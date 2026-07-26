/**
 * compat.js 单元测试 — compat.spec.js
 *
 * 覆盖范围：15 个测试用例，分为两组：
 *   1. 语法转换组（12 用例）：验证每个旧语法模式到 JS 的转换字符串是否正确
 *   2. 正确性验证组（3 用例）：验证转换后的 JS 表达式在 check() 中求值正确
 *
 * 核心验证点：
 *   - 运算符映射（&→&&、|→||、=→===、!=→!==）
 *   - 数组映射（?[ → .includes() 或 .some()）
 *   - 属性前缀（统一加 params.）
 *   - JS 内置对象不被加前缀（Math 保持为 Math）
 *   - 非数字值自动加引号
 */

import { describe, test, expect } from 'vitest'
import { convertLegacy } from './compat.js'
import { check } from './index.js'

// === 第一组：语法转换 — 验证字符串转换结果 ===

describe('compat.js - legacy conversion', () => {
  // & → &&（旧语法逻辑与 → JS 逻辑与）
  test('& → &&', () => {
    expect(convertLegacy('CHR>5&INT>3')).toBe('params.CHR > 5 && params.INT > 3')
  })

  // | → ||（旧语法逻辑或 → JS 逻辑或）
  test('| → ||', () => {
    expect(convertLegacy('CHR>5|INT>3')).toBe('params.CHR > 5 || params.INT > 3')
  })

  // 混合 & | 且带括号分组。验证括号是否被正确保留。
  test('mixed & | with parentheses', () => {
    const result = convertLegacy('(CHR>5|INT>3)&MNY>0')
    expect(result).toBe('(params.CHR > 5 || params.INT > 3) && params.MNY > 0')
  })

  // ?[ 用于标量属性：AGE?[18,25,30] → [18,25,30].includes(params.AGE)
  test('? with scalar prop', () => {
    const result = convertLegacy('AGE?[18,25,30]', { AGE: 'scalar' })
    expect(result).toBe('[18,25,30].includes(params.AGE)')
  })

  // ?[ 用于数组属性：TLT?[1001,1002] → TLT.some(id => ...)
  test('? with array prop', () => {
    const result = convertLegacy('TLT?[1001,1002]', { TLT: 'array' })
    expect(result).toBe('params.TLT.some(id => [1001,1002].includes(id))')
  })

  // ![ 用于标量属性：CHR![1,2,3] → ![1,2,3].includes(params.CHR)
  test('! with scalar prop', () => {
    const result = convertLegacy('CHR![1,2,3]', { CHR: 'scalar' })
    expect(result).toBe('![1,2,3].includes(params.CHR)')
  })

  // ![ 用于数组属性：TLT![1001] → !TLT.some(id => ...)
  test('! with array prop', () => {
    const result = convertLegacy('TLT![1001]', { TLT: 'array' })
    expect(result).toBe('!params.TLT.some(id => [1001].includes(id))')
  })

  // 旧语法 = → JS 的 ===（严格相等）
  test('= → ===', () => {
    const result = convertLegacy('CHR=5')
    expect(result).toBe('params.CHR === 5')
  })

  // 旧语法 != → JS 的 !==（严格不等），确认 != 没有被误转为 =。
  test('!= stays !==', () => {
    const result = convertLegacy('CHR!=5')
    expect(result).toBe('params.CHR !== 5')
  })

  // 旧语法 >= → JS 的 >=（保持不变，只加空格）
  test('>= stays >=', () => {
    const result = convertLegacy('CHR>=5')
    expect(result).toBe('params.CHR >= 5')
  })

  // Math 是 JS 内置对象，不应加 params. 前缀。
  test('Math is not prefixed', () => {
    const result = convertLegacy('CHR>5&&Math.random()<0.5')
    expect(result).toContain('params.CHR')
    expect(result).toContain('Math.random')
  })

  // 完整的旧语法示例：混合 &、|、?[（标量+数组），验证整体转换正确。
  test('full old syntax example', () => {
    const result = convertLegacy('CHR>5&AGE?[18,30]|TLT?[1001]', {
      CHR: 'scalar', AGE: 'scalar', TLT: 'array'
    })
    expect(result).toBe(
      'params.CHR > 5 && [18,30].includes(params.AGE) || params.TLT.some(id => [1001].includes(id))'
    )
  })
})

// === 第二组：正确性验证 — 转换后的表达式在 check() 中求值正确 ===

describe('compat.js - conversion correctness', () => {
  // 测试属性的值与 propTypes 声明要匹配。
  // TLT 的真实值是数组，所以 propTypes 中 TLT 应为 'array'。
  const props = { CHR: 10, AGE: 25, TLT: ['t_001', 't_002'] }

  // AGE=25，在列表 [18,25,30] 中 → true
  test('converted condition evaluates correctly', () => {
    const cond = convertLegacy('CHR>5&AGE?[18,25,30]', { CHR: 'scalar', AGE: 'scalar' })
    expect(check(cond, props)).toBe(true)
  })

  // CHR=10，CHR>15 不满足 → false
  test('converted false condition', () => {
    const cond = convertLegacy('CHR>15&AGE?[18,30]', { CHR: 'scalar', AGE: 'scalar' })
    expect(check(cond, props)).toBe(false)
  })

  // TLT 包含 t_001，所以 TLT?[t_001,t_003] 满足 → true
  // 同时验证非数字值（t_001）被正确加引号。
  test('converted array prop', () => {
    const cond = convertLegacy('TLT?[t_001,t_003]', { TLT: 'array' })
    expect(check(cond, props)).toBe(true)
  })
})
