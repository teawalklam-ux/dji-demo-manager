/**
 * 应用版本号 —— 单一数据源 (single source of truth)
 *
 * 规则（见 docs/VERSIONING_WORKFLOW.md）：
 *  - 每次发布调整后，必须同时：
 *      1) 在 CHANGELOG.md 顶部新增对应版本条目
 *      2) 在此处将 APP_VERSION 提升到相同版本
 *      3) 页面右下角版本号由本常量驱动，自动与 CHANGELOG 保持一致
 *  - .git/hooks/pre-commit 会在提交源码改动时校验三处一致性。
 */
export const APP_VERSION = '1.69'
