/**
 * router guard — 路由守卫纯函数（可测试）
 *
 * 背景（2026-08 修复的原生异常）：
 *   刷新页面后 store 状态重置（life = null），
 *   若 hash 停留在 #/talent 等「需要引擎」的页面，会直进该页导致抽卡/翻年读 null 报错。
 *   处理：路由 beforeEach 判定为需要引擎且未初始化 → 重定向主页。
 *
 * 守卫判断逻辑抽成纯函数，便于单元测试（不依赖 router/Vue 实例）。
 */

// #ENGINE_PAGES
// 需要引擎初始化的页面（引擎未就绪时禁止进入）。
const ENGINE_PAGES = ['/talent', '/property', '/game', '/summary']

// #shouldRedirectEnginePage
// 判定：目标页需要引擎且引擎未初始化 → 返回重定向路径，否则 null（放行）。
//
// @param {string} toPath - 目标路由路径
// @param {boolean} isReady - 引擎是否已初始化（store.isReady）
// @returns {string|null} 重定向路径 '/' 或 null
export function shouldRedirectEnginePage(toPath, isReady) {
  // 目标在引擎页列表且未就绪。
  return ENGINE_PAGES.includes(toPath) && !isReady ? '/' : null
}