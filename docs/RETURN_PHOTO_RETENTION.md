# 归还水印照片永久留存、NAS 归档与容量核算

核算日期：2026-08-24。计费容量按十进制 GB 计算，业务预测假设每次归还产生 1 张照片。

## 留存策略

- `return_photos` 拍摄元数据永久保留，不再执行 30 天或 1 年到期清理。
- 照片文件永久副本转存到 UGREEN NAS；Supabase 文件持续作为热副本保留，只有 Storage 达到 80%、当日清理前预告成功送达至少 5 分钟后，才允许清理已完成 NAS 与服务端双哈希校验且同步 Webhook 成功的文件。
- 浏览器角色不能更新或删除照片元数据；包含照片的借用记录不能通过级联删除移除照片证据。
- `cleanup-return-photos` 仅处理管理员明确删除测试/取消记录时形成的无主文件队列，不按文件年龄扫描。
- NAS 自动清理由独立状态机执行，必须先完成文件大小、SHA-256、内网可读路径、同步通知及删除前预告投递证明；删除只使用 Storage API。
- 每张 NAS 归档包含申请号、借出记录 ID、机型、SN 后四位及原 Supabase bucket/object path 的 SQLite 索引和 JSON 侧车清单；组合检索仅供超级管理员从「申请历史」使用，普通用户仍可在自己的申请详情查看有权访问的单张照片，归档文件可按原路径导回 Supabase。
- “永久”不等同于不可篡改 WORM。NAS 归档目录仍需快照与第二份离线或异机备份，详见 `docs/NAS_RETURN_PHOTO_ARCHIVE.md`。

## 生产快照

| 指标 | 结果 |
| --- | ---: |
| Supabase 方案 | Free |
| Storage 配额 | 1 GB（组织级） |
| 当前全部 Storage | 1.352 MB / 7 个对象 |
| 已关联归还照片 | 1.087 MB / 5 张 |
| 未关联对象 | 0.265 MB / 2 个 |
| 实测照片平均 / P95 / 最大 | 217 KB / 273 KB / 277 KB |
| Bucket 单文件上限 | 5 MiB |
| 当前数据库大小 | 22.1 MB / 500 MB 限额 |
| 观察周期 | 63 天，5 次归还（约 29 次/年） |

## 容量预测

使用实测平均值 217,389 bytes/张；数值包含当前 1.352 MB。

| 每日归还照片 | 年增量 | 1 年总量 | 3 年总量 | 5 年总量 | Free 预计触顶 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 当前速度（0.079/天） | 0.0063 GB | 0.008 GB | 0.020 GB | 0.033 GB | 约 159 年 |
| 1/天 | 0.079 GB | 0.081 GB | 0.239 GB | 0.398 GB | 约 12.6 年 |
| 10/天 | 0.793 GB | 0.795 GB | 2.382 GB | 3.969 GB | 约 1.26 年 |
| 50/天 | 3.967 GB | 3.969 GB | 11.903 GB | 19.838 GB | 约 3 个月 |
| 100/天 | 7.935 GB | 7.936 GB | 23.805 GB | 39.675 GB | 约 46 天 |

当前 Free 配额还能容纳约 4,593 张实测平均大小的照片。Pro/Team 包含 100 GB，按相同平均值约可容纳 46 万张；即使达到 100 张/天，5 年约 39.7 GB，仍低于包含额度。NAS 自动归档正常运行后，Supabase 会持续保留全部热副本，直到 Storage 达到 80%；系统先发送当日清理前预告并至少等待 5 分钟，再仅清理足够数量的最早已验证文件以回落到 70%。

## Supabase 边界

- [Storage 计费](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)：Free 1 GB；Pro/Team 100 GB，超出后约 $0.0213/GB/月。
- [流量计费](https://supabase.com/docs/guides/platform/manage-your-usage/egress)：Free 每月 5 GB；Pro/Team 每月 250 GB。按实测平均大小，Free 约支持每月 23,000 次原图读取。
- [上传限制](https://supabase.com/docs/guides/storage/uploads/file-limits)：Free 全局单文件最高 50 MB；本项目 bucket 进一步限制为 5 MiB。
- [数据库容量](https://supabase.com/docs/guides/platform/database-size)：Free 在数据库达到 500 MB 后进入只读；当前 22.1 MB，照片二进制不存放在数据库中。
- Supabase 没有公布面向普通 File Storage 的低对象数硬上限；官方已针对数千万对象优化列表性能。本系统按已知路径签发短时 URL，不依赖全桶列表，当前对象数不是瓶颈。

## 运维阈值

- Storage 达 700 MB 时通过 Webhook 告警；低于 800 MB 永不自动清理，达到 800 MB 后先发送删除前预告并等待至少 5 分钟，才清理已校验且同步通知成功的 NAS 归档，目标降回 700 MB；达 900 MB 时发送严重告警。
- 数据库达 350 MB / 450 MB 时分别发送普通 / 严重告警。
- 若稳定超过约 3 张/天，年度复核一次；超过 10 张/天时直接按 Pro 预算管理。
- 自动清理首次部署默认关闭；现有照片全量 NAS 回读、RLS 查看与 Webhook 验收完成后，生产环境已启用。容量低于 80% 时启用状态也不会领取删除任务。
