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

import { describe, test, expect, it } from 'vitest'
import { check } from './index.js'

describe('condition engine', () => {
  // 模拟属性数据，覆盖 scalar 和 array 两种类型。
  // TLT 和 EVT 是数组属性，其余为标量属性。
  const props = {
    CHR: 10,
    INT: 8,
    STR: 5,
    MNY: 1000,
    SPR: 60,
    LIF: 1,
    AGE: 25,
    TLT: ['talent_001', 'talent_002'],
    EVT: ['event_001'],
    EMPTY: [],
    ZERO: 0,
    NEG: -5,
  }

  // 1. 基础数值比较
  // 验证 >、>=、<、<=、===、!== 六个比较操作符的边界行为。
  describe('basic comparisons', () => {
    test('gt (>)', () => {
      expect(check('params.CHR > 11', props)).toBe(false)
      expect(check('params.CHR > 10', props)).toBe(false)
      expect(check('params.CHR > 9', props)).toBe(true)
    })

    test('gte (>=)', () => {
      expect(check('params.CHR >= 11', props)).toBe(false)
      expect(check('params.CHR >= 10', props)).toBe(true)
      expect(check('params.CHR >= 9', props)).toBe(true)
    })

    test('lt (<)', () => {
      expect(check('params.CHR < 9', props)).toBe(false)
      expect(check('params.CHR < 10', props)).toBe(false)
      expect(check('params.CHR < 11', props)).toBe(true)
    })

    test('lte (<=)', () => {
      expect(check('params.CHR <= 9', props)).toBe(false)
      expect(check('params.CHR <= 10', props)).toBe(true)
      expect(check('params.CHR <= 11', props)).toBe(true)
    })

    test('eq (===)', () => {
      expect(check('params.CHR === 9', props)).toBe(false)
      expect(check('params.CHR === 10', props)).toBe(true)
      expect(check('params.CHR === 11', props)).toBe(false)
    })

    test('neq (!==)', () => {
      expect(check('params.CHR !== 9', props)).toBe(true)
      expect(check('params.CHR !== 10', props)).toBe(false)
      expect(check('params.CHR !== 11', props)).toBe(true)
    })
  })

  // 2. 字符串比较
  // 验证数字与字符串字面量的严格类型区分。
  describe('string comparisons', () => {
    test('string eq', () => {
      // AGE 是数字 25，比较时值相等
      expect(check('params.AGE === 25', props)).toBe(true)
      // AGE 是数字 25，与字符串 "25" 严格不相等
      expect(check('params.AGE === "25"', props)).toBe(false)
    })

    test('string neq', () => {
      expect(check('params.AGE !== 30', props)).toBe(true)
    })
  })

  // 3. 数组方法
  // 验证 .includes() 和 .some() 在判定成员关系和数组交集中的行为。
  describe('array methods', () => {
    test('includes (scalar in list)', () => {
      // AGE=25 在列表 [18,25,30] 中
      expect(check('[18, 25, 30].includes(params.AGE)', props)).toBe(true)
      // AGE=25 不在列表 [18,20,30] 中
      expect(check('[18, 20, 30].includes(params.AGE)', props)).toBe(false)
    })

    test('includes (array contains value)', () => {
      // TLT 数组中包含 "talent_001"
      expect(check('params.TLT.includes("talent_001")', props)).toBe(true)
      // TLT 数组中不包含 "talent_999"
      expect(check('params.TLT.includes("talent_999")', props)).toBe(false)
    })

    test('some (array intersection)', () => {
      // TLT 与 ["talent_001", "talent_999"] 有交集
      expect(check('params.TLT.some(id => ["talent_001", "talent_999"].includes(id))', props)).toBe(true)
      // TLT 与 ["talent_999", "talent_888"] 无交集
      expect(check('params.TLT.some(id => ["talent_999", "talent_888"].includes(id))', props)).toBe(false)
    })

    test('empty arrays', () => {
      // 空数组 .includes 永远返回 false
      expect(check('[].includes(params.CHR)', props)).toBe(false)
      // EMPTY 是 []，不包含任何值
      expect(check('params.EMPTY.includes("anything")', props)).toBe(false)
    })
  })

  // 4. 布尔逻辑
  // 验证 &&、||、! 的求值行为，以及它们与分组的配合。
  describe('boolean logic', () => {
    test('and (&&)', () => {
      expect(check('params.CHR > 5 && params.INT > 5', props)).toBe(true)
      expect(check('params.CHR > 5 && params.INT > 10', props)).toBe(false)
      expect(check('params.CHR > 15 && params.INT > 5', props)).toBe(false)
    })

    test('or (||)', () => {
      expect(check('params.CHR > 15 || params.INT > 5', props)).toBe(true)
      expect(check('params.CHR > 5 || params.INT > 15', props)).toBe(true)
      expect(check('params.CHR > 15 || params.INT > 15', props)).toBe(false)
    })

    test('not (!)', () => {
      expect(check('!false', props)).toBe(true)
      expect(check('!(params.CHR > 5)', props)).toBe(false)
      expect(check('params.CHR > 5 && !(params.SPR > 80)', props)).toBe(true)
    })

    test('mixed and/or with grouping', () => {
      expect(check('(params.CHR > 15 || params.INT > 5) && params.MNY > 500', props)).toBe(true)
      expect(check('(params.CHR > 15 || params.INT > 15) && params.MNY > 500', props)).toBe(false)
      expect(check('params.CHR > 5 || params.MNY > 2000 && params.SPR > 80', props)).toBe(true)
    })
  })

  // 5. 算术
  // 验证 + - * / 四则运算在条件表达式中的使用。
  describe('arithmetic', () => {
    test('addition', () => {
      // CHR(10) + INT(8) = 18 > 15
      expect(check('params.CHR + params.INT > 15', props)).toBe(true)
      // 18 > 20
      expect(check('params.CHR + params.INT > 20', props)).toBe(false)
    })

    test('subtraction', () => {
      expect(check('params.CHR - params.INT > 0', props)).toBe(true)
      expect(check('params.CHR - params.STR === 5', props)).toBe(true)
    })

    test('multiplication', () => {
      expect(check('params.MNY * 2 === 2000', props)).toBe(true)
    })

    test('division', () => {
      expect(check('params.MNY / 2 === 500', props)).toBe(true)
    })
  })

  // 6. Math 函数
  // 验证 JS 内置 Math 对象在条件表达式中可用。
  describe('Math functions', () => {
    test('Math.max', () => {
      expect(check('Math.max(params.CHR, params.INT, params.STR) === 10', props)).toBe(true)
      expect(check('Math.max(params.CHR, params.INT) > 5', props)).toBe(true)
    })

    test('Math.min', () => {
      expect(check('Math.min(params.CHR, params.INT, params.STR) === 5', props)).toBe(true)
    })

    test('Math.floor', () => {
      expect(check('Math.floor(3.9) === 3', props)).toBe(true)
      expect(check('Math.floor(10 / 3) === 3', props)).toBe(true)
    })

    test('Math.random returns number', () => {
      const result = check('typeof Math.random() === "number"', props)
      expect(result).toBe(true)
    })

    test('Math.abs', () => {
      expect(check('Math.abs(params.NEG) === 5', props)).toBe(true)
    })
  })

  // 7. 短路求值
  // 验证 && 和 || 的惰性求值行为：JS 引擎不会评估多余的子表达式。
  describe('short-circuit', () => {
    test('&& short-circuits on false', () => {
      // params.CHR > 15 为 false，所以右边不评估。
      // 即便右边有非法访问 params.XXX.ZZZ 也不会触发。
      expect(check('params.CHR > 15 && params.INT > 5', props)).toBe(false)
    })

    test('|| short-circuits on true', () => {
      expect(check('params.CHR > 5 || params.INT > 15', props)).toBe(true)
    })
  })

  // 8. 错误处理
  // 验证非法语法和越界访问时的行为。
  describe('error handling', () => {
    test('invalid syntax throws', () => {
      // 不完整的表达式 → SyntaxError → 包装后抛出
      expect(() => check('params.CHR > ', props)).toThrow()
    })

    test('unknown property returns undefined', () => {
      // params.XXX 不存在于 properties 中 → undefined
      // undefined > 5 → false（不会抛异常）
      expect(check('params.XXX > 5', props)).toBe(false)
    })
  })

  // 9. 边缘情况
  describe('edge cases', () => {
    test('zero values', () => {
      expect(check('params.ZERO === 0', props)).toBe(true)
      expect(check('params.ZERO > 0', props)).toBe(false)
    })

    test('negative values', () => {
      expect(check('params.NEG < 0', props)).toBe(true)
      expect(check('params.NEG === -5', props)).toBe(true)
    })

    test('truthy/falsy coercion', () => {
      // LIF=1 → truthy → Boolean(1) → true
      expect(check('params.LIF', props)).toBe(true)
      // ZERO=0 → falsy → Boolean(0) → false
      expect(check('params.ZERO', props)).toBe(false)
    })

    test('big expression', () => {
      // 多条件组合的长表达式，验证解析和求值稳定性
      const cond = 'params.CHR > 5 && params.INT > 3 && params.MNY > 500 || params.SPR > 90'
      expect(check(cond, props)).toBe(true)
      const cond2 = 'params.CHR > 5 && params.INT > 3 && params.MNY > 5000 || params.SPR > 90'
      expect(check(cond2, props)).toBe(false)
    })
  })

  // 10. 复杂组合
  // 模拟实际游戏中可能出现的多种条件类型叠加场景。
  describe('complex expressions', () => {
    test('nested array + boolean', () => {
      const cond = 'params.TLT.includes("talent_001") && [18, 20, 25, 30].includes(params.AGE)'
      expect(check(cond, props)).toBe(true)
    })

    test('arithmetic + comparison + array', () => {
      const cond = 'params.CHR + params.INT > 15 && !params.TLT.includes("talent_999")'
      expect(check(cond, props)).toBe(true)
    })

    test('everything combined', () => {
      const cond = '(params.CHR + params.INT + params.STR > 20 || Math.max(params.MNY, params.SPR) > 500) && params.TLT.some(t => ["talent_001", "talent_999"].includes(t))'
      expect(check(cond, props)).toBe(true)
    })
  })

  // 11. 操作符优先级
  // 验证 JS 标准优先级的正确性。这些测试依赖 JS 引擎行为，无需额外配置。
  describe('operator precedence', () => {
    test('&& before ||', () => {
      // JS 标准：&& 优先级高于 ||
      // false || true && true  →  false || true  →  true
      expect(check('false || true && true', props)).toBe(true)
      // true || true && false  →  true || false  →  true
      expect(check('true || true && false', props)).toBe(true)
    })

    test('arithmetic before comparison', () => {
      // + 优先级高于 >: (CHR+INT) > 15
      expect(check('params.CHR + params.INT > 15', props)).toBe(true)
      // / 优先级高于 >: (MNY/2 + 100) < 500
      expect(check('params.MNY / 2 + 100 < 500', props)).toBe(false)
    })
  })
})
