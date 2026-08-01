/**
 * property 属性系统单元测试 — property.spec.js
 *
 * 覆盖范围：47 个测试用例，分为 10 组：
 *   1. initial（age 数据解析：权重、字符串 ID）
 *   2. restart/restartLastStep（初始属性、派生基准）
 *   3. get/set（本局属性、深拷贝隔离）
 *   4. change（标量累加、数组添加/移除、字符串 ID）
 *   5. 派生属性（L/H 值、SUM 总评）
 *   6. 统计属性（storage 累计、计数、总数、比率）
 *   7. effect/hookSpecial（RDM 随机、批量效果）
 *   8. judge（分档评价）
 *   9. isEnd/ageNext
 *   10. achieve 持久化
 */

// 导入 vitest 测试 DSL 和被测对象。
import { describe, test, expect, beforeEach } from 'vitest'
// Property 模块。
import Property from './property.js'
// 测试 fixture 数据。
import { AGE_DATA, TOTAL, JUDGE_CONFIG } from '../fixtures/property.fixture.js'
// 种子随机源。
import { createRng } from '../functions/util.js'
// 深拷贝（initial 会就地修改 age 数据，每次测试需用副本）。
import { clone } from '../functions/util.js'

// 在每个测试前创建一个全新的 Property 实例。
// 用内存 storage + 固定种子 RNG，保证测试可复现且互不影响。
let prop
beforeEach(() => {
  // 创建实例：注入内存 storage + 种子 RNG。
  prop = new Property({
    storage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null }, setItem(k, v) { this._d[k] = String(v) } },
    random: createRng(42),
  })
  // 注入 age 数据（用深拷贝，避免 initial 就地修改污染共享 fixture）与总数。
  prop.initial({ age: clone(AGE_DATA), total: TOTAL })
  // 注入评价配置。
  prop.config({ judge: JUDGE_CONFIG })
})

// #restartGame
// 快速开局辅助：应用初始分配。
//
// @param {object} data - 初始属性（含 TLT）
function restartGame(data = { TLT: [] }) {
  // 重启一局。
  prop.restart(data)
  // 记录开局基准。
  prop.restartLastStep()
}

// ========== 测试组 1：initial ==========
describe('property - initial', () => {
  test('parses event with weight suffix', () => {
    // 先开局。
    restartGame()
    // 2 岁的数据（在 initial 时已解析）。
    const data = prop.getAgeData(2)
    // 事件 ev_002*2 → ['ev_002', 2]。
    expect(data.event).toContainEqual(['ev_002', 2])
    // 事件 ev_003*0.5 → ['ev_003', 0.5]。
    expect(data.event).toContainEqual(['ev_003', 0.5])
    // 纯 ID 事件 → ['ev_004', 1]（默认权重 1）。
    expect(data.event).toContainEqual(['ev_004', 1])
  })

  test('keeps talent ids as strings', () => {
    // 开局。
    restartGame()
    // 2 岁数据。
    const data = prop.getAgeData(2)
    // 天赋 ID 保持字符串。
    expect(data.talent).toEqual(['t_001', 't_002'])
  })

  test('parses comma-separated event string', () => {
    // 构造字符串形式 age 数据。
    const strProp = new Property()
    // 注入 age：event 为逗号字符串。
    strProp.initial({
      age: { 1: { event: '10001,10002', talent: 't_001,t_002' } },
      total: TOTAL,
    })
    // 读取解析结果。
    const data = strProp.getAgeData(1)
    // 事件被拆分为数组。
    expect(data.event).toEqual([['10001', 1], ['10002', 1]])
    // 天赋被拆分为字符串数组。
    expect(data.talent).toEqual(['t_001', 't_002'])
  })
})

// ========== 测试组 2：restart ==========
describe('property - restart', () => {
  test('initializes base properties', () => {
    // 重启（无分配）。
    restartGame()
    // 年龄从 -1 开始。
    expect(prop.get('AGE')).toBe(-1)
    // 五项基础属性为 0。
    expect(prop.get('CHR')).toBe(0)
    // 生命为 1。
    expect(prop.get('LIF')).toBe(1)
    // 天赋列表为空。
    expect(prop.get('TLT')).toEqual([])
  })

  test('applies allocation data', () => {
    // 带分配重启。
    restartGame({ CHR: 5, INT: 3, TLT: ['t_001'] })
    // 分配生效。
    expect(prop.get('CHR')).toBe(5)
    // 天赋写入。
    expect(prop.get('TLT')).toEqual(['t_001'])
  })

  test('restartLastStep records opening baseline', () => {
    // 带属性重启。
    restartGame({ CHR: 5, MNY: 8 })
    // 开局后 HCHR = CHR = 5。
    expect(prop.get('HCHR')).toBe(5)
    // 开局后 HMNY = MNY = 8。
    expect(prop.get('HMNY')).toBe(8)
  })
})

// ========== 测试组 3：get/set ==========
describe('property - get/set', () => {
  test('get returns clone (mutation isolated)', () => {
    // 开局。
    restartGame({ TLT: ['t_001'] })
    // 取天赋列表。
    const tlt = prop.get('TLT')
    // 修改返回值。
    tlt.push('evil')
    // 内部数据不受影响（深拷贝隔离）。
    expect(prop.get('TLT')).toEqual(['t_001'])
  })

  test('set overrides value', () => {
    // 开局。
    restartGame()
    // 覆盖设置 CHR。
    prop.set('CHR', 9)
    // 读取确认。
    expect(prop.get('CHR')).toBe(9)
  })

  test('set TMS writes to storage', () => {
    // 开局。
    restartGame()
    // 设置重开次数。
    prop.set('TMS', 3)
    // 读取。
    expect(prop.get('TMS')).toBe(3)
  })

  test('set EXT writes extend talent', () => {
    // 开局。
    restartGame()
    // 设置继承天赋。
    prop.set('EXT', 't_002')
    // 读取。
    expect(prop.get('EXT')).toBe('t_002')
  })

  test('getPropertys returns six base stats', () => {
    // 开局。
    restartGame({ CHR: 2, INT: 4, STR: 6, MNY: 8, SPR: 3 })
    // 读取六个属性。
    const p = prop.getPropertys()
    // 各属性值。
    expect(p.CHR).toBe(2)
    expect(p.INT).toBe(4)
    expect(p.STR).toBe(6)
    expect(p.MNY).toBe(8)
    expect(p.SPR).toBe(3)
    // AGE 存在。
    expect(p.AGE).toBe(-1)
  })
})

// ========== 测试组 4：change ==========
describe('property - change', () => {
  test('accumulates scalar property', () => {
    // 开局。
    restartGame({ CHR: 5 })
    // +3。
    prop.change('CHR', 3)
    // 结果为 8。
    expect(prop.get('CHR')).toBe(8)
  })

  test('accumulates negative scalar', () => {
    // 开局。
    restartGame({ CHR: 5 })
    // -2。
    prop.change('CHR', -2)
    // 结果为 3。
    expect(prop.get('CHR')).toBe(3)
  })

  test('accepts string numbers', () => {
    // 开局。
    restartGame({ MNY: 10 })
    // 字符串数值。
    prop.change('MNY', '5')
    // 结果为 15。
    expect(prop.get('MNY')).toBe(15)
  })

  test('adds talent id to array', () => {
    // 开局。
    restartGame()
    // 添加天赋。
    prop.change('TLT', 't_003')
    // 列表含该天赋。
    expect(prop.get('TLT')).toContain('t_003')
  })

  test('dedupes talent ids', () => {
    // 开局。
    restartGame()
    // 重复添加。
    prop.change('TLT', 't_001')
    prop.change('TLT', 't_001')
    // 只存一个。
    expect(prop.get('TLT').filter(id => id === 't_001')).toHaveLength(1)
  })

  test('removes talent with minus prefix', () => {
    // 开局。
    restartGame({ TLT: ['t_001', 't_002'] })
    // 用 '-' 前缀移除。
    prop.change('TLT', '-t_001')
    // 已移除。
    expect(prop.get('TLT')).toEqual(['t_002'])
  })

  test('negative number does not corrupt string array', () => {
    // 开局。
    restartGame({ TLT: ['t_001', 't_002'] })
    // 字符串数组中没有数字元素，负值移除是 no-op（不删除也不添加）。
    prop.change('TLT', -1)
    // 数组不变。
    expect(prop.get('TLT')).toEqual(['t_001', 't_002'])
  })

  test('handles array value by recursion', () => {
    // 开局。
    restartGame()
    // 一次传数组。
    prop.change('TLT', ['t_001', 't_002'])
    // 全部添加。
    expect(prop.get('TLT')).toEqual(['t_001', 't_002'])
  })

  test('change TMS via storage', () => {
    // 开局。
    restartGame()
    // 设置初始次数 1。
    prop.set('TMS', 1)
    // 增量。
    prop.change('TMS', 1)
    // 结果为 2。
    expect(prop.get('TMS')).toBe(2)
  })

  test('effect applies multiple changes', () => {
    // 开局。
    restartGame()
    // 批量效果。
    prop.effect({ CHR: 2, INT: 3 })
    // 全部生效。
    expect(prop.get('CHR')).toBe(2)
    expect(prop.get('INT')).toBe(3)
  })
})

// ========== 测试组 5：派生属性 ==========
describe('property - derived values', () => {
  test('hl tracks high value', () => {
    // 开局。
    restartGame({ CHR: 3 })
    // 提高到 7。
    prop.change('CHR', 4)
    // 最高值为 7。
    expect(prop.get('HCHR')).toBe(7)
  })

  test('hl keeps max across decrease', () => {
    // 开局。
    restartGame({ CHR: 5 })
    // 升到 8。
    prop.change('CHR', 3)
    // 降到 6。
    prop.change('CHR', -2)
    // 最高仍是 8。
    expect(prop.get('HCHR')).toBe(8)
  })

  test('hl tracks low value', () => {
    // 开局。
    restartGame({ CHR: 5 })
    // 降到 2。
    prop.change('CHR', -3)
    // 最低为 2。
    expect(prop.get('LCHR')).toBe(2)
  })

  test('L/H default to opening value via fallback', () => {
    // 开局无属性变化时。
    restartGame({ INT: 4 })
    // LINT 回退到当前 INT = 4。
    expect(prop.get('LINT')).toBe(4)
    // HINT 同。
    expect(prop.get('HINT')).toBe(4)
  })

  test('SUM formula', () => {
    // 各属性最高值。
    restartGame({ CHR: 10, INT: 10, STR: 10, MNY: 10, SPR: 10 })
    // SUM = floor(50*2 + HAGE/2)。
    // HAGE 此时 = AGE = -1，floor(100 + -0.5) = 99。
    expect(prop.get('SUM')).toBe(99)
  })

  test('SUM increases with age', () => {
    // 开局。
    restartGame({ CHR: 10, INT: 10, STR: 10, MNY: 10, SPR: 10 })
    // 推进一年。
    prop.ageNext()
    // HAGE 更新为 0，SUM = floor(100 + 0) = 100。
    expect(prop.get('SUM')).toBe(100)
  })
})

// ========== 测试组 6：统计属性 ==========
describe('property - statistics', () => {
  test('TLT adds to ATLT', () => {
    // 开局。
    restartGame()
    // 添加天赋。
    prop.change('TLT', 't_001')
    // ATLT 累计。
    expect(prop.get('ATLT')).toContain('t_001')
  })

  test('CTLT counts distinct talents', () => {
    // 开局。
    restartGame()
    // 添加两个天赋。
    prop.change('TLT', 't_001')
    prop.change('TLT', 't_002')
    // 计数 2。
    expect(prop.get('CTLT')).toBe(2)
  })

  test('TTLT returns total from initial', () => {
    // 开局。
    restartGame()
    // 总天赋数来自 TOTAL。
    expect(prop.get('TTLT')).toBe(5)
  })

  test('RTLT rate computation', () => {
    // 开局。
    restartGame()
    // 添加一个天赋。
    prop.change('TLT', 't_001')
    // 比率 = CTLT/TTLT = 1/5。
    expect(prop.get('RTLT')).toBeCloseTo(0.2)
  })

  test('AEVT accumulates events', () => {
    // 开局。
    restartGame()
    // 触发事件。
    prop.change('EVT', '10001')
    // 累计。
    expect(prop.get('AEVT')).toContain('10001')
  })

  test('storage persists across instances', () => {
    // 共享 storage。
    const shared = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null }, setItem(k, v) { this._d[k] = String(v) } }
    // 第一个实例。
    const p1 = new Property({ storage: shared })
    p1.initial({ age: clone(AGE_DATA), total: TOTAL })
    p1.restart({ TLT: [] })
    p1.change('TLT', 't_001')
    // 第二个实例（同一 storage）。
    const p2 = new Property({ storage: shared })
    p2.initial({ age: clone(AGE_DATA), total: TOTAL })
    p2.restart({ TLT: [] })
    // ATLT 仍能读到第一个实例写入的数据。
    expect(p2.get('ATLT')).toContain('t_001')
  })
})

// ========== 测试组 7：effect/hookSpecial ==========
describe('property - effect/hookSpecial', () => {
  test('RDM picks one of five stats', () => {
    // 开局。
    restartGame()
    // RDM 映射。
    const mapped = prop.hookSpecial('RDM')
    // 必须是五个基础属性之一。
    expect(['CHR', 'INT', 'STR', 'MNY', 'SPR']).toContain(mapped)
  })

  test('RDM deterministic with seed', () => {
    // 用固定随机源的实例。
    const p1 = new Property({ random: createRng(5) })
    p1.initial({ age: clone(AGE_DATA), total: TOTAL })
    p1.restart({ TLT: [] })
    // 同种子另一个实例。
    const p2 = new Property({ random: createRng(5) })
    p2.initial({ age: clone(AGE_DATA), total: TOTAL })
    p2.restart({ TLT: [] })
    // 两次 RDM 映射一致。
    expect(p1.hookSpecial('RDM')).toBe(p2.hookSpecial('RDM'))
  })

  test('non-special prop passes through hookSpecial', () => {
    // 普通属性原样返回。
    expect(prop.hookSpecial('CHR')).toBe('CHR')
  })

  test('effect with RDM property', () => {
    // 开局。
    restartGame()
    // 效果含 RDM。
    prop.effect({ RDM: 5 })
    // 六个基础属性中恰有一个 +5。
    const stats = ['CHR', 'INT', 'STR', 'MNY', 'SPR']
    // 求和应为 5。
    const total = stats.reduce((acc, k) => acc + prop.get(k), 0)
    expect(total).toBe(5)
  })
})

// ========== 测试组 8：judge ==========
describe('property - judge', () => {
  test('judges high value with top grade', () => {
    // 开局。
    restartGame({ CHR: 9 })
    // 评价 CHR。
    const r = prop.judge('CHR')
    // 最高档。
    expect(r.grade).toBe(3)
    // 评价文案。
    expect(r.judge).toBe('Judge_Great')
    // 值正确。
    expect(r.value).toBe(9)
  })

  test('judges mid value', () => {
    // 开局。
    restartGame({ CHR: 6 })
    // 评价。
    const r = prop.judge('CHR')
    // 中档。
    expect(r.grade).toBe(2)
  })

  test('judges low value with lowest grade', () => {
    // 开局。
    restartGame({ CHR: 1 })
    // 评价。
    const r = prop.judge('CHR')
    // 最低档。
    expect(r.grade).toBe(1)
  })

  test('judge progress clamps to [0,1]', () => {
    // 值超 10。
    restartGame({ CHR: 12 })
    // progress = 10/10 = 1。
    expect(prop.judge('CHR').progress).toBe(1)
    // 值负数。
    restartGame({ CHR: -5 })
    // progress = 0/10 = 0。
    expect(prop.judge('CHR').progress).toBe(0)
  })

  test('judge returns undefined for unconfigured prop', () => {
    // 开局。
    restartGame()
    // INT 未配置 judge。
    expect(prop.judge('INT')).toBe(undefined)
  })
})

// ========== 测试组 9：isEnd/ageNext ==========
describe('property - isEnd/ageNext', () => {
  test('isEnd true when LIF drops below 1', () => {
    // 开局。
    restartGame()
    // 初始存活。
    expect(prop.isEnd()).toBe(false)
    // 扣命。
    prop.change('LIF', -1)
    // 结束。
    expect(prop.isEnd()).toBe(true)
  })

  test('ageNext increments age', () => {
    // 开局。
    restartGame()
    // 推进。
    prop.ageNext()
    // 年龄 +1（-1 → 0）。
    expect(prop.get('AGE')).toBe(0)
  })

  test('ageNext returns event/talent lists', () => {
    // 开局。
    restartGame()
    // 推进到 0 岁。
    const r = prop.ageNext()
    // 年龄 0。
    expect(r.age).toBe(0)
    // 0 岁的事件列表（AGE_DATA[0].event 解析后为 [['ev_001', 1]]）。
    expect(r.event).toEqual([['ev_001', 1]])
    // 0 岁的天赋列表为空。
    expect(r.talent).toEqual([])
  })

  test('ageNext handles missing age gracefully', () => {
    // 开局。
    restartGame()
    // 推进到超过数据覆盖的年龄（9 岁后）。
    // 直接推进多次。
    for (let i = 0; i < 10; i++) prop.ageNext()
    // 年龄 9（AGE_DATA 覆盖到 9）。
    // 再推一次到 10（无数据）。
    const r = prop.ageNext()
    // 年龄 10。
    expect(r.age).toBe(10)
    // 缺失年龄返回空列表而非崩溃。
    expect(r.event).toEqual([])
    expect(r.talent).toEqual([])
  })
})

// ========== 测试组 10：achieve ==========
describe('property - achieve', () => {
  test('achieve records achievement with timestamp', () => {
    // 开局。
    restartGame()
    // 记录成就。
    prop.achieve('ACHV', 'ach_001')
    // 读取。
    const list = prop.get('ACHV')
    // 含 [id, timestamp]。
    expect(list[0][0]).toBe('ach_001')
    // 时间戳是数字。
    expect(typeof list[0][1]).toBe('number')
  })

  test('achieve appends multiple achievements', () => {
    // 开局。
    restartGame()
    // 记录两个。
    prop.achieve('ACHV', 'ach_001')
    prop.achieve('ACHV', 'ach_002')
    // 长度为 2。
    expect(prop.get('ACHV')).toHaveLength(2)
  })

  test('set TLT triggers achieve', () => {
    // 开局。
    restartGame()
    // set 触发 achieve。
    prop.set('TLT', ['t_001'])
    // ATLT 累计。
    expect(prop.get('ATLT')).toContain('t_001')
  })
})
