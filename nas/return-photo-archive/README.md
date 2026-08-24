# UGREEN NAS 归还照片归档代理

面向 UGREEN NASync DXP4800 Plus / UGOS Pro 的 Docker 服务，职责如下：

- 主动轮询 Supabase 的最小权限归档 API，不在 NAS 保存 `service_role` 或全桶 S3 密钥。
- 文件先写入同目录临时文件，`fsync` 后原子改名，再从最终文件回读并计算 SHA-256。
- 服务端重新下载 Supabase 源文件并独立计算 SHA-256；大小与哈希同时一致后才标记已归档。
- 提供只读内网照片接口。每次读取都把用户的 Supabase JWT 交回 Data API，由原有 RLS 判断是否有查看权限。
- 为每张照片生成同名 `.metadata.json`，固定记录申请号、借出记录、机型、SN 后四位、哈希、验证时间及原 Supabase bucket/object path。
- 本地 SQLite 为申请号、机型和 SN 后四位建立查询索引，不保存用户密码或 Supabase `service_role`。
- `/search` 仅接受启用状态的超级管理员：先用当前用户 JWT 调用数据库权限函数复核角色，再查询本地标签并通过 `return_photos` RLS 过滤结果。普通用户的单张照片查看仍沿用申请详情中的原有 RLS。

## UGOS 部署

1. 在 UGOS Pro 创建专用共享目录，例如 `DJI归还照片`，启用快照并为 Docker 运行 UID/GID 授予读写权限。
2. 复制 `.env.example` 为 `.env`，填写共享目录的真实宿主机路径、publishable key 和部署时生成的 `NAS_ARCHIVE_TOKEN`。
3. 配置 HTTPS：优先使用 UGOS 反向代理给容器的 `8787` 端口配置受客户端信任的证书；也可以把证书挂载到 `certs/` 由容器直接终止 TLS。
4. 执行 `docker compose up -d --build`，再检查 `docker compose ps` 与 `docker compose logs --tail=100`。
5. 访问 `https://<NAS内网域名>/health`，确认服务、归档数量和磁盘余量均正常。

不要把 `.env`、NAS SSH 私钥、Webhook URL 或证书私钥提交到 Git。

## 数据保护

服务端在 Storage 低于 80% 时永久保留 Supabase 热副本；达到 80% 后先发送删除前 Webhook 并等待至少 5 分钟，才清理已验证且同步通知已送达的对象，目标回落到 70%。SQLite 和 `.metadata.json` 都保留原 `return-photos/<storage_path>`，可用受控服务端流程以 `upsert=false` 按原路径导回并重新校验。RAID 不能替代备份，建议为归档目录启用定期快照，并增加另一台设备或离线盘作为第二份备份。

## 本地测试

```sh
python -m unittest -v test_archive_agent.py
```
