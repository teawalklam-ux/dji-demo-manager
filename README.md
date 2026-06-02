# DJI Demo Manager / DJI 样机管理系统

[English](#english) | [中文](#chinese)

---

## English

A web-based demo unit management system built for DJI authorized dealers, covering the complete lifecycle of demo units from inventory tracking, borrowing, multi-level approval, return with photo evidence, overdue monitoring, to reporting and export.

### Features

- **Dashboard** -- At-a-glance overview of total items, borrowed items, pending approvals, and overdue items. Pie charts show item distribution by category and status.
- **Item Management** -- Add, edit, view, and delete demo units. Each unit has a unique CODE128 barcode (format: `DJI-YYYYMMDD-XXXX`), with support for category assignment, specification fields, location tracking, and batch barcode printing.
- **Barcode System** -- Generate scannable barcodes via JsBarcode, scan with device camera using html5-qrcode (supports CODE128 + QR code), and quickly locate items by scanning their barcode labels.
- **Borrow Requests** -- Submit borrow requests with borrow type (customer demo / marketing demo), purpose, customer info, and date range. Automatic approval chain matching based on borrow type.
- **Multi-Level Approval** -- Configurable approval chains with flexible steps per level: by role or by specific person. Super admins and admins can approve any request. Status updates are trigger-driven (approval passed → auto-create borrow record + update item status).
- **Return with Photo Evidence** -- Return items with captured photos that include GPS coordinates and timestamp watermarks burned into the image. Photos are automatically deleted after 30 days; metadata retained for 1 year.
- **Renewal Requests** -- Submit renewal requests for active borrows with updated return dates.
- **Overdue Management** -- Automated daily check via Supabase Edge Function + pg_cron. System notifications and WeCom (WeChat Work) webhook alerts for overdue items.
- **User Management** -- 4-tier role system: super_admin > admin > approver > user. Registration requires admin approval. Support for role assignment, account enable/disable, and super admin privilege transfer.
- **Reports & Export** -- Export item lists, borrow records, and approval records to Excel via SheetJS.
- **Responsive Design** -- Card-based layout on mobile, table-based layout on desktop.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Build Tool | Vite |
| UI Library | shadcn/ui (Radix UI + Tailwind CSS 3.4) |
| Routing | react-router-dom v7 |
| Forms | react-hook-form + zod |
| Backend (BaaS) | Supabase (PostgreSQL + Auth + RLS + Storage) |
| Serverless | Supabase Edge Functions (Deno) |
| Scheduler | pg_cron |
| Charts | recharts |
| Barcodes | JsBarcode (generate) + html5-qrcode (scan) |
| Excel Export | SheetJS (xlsx) |
| Icons | lucide-react |
| Notifications | In-app + WeCom Webhook |

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  GitHub Pages                    │
│  React SPA (static build with content hashes)    │
│  /dji-demo-manager/                              │
└────────────────────┬────────────────────────────┘
                     │ Supabase Client (anon key)
┌────────────────────▼────────────────────────────┐
│                   Supabase                       │
│  ┌──────────────────────────────────────────┐   │
│  │         PostgreSQL (RLS protected)        │   │
│  │  9 core tables + triggers + functions     │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌───────────────────────┐    │
│  │  Auth (Email) │  │  Storage (return photos) │ │
│  └──────────────┘  └───────────────────────┘    │
│  ┌──────────────────────────────────────────┐   │
│  │      Edge Functions (Deno)                │   │
│  │  - check-overdue (daily cron)             │   │
│  │  - cleanup-return-photos                  │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Role System

| Role | Access |
|------|--------|
| **super_admin** | Full system access: user management, category management, approval chain config, system settings, super admin transfer |
| **admin** | Item CRUD, approve any request, view users |
| **approver** | Approve borrow requests assigned to them |
| **user** | View items, submit borrow requests, return & renew items |

### Database Tables

- `profiles` -- User profiles with role and status
- `categories` -- Item categories
- `items` -- Demo unit inventory with barcodes
- `borrow_requests` -- Borrow application records
- `approval_chains` -- Configurable approval workflows
- `approval_records` -- Individual approval actions
- `borrow_records` -- Active and historical borrow records
- `stock_movements` -- Inventory change audit trail
- `overdue_notifications` -- Overdue alert records
- `return_photos` -- Return photo metadata with GPS coordinates

### Project Structure

```
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── auth/            # Login form & auth guard
│   │   ├── barcode/         # Barcode generator, scanner, scan input
│   │   ├── borrow/          # Return photo capture
│   │   ├── export/          # Excel export button
│   │   ├── layout/          # App layout (sidebar + top nav)
│   │   └── ui/              # shadcn/ui components (60+)
│   ├── contexts/            # Auth context provider
│   ├── hooks/               # Custom React hooks (7)
│   ├── lib/                 # Utilities, constants, Supabase client
│   ├── pages/               # Page components
│   │   ├── items/           # List, detail, new, edit
│   │   ├── borrow/          # Apply, my requests, return, renew
│   │   ├── approval/        # Queue, detail
│   │   ├── admin/           # Users, categories, approval chains, settings
│   │   └── reports/         # Reports & export
│   ├── services/            # API service layer (7 services)
│   └── types/               # TypeScript interfaces
├── supabase/
│   ├── migrations/          # SQL migration files
│   └── functions/           # Edge Functions (Deno)
├── .github/workflows/       # CI/CD for GitHub Pages
└── public/                  # Static assets
```

### Getting Started

#### Prerequisites

- Node.js >= 20
- npm
- A Supabase project

#### Environment Setup

Create `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

> ⚠️ Never commit `.env` files. Use GitHub Secrets for CI/CD.

#### Install & Run

```bash
npm install
npm run dev          # Start dev server
npm run build        # Production build
npm run preview      # Preview production build
```

#### Database Setup

Run the SQL migration files in `supabase/migrations/` in numerical order using the Supabase SQL Editor. The files create all tables, RLS policies, triggers, functions, and seed data.

#### Deploy Edge Functions

Deploy the Edge Functions via Supabase CLI or Dashboard:

```bash
# check-overdue: daily overdue detection
# cleanup-return-photos: auto-cleanup 30-day-old photos
```

Configure pg_cron to schedule `check-overdue` with the appropriate CRON secret.

#### CI/CD

The project uses GitHub Actions to deploy to GitHub Pages. Add the following secrets to your repository:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Then enable GitHub Pages with "GitHub Actions" as the source.

### Security

- Row Level Security (RLS) on all database tables
- SECURITY DEFINER functions for privileged operations
- Frontend auth guard with role-based route protection
- User registration requires admin approval
- Edge Functions secured with CRON_SECRET validation
- Environment variables for all sensitive configuration

### License

This project is for internal use by DJI authorized dealers.

---

## 中文

一套面向大疆授权代理商的 Web 端样机管理系统，覆盖样机库存管理、借用申请、多级审批、归还拍照留档、逾期监控和报表导出等完整生命周期。

### 功能特性

- **仪表盘** -- 首页概览：样机总数、借出数量、待审批数、逾期数量。饼图展示样机分类和状态分布。
- **样机管理** -- 样机的增删改查。每台样机拥有唯一 CODE128 条码（格式：`DJI-YYYYMMDD-XXXX`），支持分类归属、规格参数、存放位置、批量打印条码。
- **条码系统** -- JsBarcode 生成可扫描条码，html5-qrcode 调用摄像头扫描（支持 CODE128 + 二维码），通过扫描条码快速定位样机。
- **借用申请** -- 提交借用申请，支持借用类型（客户试用 / 营销演示）、用途说明、客户信息、借用日期范围。根据借用类型自动匹配审批链。
- **多级审批** -- 可配置的审批链，每级支持按角色或按指定人审批。超级管理员和管理员可审批任意流程。状态变更由数据库触发器驱动（审批通过 → 自动创建借用记录 + 更新样机状态）。
- **归还拍照留档** -- 归还时拍摄照片，自动叠加 GPS 坐标和时间戳水印。照片 30 天自动删除，元数据保留 1 年。
- **续借申请** -- 对正在借用中的样机提交续借，更新预计归还日期。
- **逾期管理** -- Supabase Edge Function + pg_cron 每日自动检测逾期。系统内通知 + 企业微信 Webhook 提醒。
- **用户管理** -- 四级角色体系：超级管理员 > 管理员 > 审批人 > 普通用户。注册需管理员审批。支持角色分配、账号启停、超级管理员权限转移。
- **报表导出** -- 通过 SheetJS 导出样机清单、借用记录、审批记录为 Excel 文件。
- **响应式设计** -- 移动端卡片布局，桌面端表格布局。

### 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript |
| 构建工具 | Vite |
| UI 组件库 | shadcn/ui (Radix UI + Tailwind CSS 3.4) |
| 路由 | react-router-dom v7 |
| 表单 | react-hook-form + zod |
| 后端 (BaaS) | Supabase (PostgreSQL + Auth + RLS + Storage) |
| 无服务器函数 | Supabase Edge Functions (Deno) |
| 定时任务 | pg_cron |
| 图表 | recharts |
| 条码 | JsBarcode (生成) + html5-qrcode (扫描) |
| Excel 导出 | SheetJS (xlsx) |
| 图标 | lucide-react |
| 通知 | 系统内通知 + 企业微信 Webhook |

### 系统架构

```
┌─────────────────────────────────────────────────┐
│                  GitHub Pages                    │
│  React SPA (静态构建 + 内容哈希)                  │
│  /dji-demo-manager/                              │
└────────────────────┬────────────────────────────┘
                     │ Supabase Client (anon key)
┌────────────────────▼────────────────────────────┐
│                   Supabase                       │
│  ┌──────────────────────────────────────────┐   │
│  │       PostgreSQL (RLS 行级安全)           │   │
│  │   9 张核心表 + 触发器 + 存储函数           │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌───────────────────────┐    │
│  │  Auth (邮件)  │  │ Storage (归还照片存储)  │   │
│  └──────────────┘  └───────────────────────┘    │
│  ┌──────────────────────────────────────────┐   │
│  │      Edge Functions (Deno)                │   │
│  │  - check-overdue (每日定时)                │   │
│  │  - cleanup-return-photos                  │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 角色体系

| 角色 | 权限范围 |
|------|----------|
| **super_admin** | 全部权限：用户管理、分类管理、审批链配置、系统设置、超管转移 |
| **admin** | 样机增删改、审批任意流程、查看用户 |
| **approver** | 审批分配给自己的借用申请 |
| **user** | 查看样机、提交借用申请、归还/续借样机 |

### 数据库表结构

- `profiles` -- 用户档案（角色、状态）
- `categories` -- 样机分类
- `items` -- 样机库存（含条码）
- `borrow_requests` -- 借用申请表
- `approval_chains` -- 审批链配置
- `approval_records` -- 各级审批记录
- `borrow_records` -- 借用记录（含历史）
- `stock_movements` -- 库存变动审计
- `overdue_notifications` -- 逾期通知记录
- `return_photos` -- 归还照片元数据（含 GPS 坐标）

### 项目结构

```
├── src/
│   ├── components/          # 可复用组件
│   │   ├── auth/            # 登录表单、路由守卫
│   │   ├── barcode/         # 条码生成、扫描、输入
│   │   ├── borrow/          # 归还拍照
│   │   ├── export/          # Excel 导出按钮
│   │   ├── layout/          # 应用布局（侧边栏 + 顶栏）
│   │   └── ui/              # shadcn/ui 组件库 (60+)
│   ├── contexts/            # 认证上下文
│   ├── hooks/               # 自定义 Hooks (7 个)
│   ├── lib/                 # 工具函数、常量、Supabase 客户端
│   ├── pages/               # 页面组件
│   │   ├── items/           # 列表、详情、新增、编辑
│   │   ├── borrow/          # 申请、我的申请、归还、续借
│   │   ├── approval/        # 审批队列、审批详情
│   │   ├── admin/           # 用户管理、分类管理、审批链、系统设置
│   │   └── reports/         # 报表导出
│   ├── services/            # API 服务层 (7 个服务)
│   └── types/               # TypeScript 类型定义
├── supabase/
│   ├── migrations/          # SQL 迁移文件
│   └── functions/           # Edge Functions (Deno)
├── .github/workflows/       # GitHub Pages 自动部署
└── public/                  # 静态资源
```

### 快速开始

#### 前置条件

- Node.js >= 20
- npm
- 一个 Supabase 项目

#### 环境配置

在项目根目录创建 `.env` 文件：

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

> ⚠️ 切勿将 `.env` 文件提交到代码仓库。CI/CD 中使用 GitHub Secrets 注入。

#### 安装与运行

```bash
npm install
npm run dev          # 启动开发服务器
npm run build        # 生产构建
npm run preview      # 预览生产构建
```

#### 数据库初始化

按编号顺序在 Supabase SQL Editor 中执行 `supabase/migrations/` 目录下的 SQL 迁移文件。这些文件将创建所有数据表、RLS 策略、触发器和函数。

#### 部署 Edge Functions

通过 Supabase CLI 或 Dashboard 部署 Edge Functions，并配置 pg_cron 定时任务。

#### CI/CD

项目使用 GitHub Actions 自动部署到 GitHub Pages。在仓库的 Settings > Secrets 中添加：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

然后在 Settings > Pages 中选择 "GitHub Actions" 作为部署源。

### 安全设计

- 所有数据表启用行级安全 (RLS)
- 核心操作使用 SECURITY DEFINER 特权函数
- 前端路由守卫 + 基于角色的页面权限控制
- 用户注册需管理员审批通过
- Edge Functions 通过 CRON_SECRET 验证调用来源
- 敏感配置全部使用环境变量

### 许可证

本项目仅供大疆授权代理商内部使用。
