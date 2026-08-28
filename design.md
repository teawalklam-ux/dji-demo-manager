# DJI 样机管理系统 UI 基线

Hallmark v1.1 设计记录。此基线仅约束视觉层，不改变路由、权限、数据读取、表单提交、Supabase 调用、后端接口或部署行为。

## 设计方向

- 受众：DJI 授权代理商的运营人员、管理员与审批人。
- 工作目标：快速理解库存状态，完成查找、借用、审批与跟进。
- 视觉语气：精准、冷静、业务导向、可信赖。
- 类型：modern-minimal。
- 主题：自定义冷色系统；DJI 蓝是唯一主强调色。应用侧栏使用同一冷色锚点的深墨色反转面，主工作区保持冷白纸面。
- 字体：标题使用设备本地的 Bahnschrift / 微软雅黑，正文使用 Segoe UI Variable / 苹方 / 微软雅黑，数据标识使用 Cascadia Mono；不新增网络字体或构建依赖。
- 图片与装饰：仅侧栏品牌区使用白色透明 DJI Logo，并在原深蓝圆角底内保持安全留白；其余区域以真实数据与操作密度为视觉内容。

## 宏观结构

### 应用壳：Workbench

侧栏承载稳定的信息架构，使用深墨色反转面与单一 DJI 蓝当前项标记；顶部栏只保留页面定位和全局控制，主内容区使用受控宽度和清晰工作区分组。导航、折叠与通知行为保持原样。

### 仪表盘：Stat-Led

第一屏先展示真实库存统计，不制造任何指标。页面标题与快捷操作组成同一工作头，统计条改为相连且不等宽的操作面；预警、图表、审批与变动记录使用 7/5 与 5/7 的非对称单层工作面。无数据时保留解释与下一步操作，不再让区块直接消失。

状态图表固定使用语义色：可用在库为成功绿、预定为紫、借出为 DJI 蓝、逾期为危险红、维修为警示橙、退役为中性灰。颜色不随数据顺序改变。

### 样机列表：Index-First / Workbench

标题与批量操作构成工具头，搜索筛选构成工具轨，数据表是主要工作面。移动端继续使用原有卡片式数据重排，不更改选择、排序、分页、扫码、导入或导出逻辑。

### SOP 指引：Narrative Workflow / Liquid

页面以真实工作阶段组织内容：物料准备、现场工作、后续交接。应用侧栏仍是全局导航，页面内部使用三列 Mega Menu 切换选址、部署、维修等业务流程；阶段按钮以 circle-to-pill 表达当前步骤，清单面板以 pill-to-card 和 reverse-collapse 表达展开与收起。

Liquid 只承载导航和阶段切换，不用于正文装饰。视觉代理使用独立 SVG silhouette，真实按钮、文字、焦点环与点击区域保持清晰。机场选址使用已确认的业务内容；未确认的部署与维修流程显示待配置空状态，不生成假流程。

## 交互约束

- 所有按钮和可点击标签保持单行。
- 键盘焦点即时出现，不参与动画。
- 输入框边框宽度在默认、悬停、焦点、禁用和错误状态保持不变。
- 动效只使用明确属性；禁止 `transition-all`。
- 默认微交互只有按钮按压和统计操作面的轻微位移。
- SOP 页面额外允许 circle-to-pill、pill-to-card、reverse-collapse 三种关联动效；动效关闭时保留完整状态变化。
- `prefers-reduced-motion: reduce` 下关闭空间位移。
- 触控设备的点击目标不小于 44 × 44 CSS px。

## 响应式

- 基础布局从 320 px 开始。
- 统计、工具头与筛选条件允许容器重排，按钮文字不换行。
- 数据表在小屏继续切换为现有移动卡片。
- `html` 与 `body` 使用 `overflow-x: clip`，避免全局水平滚动。
- 验证宽度：320、375、414、768 CSS px。

## 文件与安全边界

首轮 UI 改造只创建本文件、`tokens.css`、`.hallmark/*`，并修改 Tailwind/全局样式、共享 UI 组件、应用壳、仪表盘和样机列表。该阶段以下内容明确不在范围内：

- `src/App.tsx` 与所有路由定义
- `src/services/**`、`src/hooks/**`、`src/contexts/**`
- Supabase 客户端、SQL 与后端接口
- `.env*`、API secret、token、密钥
- `package*.json`、Vite、CI/CD 与部署配置

## 本地演示模式

2026-07-28 的后续测试需求增加了仅开发环境可用的本地演示账号：

- 本地 API 使用 Node 内置 HTTP 服务，绑定 `127.0.0.1:5176`。
- 演示账号只允许访问仪表盘、样机列表和样机详情。
- 演示数据来自内存种子，服务重启后恢复初始状态。
- 演示会话中的写方法会被前端适配层拦截，不会回落到真实 Supabase。
- 入口由 `import.meta.env.DEV` 控制，生产构建不显示。
- 未修改 Supabase schema、真实后端接口、环境变量、package、Vite 或部署配置。

## 令牌来源

运行时唯一来源是根目录的 `tokens.css`。以下导出用于跨项目复制，不在本次构建中额外生成依赖。

### CSS

```css
@import "./tokens.css";
```

### Tailwind v4 `@theme` 导出

当前项目仍使用 Tailwind v3，因此运行时映射保留在 `tailwind.config.js`。若迁移到 v4，可复制：

```css
@theme {
  --color-paper: oklch(98.8% 0.004 250);
  --color-paper-2: oklch(96.4% 0.009 252);
  --color-paper-3: oklch(92.8% 0.014 254);
  --color-rule: oklch(85.5% 0.016 255);
  --color-rule-2: oklch(65% 0.025 257);
  --color-muted: oklch(46% 0.022 258);
  --color-neutral: oklch(36% 0.025 258);
  --color-ink-2: oklch(29% 0.028 259);
  --color-ink: oklch(20.6% 0.039 265.5);
  --color-accent: oklch(50% 0.16 258);
  --color-success: oklch(43% 0.13 150);
  --color-warning: oklch(42% 0.105 75);
  --color-danger: oklch(49% 0.18 25);
  --color-focus: oklch(9% 0.025 260);
  --color-sidebar-surface: oklch(25% 0.04 263);
  --color-sidebar-active: oklch(31% 0.06 258);
  --color-sidebar-text: oklch(94% 0.012 252);
  --color-sidebar-accent: oklch(67% 0.16 258);
  --color-reserved: oklch(50% 0.15 300);
  --color-liquid-surface: oklch(97.6% 0.012 252);
  --color-liquid-shadow: oklch(20.6% 0.039 265.5 / 0.12);
  --color-liquid-scrim: oklch(20.6% 0.039 265.5 / 0.24);
  --color-chart-in-stock: var(--color-success);
  --color-chart-reserved: var(--color-reserved);
  --color-chart-borrowed: var(--color-accent);
  --color-chart-overdue: var(--color-danger);
  --color-chart-maintenance: var(--color-warning);
  --color-chart-retired: var(--color-neutral);
  --font-display: "Bahnschrift", "DIN Alternate", "Microsoft YaHei UI", ui-sans-serif, sans-serif;
  --font-body: "Segoe UI Variable Text", "PingFang SC", "Microsoft YaHei UI", ui-sans-serif, system-ui, sans-serif;
  --font-outlier: "Cascadia Mono", "SFMono-Regular", ui-monospace, monospace;
  --spacing-3xs: 0.25rem;
  --spacing-2xs: 0.5rem;
  --spacing-xs: 0.75rem;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --spacing-xl: 3rem;
  --spacing-2xl: 4.5rem;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-md: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.5rem;
  --text-2xl: 2rem;
  --radius-card: 0.625rem;
  --radius-pill: 999px;
  --radius-input: 0.5rem;
  --radius-liquid-card: 1.75rem;
  --radius-liquid-pill: 999px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}
```

### DTCG `tokens.json` 导出

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(98.8% 0.004 250)", "$type": "color" },
    "paper-2": { "$value": "oklch(96.4% 0.009 252)", "$type": "color" },
    "paper-3": { "$value": "oklch(92.8% 0.014 254)", "$type": "color" },
    "rule": { "$value": "oklch(85.5% 0.016 255)", "$type": "color" },
    "rule-2": { "$value": "oklch(65% 0.025 257)", "$type": "color" },
    "muted": { "$value": "oklch(46% 0.022 258)", "$type": "color" },
    "neutral": { "$value": "oklch(36% 0.025 258)", "$type": "color" },
    "ink-2": { "$value": "oklch(29% 0.028 259)", "$type": "color" },
    "ink": { "$value": "oklch(20.6% 0.039 265.5)", "$type": "color" },
    "accent": { "$value": "oklch(50% 0.16 258)", "$type": "color" },
    "accent-ink": { "$value": "oklch(98.8% 0.004 250)", "$type": "color" },
    "success": { "$value": "oklch(43% 0.13 150)", "$type": "color" },
    "warning": { "$value": "oklch(42% 0.105 75)", "$type": "color" },
    "danger": { "$value": "oklch(49% 0.18 25)", "$type": "color" },
    "focus": { "$value": "oklch(9% 0.025 260)", "$type": "color" },
    "sidebar-surface": { "$value": "oklch(25% 0.04 263)", "$type": "color" },
    "sidebar-active": { "$value": "oklch(31% 0.06 258)", "$type": "color" },
    "sidebar-text": { "$value": "oklch(94% 0.012 252)", "$type": "color" },
    "sidebar-accent": { "$value": "oklch(67% 0.16 258)", "$type": "color" },
    "reserved": { "$value": "oklch(50% 0.15 300)", "$type": "color" },
    "liquid-surface": { "$value": "oklch(97.6% 0.012 252)", "$type": "color" },
    "liquid-shadow": { "$value": "oklch(20.6% 0.039 265.5 / 0.12)", "$type": "color" },
    "liquid-scrim": { "$value": "oklch(20.6% 0.039 265.5 / 0.24)", "$type": "color" },
    "chart-in-stock": { "$value": "{color.success}", "$type": "color" },
    "chart-reserved": { "$value": "{color.reserved}", "$type": "color" },
    "chart-borrowed": { "$value": "{color.accent}", "$type": "color" },
    "chart-overdue": { "$value": "{color.danger}", "$type": "color" },
    "chart-maintenance": { "$value": "{color.warning}", "$type": "color" },
    "chart-retired": { "$value": "{color.neutral}", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Bahnschrift, DIN Alternate, Microsoft YaHei UI, ui-sans-serif, sans-serif", "$type": "fontFamily" },
    "body": { "$value": "Segoe UI Variable Text, PingFang SC, Microsoft YaHei UI, ui-sans-serif, system-ui, sans-serif", "$type": "fontFamily" },
    "outlier": { "$value": "Cascadia Mono, SFMono-Regular, ui-monospace, monospace", "$type": "fontFamily" }
  },
  "size": {
    "text-xs": { "$value": "0.75rem", "$type": "dimension" },
    "text-sm": { "$value": "0.875rem", "$type": "dimension" },
    "text-md": { "$value": "1rem", "$type": "dimension" },
    "text-lg": { "$value": "1.25rem", "$type": "dimension" },
    "text-xl": { "$value": "1.5rem", "$type": "dimension" },
    "text-2xl": { "$value": "2rem", "$type": "dimension" }
  },
  "space": {
    "3xs": { "$value": "0.25rem", "$type": "dimension" },
    "2xs": { "$value": "0.5rem", "$type": "dimension" },
    "xs": { "$value": "0.75rem", "$type": "dimension" },
    "sm": { "$value": "1rem", "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem", "$type": "dimension" },
    "xl": { "$value": "3rem", "$type": "dimension" },
    "2xl": { "$value": "4.5rem", "$type": "dimension" }
  },
  "duration": {
    "micro": { "$value": "120ms", "$type": "duration" },
    "short": { "$value": "180ms", "$type": "duration" },
    "long": { "$value": "420ms", "$type": "duration" }
  },
  "radius": {
    "liquid-card": { "$value": "1.75rem", "$type": "dimension" },
    "liquid-pill": { "$value": "999px", "$type": "dimension" }
  }
}
```

### shadcn/ui 变量导出

```css
:root {
  --background: 96.4% 0.009 252;
  --foreground: 20.6% 0.039 265.5;
  --card: 98.8% 0.004 250;
  --card-foreground: 20.6% 0.039 265.5;
  --popover: 98.8% 0.004 250;
  --popover-foreground: 20.6% 0.039 265.5;
  --primary: 50% 0.16 258;
  --primary-foreground: 98.8% 0.004 250;
  --secondary: 92.8% 0.014 254;
  --secondary-foreground: 29% 0.028 259;
  --muted: 92.8% 0.014 254;
  --muted-foreground: 46% 0.022 258;
  --accent: 92% 0.032 258;
  --accent-foreground: 29% 0.028 259;
  --destructive: 49% 0.18 25;
  --destructive-foreground: 98.8% 0.004 250;
  --border: 85.5% 0.016 255;
  --input: 65% 0.025 257;
  --ring: 9% 0.025 260;
  --sidebar-background: 20.6% 0.039 265.5;
  --sidebar-foreground: 94% 0.012 252;
  --sidebar-primary: 67% 0.16 258;
  --sidebar-primary-foreground: 20.6% 0.039 265.5;
  --sidebar-accent: 31% 0.06 258;
  --sidebar-accent-foreground: 94% 0.012 252;
  --sidebar-border: 34% 0.035 260;
  --sidebar-ring: 76% 0.12 258;
  --radius: 0.625rem;
  --sop-liquid-surface: 97.6% 0.012 252;
  --sop-liquid-shadow: 20.6% 0.039 265.5 / 0.12;
  --sop-liquid-scrim: 20.6% 0.039 265.5 / 0.24;
  --sop-liquid-radius: 1.75rem;
}
```
