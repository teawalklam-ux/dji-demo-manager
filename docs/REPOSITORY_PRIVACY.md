# 仓库脱敏与配置维护

## 保持现有部署

前端继续读取 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。本地开发可将根目录 `.env.example` 复制为 `.env.local` 后填写；GitHub Pages 继续从同名 Actions Secrets 注入。模板中的占位符不能用于生产部署。

Supabase 函数的服务端配置名称列在 `supabase/functions/.env.example`，实际值保存在 Supabase Secrets；定时任务使用的同值副本保存在 Vault。不要用空模板覆盖现有 Secrets。NAS 继续使用设备上的 `.env`；示例中的用户 ID、目录、允许来源和绑定地址必须按实际环境填写。模板默认仅绑定回环地址，现有部署继续使用其原配置。

`VITE_*` 会编译进浏览器文件，不能存放管理员密钥、数据库密码、Webhook 或 Cron 密钥。浏览器使用的 Supabase anon/publishable key 是公开客户端配置，数据权限依赖 RLS 和用户认证，不能通过隐藏前端配置来代替权限控制。参见 [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)。

## 提交前检查

```sh
npm run security:scan
node scripts/security-scan.mjs --staged
npm run security:history
```

第一条检查工作区中已跟踪和未忽略的新文件；第二条检查暂存区实际内容；第三条检查本地全部引用可达的提交与文件版本。报告只包含位置和规则名称，不打印敏感原文。历史检查失败意味着旧提交仍需处理，不能因为当前文件检查通过就判定历史已清理。

GitHub Actions 在推送与拉取请求时检查提交内容，Pages 构建前也执行检查。扫描覆盖常见凭据格式、个人邮箱/手机号、管理员标识、私网地址、个人目录以及不应提交的本地文件。它不是所有密钥格式、个人资料或图片文字的完备识别器；图片、附件、自由文本及 GitHub 站外副本仍需审查。公开版不再内置 SOP 图片，图片审核方法见 [SOP_SCREENSHOTS.md](SOP_SCREENSHOTS.md)。

`.env*`（除审核过的 `.env.example`）、本地工具配置、截图产物、导出文件、证书和数据库备份均应留在忽略范围。仅有 `.gitignore` 无法让已经跟踪的文件退出版本管理；应保留本地原件并移除 Git 跟踪。开发专用演示账号是明确限定的测试数据，其生产禁用逻辑保持不变。

## 历史与远端收尾

历史脱敏需在隔离副本中准备，保留受控的本地原始备份，检查全部分支、标签和拉取请求引用。发布前应逐分支比较清理前后的文件，确保差异仅涉及敏感原文、配置样例和本地工具记录；已部署的业务代码、数据库和 Secrets 不应跟随历史清理而被重置。

替换远端历史会改变提交编号与签名，应先确认清理范围，再使用记录旧分支值的 `--force-with-lease` 逐一更新明确列出的分支；不要使用 `push --mirror`。远端出现新提交时应停止并重新准备。协作者随后需重新克隆或按新的历史同步，不能合并旧历史使敏感内容重新进入仓库。

GitHub 的拉取请求引用、缓存、旧文件直链及其他人的克隆不一定随强制推送消失。核查后按 [GitHub 敏感信息清除说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)处理，必要时申请 GitHub Support 清理。若发现真实可用密钥，先以不中断服务的顺序配置替代值、验证调用，再撤销旧值；修改 Git 历史不能撤销密钥。

## 提交身份与图片

CI 获取完整历史并扫描 author、committer 和提交说明中的邮箱。请在 GitHub Emails 中开启邮箱隐私，在本地 Git 中使用 GitHub noreply 邮箱；不要把真实联系方式写入提交说明。图片内容变化需要重新进行人工审核并更新 reviewed-public-images.json。
