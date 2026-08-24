# UGREEN NAS 归还水印照片归档方案

适用设备：UGREEN NASync DXP4800 Plus，UGOS Pro `1.18.0.0093`，4 × 16 TB，可运行 Docker。

## 目标与边界

- NAS 主动从 Supabase 拉取，不开放 NAS 管理端口给公网。
- 每张照片在最终 NAS 路径落盘、`fsync`、回读后计算 SHA-256；Supabase Edge Function 再独立下载源文件计算 SHA-256，大小和哈希全部一致才标记已验证。
- 低于 Storage 配额 80% 时永不自动清理 Supabase；达到 80% 后，才允许通过 Supabase Storage API 清理已完成 NAS 双哈希校验且同步成功 Webhook 已送达的文件，目标降回 70%。
- 数据库中的归还照片元数据、申请、审批和借用记录永久保留。无关联 Storage 对象不进入自动归档清理；监控每日发一次 Webhook 要求人工核查。
- 归档后照片只通过内网 HTTPS 网关查看。网关将当前 Supabase JWT 交回 Data API，由原有 `return_photos` RLS 决定是否允许读取。
- 每张照片同时生成 `.metadata.json` 证据清单并写入 NAS SQLite 索引，固定保存照片、借出记录、申请、样机之间的对应关系。

## 状态机

```text
pending
  -> leased
  -> NAS 原子写入 + 本地回读 SHA-256
  -> Edge Function 独立下载源文件并核对 SHA-256/大小
  -> 写入申请号/机型/SN 后四位及原 Supabase 路径侧车清单与搜索索引
  -> verified
  -> 同步 Webhook delivered
  -> Storage >= 80%
  -> deleting
  -> Storage API 删除并复查对象已不存在
  -> deleted（元数据仍保留）
```

任一步骤失败都会保留 Supabase 源文件。租约过期后可安全重试；归档完成和清理完成均使用幂等键。Webhook 使用数据库 outbox，失败后以最长 6 小时间隔持续重试。

## 组件

- `return_photo_archive_jobs`：服务角色专用归档状态机。
- `return_photo_archive_events`：独立 Webhook outbox，不保存 Webhook URL；专用地址未配置时复用现有企业微信机器人。
- `return_photo_storage_usage_snapshots`：每小时容量快照。
- `nas-photo-archive`：NAS 领取任务、短时下载 URL 与完成校验 API；使用独立 `NAS_ARCHIVE_TOKEN`。
- `monitor-return-photo-archive`：每 10 分钟重试 Webhook、检查容量并清理满足条件的文件。
- `nas/return-photo-archive`：UGREEN Docker 归档代理及内网查看网关。

## 业务记录映射与快速检索

归档任务在照片首次进入队列时固定保存以下快照：

```text
return_photo_id
  -> borrow_record_id
  -> request_id + request_number
  -> item_id + item_name + item_model + serial_number_last4
  -> source_bucket_id + source_storage_path
```

物理文件使用 `YYYY/MM/DD/<return_photo_id>.<ext>`，避免中文、型号变更或重名造成路径冲突；同目录生成 `<文件名>.metadata.json`，记录上述业务标签、拍摄时间、文件大小、SHA-256、服务端验证时间以及 `return-photos/<原 storage_path>`。数据库归档任务和 NAS SQLite 也保留相同来源路径；即使 SQLite 索引损坏，也能从侧车清单重建并按原路径导回 Supabase。

NAS SQLite 对申请号、机型和 SN 后四位建立索引。前端「我的申请」和管理员「申请历史」均提供组合查询入口；NAS 先查本地索引，再携带浏览器当前 JWT 回查 Supabase `return_photos` RLS，只返回该账号有权查看的照片。申请号或照片 UUID 本身不构成授权凭据。

## 调度

- NAS Docker 代理每 60 秒主动领取一次，正常情况下新照片约 0–60 秒进入同步。
- `monitor_return_photo_archive` 使用 `3,13,23,33,43,53 * * * *`，每小时第 03/13/23/33/43/53 分钟检查 Webhook、Supabase Storage/Database 容量和可清理任务；与现有每 5 分钟通知任务错峰。
- 容量快照最多每小时写入一次；告警事件按类型和北京时间日期去重。
- 低于 80% 时清理领取数量固定为 0；达到 80% 时每轮最多清理 100 张最早完成验证的文件，直到估算用量降至 70% 或没有满足证据条件的文件。
- 清理开关默认关闭；同步成功 Webhook 未送达时，即使达到容量阈值也不能领取清理任务。

现有 `storage_cleanup_queue` 和 `cleanup-return-photos` 继续只负责管理员明确删除测试或取消记录产生的无主文件，不与 NAS 归档队列混用。

## 必需密钥

Edge Function Secrets：

- `NAS_ARCHIVE_TOKEN`：至少 32 个随机字节，仅 NAS 与 `nas-photo-archive` 持有。
- `RETURN_PHOTO_ARCHIVE_CRON_SECRET`：Cron 调用专用随机密钥。
- `RETURN_PHOTO_ARCHIVE_WEBHOOK_URL`：可选的专用 Webhook；未配置时回退到现有 `WECOM_WEBHOOK_URL`。
- `RETURN_PHOTO_ARCHIVE_WEBHOOK_FORMAT`：`wecom`、`generic` 或 `auto`。
- `RETURN_PHOTO_ARCHIVE_WEBHOOK_BEARER_TOKEN`：仅通用 Webhook 需要，可选。

数据库 Vault 保存 `RETURN_PHOTO_ARCHIVE_CRON_SECRET` 的同值副本，名称固定为 `return_photo_archive_cron_secret`。密钥不得写入迁移、Git、前端变量或 Cron 命令文本。

NAS `.env`：

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`（仅用于把浏览器 JWT 交回 RLS 校验）
- `NAS_ARCHIVE_TOKEN`
- 归档目录、SQLite 状态目录、HTTPS/反向代理配置

NAS 不保存 `service_role`，也不使用会绕过 RLS 且能访问全部 bucket 的 Supabase S3 Access Key。

## 告警规则

- Storage 达 70%：每天一次预警 Webhook。
- Storage 达 80%：开始清理已验证且 Webhook 已送达的文件，目标降到 70%；低于该阈值不因照片年龄清理。
- Storage 达 90%：每天一次严重预警。
- Database 达 70% / 90%：普通 / 严重预警。
- `return-photos` 桶出现没有对应 `return_photos` 记录的对象：每天一次预警，永不自动删除。
- 同步连续失败、清理失败、同步成功、清理成功：专用 Webhook 通知。

当前组织只有一个 Supabase 项目，因此项目内 `storage.objects` 汇总等于组织 Storage 用量。若以后同一组织增加项目，必须改为组织级用量 API 或汇总全部项目，否则本项目监控会低估组织级 1 GB 配额。

## 安全部署顺序

1. 确认 NAS 存储池、共享目录权限、快照策略及第二份备份策略。
2. 配置内网 HTTPS 域名和受客户端信任的证书；GitHub Pages 是 HTTPS，不能读取 HTTP NAS 地址。
3. 确认现有 `WECOM_WEBHOOK_URL` 可接收归档告警；如需消息隔离，再创建专用 Webhook 并写入 `RETURN_PHOTO_ARCHIVE_WEBHOOK_URL`。
4. 应用数据库迁移并部署两个 Edge Function；此时 `cleanup_enabled=false`。
5. 在 UGREEN NAS 通过 Docker Compose 启动归档代理，确认 `/health` 正常。
6. 让 5 条现有照片全部完成 NAS 与服务端双哈希校验，核对文件数量、总字节数和 Webhook。
7. 分别用有权账号和无权账号测试内网照片网关，确认 RLS 不被绕过。
8. 写入 `nas_view_base_url`，测试申请号、机型、SN 后四位组合检索及申请详情读取。
9. 最后启用 `cleanup_enabled`。即使启用，Storage 低于 80% 时也不会领取任何清理任务；所有删除都通过 Storage API。

## 紧急停止与恢复

- 停止自动清理：把 `return_photo_archive_config.cleanup_enabled` 设为 `false`。同步与查看仍可继续。
- 停止全部 NAS 处理：停止 `dji-return-photo-archive` 容器。未验证任务不会被清理。
- Webhook 不可用：删除自动暂停，因为清理任务要求对应的同步成功事件已经投递。
- NAS 文件异常：在 Supabase 副本尚未清理时可重新领取并覆盖归档；清理后需从 NAS 快照或第二份备份恢复。

### 按原路径导回 Supabase

每张 NAS 侧车文件的 `supabase_restore.bucket_id` 和 `supabase_restore.storage_path` 是唯一恢复目标。恢复时由受控服务端流程执行：先重新计算 NAS 文件 SHA-256，再以 `upsert=false` 上传到原 bucket/路径，防止覆盖意外存在的对象；随后从 Supabase 独立下载并与侧车大小、SHA-256 比对，全部一致后才清空 `return_photos.supabase_deleted_at`。不得由浏览器直接修改恢复状态。

RAID 只能提高可用性，不等于备份。要满足“永久保存”，至少应为归档目录开启快照，并保留另一份离线或异机副本。

## 官方参考

- [UGREEN Docker / Container](https://support.ugnas.com/detail/article/en-US/289)
- [UGREEN Docker Compose 与 HTTPS 反向代理示例](https://support.ugnas.com/detail/article/zh-CN/358)
- [Supabase Storage 删除对象](https://supabase.com/docs/guides/storage/management/delete-objects)
- [Supabase Storage 标准上传](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- [Supabase S3 Access Key 权限边界](https://supabase.com/docs/guides/storage/s3/authentication)
- [Supabase 定时调用 Edge Function](https://supabase.com/docs/guides/functions/schedule-functions)
