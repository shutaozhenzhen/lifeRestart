/**
 * strategy 单元测试 — 策略解析（随机 / 固定）
 *
 * 覆盖：
 *   1. normalizeStrategy：缺字段/类型错误容错、去重、只留数值
 *   2. resolveTalents：固定特性生效（顺序保持）、未知 ID 剔除并警告、
 *      全无效回退随机（记 warnings）、超上限截断
 *   3. resolveAllocation：固定属性生效、单项超上限截断、
 *      **超预算按比例缩减且合计正好 = 可用点数**、随机模式透传
 *   4. 固定特性 + 随机属性（本次新增的核心用法）
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { DEFAULT_STRATEGY, normalizeStrategy, resolveAllocation, resolveTalents } from './strategy.js'
// 固定种子随机源。
import { createRng } from '../functions/util.js'

// 天赋表（id → 对象）。
const TABLE = {
  t1: { id: 't1', name: '天赋一', grade: 1 },
  t2: { id: 't2', name: '天赋二', grade: 2 },
  t3: { id: 't3', name: '天赋三', grade: 3 },
  t4: { id: 't4', name: '天赋四', grade: 0 },
}

describe('strategy - normalizeStrategy', () => {
  test('缺省/空值 → 两条轴都随机', () => {
    // 空。
    expect(normalizeStrategy()).toEqual(DEFAULT_STRATEGY)
    expect(normalizeStrategy({})).toEqual(DEFAULT_STRATEGY)
    // 非法 mode 退回随机。
    expect(normalizeStrategy({ talents: { mode: 'weird' } }).talents.mode).toBe('random')
    expect(normalizeStrategy({ allocation: { mode: 'x' } }).allocation.mode).toBe('random')
  })

  test('固定特性去重、去空、字符串化', () => {
    // 带重复与空值。
    const plan = normalizeStrategy({ talents: { mode: 'fixed', fixed: ['t1', 't1', '', null, 2] } })
    // 去重去空 + 数字转字符串。
    expect(plan.talents.fixed).toEqual(['t1', '2'])
  })

  test('固定属性只保留数值项', () => {
    // 混杂非法值。
    const plan = normalizeStrategy({ allocation: { mode: 'fixed', fixed: { CHR: '3', INT: 'abc', STR: null, MNY: 5 } } })
    // 只有可数值化且非 null 的留下（null → Number(null)=0，会保留为 0）。
    expect(plan.allocation.fixed.CHR).toBe(3)
    expect(plan.allocation.fixed.MNY).toBe(5)
    expect('INT' in plan.allocation.fixed).toBe(false)
  })
})

describe('strategy - resolveTalents', () => {
  // 抽卡池。
  const POOL = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]

  test('固定模式：原样使用给定顺序（可复现），不抽卡', () => {
    // 固定两个。
    const result = resolveTalents({
      strategy: { talents: { mode: 'fixed', fixed: ['t3', 't1'] } },
      pool: POOL,
      limit: 3,
      random: createRng(1),
      talentTable: TABLE,
    })
    // 顺序保持。
    expect(result.talents).toEqual(['t3', 't1'])
    expect(result.mode).toBe('fixed')
    expect(result.warnings).toEqual([])
  })

  test('固定模式：不存在的 ID 被剔除并给出警告', () => {
    // 混入未知 ID。
    const result = resolveTalents({
      strategy: { talents: { mode: 'fixed', fixed: ['t2', 'nope'] } },
      pool: POOL,
      limit: 3,
      talentTable: TABLE,
    })
    // 只留有效的。
    expect(result.talents).toEqual(['t2'])
    // 明确告知忽略了什么。
    expect(result.warnings[0]).toContain('nope')
  })

  test('固定模式：全部无效 → 回退随机并记 warning', () => {
    // 全无效。
    const result = resolveTalents({
      strategy: { talents: { mode: 'fixed', fixed: ['x', 'y'] } },
      pool: POOL,
      limit: 2,
      random: createRng(2),
      talentTable: TABLE,
    })
    // 回退随机。
    expect(result.mode).toBe('random')
    expect(result.talents.length).toBe(2)
    // 有警告。
    expect(result.warnings.some((w) => w.includes('回退随机'))).toBe(true)
  })

  test('固定模式：超过上限截断并警告', () => {
    // 给 4 个、上限 2。
    const result = resolveTalents({
      strategy: { talents: { mode: 'fixed', fixed: ['t1', 't2', 't3', 't4'] } },
      pool: POOL,
      limit: 2,
      talentTable: TABLE,
    })
    // 截取前 2 个。
    expect(result.talents).toEqual(['t1', 't2'])
    // 警告含上限。
    expect(result.warnings.some((w) => w.includes('上限'))).toBe(true)
  })

  test('随机模式：走抽卡池（不依赖天赋表）', () => {
    // 随机。
    const result = resolveTalents({ strategy: DEFAULT_STRATEGY, pool: POOL, limit: 3, random: createRng(3) })
    // 数量与去重。
    expect(result.talents.length).toBe(3)
    expect(new Set(result.talents).size).toBe(3)
    expect(result.mode).toBe('random')
  })
})

describe('strategy - resolveAllocation', () => {
  test('固定模式：预算内原样使用（单项超上限被截断）', () => {
    // 给 CHR 99（超上限→截断 10）、INT 3、STR 5、MNY 2，合计 20 点 = 可用 20。
    const result = resolveAllocation({
      strategy: { allocation: { mode: 'fixed', fixed: { CHR: 99, INT: 3, STR: 5, MNY: 2 } } },
      points: 20,
      max: 10,
    })
    // CHR 截断到 10，其余原样。
    expect(result.allocation).toEqual({ CHR: 10, INT: 3, STR: 5, MNY: 2 })
    expect(result.mode).toBe('fixed')
    // 未超预算 → 无警告。
    expect(result.warnings).toEqual([])
  })

  test('固定模式：超预算按比例缩减，合计正好 = 可用点数且不超单项上限', () => {
    // 10+10+10+10 = 40 点，可用只有 20。
    const result = resolveAllocation({
      strategy: { allocation: { mode: 'fixed', fixed: { CHR: 10, INT: 10, STR: 10, MNY: 10 } } },
      points: 20,
      max: 10,
    })
    // 合计正好用完。
    expect(Object.values(result.allocation).reduce((a, b) => a + b, 0)).toBe(20)
    // 每项不超上限。
    for (const v of Object.values(result.allocation)) expect(v).toBeLessThanOrEqual(10)
    // 有警告说明缩减。
    expect(result.warnings[0]).toContain('超过可用')
  })

  test('固定模式：缩减时不会把点数补到用户没要的属性上', () => {
    // 只给 CHR 10、INT 10，可用 15，其余属性没要求。
    const result = resolveAllocation({
      strategy: { allocation: { mode: 'fixed', fixed: { CHR: 10, INT: 10 } } },
      points: 15,
      max: 10,
    })
    // 合计 15。
    expect(result.allocation.CHR + result.allocation.INT).toBe(15)
    // 未申请的属性保持 0（补点上限 = 各自请求值）。
    expect(result.allocation.STR).toBe(0)
    expect(result.allocation.MNY).toBe(0)
  })

  test('随机模式：透传随机分配（合计 = 可用点数）', () => {
    // 随机。
    const result = resolveAllocation({ strategy: DEFAULT_STRATEGY, points: 20, max: 10, random: createRng(4) })
    // 合计。
    expect(Object.values(result.allocation).reduce((a, b) => a + b, 0)).toBe(20)
    expect(result.mode).toBe('random')
  })

  test('固定模式：预算内但全为 0 也合法（0 点分配）', () => {
    // 全 0。
    const result = resolveAllocation({
      strategy: { allocation: { mode: 'fixed', fixed: { CHR: 0, INT: 0, STR: 0, MNY: 0 } } },
      points: 20,
    })
    // 全 0 且无警告。
    expect(Object.values(result.allocation)).toEqual([0, 0, 0, 0])
    expect(result.warnings).toEqual([])
  })
})

describe('strategy - 固定特性 + 随机属性（核心用法）', () => {
  test('特性固定、属性随机：特性固定而分配逐局变化', () => {
    // 策略。
    const strategy = { talents: { mode: 'fixed', fixed: ['t2', 't3'] }, allocation: { mode: 'random', fixed: {} } }
    // 两局（不同随机段）。
    const random = createRng(7)
    const first = resolveTalents({ strategy, pool: [], limit: 3, talentTable: TABLE })
    const second = resolveTalents({ strategy, pool: [], limit: 3, talentTable: TABLE })
    // 特性两局完全一致。
    expect(first.talents).toEqual(['t2', 't3'])
    expect(second.talents).toEqual(first.talents)
    // 属性两局不同（随机）。
    const allocA = resolveAllocation({ strategy, points: 20, max: 10, random })
    const allocB = resolveAllocation({ strategy, points: 20, max: 10, random })
    expect(allocA.mode).toBe('random')
    expect(allocA.allocation).not.toEqual(allocB.allocation)
  })
})
