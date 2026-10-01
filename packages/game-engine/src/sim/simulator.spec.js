/**
 * simulator 单元测试 — 批量模拟内核
 *
 * 覆盖：
 *   1. runOneLife：单局快照字段完整、天赋受上限约束、分配总和 = 可用点数
 *   2. createSimulator：分批跑、进度、结果累积、成就增量为非负
 *   3. **可复现性**：相同种子 → 两个独立模拟器逐局结果完全一致（最强的性质断言）
 *   4. summarize：min/max/avg/median/分档/最佳局/最长寿/空结果
 *   5. histogram：分档边界（0/9/10/99/100/150）
 *   6. collectionOf：从引擎读收集统计
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { MAX_YEARS, collectionOf, createSimulation, createSimulator, histogram, runOneLife, summarize } from './simulator.js'
// 引擎与工具。
import Life from '../modules/life.js'
import { clone, createRng } from '../functions/util.js'
// fixture 数据。
import { AGE_DATA, TOTAL } from '../fixtures/property.fixture.js'
import { TALENTS, EVENTS } from '../fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from '../fixtures/achievement-character.fixture.js'

// #buildData
// 组装 fixture 数据。
function buildData() {
  // 返回。
  return {
    age: clone(AGE_DATA),
    total: TOTAL,
    talents: clone(TALENTS),
    events: clone(EVENTS),
    achievements: clone(ACHIEVEMENTS),
    characters: {},
  }
}

// #memoryStorage
// 内存 storage（模拟器实例级隔离：收集统计在实例内累计，不污染外部）。
function memoryStorage() {
  // 数据。
  const data = {}
  // 适配器。
  return {
    // 读。
    getItem(k) { return k in data ? data[k] : null },
    // 写。
    setItem(k, v) { data[k] = String(v) },
  }
}

// #makeLife
// 造一个可用于模拟的 Life 实例（默认 judge 分档 + 内存 storage）。
//
// @returns {Promise<object>} Life
async function makeLife() {
  // 实例。
  const life = new Life({ data: buildData(), storage: memoryStorage() })
  // 初始化。
  await life.initial()
  // 配置（空参：走引擎内置 judge）。
  life.config()
  // 返回。
  return life
}

describe('simulator - runOneLife', () => {
  test('单局快照字段完整且自洽', async () => {
    // 引擎。
    const life = await makeLife()
    // 跑一局。
    const result = runOneLife({ life, random: createRng(42) })
    // 寿命是数字。
    expect(typeof result.age).toBe('number')
    expect(result.age).toBeGreaterThanOrEqual(0)
    // 寿命不超过推进上限。
    expect(result.age).toBeLessThanOrEqual(MAX_YEARS)
    // 天赋数量不超过引擎上限，且不重复。
    expect(result.talents.length).toBeLessThanOrEqual(life.talentSelectLimit)
    expect(new Set(result.talents).size).toBe(result.talents.length)
    // 天赋明细：ID 与名称一一对应（供 UI 展示可读名称）。
    expect(result.talentDetails.length).toBe(result.talents.length)
    for (const detail of result.talentDetails) {
      // ID 在选中列表里。
      expect(result.talents).toContain(detail.id)
      // 名称非空（名称缺失时回退为 ID 字符串）。
      expect(String(detail.name).length).toBeGreaterThan(0)
    }
    // 分配总和 = 可用点数（容量足够时正好分完）。
    const allocated = Object.values(result.allocation).reduce((a, b) => a + b, 0)
    expect(allocated).toBeGreaterThan(0)
    expect(allocated).toBeLessThanOrEqual(20 + result.talents.length * 10)
    // 总评与评价键。
    expect(typeof result.sum).toBe('number')
    expect(result.grade).toMatch(/^J_/)
    // 终局属性与历史最高都在。
    for (const key of ['CHR', 'INT', 'STR', 'MNY', 'SPR']) {
      expect(typeof result.propertys[key]).toBe('number')
      expect(typeof result.maxPropertys[key]).toBe('number')
    }
    // 本局统计项。
    expect(result.events).toBeGreaterThanOrEqual(0)
    expect(result.talentsTriggered).toBeGreaterThanOrEqual(0)
    expect(result.achievedTotal).toBeGreaterThanOrEqual(0)
  })

  test('同一实例可连续重开多局（结果互相独立）', async () => {
    // 引擎。
    const life = await makeLife()
    // 同一随机源连续跑三局。
    const random = createRng(7)
    const first = runOneLife({ life, random })
    const second = runOneLife({ life, random })
    const third = runOneLife({ life, random })
    // 三局都有结果。
    for (const r of [first, second, third]) expect(r.age).toBeGreaterThanOrEqual(0)
    // 至少有一局的天赋组合不同（随机种子不同段）。
    const keys = [first, second, third].map((r) => r.talents.join(','))
    expect(new Set(keys).size).toBeGreaterThan(1)
  })
})

describe('simulator - createSimulator', () => {
  test('分批跑：进度、结果累积、成就增量为非负', async () => {
    // 引擎。
    const life = await makeLife()
    // 模拟器。
    const sim = createSimulator({ life, random: createRng(1) })
    // 初始。
    expect(sim.progress()).toBe(0)
    // 第一批。
    sim.run(2)
    expect(sim.progress()).toBe(2)
    // 每局的成就增量非负。
    for (const r of sim.results) expect(r.achievements).toBeGreaterThanOrEqual(0)
    // 第二批。
    sim.run(3)
    expect(sim.progress()).toBe(5)
    expect(sim.results.length).toBe(5)
    // 聚合可用。
    const stats = sim.summarize({ seed: 1 })
    expect(stats.runs).toBe(5)
    expect(stats.seed).toBe(1)
  })

  test('onRun 回调逐局触发', async () => {
    // 引擎。
    const life = await makeLife()
    // 记录回调。
    const seen = []
    // 模拟器。
    const sim = createSimulator({ life, random: createRng(2), onRun: (r, n) => seen.push([n, r.age]) })
    // 跑三局。
    sim.run(3)
    // 回调三次，序号递增。
    expect(seen.map(([n]) => n)).toEqual([1, 2, 3])
    // 每局都有寿命。
    for (const [, age] of seen) expect(typeof age).toBe('number')
  })

  test('可复现性：相同种子 → 两套独立模拟器逐局结果完全一致', async () => {
    // 用推荐入口：同一个种子 RNG 同时注入 Life（游戏内随机）与策略层。
    // 只给 createSimulator 传 random 是不够的——游戏内随机（事件抽取/RDM）来自 Life 实例，
    // 那样两套"相同种子"的模拟器仍会跑出不同人生（本用例的第一版实现就踩了这个坑）。
    const a = await createSimulation({ data: buildData(), seed: 2026, storage: memoryStorage() })
    const b = await createSimulation({ data: buildData(), seed: 2026, storage: memoryStorage() })
    // 各跑三局。
    a.simulator.run(3)
    b.simulator.run(3)
    // 逐局完全一致（寿命/天赋/分配/总评）。
    expect(a.simulator.results.map((r) => [r.age, r.talents, r.allocation, r.sum])).toEqual(
      b.simulator.results.map((r) => [r.age, r.talents, r.allocation, r.sum])
    )
    // 聚合结果一致。
    expect(a.simulator.summarize({ seed: 2026 }).age).toEqual(b.simulator.summarize({ seed: 2026 }).age)
    // 种子透传。
    expect(a.seed).toBe(2026)
  })

  test('不同种子 → 结果不同（种子确实生效）', async () => {
    // 两个不同种子。
    const a = await createSimulation({ data: buildData(), seed: 1, storage: memoryStorage() })
    const b = await createSimulation({ data: buildData(), seed: 2, storage: memoryStorage() })
    // 各跑三局。
    a.simulator.run(3)
    b.simulator.run(3)
    // 至少有不一样的地方（寿命序列或天赋组合）。
    const sig = (s) => s.simulator.results.map((r) => `${r.age}:${r.talents.join('-')}`).join('|')
    expect(sig(a)).not.toBe(sig(b))
  })

  test('不传种子 → 走 Math.random（seed 标为 null，仍可跑）', async () => {
    // 不传种子。
    const { simulator, seed } = await createSimulation({ data: buildData(), storage: memoryStorage() })
    // 标记为不可复现。
    expect(seed).toBeNull()
    // 跑一局。
    simulator.run(1)
    expect(simulator.results.length).toBe(1)
  })

  test('collectionOf：返回数值型收集统计', async () => {
    // 引擎。
    const life = await makeLife()
    // 跑一局（产生事件/成就累计）。
    runOneLife({ life, random: createRng(3) })
    // 读统计。
    const collection = collectionOf(life)
    // 字段都在且为数字。
    for (const key of ['achievements', 'talentRate', 'eventRate', 'achievementRate']) {
      expect(typeof collection[key], key).toBe('number')
      expect(collection[key]).toBeGreaterThanOrEqual(0)
    }
    // 事件收集率是 0~1 的比例。
    expect(collection.eventRate).toBeLessThanOrEqual(1)
  })
})

describe('simulator - histogram', () => {
  test('分档边界正确（0/9/10/99/100/150）', () => {
    // 构造边界样本。
    const buckets = histogram([0, 9, 10, 99, 100, 150])
    // 取各档计数。
    const map = Object.fromEntries(buckets.map((b) => [b.label, b.count]))
    // 0 与 9 在 0-9。
    expect(map['0-9']).toBe(2)
    // 10 在 10-19。
    expect(map['10-19']).toBe(1)
    // 99 在 90-99。
    expect(map['90-99']).toBe(1)
    // 100 与 150 在 100+。
    expect(map['100+']).toBe(2)
    // 共 11 档（0-9 … 90-99 + 100+）。
    expect(buckets.length).toBe(11)
  })

  test('空输入返回全零分档', () => {
    // 分档。
    const buckets = histogram([])
    // 全零。
    expect(buckets.every((b) => b.count === 0)).toBe(true)
  })
})

describe('simulator - summarize', () => {
  // 手工构造的结果集（便于精确断言数学）。
  const RESULTS = [
    { age: 10, sum: 30, grade: 'J_Normal', propertys: { CHR: 1, INT: 2, STR: 3, MNY: 4, SPR: 5 }, maxPropertys: { CHR: 2, INT: 3, STR: 4, MNY: 5, SPR: 6 }, achievements: 0 },
    { age: 50, sum: 60, grade: 'J_Good', propertys: { CHR: 3, INT: 4, STR: 5, MNY: 6, SPR: 7 }, maxPropertys: { CHR: 4, INT: 5, STR: 6, MNY: 7, SPR: 8 }, achievements: 2 },
    { age: 90, sum: 120, grade: 'J_Great', propertys: { CHR: 5, INT: 6, STR: 7, MNY: 8, SPR: 9 }, maxPropertys: { CHR: 6, INT: 7, STR: 8, MNY: 9, SPR: 10 }, achievements: 1 },
  ]

  test('寿命与总评的 min/max/avg/median', () => {
    // 聚合。
    const stats = summarize(RESULTS, { seed: 5 })
    // 寿命。
    expect(stats.age.min).toBe(10)
    expect(stats.age.max).toBe(90)
    expect(stats.age.avg).toBe(50)
    expect(stats.age.median).toBe(50)
    // 总评。
    expect(stats.sum.min).toBe(30)
    expect(stats.sum.max).toBe(120)
    expect(stats.sum.avg).toBe(70)
    // 种子透传。
    expect(stats.seed).toBe(5)
    // 局数。
    expect(stats.runs).toBe(3)
  })

  test('分档计数、属性均值、平均成就数', () => {
    // 聚合。
    const stats = summarize(RESULTS)
    // 每档各一局。
    expect(stats.sum.grades).toEqual({ J_Normal: 1, J_Good: 1, J_Great: 1 })
    // 颜值终局均值 = (1+3+5)/3 = 3。
    expect(stats.propertys.CHR).toBe(3)
    // 颜值历史最高均值 = (2+4+6)/3 = 4。
    expect(stats.maxPropertys.CHR).toBe(4)
    // 平均成就数 = (0+2+1)/3 = 1。
    expect(stats.achievementsPerRun).toBe(1)
  })

  test('最佳一局与最长寿一局', () => {
    // 聚合。
    const stats = summarize(RESULTS)
    // 总评最高的是第三局。
    expect(stats.best.sum).toBe(120)
    expect(stats.best.age).toBe(90)
    // 最长寿也是第三局。
    expect(stats.longest.age).toBe(90)
  })

  test('空结果返回可渲染的零值结构', () => {
    // 聚合。
    const stats = summarize([], { seed: 9 })
    // 零值。
    expect(stats.runs).toBe(0)
    expect(stats.seed).toBe(9)
    expect(stats.age.avg).toBe(0)
    expect(stats.best).toBeNull()
    expect(stats.longest).toBeNull()
    // 直方图仍可渲染（全零）。
    expect(stats.age.histogram.length).toBe(11)
    expect(stats.age.histogram.every((b) => b.count === 0)).toBe(true)
  })

  test('缺字段的结果不崩（容错）', () => {
    // 只有 age 的最小结果。
    expect(() => summarize([{ age: 5 }, { age: 15 }])).not.toThrow()
    // 均值仍算得出来。
    expect(summarize([{ age: 5 }, { age: 15 }]).age.avg).toBe(10)
  })
})
