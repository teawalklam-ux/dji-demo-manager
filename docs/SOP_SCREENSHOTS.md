# 系统 SOP 图文素材与验证

## 内容来源

`public/sop-steps/` 包含 15 套系统指引的 105 张 JPEG。素材直接截取本地应用真实页面（1280×860），用蓝色轮廓标出当前操作位置；账号、客户、样机、申请和编号均为合成培训数据，未读取生产记录。图片不是业务完成凭证。

图片随前端公开发布，不含任何真实凭据或个人资料。管理员自行上传图片时应先脱敏；不要把截图 URL 当作权限保护。阅读这些指引不会执行任何业务操作。

每套旧指引有 entry-1/2、workflow-1/2/3、followup-1/2 七个稳定步骤 ID；阅读器按原有顺序拼接，编辑后存为单一 workflow 顺序，保持步骤 ID。图片文件名为 `<步骤 ID>.jpg`，路径使用 Vite BASE_URL 兼容 GitHub Pages 子目录。

## 管理员维护

点击「编辑 SOP」，选择系统指引后，在对应步骤下编辑说明、截图地址或上传图片。支持 PNG/JPEG/WebP，单张不超过 1 MB；可插入、上下移动、删除和撤销。新增步骤须补齐说明与截图后保存。

沿用 `replace_sop_processes` 接口及其 RLS。`stages` JSONB 项目增加可选 `screenshot` 和 `screenshot_caption`，无数据库迁移。上传图片使用 raster data URL，与步骤一并保存；也可使用 HTTPS 或站内图片路径。旧内置步骤未填写图片字段时自动使用随包截图，不覆盖已有自定义说明。自定义步骤没有对应素材时明确提示，不生成假截图。

大量图片优先使用经脱敏的受控 HTTPS 地址，避免内联图片使整套保存请求过大。若服务端拒绝请求，会保留本页未保存修改并显示错误，不提示保存成功。

## 可重复采集与验证

先运行 `npm run dev -- --host 127.0.0.1`。脚本需要 Playwright 和本机 Edge；不新增生产依赖。若 Playwright 不在本项目，可通过 `SOP_PLAYWRIGHT_MODULE` 指向其 ESM 入口。

```powershell
$env:SOP_PLAYWRIGHT_MODULE = 'file:///绝对路径/playwright/index.mjs'
node scripts/capture-sop-screenshots.mjs
node scripts/verify-sop-reader.mjs
```

可选：`SOP_CAPTURE_URL` 指向本地开发地址，`SOP_BROWSER_CHANNEL` 默认为 msedge。仅接受 localhost / 127.0.0.1。采集支持 `--only=system-borrow-apply` 等单条指引筛选。

脚本在浏览器层替换 Supabase 模块并拦截非本机网络。业务写入全部拒绝，只有回归测试的 SOP 保存写入隔离浏览器 sessionStorage；不会触发真实提交、删除、邮件、相机上传或权限转移。未导入生产 bundle。

回归涵盖四角色目录、全部截图及翻页、关闭和键盘焦点、编辑和保存刷新、失败重试、320/375/414/768/1280/1440/1920 宽度、截图放大和减少动态效果。结果与页面截图写入 `artifacts/sop-reader/`。这些测试验证前端契约，不替代真实环境 RLS、服务端容量或公网部署验证。

更新实际功能界面后，应重新采集对应步骤并核对文案。尤其注意：系统设置当前为浏览器配置，不代表通知服务生效；NAS 检索对象是归还照片，不是完整业务数据库备份。
