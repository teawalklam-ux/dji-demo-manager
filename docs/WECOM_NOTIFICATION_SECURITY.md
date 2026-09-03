# 企业微信通知安全配置

企业微信真实 `@` 仍由文本消息中的 `mentioned_mobile_list` 产生。本次安全加固只改变 Edge Function 的入站鉴权、Webhook 存放位置和固定收件人配置，不改变出站消息结构。

## 必需的 Edge Function Secrets

在部署新函数前配置：

- `WECOM_WEBHOOK_URL`：当前企业微信机器人的完整 Webhook URL。
- `APPROVAL_CC_MOBILES`：审批通过时固定抄送的企业微信手机号。使用 JSON 字符串数组或逗号分隔值。
- `RETURN_MENTION_PROFILE_IDS`：归还通知固定收件人的 `profiles.id`。使用 JSON 字符串数组或逗号分隔值；函数仍从 `profiles.phone` 读取用于真实 `@` 的手机号。
- `RESERVATION_EVENTS_CRON_SECRET`：至少 32 个随机字节生成的独立 Cron 密钥，不得复用 publishable、anon 或 service-role key。

可在 Supabase Dashboard 的 Edge Function Secrets 页面设置，或使用 CLI：

```powershell
npx.cmd supabase secrets set --env-file .env.wecom.production
```

本地 secret 文件受仓库 `.gitignore` 中的 `.env*` 规则保护，不应提交。

## Cron 对应的 Vault Secret

将与 `RESERVATION_EVENTS_CRON_SECRET` 完全相同的随机值写入 Vault，名称必须为 `reservation_events_cron_secret`。生产库中已有同名记录时用 `vault.update_secret` 更新；没有时用 `vault.create_secret` 创建。

示意 SQL 中不要保留占位符，执行前通过安全渠道替换：

```sql
select vault.create_secret(
  '<与 RESERVATION_EVENTS_CRON_SECRET 相同的随机值>',
  'reservation_events_cron_secret',
  'Calls notify-reservation-events from pg_cron'
);
```

Vault 配置完成后再应用迁移 `20260903064630_secure_wecom_notification_invocations.sql`。迁移会移除使用公开 publishable key 的旧任务，并使用独立密钥重新调度。

## 部署顺序

1. 保留现有 `WECOM_WEBHOOK_URL`，先配置另外三个 Edge Function Secrets。
2. 在 Vault 配置同值的 `reservation_events_cron_secret`。
3. 部署 `notify-approval`、`notify-return`、`notify-reservation-events` 和 `wecom-config-status`。
4. 应用数据库迁移并确认 `notify_reservation_events` 已重新创建。
5. 使用测试申请验证企业微信返回 `errcode: 0`，并确认目标用户产生真实 `@`。
6. 验证完成后轮换曾暴露的企业微信 Webhook；新机器人应位于预期群聊中，并立即更新 `WECOM_WEBHOOK_URL`。

## 验收矩阵

- `notify-approval`：无 JWT 返回 401；无关用户返回 403；申请人、实际处理过该申请的审批人或启用中的管理员可以触发。
- `notify-reservation-events`：publishable key 和错误 Cron 密钥返回 401；正确 Cron 密钥可以处理 outbox。
- `wecom-config-status`：仅启用中的超级管理员可读取布尔配置状态，响应不包含任何 Secret 原值。
- 企业微信出站请求继续使用 `msgtype: "text"`、原有 `content` 和 `mentioned_mobile_list`。
