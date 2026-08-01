/**
 * i18n 多语言单元测试 — i18n.spec.js
 *
 * 覆盖范围：10 个测试用例，分为 3 组：
 *   1. loadLocale（加载语言）
 *   2. t（翻译与占位符）
 *   3. 语言切换
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// i18n 模块。
import { loadLocale, t } from './index.js'

// ========== 测试组 1：loadLocale ==========
describe('i18n - loadLocale', () => {
  test('loads zh-cn locale', () => {
    // 中文。
    const locale = loadLocale('zh-cn')
    // 标题。
    expect(locale.UI_Title_Remake).toBe('人生重开模拟器')
  })

  test('loads en-us locale', () => {
    // 英文。
    const locale = loadLocale('en-us')
    // 标题。
    expect(locale.UI_Title_Remake).toBe('Life Restart Simulator')
  })

  test('falls back to zh-cn for unknown locale', () => {
    // 未知语言。
    const locale = loadLocale('xx-xx')
    // 回退中文。
    expect(locale.UI_Next).toBe('下一步')
  })
})

// ========== 测试组 2：t ==========
describe('i18n - t', () => {
  test('translates known key', () => {
    // 中文翻译。
    const locale = loadLocale('zh-cn')
    // 取值。
    expect(t(locale, 'UI_Next')).toBe('下一步')
  })

  test('returns key for missing entry', () => {
    // 中文。
    const locale = loadLocale('zh-cn')
    // 缺失键。
    expect(t(locale, 'NOT_EXIST')).toBe('NOT_EXIST')
  })

  test('replaces positional placeholder', () => {
    // 中文。
    const locale = loadLocale('zh-cn')
    // 占位符。
    expect(t(locale, 'GAME_Year', 25)).toBe('25 岁')
  })

  test('replaces multiple placeholders', () => {
    // 中文。
    const locale = loadLocale('zh-cn')
    // 多占位符（命名参数对象）。
    expect(t(locale, 'CMD_Unknown', { cmd: 'foo' })).toContain('foo')
  })
})

// ========== 测试组 3：语言切换 ==========
describe('i18n - switching', () => {
  test('same key differs across locales', () => {
    // 两种语言。
    const zh = loadLocale('zh-cn')
    const en = loadLocale('en-us')
    // 同键不同值。
    expect(t(zh, 'GAME_Year', 3)).toBe('3 岁')
    expect(t(en, 'GAME_Year', 3)).toBe('Age 3')
  })

  test('en-us property names', () => {
    // 英文。
    const en = loadLocale('en-us')
    // 属性名。
    expect(t(en, 'UI_Property_Charm')).toBe('Charm')
    // 中文。
    const zh = loadLocale('zh-cn')
    expect(t(zh, 'UI_Property_Charm')).toBe('颜值')
  })

  test('locale switching is stateless', () => {
    // 切换后互不影响。
    const zh = loadLocale('zh-cn')
    const en = loadLocale('en-us')
    // 中文值。
    expect(t(zh, 'GAME_Over')).toBe('人生结束')
    // 英文值。
    expect(t(en, 'GAME_Over')).toBe('Life Over')
  })
})
