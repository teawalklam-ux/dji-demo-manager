# DJI Demo Manager / DJI 样机管理系统

[English](#english) | [中文](#中文)

---

## English

A web application for tracking DJI demo units: inventory, borrow requests, approval, return photos, reservations, transfers, overdue handling, SOP guides, and Excel export.

The production frontend is a static Vite build published to GitHub Pages. Data, auth, storage, and scheduled work run on Supabase. Return-photo archiving is a separate Docker service intended for a UGREEN NAS. GitHub Actions deploys only the frontend.

Current Pages site: <https://teawalklam-ux.github.io/dji-demo-manager/>

### Features

- **Dashboard** — counts and status distribution for the signed-in user.
- **Inventory** — create, edit, and list units. System barcodes use `DJI-YYYYMMDD-XXXX` (`BARCODE_PREFIX` in `src/lib/constants.ts`). Administrators can batch-import from the inventory page.
- **Barcodes** — JsBarcode draws CODE128 labels. Scanning uses html5-qrcode for barcodes and qr-scanner for QR codes.
- **Borrowing** — multi-item requests, customer and marketing types, administrator-defined extra types, and transfers. Approval chains are stored in `approval_chains`.
- **Approval** — step-by-step. `private.process_approval` accepts an action only from the user assigned to the current open step. Administrators do not bypass that check.
- **Reservations** — a fully approved future borrow becomes a reservation. Migration `20260812025031_reservation_lifecycle_and_status_consistency.sql` schedules `process_reservation_lifecycle_daily` at `1 16 * * *` UTC (00:01 Asia/Shanghai the next calendar day).
- **Return photos** — the browser burns a timestamp and GPS watermark into the image. Photo metadata is kept permanently. Files are copied to the NAS archive. Supabase Storage is not deleted by age. `cleanup-return-photos` only removes objects queued when an administrator deletes a test or cancelled record. See `docs/RETURN_PHOTO_RETENTION.md`.
- **Renewal and overdue state** — renewal requests exist. `check-overdue` can mark overdue rows and optionally send a WeCom message. The repository migrations do not schedule that function.
- **People and admin** — roles are `super_admin`, `admin`, `approver`, and `user`. Self-registration stays pending until approved. Disabled accounts have their own page. Customer address book, request history, record cleanup, system logs, and global settings are separate admin screens.
- **SOP** — in-app guides, including screenshot steps under `public/sop-steps/`.
- **Export** — item, borrow, and approval sheets via SheetJS.
- **Local demo** — development builds show a local-demo sign-in. It is absent from production builds.

### Tech stack

| Layer | What the repo uses |
| --- | --- |
| UI | React 19, TypeScript, Vite 7, react-router-dom 7, Tailwind CSS 3.4, shadcn/ui (Radix) |
| Forms | react-hook-form, zod |
| Data | `@supabase/supabase-js` against hosted Supabase (Postgres, Auth, RLS, Storage) |
| Functions | Supabase Edge Functions (Deno), listed below |
| Scheduler | `pg_cron` jobs created by specific migrations |
| Charts / barcodes / export | recharts, JsBarcode, html5-qrcode, qr-scanner, SheetJS (`xlsx`) |
| Frontend hosting | GitHub Pages via `.github/workflows/deploy.yml` |
| Photo archive | Python 3.12 image in `nas/return-photo-archive` |
| Tests | `node --test` plus PGlite for the RLS test |

`package.json` has no `engines` field. The Pages workflow pins Node.js 22.

### Architecture

```
GitHub Actions (push to main, or workflow_dispatch)
  npm ci → npm run security:scan → npm run build → upload dist → GitHub Pages
  site path: /dji-demo-manager/

Browser
  VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY baked in at build time
        │
        ▼
Supabase
  Postgres + Auth + Storage + Edge Functions
  pg_cron jobs from migrations (not all functions are scheduled)

UGREEN NAS (separate)
  nas/return-photo-archive polls nas-photo-archive
  browsers read archived photos only from the NAS HTTPS gateway
```

### Roles

Navigation and route guards in `src/App.tsx` and `src/components/layout/app-layout.tsx`:

| Role | What the UI allows |
| --- | --- |
| **super_admin** | Admin screens, plus user management, customer address book, and system settings. `invite-user` allows only an active super admin. |
| **admin** | Create and edit items; categories, approval chains, request history, record cleanup, system logs. |
| **approver** | The approval queue is visible to signed-in users. Acting on a step still requires that the row be assigned to that user. |
| **user** | Inventory, borrow, own requests, return, renew, SOP, reports. |

`super_admin` satisfies every `hasRole` check. `admin` satisfies `admin`, `approver`, and `user`.

### Database

GitHub Actions does not apply SQL. Schema changes live in `supabase/migrations/` (84 files). Apply them in filename order. That order is not the same as sorting by the numeric prefix: `00024` and `00036` each appear twice, and later files use `2026…` timestamps that sort after `00042`.

These files in the repository root are not part of that directory: `fix_all_sql.sql`, `setup_return_photos.sql`, `delete_requests.sql`.

`supabase/config.toml` is the local Supabase CLI config (`project_id = "webdemo"`, Postgres 17). It references `supabase/seed.sql`, and that seed file is not in the repo. `00013_seed_data.sql` inserts categories and two approval chains.

Public tables created by the migrations:

`profiles`, `categories`, `items`, `borrow_requests`, `borrow_request_items`, `approval_chains`, `approval_records`, `borrow_records`, `stock_movements`, `overdue_notifications`, `return_photos`, `user_customers`, `reservation_events`, `storage_cleanup_queue`, `return_photo_archive_config`, `return_photo_archive_jobs`, `return_photo_archive_events`, `return_photo_storage_usage_snapshots`, `sop_processes`, `app_logs`, `system_settings`.

`private.app_log_state` is created with the application-log migration.

### Scheduled jobs in migrations

Times below are UTC, as stored in `cron.schedule`.

| Job | Cron | What it calls |
| --- | --- | --- |
| `process_reservation_lifecycle_daily` | `1 16 * * *` | `public.process_reservation_lifecycle` |
| `notify_reservation_events` | `*/5 * * * *` | `notify-reservation-events`, only if Vault has `project_url` and `reservation_events_cron_secret` |
| `monitor_return_photo_archive` | `3,13,23,33,43,53 * * * *` | `monitor-return-photo-archive`, only if Vault has `project_url` and `return_photo_archive_cron_secret` |
| `prune_app_logs_daily` | `20 18 * * *` | `private.prune_app_logs` |
| `prune_cron_history_daily` | `30 18 * * *` | deletes `cron.job_run_details` older than 7 days |

`20260812025031_reservation_lifecycle_and_status_consistency.sql` unschedules the earlier job `activate_due_borrow_requests_daily`. The Edge Function `activate-reservations` is still in the repo and checks `CRON_SECRET`, but no migration schedules it.

No migration schedules `check-overdue` or `cleanup-return-photos`.

### Edge Functions

Deploy these on the Supabase project yourself. The CLI package is the `supabase` devDependency (`2.109.1`). The workflow does not deploy functions, and the repo has no linked project ref.

| Function | Caller check in this repo |
| --- | --- |
| `check-overdue` | `Authorization: Bearer <CRON_SECRET>`. WeCom send also depends on `system_settings.overdue_wecom_notify` (default false) and `WECOM_WEBHOOK_URL`. |
| `cleanup-return-photos` | `Bearer <CRON_SECRET>`. Reads `storage_cleanup_queue` only. |
| `activate-reservations` | `Bearer <CRON_SECRET>`. Calls `activate_due_borrow_requests`. Not the scheduled path above. |
| `notify-reservation-events` | `verify_jwt = false` in `supabase/config.toml`. Compares the bearer token with `RESERVATION_EVENTS_CRON_SECRET`. |
| `monitor-return-photo-archive` | `RETURN_PHOTO_ARCHIVE_CRON_SECRET`. |
| `nas-photo-archive` | `NAS_ARCHIVE_TOKEN`. |
| `notify-approval`, `notify-return`, `wecom-config-status` | `verify_jwt = true`. |
| `invite-user` | Signed-in active `super_admin`. Uses the platform service role inside the function. |

Platform-injected names used by the functions include `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Do not put the service role key in the frontend or in GitHub Actions.

WeCom secret names and the Vault setup order are in `docs/WECOM_NOTIFICATION_SECURITY.md`. NAS secret names are in `docs/NAS_RETURN_PHOTO_ARCHIVE.md`. Global settings behavior is in `docs/system-settings.md`.

`system_settings` stores `barcode_prefix`, `default_borrow_days`, `overdue_remind_days`, `overdue_email_notify`, and `overdue_wecom_notify`. It does not store webhook URLs. The settings migration does not add an email sender or an advance-reminder job.

### Project layout

```
src/                 React application
  components/        UI, auth, barcode, borrow, layout
  pages/             dashboard, items, borrow, approval, admin, reports, sop
  services/          Supabase calls
supabase/migrations/ SQL applied in filename order
supabase/functions/  Edge Functions
supabase/config.toml local CLI config
.github/workflows/deploy.yml
nas/return-photo-archive/
docs/                NAS, retention, WeCom, settings, SOP, versioning
public/              404.html, logo, sop-steps/
scripts/             local demo API, SOP capture, security scan
tests/               node:test
```

### Getting started

#### Prerequisites

- Node.js 22 (the version in `.github/workflows/deploy.yml`)
- npm
- A Supabase project for anything other than the local demo

#### Environment

Copy `.env.example` to `.env.local` and fill in the two frontend variables. `.gitignore` ignores `.env*` except reviewed `.env.example` files. Do not commit `.env.local`.

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

Those two names are the only frontend variables. `src/lib/supabase.ts` reads them. If either is missing, the client warns and uses a placeholder URL. The placeholders in `.env.example` are not a production configuration. The Pages build receives the real values from GitHub Actions secrets. Server secrets are listed in `supabase/functions/.env.example` and belong in Supabase secrets, not in `VITE_*`. See `docs/REPOSITORY_PRIVACY.md`.

#### Install and run

```bash
npm ci
npm run dev       # Vite, base path /dji-demo-manager/
npm run build     # tsc -b && vite build
npm run preview
npm run lint
npm test
npm run security:scan
```

Open `http://127.0.0.1:5173/dji-demo-manager/`. `vite.config.ts` sets `base` to `/dji-demo-manager/`, and `BrowserRouter` uses the same basename.

`npm run build` writes `dist/`. Vite copies `public/`, including `public/404.html`. The workflow also runs `cp public/404.html dist/404.html` before uploading the artifact. `index.html` and `404.html` implement the GitHub Pages SPA redirect.

#### Local demo

The demo API is not an npm script. In one shell:

```bash
node scripts/demo-server.mjs
```

It listens on `127.0.0.1:5176`. Then start `npm run dev` and use **本地演示** on the sign-in page. The button is rendered only when `import.meta.env.DEV` is true. The demo account is in `scripts/demo-server.mjs` and `src/lib/demo-mode.ts`.

#### NAS archive

From `nas/return-photo-archive`:

```bash
docker compose up -d --build
```

`docker-compose.yml` builds `dji-return-photo-archive:1.63`, reads `.env`, and publishes `${VIEW_BIND_ADDRESS:-0.0.0.0}:${VIEW_PORT:-8787}`. The image runs `archive_agent.py` as user `archive`.

Copy `nas/return-photo-archive/.env.example` to `.env` in that directory and replace the placeholders. The compose file requires `ARCHIVE_HOST_PATH`. The agent requires `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `NAS_ARCHIVE_TOKEN`. The example also sets archive paths, `PUID`, `PGID`, TLS files, `ALLOWED_ORIGIN`, and `VIEW_BIND_ADDRESS=127.0.0.1`. If `VIEW_BIND_ADDRESS` is unset, Compose publishes port 8787 on `0.0.0.0`. The agent’s own default `ALLOWED_ORIGIN` is `https://teawalklam-ux.github.io`. Do not commit `.env`, NAS private keys, or webhook URLs. Unit tests in that directory:

```bash
python -m unittest -v test_archive_agent.py
```

Operational detail, retention thresholds, and the secret checklist are in `nas/return-photo-archive/README.md` and `docs/NAS_RETURN_PHOTO_ARCHIVE.md`.

#### GitHub Pages

`.github/workflows/deploy.yml`:

- Triggers: push to `main`, or `workflow_dispatch`
- Node.js 22, `npm ci`, `npm run security:scan`, `npm run build`
- Build environment: secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Uploads `./dist` with `actions/upload-pages-artifact@v3`
- Deploys with `actions/deploy-pages@v4` to the `github-pages` environment
- Concurrency group `pages`, `cancel-in-progress: false`

Pages source for this workflow is GitHub Actions. The workflow does not set Supabase secrets, apply migrations, or deploy Edge Functions.

`.github/workflows/security.yml` runs on push, pull request, and `workflow_dispatch`. It executes `node scripts/security-scan.mjs --staged` and `node --test tests/security-scan.test.ts`. Before committing, `docs/REPOSITORY_PRIVACY.md` also describes `npm run security:scan` and `npm run security:history`.

### Security

- RLS is defined in the migrations.
- Privileged SQL is `SECURITY DEFINER` and then revoked from `anon` where later migrations say so.
- The UI uses an auth guard and role checks on specific routes.
- Self-registration does not start as an active user.
- Cron-invoked functions check a dedicated bearer secret. That secret is not always `CRON_SECRET`; see the table above.
- `app-log` redacts sensitive keys before insert. It is not a credential store.

### License

[MIT License](LICENSE). Copyright (c) 2026 teawalklam-ux.

Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## 中文

用于管理大疆样机的 Web 应用，覆盖库存、借用、审批、归还拍照、预约、转借、逾期、SOP 指引和 Excel 导出。

生产前端是发布到 GitHub Pages 的 Vite 静态站点。数据、登录、存储和定时任务在 Supabase。归还照片归档是单独的 Docker 服务，面向 UGREEN NAS。GitHub Actions 只部署前端。

当前 Pages 站点：<https://teawalklam-ux.github.io/dji-demo-manager/>

### 功能

- **仪表盘** — 当前用户可见的数量和状态分布。
- **样机** — 新增、编辑和列表。系统条码格式为 `DJI-YYYYMMDD-XXXX`（`src/lib/constants.ts` 的 `BARCODE_PREFIX`）。管理员可在库存页批量导入。
- **条码** — JsBarcode 绘制 CODE128。扫描时条形码用 html5-qrcode，二维码用 qr-scanner。
- **借用** — 多台样机、客户试用、营销演示、管理员配置的其他类型，以及转借。审批链存在 `approval_chains`。
- **审批** — 按步骤进行。`private.process_approval` 只接受当前未完成步骤上指定的用户。管理员不能跳过这个检查。
- **预约** — 已通过且借用日在未来的申请成为预约。迁移 `20260812025031_reservation_lifecycle_and_status_consistency.sql` 以 `1 16 * * *`（UTC，对应 Asia/Shanghai 次日 00:01）调度 `process_reservation_lifecycle_daily`。
- **归还照片** — 浏览器把时间戳和 GPS 水印烧进图片。照片元数据永久保留。文件复制到 NAS。Supabase Storage 不按存放天数删除。`cleanup-return-photos` 只处理管理员删除测试或已取消记录时写入的清理队列。见 `docs/RETURN_PHOTO_RETENTION.md`。
- **续借与逾期** — 有续借。`check-overdue` 可以更新逾期状态，并在开关打开时发送企业微信。仓库里的迁移没有调度这个函数。
- **人员与管理** — 角色为 `super_admin`、`admin`、`approver`、`user`。自行注册后等待审批。停用账户有单独页面。客户地址簿、申请历史、记录清理、系统日志和全局设置是独立管理页。
- **SOP** — 应用内指引，截图在 `public/sop-steps/`。
- **导出** — 用 SheetJS 导出样机、借用和审批表。
- **本地演示** — 仅开发构建显示本地演示登录，生产构建没有这个入口。

### 技术栈

| 层级 | 仓库中的实现 |
| --- | --- |
| 界面 | React 19、TypeScript、Vite 7、react-router-dom 7、Tailwind CSS 3.4、shadcn/ui（Radix） |
| 表单 | react-hook-form、zod |
| 数据 | `@supabase/supabase-js` 连接托管的 Supabase（Postgres、Auth、RLS、Storage） |
| 函数 | 下列 Supabase Edge Functions（Deno） |
| 定时 | 由具体迁移创建的 `pg_cron` 任务 |
| 图表 / 条码 / 导出 | recharts、JsBarcode、html5-qrcode、qr-scanner、SheetJS（`xlsx`） |
| 前端托管 | GitHub Pages，工作流 `.github/workflows/deploy.yml` |
| 照片归档 | `nas/return-photo-archive` 中的 Python 3.12 镜像 |
| 测试 | `node --test`，RLS 测试使用 PGlite |

`package.json` 没有 `engines`。Pages 工作流固定 Node.js 22。

### 架构

```
GitHub Actions（推送到 main，或手动触发）
  npm ci → npm run security:scan → npm run build → 上传 dist → GitHub Pages
  站点路径：/dji-demo-manager/

浏览器
  构建时写入 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY
        │
        ▼
Supabase
  Postgres + Auth + Storage + Edge Functions
  迁移里的 pg_cron（不是每个函数都有定时任务）

UGREEN NAS（另外部署）
  nas/return-photo-archive 轮询 nas-photo-archive
  浏览器只从 NAS 的 HTTPS 网关读取已归档照片
```

### 角色

依据 `src/App.tsx` 和 `src/components/layout/app-layout.tsx` 的导航与路由守卫：

| 角色 | 界面权限 |
| --- | --- |
| **super_admin** | 管理页，以及用户管理、客户地址簿、系统设置。`invite-user` 只允许启用中的超级管理员。 |
| **admin** | 新增和编辑样机；分类、审批链、申请历史、记录清理、系统日志。 |
| **approver** | 已登录用户都能看到审批队列。对某一步执行通过或拒绝，仍必须是该步骤指定的人。 |
| **user** | 样机、借用、我的申请、归还、续借、SOP、报表。 |

`super_admin` 通过所有 `hasRole` 检查。`admin` 同时满足 `admin`、`approver` 和 `user`。

### 数据库

GitHub Actions 不执行 SQL。结构变更在 `supabase/migrations/`（84 个文件），按文件名顺序应用。这和只按数字前缀排序不同：`00024` 和 `00036` 各有两个文件，更晚的文件使用 `2026…` 时间戳，排在 `00042` 之后。

仓库根目录的 `fix_all_sql.sql`、`setup_return_photos.sql`、`delete_requests.sql` 不在迁移目录中。

`supabase/config.toml` 是本地 Supabase CLI 配置（`project_id = "webdemo"`，Postgres 17）。它引用了 `supabase/seed.sql`，仓库里没有这个种子文件。`00013_seed_data.sql` 会插入分类和两条审批链。

迁移创建的 public 表：

`profiles`、`categories`、`items`、`borrow_requests`、`borrow_request_items`、`approval_chains`、`approval_records`、`borrow_records`、`stock_movements`、`overdue_notifications`、`return_photos`、`user_customers`、`reservation_events`、`storage_cleanup_queue`、`return_photo_archive_config`、`return_photo_archive_jobs`、`return_photo_archive_events`、`return_photo_storage_usage_snapshots`、`sop_processes`、`app_logs`、`system_settings`。

应用日志迁移同时创建 `private.app_log_state`。

### 迁移中的定时任务

下面的时间是 `cron.schedule` 中的 UTC。

| 任务 | Cron | 调用 |
| --- | --- | --- |
| `process_reservation_lifecycle_daily` | `1 16 * * *` | `public.process_reservation_lifecycle` |
| `notify_reservation_events` | `*/5 * * * *` | `notify-reservation-events`；仅当 Vault 中有 `project_url` 和 `reservation_events_cron_secret` |
| `monitor_return_photo_archive` | `3,13,23,33,43,53 * * * *` | `monitor-return-photo-archive`；仅当 Vault 中有 `project_url` 和 `return_photo_archive_cron_secret` |
| `prune_app_logs_daily` | `20 18 * * *` | `private.prune_app_logs` |
| `prune_cron_history_daily` | `30 18 * * *` | 删除 7 天前的 `cron.job_run_details` |

`20260812025031_reservation_lifecycle_and_status_consistency.sql` 会取消更早的 `activate_due_borrow_requests_daily`。Edge Function `activate-reservations` 仍在仓库中，并校验 `CRON_SECRET`，但没有迁移去调度它。

没有迁移调度 `check-overdue` 或 `cleanup-return-photos`。

### Edge Functions

需要自行部署到 Supabase 项目。CLI 在开发依赖 `supabase`（`2.109.1`）。工作流不部署函数，仓库里也没有已绑定的 project ref。

| 函数 | 仓库中的调用校验 |
| --- | --- |
| `check-overdue` | `Authorization: Bearer <CRON_SECRET>`。企业微信还取决于 `system_settings.overdue_wecom_notify`（默认关闭）和 `WECOM_WEBHOOK_URL`。 |
| `cleanup-return-photos` | `Bearer <CRON_SECRET>`。只读 `storage_cleanup_queue`。 |
| `activate-reservations` | `Bearer <CRON_SECRET>`。调用 `activate_due_borrow_requests`。不是上面的定时路径。 |
| `notify-reservation-events` | `supabase/config.toml` 中 `verify_jwt = false`。用 bearer token 与 `RESERVATION_EVENTS_CRON_SECRET` 比较。 |
| `monitor-return-photo-archive` | `RETURN_PHOTO_ARCHIVE_CRON_SECRET`。 |
| `nas-photo-archive` | `NAS_ARCHIVE_TOKEN`。 |
| `notify-approval`、`notify-return`、`wecom-config-status` | `verify_jwt = true`。 |
| `invite-user` | 已登录且启用的 `super_admin`。函数内部使用平台注入的 service role。 |

函数还会读取平台注入的 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。不要把 service role key 放到前端或 GitHub Actions。

企业微信密钥名称和 Vault 顺序见 `docs/WECOM_NOTIFICATION_SECURITY.md`。NAS 密钥见 `docs/NAS_RETURN_PHOTO_ARCHIVE.md`。全局设置见 `docs/system-settings.md`。

`system_settings` 保存 `barcode_prefix`、`default_borrow_days`、`overdue_remind_days`、`overdue_email_notify`、`overdue_wecom_notify`。这里不保存 Webhook URL。该迁移没有增加发信程序或提前提醒任务。

### 目录

```
src/                 React 应用
  components/        界面、登录、条码、借用、布局
  pages/             仪表盘、样机、借用、审批、管理、报表、SOP
  services/          Supabase 调用
supabase/migrations/ 按文件名顺序应用的 SQL
supabase/functions/  Edge Functions
supabase/config.toml 本地 CLI 配置
.github/workflows/deploy.yml
nas/return-photo-archive/
docs/                NAS、留存、企业微信、设置、SOP、版本流程、仓库脱敏
public/              404.html、标志、sop-steps/
scripts/             本地演示 API、SOP 截图、敏感信息扫描
tests/               node:test
```

### 本地运行

#### 前置条件

- Node.js 22（与 `.github/workflows/deploy.yml` 一致）
- npm
- 除本地演示外，需要一个 Supabase 项目

#### 环境变量

把根目录 `.env.example` 复制为 `.env.local` 再填写两个前端变量。`.gitignore` 忽略 `.env*`，但保留已审核的 `.env.example`。不要提交 `.env.local`。

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

前端只用这两个变量，由 `src/lib/supabase.ts` 读取。缺任何一个时，客户端会警告并使用占位 URL。`.env.example` 里的占位符不能当作生产配置。Pages 构建从 GitHub Actions secrets 注入真实值。服务端密钥列在 `supabase/functions/.env.example`，应放进 Supabase secrets，不要放进 `VITE_*`。见 `docs/REPOSITORY_PRIVACY.md`。

#### 安装与命令

```bash
npm ci
npm run dev       # Vite，基础路径 /dji-demo-manager/
npm run build     # tsc -b && vite build
npm run preview
npm run lint
npm test
npm run security:scan
```

打开 `http://127.0.0.1:5173/dji-demo-manager/`。`vite.config.ts` 的 `base` 和 `BrowserRouter` 的 `basename` 都是 `/dji-demo-manager/`。

`npm run build` 生成 `dist/`。Vite 会复制 `public/`，其中包括 `public/404.html`。工作流在上传前还会执行 `cp public/404.html dist/404.html`。`index.html` 与 `404.html` 负责 GitHub Pages 的 SPA 跳转。

#### 本地演示

演示 API 没有 npm script。另开一个终端：

```bash
node scripts/demo-server.mjs
```

它监听 `127.0.0.1:5176`。再运行 `npm run dev`，在登录页使用 **本地演示**。这个按钮只在 `import.meta.env.DEV` 时渲染。演示账号写在 `scripts/demo-server.mjs` 和 `src/lib/demo-mode.ts`。

#### NAS 归档

在 `nas/return-photo-archive` 目录：

```bash
docker compose up -d --build
```

`docker-compose.yml` 构建镜像 `dji-return-photo-archive:1.63`，读取 `.env`，并把 `${VIEW_BIND_ADDRESS:-0.0.0.0}:${VIEW_PORT:-8787}` 发布出来。镜像以用户 `archive` 运行 `archive_agent.py`。

把 `nas/return-photo-archive/.env.example` 复制为该目录的 `.env`，并替换占位符。Compose 必须提供 `ARCHIVE_HOST_PATH`。代理进程必须提供 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 和 `NAS_ARCHIVE_TOKEN`。示例还包含归档目录、`PUID`、`PGID`、TLS 文件、`ALLOWED_ORIGIN`，以及 `VIEW_BIND_ADDRESS=127.0.0.1`。若未设置 `VIEW_BIND_ADDRESS`，Compose 会把 8787 发布到 `0.0.0.0`。代理代码自身的 `ALLOWED_ORIGIN` 默认值是 `https://teawalklam-ux.github.io`。不要提交 `.env`、NAS 私钥或 Webhook URL。该目录的单元测试：

```bash
python -m unittest -v test_archive_agent.py
```

留存阈值、密钥清单和操作顺序见 `nas/return-photo-archive/README.md` 与 `docs/NAS_RETURN_PHOTO_ARCHIVE.md`。

#### GitHub Pages

`.github/workflows/deploy.yml`：

- 触发：推送到 `main`，或 `workflow_dispatch`
- Node.js 22，`npm ci`，`npm run security:scan`，`npm run build`
- 构建环境变量：secrets `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`
- 用 `actions/upload-pages-artifact@v3` 上传 `./dist`
- 用 `actions/deploy-pages@v4` 部署到 `github-pages` 环境
- 并发组 `pages`，`cancel-in-progress: false`

此工作流对应的 Pages 来源是 GitHub Actions。它不设置 Supabase 密钥、不应用迁移、也不部署 Edge Functions。

`.github/workflows/security.yml` 在推送、拉取请求和 `workflow_dispatch` 时运行。它执行 `node scripts/security-scan.mjs --staged` 和 `node --test tests/security-scan.test.ts`。提交前还可以按 `docs/REPOSITORY_PRIVACY.md` 运行 `npm run security:scan` 和 `npm run security:history`。

### 安全

- 迁移中定义了 RLS。
- 高权限 SQL 使用 `SECURITY DEFINER`，后续迁移会按文件中的语句撤销 `anon` 的执行权。
- 界面有登录守卫，部分路由还有角色检查。
- 自行注册不会直接成为启用用户。
- 由 Cron 调用的函数校验各自的 bearer secret。这个 secret 不总是 `CRON_SECRET`，见上表。
- `app-log` 在写入前会遮盖敏感字段名。它不是凭据存储。

### 许可证

[MIT License](LICENSE)。版权行：Copyright (c) 2026 teawalklam-ux。

第三方声明：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
