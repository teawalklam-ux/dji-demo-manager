# 全局系统设置

部署时先应用 `20260915015532_global_system_settings.sql`，再部署 `check-overdue` Edge Function 和前端。迁移创建唯一配置行，初始值与原设置页一致；企业微信逾期通知默认关闭，需要超级管理员明确启用。浏览器旧 localStorage 配置不导入，避免将个人偏好或遗留 Webhook URL 写入全局配置。

`system_settings` 仅保存五项非敏感配置。RLS 根据 `profiles.status = 'active'` 允许有效用户读取，仅启用中的 `super_admin` 可以更新；客户端不能插入、删除或修改配置行 ID。权限读取数据库当前状态，不依赖可编辑的 JWT 元数据。

新申请读取 `default_borrow_days`，按借用日期加天数生成默认归还日期。修改借用日期时，未手动编辑的归还日期跟随变化；已手动输入的日期和已有申请日期保留。读取失败会阻止初始化新申请，并提供现有重试入口。

`check-overdue` 每次发送前读取 `overdue_wecom_notify`。关闭、读取失败、配置缺失或 Secret 未配置时跳过企业微信发送；逾期状态维护和站内通知继续运行。成功计数仅在 Webhook HTTP 成功且 `errcode = 0` 后累计。Webhook 与收件人仍通过 Edge Function Secrets 管理，设置页继续只展示配置状态。

条码前缀、到期前提醒天数和邮件开关在本次变更中迁移为共享配置，未新增条码生成、提前提醒或邮件发送机制。

验证：Node.js 24 下运行 `npm test`、`npm run build`。RLS 测试使用 PGlite 执行实际迁移和非 owner 角色查询，模拟 Supabase auth/profile 边界；逾期测试执行实际处理函数，模拟数据库及 HTTP 边界，不发送真实通知。发布环境仍需按正常流程应用迁移与部署函数。
