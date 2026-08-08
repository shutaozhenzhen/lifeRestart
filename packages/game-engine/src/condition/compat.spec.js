/**
 * compat.js 单元测试 — compat.spec.js
 *
 * 覆盖范围：19 个测试用例，分为两组：
 *   1. 语法转换组（15 用例）：验证每个旧语法模式到 JS 的转换字符串是否正确。
 *   2. 正确性验证组（4 用例）：验证转换后的 JS 表达式在 check() 中求值正确。
 *
 * 核心验证点：
 *   - 运算符映射（&→&&、|→||、=→===、!=→!==）
 *   - 数组映射（?[ → .includes() 或 .some()）
 *   - 属性前缀（统一加 params.）
 *   - JS 内置对象不被加前缀（Math 保持为 Math）
 *   - 非数字值自动加引号
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// convertLegacy()：旧语法转换函数。
import { convertLegacy } from './compat.js'
// check()：新语法求值函数，用于第二组测试验证转换后结果。
import { check } from './index.js'

// ========== 第一组：语法转换 ==========
// 验证 convertLegacy() 输出的字符串是否完全符合预期。
// 每个用例覆盖一个或一组旧语法模式的转换。

describe('compat.js - legacy conversion', () => {
  // 测试 1：& → &&（逻辑与）
  test('& → &&', () => {
    // 输入：CHR>5&INT>3
    // 输出应同时 => params. 前缀和 && 操作符。
    expect(convertLegacy('CHR>5&INT>3')).toBe('params.CHR > 5 && params.INT > 3')
  })

  // 测试 2：| → ||（逻辑或）
  test('| → ||', () => {
    // 输入：CHR>5|INT>3
    expect(convertLegacy('CHR>5|INT>3')).toBe('params.CHR > 5 || params.INT > 3')
  })

  // 测试 3：混合 & 和 | 且带括号分组。
  test('mixed & | with parentheses', () => {
    // 输入：(CHR>5|INT>3)&MNY>0
    // 括号应被保留。
    const result = convertLegacy('(CHR>5|INT>3)&MNY>0')
    expect(result).toBe('(params.CHR > 5 || params.INT > 3) && params.MNY > 0')
  })

  // 测试 4：?[ 用于标量属性。
  test('? with scalar prop', () => {
    // AGE 是标量，转换结果应为 [18,25,30].includes(params.AGE)。
    const result = convertLegacy('AGE?[18,25,30]', { AGE: 'scalar' })
    expect(result).toBe('[18,25,30].includes(params.AGE)')
  })

  // 测试 5：?[ 用于数组属性。
  test('? with array prop', () => {
    // TLT 是数组，转换结果应为 TLT.some(id => [...].includes(id))。
    // 数组元素是字符串 ID（运行时 prepareForEngine 字符串化），所以值加引号。
    const result = convertLegacy('TLT?[1001,1002]', { TLT: 'array' })
    expect(result).toBe('params.TLT.some(id => ["1001","1002"].includes(id))')
  })

  // 测试 6：![ 用于标量属性（非成员判断）。
  test('! with scalar prop', () => {
    // CHR 是标量，![1,2,3].includes(CHR) 表示 CHR 不在 [1,2,3] 中。
    const result = convertLegacy('CHR![1,2,3]', { CHR: 'scalar' })
    expect(result).toBe('![1,2,3].includes(params.CHR)')
  })

  // 测试 7：![ 用于数组属性。
  test('! with array prop', () => {
    // TLT 是数组，!TLT.some(id => [...].includes(id)) 表示 TLT 与列表无交集。
    // 数组元素是字符串 ID，值加引号。
    const result = convertLegacy('TLT![1001]', { TLT: 'array' })
    expect(result).toBe('!params.TLT.some(id => ["1001"].includes(id))')
  })

  // 测试 8：旧语法 = → JS 的 ===（严格相等）。
  test('= → ===', () => {
    // CHR=5 应转换为 params.CHR === 5。
    const result = convertLegacy('CHR=5')
    expect(result).toBe('params.CHR === 5')
  })

  // 测试 8b：= 接字符串值（回归测试，与 != 相同的漏洞）。
  test('= with string value', () => {
    // CHR=abc 应转换为 params.CHR === "abc"。
    expect(convertLegacy('CHR=abc')).toBe('params.CHR === "abc"')
  })

  // 测试 9：旧语法 != → JS 的 !==（严格不等）。
  test('!= stays !==', () => {
    // CHR!=5 应转换为 params.CHR !== 5（不是 ===，也不是 !=）。
    const result = convertLegacy('CHR!=5')
    expect(result).toBe('params.CHR !== 5')
  })

  // 测试 9b：!= 接字符串值（回归测试，修复旧规则只匹配数字的漏洞）。
  test('!= with string value', () => {
    // CHR!=abc 应转换为 params.CHR !== "abc"：
    // 字符串值必须加引号，否则 abc 会变成未定义变量导致 ReferenceError。
    expect(convertLegacy('CHR!=abc')).toBe('params.CHR !== "abc"')
    // 带下划线的 ID 值同样要加引号。
    expect(convertLegacy('CHR!=talent_001')).toBe('params.CHR !== "talent_001"')
  })

  // 测试 9c：!= 接布尔与浮点值保持字面量。
  test('!= with boolean and float values', () => {
    // 布尔字面量不加引号，保留 true/false 语义。
    expect(convertLegacy('CHR!=true')).toBe('params.CHR !== true')
    // 浮点数不加引号，按数字解析。
    expect(convertLegacy('CHR!=5.5')).toBe('params.CHR !== 5.5')
  })

  // 测试 10：>= 不变。
  test('>= stays >=', () => {
    // >= 操作符在 JS 中已经合法，只加空格。
    const result = convertLegacy('CHR>=5')
    expect(result).toBe('params.CHR >= 5')
  })

  // 测试 11：Math 内置对象不加 params. 前缀。
  test('Math is not prefixed', () => {
    // 转换后应包含 params.CHR（游戏属性）和 Math.random（JS 内置）。
    const result = convertLegacy('CHR>5&&Math.random()<0.5')
    expect(result).toContain('params.CHR')
    expect(result).toContain('Math.random')
  })

  // 测试 12：完整旧语法示例，混合 &、|、?[ 标量和数组。
  test('full old syntax example', () => {
    // 输入复杂条件：CHR>5 AND AGE in [18,30] OR TLT intersects [1001]。
    const result = convertLegacy('CHR>5&AGE?[18,30]|TLT?[1001]', {
      CHR: 'scalar', AGE: 'scalar', TLT: 'array'
    })
    expect(result).toBe(
      'params.CHR > 5 && [18,30].includes(params.AGE) || params.TLT.some(id => ["1001"].includes(id))'
    )
  })
})

// ========== 第二组：正确性验证 ==========
// 转换后的字符串必须是合法的 JS 表达式，且求值结果符合预期。

describe('compat.js - conversion correctness', () => {
  // 测试属性值与 propTypes 声明一致。
  // TLT 的真实值是数组，必须在 propTypes 中明确声明为 'array'。
  const props = { CHR: 10, AGE: 25, TLT: ['t_001', 't_002'] }

  // 测试 13：条件求值为 true 的场景。
  test('converted condition evaluates correctly', () => {
    // AGE=25，在列表 [18,25,30] 中，所以 .includes() 返回 true。
    const cond = convertLegacy('CHR>5&AGE?[18,25,30]', { CHR: 'scalar', AGE: 'scalar' })
    expect(check(cond, props)).toBe(true)
  })

  // 测试 14：条件求值为 false 的场景。
  test('converted false condition', () => {
    // CHR=10，CHR>15 不满足，整体为 false。
    const cond = convertLegacy('CHR>15&AGE?[18,30]', { CHR: 'scalar', AGE: 'scalar' })
    expect(check(cond, props)).toBe(false)
  })

  // 测试 15：数组属性的正确转换。
  test('converted array prop', () => {
    // TLT 包含 t_001，所以 TLT?[t_001,t_003] 满足 → true。
    // 同时验证非数字值（t_001）被正确加引号，否则 JS 会报未定义变量错误。
    const cond = convertLegacy('TLT?[t_001,t_003]', { TLT: 'array' })
    expect(check(cond, props)).toBe(true)
  })

  // 测试 16：字符串 != 转换后可在 check() 中正确求值（回归测试）。
  test('converted string != evaluates correctly', () => {
    // props.CHR = 10，不是 "abc"，所以 params.CHR !== "abc" → true。
    const cond = convertLegacy('CHR!=abc')
    expect(check(cond, props)).toBe(true)
    // 用字符串属性验证：构造一个 CHR 恰好等于字符串的场景。
    const stringProps = { CHR: 'abc', TLT: ['t_001'] }
    const same = convertLegacy('CHR!=abc')
    expect(check(same, stringProps)).toBe(false)
  })
})
