/**
 * CLI 原型单元测试 — cli-prototypes.spec.js
 *
 * 覆盖范围：41 个测试用例，分为 5 组：
 *   1. cli-util（parseCommand、makeRng）
 *   2. property.cli（restart/set/change/get/all/effect/judge/next）
 *   3. talent.cli（pool/random/get/check/do/replace/exclude）
 *   4. event.cli（get/check/do/props）
 *   5. game.cli（draw/select/alloc/start/next/summary 完整一局）
 *
 * 直接调用各 CLI 的 createHandler()，不经过真实 stdin。
 */

// 导入 vitest 测试 DSL。
import { describe, test, expect, beforeEach } from 'vitest'
// 共享辅助。
import { parseCommand, makeRng } from '../cli/cli-util.js'
// 三个模块 CLI 的处理器。
import { createHandler as createPropHandler } from '../cli/property.cli.js'
import { createHandler as createTalentHandler } from '../cli/talent.cli.js'
import { createHandler as createEventHandler } from '../cli/event.cli.js'
// 可玩版。
import { createGame } from '../cli/game.cli.js'
// 模块与工具。
import Property from '../modules/property.js'
import Talent from '../modules/talent.js'
import Event from '../modules/event.js'
import { clone, createRng } from '../functions/util.js'
// 条件引擎。
import { check } from '../condition/index.js'
// fixture。
import { AGE_DATA, TOTAL } from '../fixtures/property.fixture.js'
import { TALENTS, EVENTS } from '../fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from '../fixtures/achievement-character.fixture.js'

// 演示属性快照。
const DEMO_PROPS = { CHR: 10, INT: 8, STR: 5, MNY: 1000, SPR: 60, LIF: 1, AGE: 25, TLT: [], EVT: [] }

// ========== 测试组 1：cli-util ==========
describe('cli-util', () => {
  test('parseCommand splits by spaces', () => {
    // 简单拆分。
    expect(parseCommand('restart CHR=10 INT=8')).toEqual(['restart', 'CHR=10', 'INT=8'])
  })

  test('parseCommand handles quoted args', () => {
    // 双引号包裹带空格参数。
    expect(parseCommand('effect {"CHR":1,"INT":2}')).toEqual(['effect', '{"CHR":1,"INT":2}'])
  })

  test('parseCommand returns empty for blank line', () => {
    // 空行。
    expect(parseCommand('   ')).toEqual([])
  })

  test('makeRng returns seeded rng', () => {
    // 有 --seed。
    const { random, seed } = makeRng(['--seed', '42'])
    // 种子记录。
    expect(seed).toBe(42)
    // 同种子复现。
    const a = random()
    const b = makeRng(['--seed', '42']).random()
    // 一致。
    expect(a).toBe(b)
  })

  test('makeRng defaults to Math.random', () => {
    // 无 seed。
    const { seed } = makeRng([])
    // 种子为 null。
    expect(seed).toBeNull()
  })
})

// ========== 测试组 2：property.cli ==========
describe('property.cli', () => {
  // 处理器。
  let handler
  // Property 实例。
  let prop
  beforeEach(() => {
    // 创建实例。
    prop = new Property({ clone, random: createRng(1) })
    // 初始化。
    prop.initial({ age: clone(AGE_DATA), total: TOTAL })
    // 处理器。
    handler = createPropHandler(prop)
  })

  test('restart starts a new game', () => {
    // 开局。
    const r = handler(['restart', 'CHR=10'])
    // 输出含属性。
    expect(r.text).toContain('CHR')
    // 属性已设置。
    expect(prop.get('CHR')).toBe(10)
  })

  test('set overrides property', () => {
    // 开局。
    handler(['restart'])
    // 设置。
    const r = handler(['set', 'MNY', '999'])
    // 输出。
    expect(r.text).toContain('999')
  })

  test('change increments property', () => {
    // 开局。
    handler(['restart', 'CHR=5'])
    // 增量。
    handler(['change', 'CHR', '3'])
    // 值为 8。
    expect(prop.get('CHR')).toBe(8)
  })

  test('get returns property value', () => {
    // 开局。
    handler(['restart', 'INT=7'])
    // 读取。
    const r = handler(['get', 'INT'])
    // 输出。
    expect(r.text).toContain('7')
  })

  test('all returns full snapshot', () => {
    // 开局。
    handler(['restart'])
    // 全部属性。
    const r = handler(['all'])
    // 含 AGE。
    expect(r.text).toContain('AGE')
  })

  test('effect applies JSON effects', () => {
    // 开局。
    handler(['restart'])
    // 应用效果。
    handler(['effect', '{"CHR":2}'])
    // CHR 为 2。
    expect(prop.get('CHR')).toBe(2)
  })

  test('effect rejects invalid JSON', () => {
    // 开局。
    handler(['restart'])
    // 非法 JSON。
    const r = handler(['effect', '{bad}'])
    // 报错。
    expect(r.text).toContain('失败')
  })

  test('judge returns grade info', () => {
    // 开局。
    handler(['restart'])
    // 未配置 judge 时。
    const r = handler(['judge', 'CHR'])
    // 无配置提示。
    expect(r.text).toContain('未配置')
  })

  test('next advances age', () => {
    // 开局。
    handler(['restart'])
    // 推进。
    const r = handler(['next'])
    // 年龄 0。
    expect(r.text).toContain('年龄 0')
  })

  test('exit flag set', () => {
    // 退出。
    const r = handler(['exit'])
    // 退出标记。
    expect(r.exit).toBe(true)
  })
})

// ========== 测试组 3：talent.cli ==========
describe('talent.cli', () => {
  // 处理器。
  let handler
  beforeEach(() => {
    // 创建实例。
    const talent = new Talent({ clone, check: c => check(c, DEMO_PROPS), random: createRng(2) })
    // 初始化。
    talent.initial({ talents: clone(TALENTS) })
    // 配置。
    talent.config()
    // 处理器。
    handler = createTalentHandler(talent)
  })

  test('pool draws talent pool', () => {
    // 抽取。
    const r = handler(['pool'])
    // 输出含天赋池。
    expect(r.text).toContain('天赋池')
  })

  test('random draws count ids', () => {
    // 抽取。
    const r = handler(['random', '3'])
    // 输出含抽中。
    expect(r.text).toContain('抽中')
  })

  test('get returns talent info', () => {
    // 读取。
    const r = handler(['get', 't_001'])
    // 名称。
    expect(r.text).toContain('智力+1')
  })

  test('check evaluates condition', () => {
    // 检查。
    const r = handler(['check', 't_002'])
    // INT=8 > 3。
    expect(r.text).toContain('true')
  })

  test('do triggers talent', () => {
    // 触发。
    const r = handler(['do', 't_001'])
    // 输出效果。
    expect(r.text).toContain('触发')
  })

  test('replace runs replacement chain', () => {
    // 替换。
    const r = handler(['replace', 't_006'])
    // 输出替换或未发生。
    expect(r.text.length).toBeGreaterThan(0)
  })

  test('exclude detects conflict', () => {
    // 互斥。
    const r = handler(['exclude', 't_003', 't_004'])
    // 冲突。
    expect(r.text).toContain('冲突')
  })

  test('count returns total', () => {
    // 总数。
    const r = handler(['count'])
    // 12。
    expect(r.text).toContain('12')
  })
})

// ========== 测试组 4：event.cli ==========
describe('event.cli', () => {
  // 处理器。
  let handler
  // 属性快照。
  let props
  beforeEach(() => {
    // 属性。
    props = { ...DEMO_PROPS }
    // 事件实例。
    const event = new Event({ clone, check: c => check(c, props) })
    // 初始化。
    event.initial({ events: clone(EVENTS) })
    // 处理器。
    handler = createEventHandler(event, () => props, p => { props = p })
  })

  test('get returns event summary', () => {
    // 读取。
    const r = handler(['get', 'ev_001'])
    // 描述。
    expect(r.text).toContain('你死了')
  })

  test('check evaluates random trigger eligibility', () => {
    // 检查。
    const r = handler(['check', 'ev_002'])
    // CHR=10 > 5 满足 include。
    expect(r.text).toContain('true')
  })

  test('do executes event with effect', () => {
    // 执行。
    const r = handler(['do', 'ev_001'])
    // 效果。
    expect(r.text).toContain('LIF')
  })

  test('do follows branch when condition met', () => {
    // 执行带分支事件。
    const r = handler(['do', 'ev_005'])
    // CHR=10 命中分支。
    expect(r.text).toContain('分支')
  })

  test('props updates the snapshot', () => {
    // 更新属性。
    const r = handler(['props', '{"CHR":2}'])
    // 新属性。
    expect(r.text).toContain('"CHR":2')
    // 快照已变。
    expect(props.CHR).toBe(2)
  })

  test('count returns total', () => {
    // 总数。
    const r = handler(['count'])
    // 6。
    expect(r.text).toContain('6')
  })
})

// ========== 测试组 5：game.cli ==========
describe('game.cli', () => {
  // 游戏状态机。
  let game
  // 构建测试数据。
  function makeGameData() {
    // 返回完整数据。
    return {
      age: clone(AGE_DATA),
      total: TOTAL,
      talents: clone(TALENTS),
      events: clone(EVENTS),
      achievements: clone(ACHIEVEMENTS),
      characters: {},
    }
  }
  beforeEach(() => {
    // 创建游戏（固定种子保证可复现）。
    game = createGame({
      data: makeGameData(),
      random: createRng(7),
    })
  })

  test('draw produces a pool', async () => {
    // 抽取。
    const r = await game.handlers(['draw'])
    // 天赋池。
    expect(r.text).toContain('天赋池')
    // 池非空。
    expect(game.state.pool.length).toBeGreaterThan(0)
  })

  test('select limits to 3 talents', async () => {
    // 选 4 个。
    const r = await game.handlers(['select', 't_001', 't_002', 't_003', 't_004'])
    // 超限。
    expect(r.text).toContain('最多选择 3 个')
  })

  test('select detects mutual exclusion', async () => {
    // 互斥天赋。
    const r = await game.handlers(['select', 't_003', 't_004'])
    // 冲突。
    expect(r.text).toContain('互斥')
  })

  test('full game loop plays one life', async () => {
    // 抽取。
    await game.handlers(['draw'])
    // 选中。
    await game.handlers(['select', 't_001', 't_002'])
    // 分配。
    await game.handlers(['alloc', '{"CHR":5,"INT":3}'])
    // 开局。
    await game.handlers(['start'])
    // 阶段为 play。
    expect(game.state.phase).toBe('play')
    // 推进几年。
    for (let i = 0; i < 3; i++) {
      const r = await game.handlers(['next'])
      // 输出年龄。
      expect(r.text).toMatch(/岁/)
    }
    // 总结。
    const s = await game.handlers(['summary'])
    // 含人生总结。
    expect(s.text).toContain('人生总结')
  })

  test('next before start is blocked', async () => {
    // 未开局直接推进。
    const r = await game.handlers(['next'])
    // 提示先开局。
    expect(r.text).toContain('start')
  })

  test('again increments times', async () => {
    // 开局。
    await game.handlers(['start'])
    // 重开。
    const r = await game.handlers(['again'])
    // 次数递增。
    expect(r.text).toContain('重开次数: 1')
  })

  test('exit flag set', async () => {
    // 退出。
    const r = await game.handlers(['exit'])
    // 退出标记。
    expect(r.exit).toBe(true)
  })

  test('deterministic with same seed', async () => {
    // 同种子另一局。
    const game2 = createGame({
      data: makeGameData(),
      random: createRng(7),
    })
    // 两局走相同命令。
    await game.handlers(['draw'])
    await game2.handlers(['draw'])
    // 天赋池一致。
    expect(game.state.pool).toEqual(game2.state.pool)
  })
})
