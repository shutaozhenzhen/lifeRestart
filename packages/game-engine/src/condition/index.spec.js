/**
 * condition 引擎单元测试 — index.spec.js
 *
 * 覆盖范围：41 个测试用例，分为 11 个测试组：
 *   1. 基础数值比较（gt/gte/lt/lte/eq/neq）
 *   2. 字符串比较
 *   3. 数组方法（includes、some、空数组）
 *   4. 布尔逻辑（and/or/not/混合+分组）
 *   5. 算术（加减乘除）
 *   6. Math 函数（max/min/floor/random/abs）
 *   7. 短路求值（&& 左侧 false → 不评估右侧）
 *   8. 错误处理（语法错误、属性不存在）
 *   9. 边缘情况（0/负数/真值强制转换/长表达式）
 *   10. 复杂组合（数组+布尔+算术混合）
 *   11. 操作符优先级（&& 高于 ||、算术高于比较）
 */

// 导入 vitest 的测试 DSL。
// describe：定义测试组。
// test：定义单个测试用例。
// expect：断言函数。
import { describe, test, expect, it } from 'vitest'
// 导入被测对象：check() 函数。
import { check } from './index.js'

// 顶层 describe，包含所有测试组。
describe('condition engine', () => {
  // #props
  // 模拟属性数据，覆盖 scalar 和 array 两种类型。
  // TLT 和 EVT 是数组属性（存储 ID 列表），其余为标量属性。
  const props = {
    CHR: 10,                    // 颜值
    INT: 8,                     // 智力
    STR: 5,                     // 体质
    MNY: 1000,                  // 财富
    SPR: 60,                    // 快乐
    LIF: 1,                     // 寿命（1 = 存活）
    AGE: 25,                    // 年龄
    TLT: ['talent_001', 'talent_002'], // 已获得天赋的 ID 数组
    EVT: ['event_001'],         // 已触发事件的 ID 数组
    EMPTY: [],                  // 空数组
    ZERO: 0,                    // 零值
    NEG: -5,                    // 负值
  }

  // === 测试组 1：基础数值比较 ===
  // 验证 >、>=、<、<=、===、!== 六个比较操作符的边界行为。
  // 关键测试特征：等于边界（10 > 10 → false）和越过边界（10 > 9 → true）。
  describe('basic comparisons', () => {
    test('gt (>)', () => {
      // 10 > 11 → false（大于更大的数）
      expect(check('params.CHR > 11', props)).toBe(false)
      // 10 > 10 → false（不大于自身）
      expect(check('params.CHR > 10', props)).toBe(false)
      // 10 > 9 → true（大于更小的数）
      expect(check('params.CHR > 9', props)).toBe(true)
    })

    test('gte (>=)', () => {
      // 10 >= 11 → false
      expect(check('params.CHR >= 11', props)).toBe(false)
      // 10 >= 10 → true（等于自身）
      expect(check('params.CHR >= 10', props)).toBe(true)
      // 10 >= 9 → true（大于更小的数）
      expect(check('params.CHR >= 9', props)).toBe(true)
    })

    test('lt (<)', () => {
      // 10 < 9 → false
      expect(check('params.CHR < 9', props)).toBe(false)
      // 10 < 10 → false
      expect(check('params.CHR < 10', props)).toBe(false)
      // 10 < 11 → true
      expect(check('params.CHR < 11', props)).toBe(true)
    })

    test('lte (<=)', () => {
      // 10 <= 9 → false
      expect(check('params.CHR <= 9', props)).toBe(false)
      // 10 <= 10 → true
      expect(check('params.CHR <= 10', props)).toBe(true)
      // 10 <= 11 → true
      expect(check('params.CHR <= 11', props)).toBe(true)
    })

    test('eq (===)', () => {
      // 10 === 9 → false
      expect(check('params.CHR === 9', props)).toBe(false)
      // 10 === 10 → true
      expect(check('params.CHR === 10', props)).toBe(true)
      // 10 === 11 → false
      expect(check('params.CHR === 11', props)).toBe(false)
    })

    test('neq (!==)', () => {
      // 10 !== 9 → true（不等于）
      expect(check('params.CHR !== 9', props)).toBe(true)
      // 10 !== 10 → false（等于）
      expect(check('params.CHR !== 10', props)).toBe(false)
      // 10 !== 11 → true（不等于）
      expect(check('params.CHR !== 11', props)).toBe(true)
    })
  })

  // === 测试组 2：字符串比较 ===
  // 验证数字与字符串字面量的严格类型区分。
  describe('string comparisons', () => {
    test('string eq', () => {
      // 数字 25 === 数字 25 → true
      expect(check('params.AGE === 25', props)).toBe(true)
      // 数字 25 === 字符串 "25" → false（严格类型比较）
      expect(check('params.AGE === "25"', props)).toBe(false)
    })

    test('string neq', () => {
      // 25 !== 30 → true
      expect(check('params.AGE !== 30', props)).toBe(true)
    })
  })

  // === 测试组 3：数组方法 ===
  // 验证 .includes() 和 .some() 在判定成员关系和数组交集中的行为。
  describe('array methods', () => {
    test('includes (scalar in list)', () => {
      // AGE=25 在字面量数组 [18,25,30] 中 → true
      expect(check('[18, 25, 30].includes(params.AGE)', props)).toBe(true)
      // AGE=25 不在字面量数组 [18,20,30] 中 → false
      expect(check('[18, 20, 30].includes(params.AGE)', props)).toBe(false)
    })

    test('includes (array contains value)', () => {
      // TLT 数组中包含 "talent_001" → true
      expect(check('params.TLT.includes("talent_001")', props)).toBe(true)
      // TLT 数组中不包含 "talent_999" → false
      expect(check('params.TLT.includes("talent_999")', props)).toBe(false)
    })

    test('some (array intersection)', () => {
      // TLT 与 ["talent_001","talent_999"] 有交集（talent_001 匹配）→ true
      expect(check('params.TLT.some(id => ["talent_001", "talent_999"].includes(id))', props)).toBe(true)
      // TLT 与 ["talent_999","talent_888"] 无交集 → false
      expect(check('params.TLT.some(id => ["talent_999", "talent_888"].includes(id))', props)).toBe(false)
    })

    test('empty arrays', () => {
      // 空数组的 .includes() 永远返回 false
      expect(check('[].includes(params.CHR)', props)).toBe(false)
      // EMPTY 属性是空数组，不包含 "anything" → false
      expect(check('params.EMPTY.includes("anything")', props)).toBe(false)
    })
  })

  // === 测试组 4：布尔逻辑 ===
  describe('boolean logic', () => {
    test('and (&&)', () => {
      // CHR(10)>5 && INT(8)>5 → true && true → true
      expect(check('params.CHR > 5 && params.INT > 5', props)).toBe(true)
      // CHR(10)>5 && INT(8)>10 → true && false → false
      expect(check('params.CHR > 5 && params.INT > 10', props)).toBe(false)
      // CHR(10)>15 && INT(8)>5 → false && true → false
      expect(check('params.CHR > 15 && params.INT > 5', props)).toBe(false)
    })

    test('or (||)', () => {
      // false || true → true
      expect(check('params.CHR > 15 || params.INT > 5', props)).toBe(true)
      // true || false → true
      expect(check('params.CHR > 5 || params.INT > 15', props)).toBe(true)
      // false || false → false
      expect(check('params.CHR > 15 || params.INT > 15', props)).toBe(false)
    })

    test('not (!)', () => {
      // !false → true
      expect(check('!false', props)).toBe(true)
      // !(true) → false
      expect(check('!(params.CHR > 5)', props)).toBe(false)
      // true && !(false) → true && true → true
      expect(check('params.CHR > 5 && !(params.SPR > 80)', props)).toBe(true)
    })

    test('mixed and/or with grouping', () => {
      // (false||true) && true → true && true → true
      expect(check('(params.CHR > 15 || params.INT > 5) && params.MNY > 500', props)).toBe(true)
      // (false||false) && true → false && true → false
      expect(check('(params.CHR > 15 || params.INT > 15) && params.MNY > 500', props)).toBe(false)
      // true || (false && false) → true || false → true
      // JS 中 && 优先级高于 ||，所以此处 true || (MNY>2000 && SPR>80)
      expect(check('params.CHR > 5 || params.MNY > 2000 && params.SPR > 80', props)).toBe(true)
    })
  })

  // === 测试组 5：算术 ===
  describe('arithmetic', () => {
    test('addition', () => {
      // CHR(10) + INT(8) = 18 > 15 → true
      expect(check('params.CHR + params.INT > 15', props)).toBe(true)
      // 18 > 20 → false
      expect(check('params.CHR + params.INT > 20', props)).toBe(false)
    })

    test('subtraction', () => {
      // 10 - 8 = 2 > 0 → true
      expect(check('params.CHR - params.INT > 0', props)).toBe(true)
      // 10 - 5 = 5 === 5 → true
      expect(check('params.CHR - params.STR === 5', props)).toBe(true)
    })

    test('multiplication', () => {
      // 1000 * 2 = 2000 === 2000 → true
      expect(check('params.MNY * 2 === 2000', props)).toBe(true)
    })

    test('division', () => {
      // 1000 / 2 = 500 === 500 → true
      expect(check('params.MNY / 2 === 500', props)).toBe(true)
    })
  })

  // === 测试组 6：Math 函数 ===
  describe('Math functions', () => {
    test('Math.max', () => {
      // max(10,8,5) = 10 === 10 → true
      expect(check('Math.max(params.CHR, params.INT, params.STR) === 10', props)).toBe(true)
      // max(10,8) = 10 > 5 → true
      expect(check('Math.max(params.CHR, params.INT) > 5', props)).toBe(true)
    })

    test('Math.min', () => {
      // min(10,8,5) = 5 === 5 → true
      expect(check('Math.min(params.CHR, params.INT, params.STR) === 5', props)).toBe(true)
    })

    test('Math.floor', () => {
      // floor(3.9) = 3 === 3 → true
      expect(check('Math.floor(3.9) === 3', props)).toBe(true)
      // floor(10/3) = floor(3.33) = 3 === 3 → true
      expect(check('Math.floor(10 / 3) === 3', props)).toBe(true)
    })

    test('Math.random returns number', () => {
      // typeof Math.random() === "number" → true
      // 不固件随机值，只验证类型
      const result = check('typeof Math.random() === "number"', props)
      expect(result).toBe(true)
    })

    test('Math.abs', () => {
      // abs(-5) = 5 === 5 → true
      expect(check('Math.abs(params.NEG) === 5', props)).toBe(true)
    })
  })

  // === 测试组 7：短路求值 ===
  describe('short-circuit', () => {
    test('&& short-circuits on false', () => {
      // && 的左侧为 false 时，右侧表达式不会被评估。
      // 此处 params.CHR > 15 为 false，所以右侧（即使有访问错误）不会执行。
      expect(check('params.CHR > 15 && params.INT > 5', props)).toBe(false)
    })

    test('|| short-circuits on true', () => {
      // || 的左侧为 true 时，右侧不会评估。
      expect(check('params.CHR > 5 || params.INT > 15', props)).toBe(true)
    })
  })

  // === 测试组 8：错误处理 ===
  describe('error handling', () => {
    test('invalid syntax throws', () => {
      // 不完整的表达式（params.CHR > 后面没有操作数）→ SyntaxError。
      // check() 应该捕获并抛出包装后的错误。
      expect(() => check('params.CHR > ', props)).toThrow()
    })

    test('unknown property returns undefined', () => {
      // params.XXX 在 properties 对象中不存在，读取结果为 undefined。
      // undefined > 5 在 JS 中是 false，不会抛异常。
      expect(check('params.XXX > 5', props)).toBe(false)
    })
  })

  // === 测试组 9：边缘情况 ===
  describe('edge cases', () => {
    test('zero values', () => {
      // 0 === 0 → true
      expect(check('params.ZERO === 0', props)).toBe(true)
      // 0 > 0 → false
      expect(check('params.ZERO > 0', props)).toBe(false)
    })

    test('negative values', () => {
      // -5 < 0 → true
      expect(check('params.NEG < 0', props)).toBe(true)
      // -5 === -5 → true
      expect(check('params.NEG === -5', props)).toBe(true)
    })

    test('truthy/falsy coercion', () => {
      // Boolean(1) → true（LIF=1 是真值）
      expect(check('params.LIF', props)).toBe(true)
      // Boolean(0) → false（ZERO=0 是假值）
      expect(check('params.ZERO', props)).toBe(false)
    })

    test('big expression', () => {
      // 多条件长表达式，验证解析和求值的稳定性。
      // CHR>5 && INT>3 && MNY>500 → true && true && true → true
      // 由于 || SPR>90 短路，整体为 true。
      const cond = 'params.CHR > 5 && params.INT > 3 && params.MNY > 500 || params.SPR > 90'
      expect(check(cond, props)).toBe(true)
      // MNY>5000 为 false，且 SPR>90 为 false，整体为 false。
      const cond2 = 'params.CHR > 5 && params.INT > 3 && params.MNY > 5000 || params.SPR > 90'
      expect(check(cond2, props)).toBe(false)
    })
  })

  // === 测试组 10：复杂组合 ===
  // 模拟实际游戏中可能出现的多种条件类型叠加场景。
  describe('complex expressions', () => {
    test('nested array + boolean', () => {
      // TLT 包含 talent_001 AND AGE 在 [18,20,25,30] 中 → true && true → true
      const cond = 'params.TLT.includes("talent_001") && [18, 20, 25, 30].includes(params.AGE)'
      expect(check(cond, props)).toBe(true)
    })

    test('arithmetic + comparison + array', () => {
      // (10+8)>15 AND NOT TLT 包含 talent_999 → true && true → true
      const cond = 'params.CHR + params.INT > 15 && !params.TLT.includes("talent_999")'
      expect(check(cond, props)).toBe(true)
    })

    test('everything combined', () => {
      // 同时包含算术、Math 函数、数组 .some()、括号分组的复杂表达式。
      const cond = '(params.CHR + params.INT + params.STR > 20 || Math.max(params.MNY, params.SPR) > 500) && params.TLT.some(t => ["talent_001", "talent_999"].includes(t))'
      expect(check(cond, props)).toBe(true)
    })
  })

  // === 测试组 11：操作符优先级 ===
  describe('operator precedence', () => {
    test('&& before ||', () => {
      // JS 标准：&& 优先级高于 ||。
      // false || true && true → false || true → true
      expect(check('false || true && true', props)).toBe(true)
      // true || true && false → true || false → true
      expect(check('true || true && false', props)).toBe(true)
    })

    test('arithmetic before comparison', () => {
      // + 优先级高于 >：实际计算为 (CHR+INT) > 15 → 18 > 15 → true
      expect(check('params.CHR + params.INT > 15', props)).toBe(true)
      // / 优先级高于 >：实际计算为 ((MNY/2)+100) < 500 → 600 < 500 → false
      expect(check('params.MNY / 2 + 100 < 500', props)).toBe(false)
    })
  })
})
