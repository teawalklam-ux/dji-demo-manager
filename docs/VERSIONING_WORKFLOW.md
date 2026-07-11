# 版本更新工作流 (Versioning Workflow)

> 适用范围：DJI 样机管理系统（本项目）
> 目标：保证「代码改动 → 版本更新文档 → 页面右下角版本号」三者永远一致。

---

## 1. 核心原则

**每一次对 `src/`、`supabase/migrations/`、`public/` 做出调整后，都必须：**

1. 在 [`CHANGELOG.md`](./CHANGELOG.md) 顶部新增一条对应版本的更新说明；
2. 将 [`src/lib/version.ts`](./src/lib/version.ts) 中的 `APP_VERSION` 提升到相同版本；
3. 页面右下角的版本号由 `APP_VERSION` 单一驱动，自动与 CHANGELOG 保持一致；
4. 三者版本号必须完全匹配，否则提交会被 `pre-commit` 钩子阻止。

版本号格式：`主版本.次版本`（如 `1.15`）。破坏性变更升主版本，功能 / 修复升次版本。

---

## 2. 标准操作步骤

### 步骤 A — 完成代码调整
正常开发，修改 `src/`、`supabase/migrations/`、`public/` 等。

### 步骤 B — 更新 CHANGELOG.md
在文件顶部 `## [1.x] - YYYY-MM-DD` 区块**之上**新增条目，按类型分组：

```markdown
## [1.16] - 2026-07-15

### 新增 (Features)
- 描述本次新增能力（附关键 commit hash）。

### 修复 (Fixes)
- 描述本次修复的问题（附关键 commit hash）。

### 文档 (Docs)
- 文档类改动。
```

> 日期取本次发布日期；commit hash 用 `git log --oneline -5` 取前 7 位，便于追溯。

### 步骤 C — 提升 APP_VERSION
编辑 `src/lib/version.ts`：

```ts
export const APP_VERSION = '1.16'   // 必须与 CHANGELOG 顶部版本号一致
```

> 同步把 `package.json` 的 `version` 改为对应的 semver（如 `1.16.0`），保持仓库元数据一致。

### 步骤 D — 提交（钩子自动校验）
```bash
git add src/lib/version.ts CHANGELOG.md package.json <其它改动>
git commit -m "chore: release v1.16"
```

`pre-commit` 会自动检查：
- 源码有改动时，`CHANGELOG.md` **必须**一并 staged，否则阻止提交；
- `CHANGELOG.md` 顶部版本号必须与 `APP_VERSION` 一致，否则阻止提交。

---

## 3. 校验机制（pre-commit 钩子）

文件：`.git/hooks/pre-commit`（由仓库提供，无需手动维护）。

| 检查项 | 触发条件 | 不通过后果 |
| --- | --- | --- |
| CHANGELOG 已更新 | 改动 `src/`、`supabase/migrations/`、`public/` 中任一文件 | 阻止提交，提示先写 CHANGELOG |
| 版本号一致 | `CHANGELOG.md` 已 staged | 顶部版本 ≠ `APP_VERSION` 时阻止提交 |

本地临时跳过校验（仅应急）：`git commit --no-verify`（不推荐）。

---

## 4. 本地手动校验（不提交时也可用）

```bash
# 查看 CHANGELOG 顶部版本
grep -m1 -E '^## \[?[0-9]' CHANGELOG.md

# 查看代码版本
grep APP_VERSION src/lib/version.ts
```

两者应显示同一版本号。

---

## 5. 常见错误

- ❌ 只改了代码，忘了写 CHANGELOG → 提交被拦。
- ❌ CHANGELOG 写了 `1.16`，但 `APP_VERSION` 还是 `1.15` → 提交被拦，页面右下角仍显示旧版本。
- ❌ 把版本号直接硬编码在 `app-layout.tsx` → 已由 `APP_VERSION` 常量驱动，请勿回退。
