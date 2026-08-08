/**
 * AI 输出校验器单元测试 — ai-validate.spec.js
 *
 * 覆盖范围：
 *   1. checkCondition：合法/非法/空
 *   2. checkEffect：合法/非法值
 *   3. validateTalentJSON：结构/condition/effect
 *   4. validateEventJSON：结构/include/exclude/effect
 *   5. validateGenerated：类型分发
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// 校验器。
import { checkCondition, checkEffect, validateTalentJSON, validateEventJSON, validateGenerated } from './ai-validate.js'

// ========== 测试组 1：checkCondition ==========
describe('ai-validate - checkCondition', () => {
  test('valid condition passes', () => {
    // 合法。
    expect(checkCondition('params.CHR > 5').ok).toBe(true)
  })

  test('invalid syntax fails', () => {
    // 语法错误。
    expect(checkCondition('params.CHR >>').ok).toBe(false)
  })

  test('empty or non-string fails', () => {
    // 空字符串。
    expect(checkCondition('').ok).toBe(false)
    // 非字符串。
    expect(checkCondition(123).ok).toBe(false)
  })

  test('references unknown prop still compiles', () => {
    // 引用未知属性（undefined 比较，不抛错）。
    expect(checkCondition('params.UNKNOWN > 5').ok).toBe(true)
  })
})

// ========== 测试组 2：checkEffect ==========
describe('ai-validate - checkEffect', () => {
  test('valid numeric effect passes', () => {
    // 合法。
    expect(checkEffect({ CHR: 10, MNY: -5 }).ok).toBe(true)
  })

  test('non-numeric value fails', () => {
    // 字符串值。
    expect(checkEffect({ CHR: '10' }).ok).toBe(false)
  })

  test('missing effect is ok', () => {
    // 可选。
    expect(checkEffect(undefined).ok).toBe(true)
  })

  test('non-object fails', () => {
    // 数组。
    expect(checkEffect([1, 2]).ok).toBe(false)
  })
})

// ========== 测试组 3：validateTalentJSON ==========
describe('ai-validate - validateTalentJSON', () => {
  test('valid talent passes', () => {
    // 合法天赋。
    const t = { id: 'ai_001', name: 'AI天赋', condition: 'params.CHR > 5', effect: { INT: 2 } }
    expect(validateTalentJSON(t).ok).toBe(true)
  })

  test('missing id fails', () => {
    // 缺 id。
    expect(validateTalentJSON({ name: 'x' }).ok).toBe(false)
  })

  test('missing name fails', () => {
    // 缺 name。
    expect(validateTalentJSON({ id: 'a' }).ok).toBe(false)
  })

  test('bad condition fails', () => {
    // 非法 condition。
    const t = { id: 'a', name: 'x', condition: 'CHR >>' }
    expect(validateTalentJSON(t).ok).toBe(false)
  })

  test('bad effect fails', () => {
    // 非法 effect。
    const t = { id: 'a', name: 'x', effect: { INT: 'bad' } }
    expect(validateTalentJSON(t).ok).toBe(false)
  })
})

// ========== 测试组 4：validateEventJSON ==========
describe('ai-validate - validateEventJSON', () => {
  test('valid event passes', () => {
    // 合法事件。
    const e = { id: 'ai_e1', event: '描述', effect: { LIF: -1 } }
    expect(validateEventJSON(e).ok).toBe(true)
  })

  test('missing event text fails', () => {
    // 缺描述。
    expect(validateEventJSON({ id: 'a' }).ok).toBe(false)
  })

  test('bad include fails', () => {
    // 非法 include。
    const e = { id: 'a', event: 'x', include: 'params.X >' }
    expect(validateEventJSON(e).ok).toBe(false)
  })

  test('valid include passes', () => {
    // 合法 include。
    const e = { id: 'a', event: 'x', include: 'params.TMS > 9' }
    expect(validateEventJSON(e).ok).toBe(true)
  })
})

// ========== 测试组 5：validateGenerated ==========
describe('ai-validate - validateGenerated', () => {
  test('dispatches by type', () => {
    // talent。
    expect(validateGenerated('talent', { id: 'a', name: 'x' }).ok).toBe(true)
    // event。
    expect(validateGenerated('event', { id: 'a', event: 'x' }).ok).toBe(true)
  })

  test('unknown type fails', () => {
    // 未知类型。
    expect(validateGenerated('foo', {}).ok).toBe(false)
  })
})
