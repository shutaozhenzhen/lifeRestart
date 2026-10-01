/**
 * random-strategy 单元测试 — 批量模拟的随机策略
 *
 * 覆盖：
 *   1. randomAllocation：总和正确、单项上限、点数超容量、0 点、可配置 keys/max
 *   2. randomTalents：选满上限、不重复、池不足、互斥跳过、对象池/ID 数组两种入参
 *   3. 同一随机种子两次调用结果一致（可复现）
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { ALLOC_KEYS, randomAllocation, randomTalents } from './random-strategy.js'
// 固定种子随机源。
import { createRng } from '../functions/util.js'

describe('random-strategy - randomAllocation', () => {
  test('分配总和等于点数，且每项不超过上限', () => {
    // 固定种子。
    const random = createRng(1)
    // 20 点、单项上限 10。
    const alloc = randomAllocation({ points: 20, max: 10, random })
    // 总和。
    expect(Object.values(alloc).reduce((a, b) => a + b, 0)).toBe(20)
    // 每项不超上限。
    for (const key of ALLOC_KEYS) {
      expect(alloc[key]).toBeGreaterThanOrEqual(0)
      expect(alloc[key]).toBeLessThanOrEqual(10)
    }
  })

  test('0 点 → 全 0', () => {
    // 分配。
    const alloc = randomAllocation({ points: 0 })
    // 全零。
    expect(alloc).toEqual({ CHR: 0, INT: 0, STR: 0, MNY: 0 })
  })

  test('点数超过总容量 → 分配到满且不死循环', () => {
    // 4 项 × 上限 10 = 容量 40，这里给 100 点。
    const alloc = randomAllocation({ points: 100, max: 10, random: createRng(2) })
    // 每项都满。
    expect(Object.values(alloc)).toEqual([10, 10, 10, 10])
    // 总和 = 容量。
    expect(Object.values(alloc).reduce((a, b) => a + b, 0)).toBe(40)
  })

  test('keys / max 可配置（Mod 自定义属性也能模拟）', () => {
    // 两项、上限 3、共 5 点（容量 6）。
    const alloc = randomAllocation({ points: 5, keys: ['A', 'B'], max: 3, random: createRng(3) })
    // 只含指定键。
    expect(Object.keys(alloc).sort()).toEqual(['A', 'B'])
    // 总和 5。
    expect(alloc.A + alloc.B).toBe(5)
    // 都不超上限。
    expect(alloc.A).toBeLessThanOrEqual(3)
    expect(alloc.B).toBeLessThanOrEqual(3)
  })

  test('同一随机种子结果一致', () => {
    // 两次相同种子。
    const a = randomAllocation({ points: 20, max: 10, random: createRng(9) })
    const b = randomAllocation({ points: 20, max: 10, random: createRng(9) })
    // 完全一致。
    expect(a).toEqual(b)
  })

  test('异常入参不崩（undefined / 负数 / 非数字）', () => {
    // undefined。
    expect(Object.values(randomAllocation({})).every((v) => v === 0)).toBe(true)
    // 负数。
    expect(Object.values(randomAllocation({ points: -5 })).every((v) => v === 0)).toBe(true)
    // 非数字。
    expect(Object.values(randomAllocation({ points: 'abc' })).every((v) => v === 0)).toBe(true)
  })
})

describe('random-strategy - randomTalents', () => {
  // 候选池。
  const POOL = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }, { id: 't5' }]

  test('选满上限且不重复', () => {
    // 选 3 个。
    const picked = randomTalents({ pool: POOL, limit: 3, random: createRng(4) })
    // 数量。
    expect(picked.length).toBe(3)
    // 不重复。
    expect(new Set(picked).size).toBe(3)
    // 都来自池。
    for (const id of picked) expect(POOL.map((t) => t.id)).toContain(id)
  })

  test('池不足时返回全部可用（不报错）', () => {
    // 池 2 个、要 5 个。
    const picked = randomTalents({ pool: [{ id: 'a' }, { id: 'b' }], limit: 5, random: createRng(5) })
    // 只拿到 2 个。
    expect(picked.sort()).toEqual(['a', 'b'])
  })

  test('互斥的候选被跳过', () => {
    // 让 t2 永远与已选冲突（模拟互斥天赋）。
    const isConflict = (chosen, id) => id === 't2'
    // 选 3 个。
    const picked = randomTalents({ pool: POOL, limit: 3, isConflict, random: createRng(6) })
    // 不含冲突项。
    expect(picked).not.toContain('t2')
    // 依然凑满 3 个。
    expect(picked.length).toBe(3)
  })

  test('支持 ID 数组入参；无效项被跳过', () => {
    // ID 数组 + 一个 undefined。
    const picked = randomTalents({ pool: ['a', undefined, 'b'], limit: 2, random: createRng(7) })
    // 只取有效 ID。
    expect(picked.sort()).toEqual(['a', 'b'])
  })

  test('同一随机种子结果一致', () => {
    // 两次相同种子。
    const a = randomTalents({ pool: POOL, limit: 3, random: createRng(11) })
    const b = randomTalents({ pool: POOL, limit: 3, random: createRng(11) })
    // 一致。
    expect(a).toEqual(b)
  })

  test('空池 / limit=0 返回空数组', () => {
    // 空池。
    expect(randomTalents({ pool: [], limit: 3 })).toEqual([])
    // 0 个。
    expect(randomTalents({ pool: POOL, limit: 0 })).toEqual([])
  })
})
