/**
 * util 工具函数单元测试 — util.spec.js
 *
 * 覆盖范围：43 个测试用例，分为 9 组：
 *   1. clone（深拷贝：对象/数组/null/嵌套）
 *   2. max/min（单层/嵌套数组/单元素）
 *   3. sum/average
 *   4. weightRandom（权重分布、边界、随机源注入）
 *   5. listRandom（随机源注入）
 *   6. map 系列（getListValuesMap/mapConvert/getConvertedMap/mapSet/deepMapSet）
 *   7. deepGet（点路径）
 *   8. format（对象参数/下标参数/类型格式化）
 *   9. createRng（种子可复现）
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// util 全部工具函数。
import {
  clone, max, min, sum, average,
  weightRandom, listRandom,
  getListValuesMap, mapConvert, getConvertedMap, mapSet, deepMapSet,
  deepGet, format, createRng,
} from './util.js'

// ========== 测试组 1：clone ==========
describe('util - clone', () => {
  test('clones primitives by value', () => {
    // 数字原样返回。
    expect(clone(42)).toBe(42)
    // 字符串原样返回。
    expect(clone('hello')).toBe('hello')
    // 布尔原样返回。
    expect(clone(true)).toBe(true)
    // undefined 原样返回。
    expect(clone(undefined)).toBe(undefined)
  })

  test('clones null', () => {
    // null 返回 null。
    expect(clone(null)).toBe(null)
  })

  test('clones arrays deep', () => {
    // 输入嵌套数组。
    const input = [1, [2, 3], [4, [5]]]
    // 克隆结果。
    const output = clone(input)
    // 值相等。
    expect(output).toEqual([1, [2, 3], [4, [5]]])
    // 不是同一个引用。
    expect(output).not.toBe(input)
    // 嵌套数组也是新引用。
    expect(output[1]).not.toBe(input[1])
  })

  test('clones objects deep', () => {
    // 输入嵌套对象。
    const input = { a: 1, b: { c: 2, d: { e: 3 } } }
    // 克隆结果。
    const output = clone(input)
    // 值相等。
    expect(output).toEqual({ a: 1, b: { c: 2, d: { e: 3 } } })
    // 不是同一个引用。
    expect(output).not.toBe(input)
    // 嵌套对象也是新引用。
    expect(output.b).not.toBe(input.b)
  })

  test('clone does not affect original on mutation', () => {
    // 输入对象。
    const input = { a: [1, 2] }
    // 克隆。
    const output = clone(input)
    // 修改克隆。
    output.a.push(3)
    // 原对象不受影响。
    expect(input.a).toEqual([1, 2])
  })
})

// ========== 测试组 2：max/min ==========
describe('util - max/min', () => {
  test('max of multiple numbers', () => {
    // 直接传多个参数。
    expect(max(1, 5, 3)).toBe(5)
  })

  test('max of nested array', () => {
    // 传数组（flat 摊平）。
    expect(max([1, 2], [9, 4], 7)).toBe(9)
  })

  test('max of single element', () => {
    // 单元素。
    expect(max([5])).toBe(5)
  })

  test('max with negative numbers', () => {
    // 负数。
    expect(max(-1, -5, -2)).toBe(-1)
  })

  test('min of multiple numbers', () => {
    // 直接传多个参数。
    expect(min(1, 5, 3)).toBe(1)
  })

  test('min of nested array', () => {
    // 传数组。
    expect(min([1, 2], [9, 4], 7)).toBe(1)
  })

  test('min of single element', () => {
    // 单元素。
    expect(min([5])).toBe(5)
  })

  test('min with negative numbers', () => {
    // 负数。
    expect(min(-1, -5, -2)).toBe(-5)
  })
})

// ========== 测试组 3：sum/average ==========
describe('util - sum/average', () => {
  test('sum of multiple numbers', () => {
    // 简单求和。
    expect(sum(1, 2, 3)).toBe(6)
  })

  test('sum of nested array', () => {
    // 数组求和。
    expect(sum([1, 2], [3, 4], 5)).toBe(15)
  })

  test('sum of single element', () => {
    // 单元素。
    expect(sum([10])).toBe(10)
  })

  test('sum of empty', () => {
    // 空参数求和为 0。
    expect(sum()).toBe(0)
  })

  test('average of numbers', () => {
    // (1+2+3)/3 = 2。
    expect(average(1, 2, 3)).toBe(2)
  })

  test('average of nested array', () => {
    // (1+2+3+4)/4 = 2.5。
    expect(average([1, 2], [3, 4])).toBe(2.5)
  })

  test('average of single element', () => {
    // 单元素平均值等于自身。
    expect(average([7])).toBe(7)
  })
})

// ========== 测试组 4：weightRandom ==========
describe('util - weightRandom', () => {
  test('returns id with full weight', () => {
    // 总权重 = 10，random() 返回 0.99 → 落在最后一项。
    // 用固定 random 返回 0.99。
    const result = weightRandom([['a', 5], ['b', 5]], () => 0.99)
    // 命中 b。
    expect(result).toBe('b')
  })

  test('returns id with near-zero weight', () => {
    // random() 返回接近 0 → 落在第一项。
    const result = weightRandom([['a', 5], ['b', 5]], () => 0.001)
    // 命中 a。
    expect(result).toBe('a')
  })

  test('weight distribution proportional', () => {
    // 用种子 RNG 做 10000 次抽样，统计分布应接近权重比例。
    const rng = createRng(42)
    // 计数器。
    const counts = { a: 0, b: 0, c: 0 }
    // 抽样次数。
    const N = 10000
    // 逐次抽样。
    for (let i = 0; i < N; i++) {
      // 抽样。
      const id = weightRandom([['a', 1], ['b', 2], ['c', 7]], rng)
      // 累加。
      counts[id]++
    }
    // 分布比例：c 占比应约 70%。
    expect(counts.c / N).toBeGreaterThan(0.65)
    expect(counts.c / N).toBeLessThan(0.75)
    // b 占比应约 20%。
    expect(counts.b / N).toBeGreaterThan(0.15)
    expect(counts.b / N).toBeLessThan(0.25)
    // a 占比应约 10%。
    expect(counts.a / N).toBeGreaterThan(0.05)
    expect(counts.a / N).toBeLessThan(0.15)
  })

  test('all weight to one item', () => {
    // 只有一个元素有权重 → 永远返回它。
    for (let i = 0; i < 10; i++) {
      // 多次抽样。
      const result = weightRandom([['only', 100]], () => Math.random())
      // 始终命中。
      expect(result).toBe('only')
    }
  })

  test('uses injected random source', () => {
    // 验证随机源确实被调用。
    const random = createRng(7)
    // 用注入的 RNG 抽样。
    const r1 = weightRandom([['a', 1], ['b', 1]], random)
    // 重新创建同种子 RNG，结果应一致（可复现）。
    const random2 = createRng(7)
    const r2 = weightRandom([['a', 1], ['b', 1]], random2)
    // 同种子 → 同结果。
    expect(r1).toBe(r2)
  })
})

// ========== 测试组 5：listRandom ==========
describe('util - listRandom', () => {
  test('returns element by index', () => {
    // 列表。
    const list = ['x', 'y', 'z']
    // random() 返回 0 → 下标 0。
    expect(listRandom(list, () => 0)).toBe('x')
    // random() 返回 0.9 → 下标 2。
    expect(listRandom(list, () => 0.9)).toBe('z')
  })

  test('uses injected random source deterministically', () => {
    // 列表。
    const list = [10, 20, 30]
    // 同种子 RNG。
    const rng1 = createRng(3)
    const rng2 = createRng(3)
    // 两次抽样结果一致。
    expect(listRandom(list, rng1)).toBe(listRandom(list, rng2))
  })
})

// ========== 测试组 6：map 系列 ==========
describe('util - map utilities', () => {
  test('getListValuesMap builds key-value map', () => {
    // 键数组。
    const keys = ['a', 'b']
    // 生成映射。
    const map = getListValuesMap(keys, key => key.toUpperCase())
    // 结果。
    expect(map).toEqual({ a: 'A', b: 'B' })
  })

  test('mapConvert modifies in place', () => {
    // 输入。
    const map = { a: 1, b: 2 }
    // 就地乘 2。
    mapConvert(map, (_key, v) => v * 2)
    // 原对象被修改。
    expect(map).toEqual({ a: 2, b: 4 })
  })

  test('getConvertedMap returns new object', () => {
    // 输入。
    const map = { a: 1, b: 2 }
    // 生成新对象。
    const out = getConvertedMap(map, (_key, v) => v + 1)
    // 新对象值正确。
    expect(out).toEqual({ a: 2, b: 3 })
    // 原对象不受影响。
    expect(map).toEqual({ a: 1, b: 2 })
  })

  test('mapSet copies source into target', () => {
    // 目标。
    const target = { a: 1 }
    // 源。
    const source = { b: 2 }
    // 合并。
    mapSet(target, source)
    // 目标含两个键。
    expect(target).toEqual({ a: 1, b: 2 })
  })

  test('deepMapSet merges nested objects', () => {
    // 目标。
    const target = { a: { x: 1 }, b: 2 }
    // 源。
    const source = { a: { y: 3 }, c: 4 }
    // 深合并。
    deepMapSet(target, source)
    // 嵌套对象被合并而非覆盖。
    expect(target).toEqual({ a: { x: 1, y: 3 }, b: 2, c: 4 })
  })

  test('deepMapSet overwrites arrays and primitives', () => {
    // 目标。
    const target = { a: [1, 2], b: 'old' }
    // 源。
    const source = { a: [3], b: 'new' }
    // 合并。
    deepMapSet(target, source)
    // 数组直接覆盖。
    expect(target.a).toEqual([3])
    // 原始值直接覆盖。
    expect(target.b).toBe('new')
  })

  test('deepMapSet executes function values', () => {
    // 目标。
    const target = { a: 1 }
    // 源：函数值会被执行。
    const source = { a: () => 99 }
    // 合并。
    deepMapSet(target, source)
    // 函数执行结果写入。
    expect(target.a).toBe(99)
  })
})

// ========== 测试组 7：deepGet ==========
describe('util - deepGet', () => {
  test('gets nested value by dot path', () => {
    // 嵌套对象。
    const obj = { a: { b: { c: 42 } } }
    // 深取。
    expect(deepGet(obj, 'a.b.c')).toBe(42)
  })

  test('returns undefined for missing path', () => {
    // 对象。
    const obj = { a: 1 }
    // 缺失路径返回 undefined。
    expect(deepGet(obj, 'a.b')).toBe(undefined)
    // 一级缺失。
    expect(deepGet(obj, 'z')).toBe(undefined)
  })

  test('handles array elements in path', () => {
    // 对象含数组。
    const obj = { list: [{ name: 'x' }] }
    // 通过下标深取。
    expect(deepGet(obj, 'list.0.name')).toBe('x')
  })
})

// ========== 测试组 8：format ==========
describe('util - format', () => {
  test('formats with object arg', () => {
    // 模板 + 对象参数。
    expect(format('Hello {name}', { name: 'World' })).toBe('Hello World')
  })

  test('formats nested key with object arg', () => {
    // 深路径占位。
    expect(format('{a.b}', { a: { b: 'deep' } })).toBe('deep')
  })

  test('formats with positional args', () => {
    // 下标占位。
    expect(format('{0} and {1}', 'a', 'b')).toBe('a and b')
  })

  test('formats numbers and booleans', () => {
    // 数字。
    expect(format('{n}', { n: 42 })).toBe('42')
    // 布尔。
    expect(format('{flag}', { flag: true })).toBe('true')
  })

  test('formats objects as JSON', () => {
    // 对象值转 JSON。
    expect(format('{o}', { o: { x: 1 } })).toBe('{"x":1}')
  })

  test('returns original string when no args', () => {
    // 无参数原样返回。
    expect(format('no placeholders')).toBe('no placeholders')
  })

  test('keeps placeholder for undefined value', () => {
    // 缺失键保留原占位符。
    expect(format('{missing}', {})).toBe('{missing}')
  })
})

// ========== 测试组 9：createRng ==========
describe('util - createRng', () => {
  test('same seed produces same sequence', () => {
    // 同种子创建两个 RNG。
    const rng1 = createRng(123)
    const rng2 = createRng(123)
    // 前 5 个随机数应完全一致。
    for (let i = 0; i < 5; i++) {
      expect(rng1()).toBe(rng2())
    }
  })

  test('different seeds produce different sequences', () => {
    // 不同种子。
    const rng1 = createRng(1)
    const rng2 = createRng(2)
    // 首个随机数应不同。
    expect(rng1()).not.toBe(rng2())
  })

  test('returns numbers in [0, 1)', () => {
    // 种子。
    const rng = createRng(999)
    // 抽 1000 次验证范围。
    for (let i = 0; i < 1000; i++) {
      // 每次取值。
      const v = rng()
      // 范围断言。
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
