import { describe, test, expect, it } from 'vitest'
import { check } from './index.js'

describe('condition engine', () => {
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

  // === 基础数值比较 ===
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

  // === 字符串 ===
  describe('string comparisons', () => {
    test('string eq', () => {
      expect(check('params.AGE === 25', props)).toBe(true)
      expect(check('params.AGE === "25"', props)).toBe(false)
    })

    test('string neq', () => {
      expect(check('params.AGE !== 30', props)).toBe(true)
    })
  })

  // === 数组方法 ===
  describe('array methods', () => {
    test('includes (scalar in list)', () => {
      expect(check('[18, 25, 30].includes(params.AGE)', props)).toBe(true)
      expect(check('[18, 20, 30].includes(params.AGE)', props)).toBe(false)
    })

    test('includes (array contains value)', () => {
      expect(check('params.TLT.includes("talent_001")', props)).toBe(true)
      expect(check('params.TLT.includes("talent_999")', props)).toBe(false)
    })

    test('some (array intersection)', () => {
      expect(check('params.TLT.some(id => ["talent_001", "talent_999"].includes(id))', props)).toBe(true)
      expect(check('params.TLT.some(id => ["talent_999", "talent_888"].includes(id))', props)).toBe(false)
    })

    test('empty arrays', () => {
      expect(check('[].includes(params.CHR)', props)).toBe(false)
      expect(check('params.EMPTY.includes("anything")', props)).toBe(false)
    })
  })

  // === 布尔逻辑 ===
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

  // === 算术 ===
  describe('arithmetic', () => {
    test('addition', () => {
      expect(check('params.CHR + params.INT > 15', props)).toBe(true)
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

  // === Math 函数 ===
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

  // === 短路求值 ===
  describe('short-circuit', () => {
    test('&& short-circuits on false', () => {
      // If left is false, right is NOT evaluated
      // params.CHR > 15 is false, so params.XXX.ZZZ doesn't get evaluated
      expect(check('params.CHR > 15 && params.INT > 5', props)).toBe(false)
    })

    test('|| short-circuits on true', () => {
      expect(check('params.CHR > 5 || params.INT > 15', props)).toBe(true)
    })
  })

  // === 错误处理 ===
  describe('error handling', () => {
    test('invalid syntax throws', () => {
      expect(() => check('params.CHR > ', props)).toThrow()
    })

    test('unknown property returns undefined', () => {
      // params.XXX doesn't exist, returns undefined
      // undefined > 5 is false
      expect(check('params.XXX > 5', props)).toBe(false)
    })
  })

  // === 边缘情况 ===
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
      expect(check('params.LIF', props)).toBe(true)
      expect(check('params.ZERO', props)).toBe(false)
    })

    test('big expression', () => {
      const cond = 'params.CHR > 5 && params.INT > 3 && params.MNY > 500 || params.SPR > 90'
      expect(check(cond, props)).toBe(true)
      const cond2 = 'params.CHR > 5 && params.INT > 3 && params.MNY > 5000 || params.SPR > 90'
      expect(check(cond2, props)).toBe(false)
    })
  })

  // === 复杂组合 ===
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

  // === 函数 ===
  describe('additional Math', () => {
    test('Math.round', () => {
      expect(check('Math.round(3.4) === 3', props)).toBe(true)
      expect(check('Math.round(3.6) === 4', props)).toBe(true)
    })

    test('Math.pow', () => {
      expect(check('Math.pow(2, 3) === 8', props)).toBe(true)
    })

    test('Math.PI constant', () => {
      expect(check('Math.PI > 3', props)).toBe(true)
      expect(check('Math.PI < 4', props)).toBe(true)
    })
  })

  // === 操作符优先级 ===
  describe('operator precedence', () => {
    test('&& before ||', () => {
      // JS: false || true && true → false || true → true (&& binds tighter)
      expect(check('false || true && true', props)).toBe(true)
      // JS: true || true && false → true || false → true
      expect(check('true || true && false', props)).toBe(true)
    })

    test('arithmetic before comparison', () => {
      expect(check('params.CHR + params.INT > 15', props)).toBe(true)
      expect(check('params.MNY / 2 + 100 < 500', props)).toBe(false)
    })
  })
})
