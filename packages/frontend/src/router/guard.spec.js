/**
 * 路由守卫纯函数测试 — guard.spec.js
 *
 * 覆盖异常回归：刷新后 store 重置（life=null），
 * hash 直进 #/talent 等「需要引擎」的页面导致抽卡/翻年报 null 异常。
 * 处理：beforeEach 判定引擎页未就绪 → 重定向主页。
 * 判定逻辑抽为纯函数 shouldRedirectEnginePage，此处单测。
 */

// 导入 vitest 测试 DSL。
import { describe, test, expect } from 'vitest'
// 被测函数。
import { shouldRedirectEnginePage } from './guard.js'

describe('shouldRedirectEnginePage（引擎页守卫判定）', () => {
  test('引擎页未初始化 → 重定向 /（刷新直进的原生异常场景）', () => {
    // 各引擎页。
    expect(shouldRedirectEnginePage('/talent', false)).toBe('/')
    expect(shouldRedirectEnginePage('/property', false)).toBe('/')
    expect(shouldRedirectEnginePage('/game', false)).toBe('/')
    expect(shouldRedirectEnginePage('/summary', false)).toBe('/')
  })

  test('引擎已初始化 → 放行（null）', () => {
    // 各引擎页。
    expect(shouldRedirectEnginePage('/talent', true)).toBeNull()
    expect(shouldRedirectEnginePage('/property', true)).toBeNull()
    expect(shouldRedirectEnginePage('/game', true)).toBeNull()
    expect(shouldRedirectEnginePage('/summary', true)).toBeNull()
  })

  test('非引擎页（/、/mods、/settings）→ 无论是否就绪均放行', () => {
    // 未初始化。
    expect(shouldRedirectEnginePage('/', false)).toBeNull()
    expect(shouldRedirectEnginePage('/mods', false)).toBeNull()
    expect(shouldRedirectEnginePage('/settings', false)).toBeNull()
    // 已初始化。
    expect(shouldRedirectEnginePage('/', true)).toBeNull()
    expect(shouldRedirectEnginePage('/mods', true)).toBeNull()
    expect(shouldRedirectEnginePage('/settings', true)).toBeNull()
  })

  test('Mod 数据详情页（/mods/<目录名>）不需要引擎，刷新直进也不被重定向', () => {
    // 未初始化（刷新后直接打开某个 Mod 的详情）。
    expect(shouldRedirectEnginePage('/mods/lifeRestart-data', false)).toBeNull()
    // 已初始化。
    expect(shouldRedirectEnginePage('/mods/base-mod', true)).toBeNull()
    // 守卫是**精确匹配**：只有 /mods 与 /mods/<name> 这类它不认识的路径都放行，
    // 不会因为前缀是 /mods 就把 /modsXXX 误判成引擎页。
    expect(shouldRedirectEnginePage('/modsXYZ', false)).toBeNull()
  })
})