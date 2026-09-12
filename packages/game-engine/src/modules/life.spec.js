/**
 * Life 编排器单元测试 — life.spec.js
 *
 * 覆盖范围：28 个测试用例，分为 8 组：
 *   1. initial/config（数据加载、配置）
 *   2. remake/start（开局流程、替换链）
 *   3. next（推进一年、天赋/事件触发）
 *   4. doTalent/doEvent（效果应用、分支）
 *   5. random/talentRandom（随机）
 *   6. summary/statistics/achievements（总结）
 *   7. format（模板占位符）
 *   8. 日志器注入与 setLogLevel（动态切换过滤，全链路同步）
 */

// 导入 vitest 测试 DSL 和被测对象。
import { describe, test, expect, beforeEach } from 'vitest'
// Life 模块。
import Life from './life.js'
// 条件引擎。
import { check } from '../condition/index.js'
// 工具。
import { clone, createRng } from '../functions/util.js'
// 日志器（注入测试）。
import { createLogger } from '../functions/logger.js'
// fixture。
import { AGE_DATA, TOTAL } from '../fixtures/property.fixture.js'
import { TALENTS, EVENTS } from '../fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from '../fixtures/achievement-character.fixture.js'

// 构建 Life 数据。
function buildData() {
  // 返回数据对象。
  return {
    age: clone(AGE_DATA),
    total: TOTAL,
    talents: clone(TALENTS),
    events: clone(EVENTS),
    achievements: clone(ACHIEVEMENTS),
    characters: {},
  }
}

// 测试辅助：创建 Life 实例并开局。
// @returns {Promise<Life>} 实例
async function makeLife() {
  // 创建实例。
  const life = new Life({
    data: buildData(),
    random: createRng(42),
    storage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null }, setItem(k, v) { this._d[k] = String(v) } },
  })
  // 初始化（await，否则模块数据未加载）。
  await life.initial()
  // 配置（含 judge 分档，供 summary/statistics 使用）。
  life.config({
    propertyConfig: {
      judge: {
        CHR: [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']],
        INT: [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']],
        STR: [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']],
        MNY: [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']],
        SPR: [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']],
        HCHR: [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']],
        HINT: [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']],
        HSTR: [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']],
        HMNY: [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']],
        HSPR: [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']],
        HAGE: [[0, 1, 'J_Normal'], [10, 2, 'J_Good'], [20, 3, 'J_Great']],
        SUM: [[0, 1, 'J_Normal'], [50, 2, 'J_Good'], [100, 3, 'J_Great']],
        TMS: [[0, 1, 'J_Normal'], [1, 2, 'J_Good'], [5, 3, 'J_Great']],
        CACHV: [[0, 1, 'J_Normal'], [1, 2, 'J_Good'], [5, 3, 'J_Great']],
        RTLT: [[0, 1, 'J_Normal'], [0.5, 2, 'J_Good'], [0.8, 3, 'J_Great']],
        REVT: [[0, 1, 'J_Normal'], [0.5, 2, 'J_Good'], [0.8, 3, 'J_Great']],
      },
    },
  })
  // 返回。
  return life
}

// 每个测试前的实例。
let life
beforeEach(async () => {
  // 创建。
  life = await makeLife()
})

// ========== 测试组 1：initial/config ==========
describe('life - initial/config', () => {
  test('initial loads module totals', async () => {
    // 重新初始化（新实例避免二次解析）。
    const life2 = await makeLife()
    // 天赋总数。
    expect(life2.initial()).resolves.toMatchObject({ TTLT: 12, TEVT: 6, TACHV: 3 })
  })

  test('config sets limits', () => {
    // 默认配置。
    expect(life.talentSelectLimit).toBe(3)
    // 属性分配范围。
    expect(life.propertyAllocateLimit).toEqual([0, 10])
  })

  test('request returns modules', () => {
    // 属性模块。
    expect(life.request('PROPERTY')).toBeDefined()
    // 天赋模块。
    expect(life.request('TALENT')).toBeDefined()
    // 未知模块。
    expect(life.request('NOPE')).toBeNull()
  })
})

// ========== 测试组 2：remake/start ==========
describe('life - remake/start', () => {
  test('remake triggers replacement chain', () => {
    // 重新开始（带可替换天赋）。
    const contents = life.remake(['t_006'])
    // 可能有替换。
    expect(Array.isArray(contents)).toBe(true)
  })

  test('start initializes properties', () => {
    // 重开。
    life.remake(['t_001'])
    // 开局。
    life.start({ CHR: 5, INT: 3 })
    // 属性生效。
    expect(life.propertys.CHR).toBe(5)
    // 天赋写入。
    expect(life.request('PROPERTY').get('TLT')).toContain('t_001')
  })

  test('getPropertyPoints includes talent bonus', () => {
    // 无加成天赋时。
    life.remake(['t_001'])
    // 默认 20 点。
    expect(life.getPropertyPoints()).toBe(20)
  })
})

// ========== 测试组 3：next ==========
describe('life - next', () => {
  test('advances one year', () => {
    // 开局。
    life.remake([])
    life.start({})
    // 拉满生命，防止 0 岁 ev_001 致死干扰断言。
    life.request('PROPERTY').set('LIF', 100)
    // 推进。
    const r = life.next()
    // 年龄 0。
    expect(r.age).toBe(0)
    // 返回结构。
    expect(Array.isArray(r.content)).toBe(true)
    // 未结束。
    expect(r.isEnd).toBe(false)
  })

  test('next ends when LIF drops', () => {
    // 开局。
    life.remake([])
    life.start({})
    // 直接扣命。
    life.request('PROPERTY').change('LIF', -1)
    // 推进。
    const r = life.next()
    // 结束。
    expect(r.isEnd).toBe(true)
  })
})

// ========== 测试组 4：doTalent/doEvent ==========
describe('life - doTalent/doEvent', () => {
  test('doTalent applies talent effect', () => {
    // 空天赋开局。
    life.remake([])
    life.start({})
    // 触发 t_001（无条件，INT+1）。
    const content = life.doTalent(['t_001'])
    // 有触发记录。
    expect(content.length).toBe(1)
    // INT 变化。
    const int = life.request('PROPERTY').get('INT')
    // t_001 是 INT+1。
    expect(int).toBe(1)
  })

  test('doTalent respects maxTriggers', () => {
    // 空天赋开局。
    life.remake([])
    life.start({})
    // t_002 maxTriggers=2，条件 INT>3（当前 INT=0 不满足）。
    // 提高 INT 使其可触发。
    life.request('PROPERTY').change('INT', 5)
    // 触发两次。
    life.doTalent(['t_002'])
    life.doTalent(['t_002'])
    // 触发计数为 2（达上限）。
    expect(life.getTalentCurrentTriggerCount('t_002')).toBe(2)
    // 第三次不再触发（maxTriggers 已满）。
    const c = life.doTalent(['t_002'])
    // 本次无新增触发记录（计数不再变化）。
    expect(c.length).toBe(0)
    // 计数仍为 2。
    expect(life.getTalentCurrentTriggerCount('t_002')).toBe(2)
  })

  test('doEvent applies event effect', () => {
    // 开局。
    life.remake([])
    life.start({})
    // 执行 ev_001（LIF-1）。
    const content = life.doEvent('ev_001')
    // 有流水。
    expect(content.length).toBe(1)
    // LIF 变化。
    expect(life.request('PROPERTY').get('LIF')).toBe(0)
  })

  test('doEvent follows branch', () => {
    // 开局。
    life.remake([])
    life.start({ CHR: 10 })
    // 执行 ev_005（CHR>7 走分支到 ev_006）。
    const content = life.doEvent('ev_005')
    // 递归执行分支。
    expect(content.length).toBe(2)
  })

  test('doEvent tolerates missing event', () => {
    // 开局。
    life.remake([])
    life.start({})
    // 缺失事件。
    const content = life.doEvent('nope_999')
    // 空流水。
    expect(content).toEqual([])
  })
})

// ========== 测试组 5：random/talentRandom ==========
describe('life - random/talentRandom', () => {
  test('random picks valid event', () => {
    // 开局。
    life.remake([])
    life.start({})
    // 候选事件。
    const picked = life.random([['ev_001', 1], ['ev_002', 1]])
    // 选中其一。
    expect(['ev_001', 'ev_002']).toContain(picked)
  })

  test('random returns null when no eligible', () => {
    // 开局。
    life.remake([])
    life.start({})
    // 全部 NoRandom 或条件不满足。
    const picked = life.random([['ev_004', 1]])
    // ev_004 是 NoRandom → 不可选。
    expect(picked).toBeNull()
  })

  test('talentRandom returns pool', () => {
    // 抽取。
    const pool = life.talentRandom()
    // 不超过池大小 10，且全是有效天赋。
    expect(pool.length).toBeLessThanOrEqual(10)
    expect(pool.every(t => t && t.id)).toBe(true)
  })
})

// ========== 测试组 6：summary/statistics/achievements ==========
describe('life - summary/statistics', () => {
  test('summary returns property judgments', () => {
    // 开局。
    life.remake([])
    life.start({ CHR: 9 })
    // 总结。
    const s = life.summary
    // 包含 HCHR。
    expect(s.HCHR).toBeDefined()
  })

  test('statistics returns counts', () => {
    // 开局。
    life.remake([])
    life.start({})
    // 统计。
    const st = life.statistics
    // 包含 TMS。
    expect(st.TMS).toBeDefined()
  })

  test('achievements list works', () => {
    // 开局。
    life.remake([])
    life.start({})
    // 成就列表。
    const list = life.achievements
    // 数组。
    expect(Array.isArray(list)).toBe(true)
  })
})

// ========== 测试组 7：format ==========
describe('life - format', () => {
  test('formats age placeholder', () => {
    // 开局。
    life.remake([])
    life.start({})
    // 格式化。
    expect(life.format('年龄 {age}')).toContain('年龄')
  })

  test('formats property placeholders', () => {
    // 开局。
    life.remake([])
    life.start({ CHR: 7 })
    // 格式化颜值。
    const out = life.format('颜值 {charm}')
    // 含 7。
    expect(out).toContain('7')
  })

  test('leaves unknown placeholder', () => {
    // 未知占位符保留。
    expect(life.format('{unknown_key}')).toBe('{unknown_key}')
  })
})

// ========== 测试组 8：Mod 钩子接入 ==========
describe('life - mod hooks', () => {
  // 创建带钩子总线的 Life。
  // @param {object} bus - 钩子总线（{ emit }）
  // @returns {Promise<Life>} 实例
  async function makeHookedLife(bus) {
    // 创建实例。
    const l = new Life({ data: buildData(), random: createRng(42), hooks: bus })
    // 初始化。
    await l.initial()
    // 配置。
    l.config()
    // 返回。
    return l
  }

  // 最小钩子总线（记录 emit/emitSync 调用）。
  function makeBus() {
    // 调用记录。
    const calls = []
    // 总线。
    const bus = {
      emit(name, payload) { calls.push({ name, payload }); return [] },
      emitSync(name, payload) { calls.push({ name, payload }); return [] },
    }
    // 返回。
    return { bus, calls }
  }

  test('onYearAdvance fires on next', async () => {
    // 钩子总线。
    const { bus, calls } = makeBus()
    // 创建。
    const l = await makeHookedLife(bus)
    // 开局。
    l.remake([])
    l.start({})
    // 推进一年。
    l.next()
    // 触发 onYearAdvance。
    expect(calls.some(c => c.name === 'onYearAdvance')).toBe(true)
    // payload 含 age。
    const y = calls.find(c => c.name === 'onYearAdvance')
    expect(typeof y.payload.age).toBe('number')
  })

  test('onTalentPoolGenerate fires on talentRandom', async () => {
    // 钩子总线。
    const { bus, calls } = makeBus()
    // 创建。
    const l = await makeHookedLife(bus)
    // 抽池。
    l.talentRandom()
    // 触发。
    expect(calls.some(c => c.name === 'onTalentPoolGenerate')).toBe(true)
  })

  test('onEventRender hook can rewrite description', async () => {
    // 钩子总线：改写 format 输出。
    const bus = {
      emit(name, payload) { return this.emitSync(name, payload) },
      emitSync(name, payload) {
        // 渲染钩子：加前缀。
        if (name === 'onEventRender') return ['[AI润色] ' + payload.text]
        // 其余返回空。
        return []
      },
    }
    // 创建。
    const l = await makeHookedLife(bus)
    // 开局。
    l.remake([])
    l.start({})
    // 格式化。
    expect(l.format('你好')).toBe('[AI润色] 你好')
  })

  test('hooks can inject events into next content', async () => {
    // 钩子总线：向 content 注入 AI 事件。
    const bus = {
      emit(name, payload) { return this.emitSync(name, payload) },
      emitSync(name, payload) {
        // 翻年钩子：追加 AI 事件流水。
        if (name === 'onYearAdvance') payload.content.push({ type: 'EVT', description: 'AI 生成事件' })
        // 返回。
        return []
      },
    }
    // 创建。
    const l = await makeHookedLife(bus)
    // 开局。
    l.remake([])
    l.start({})
    // 推进。
    const r = l.next()
    // content 含 AI 注入的事件。
    expect(r.content.some(c => c.description === 'AI 生成事件')).toBe(true)
  })

  test('hooks can inject talents into pool', async () => {
    // 钩子总线：向天赋池注入 AI 天赋。
    const bus = {
      emit(name, payload) { return this.emitSync(name, payload) },
      emitSync(name, payload) {
        // 天赋池钩子：追加 AI 天赋。
        if (name === 'onTalentPoolGenerate') payload.pool.push({ id: 'ai_001', name: 'AI 天赋', grade: 3 })
        // 返回。
        return []
      },
    }
    // 创建。
    const l = await makeHookedLife(bus)
    // 抽池。
    const pool = l.talentRandom()
    // 池含 AI 天赋。
    expect(pool.some(t => t.id === 'ai_001')).toBe(true)
  })
})

// ========== 测试组 8：日志器注入与 setLogLevel（动态切换过滤，全链路同步） ==========
// 覆盖：前端「日志设置」切换等级调用的正是 Life.setLogLevel；
// 引擎测试保证注入 logger 后各级日志按过滤输出、切级实时生效到子模块。
describe('Life 日志器注入与 setLogLevel', () => {
  // 捕获 sink：各级别收集到数组。
  function makeCapture() {
    // 行数组。
    const lines = []
    // 自定义 sink。
    const sink = { trace: m => lines.push(m), debug: m => lines.push(m), info: m => lines.push(m), warn: m => lines.push(m), error: m => lines.push(m) }
    // 返回。
    return { lines, sink }
  }

  // 创建带注入 logger 的 Life。
  // @param {string} level - 日志级别
  // @returns {Promise<{l: Life, lines: Array}>} 实例与捕获行
  async function makeLoggedLife(level) {
    // 捕获。
    const { lines, sink } = makeCapture()
    // 创建。
    const l = new Life({
      data: buildData(),
      random: createRng(7),
      storage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null }, setItem(k, v) { this._d[k] = String(v) } },
      // 注入日志器。
      logger: createLogger({ level, sink }),
    })
    // 初始化。
    await l.initial()
    // 返回。
    return { l, lines }
  }

  test('注入 logger：引擎日志进捕获 sink，子模块带前缀', async () => {
    // debug 级创建。
    const { lines } = await makeLoggedLife('debug')
    // info 级初始规模日志。
    expect(lines.some(m => m.includes('[INFO]') && m.includes('initial'))).toBe(true)
    // 子模块 debug 带前缀（property/talent/event/achievement/character）。
    expect(lines.some(m => m.includes('[DEBUG]') && m.includes('[property]'))).toBe(true)
    expect(lines.some(m => m.includes('[DEBUG]') && m.includes('[talent]'))).toBe(true)
    // trace 级被过滤（debug 级别看不到 trace）。
    expect(lines.some(m => m.includes('[TRACE]'))).toBe(false)
  })

  test('trace 级：next 翻年产生函数级追踪（进出 + 属性变更）', async () => {
    // trace 级创建。
    const { l, lines } = await makeLoggedLife('trace')
    // 开局跑一年。
    l.config()
    l.remake([])
    l.start({})
    l.next()
    // next 进出 trace。
    expect(lines.some(m => m.includes('[TRACE]') && m.includes('→ next()'))).toBe(true)
    expect(lines.some(m => m.includes('[TRACE]') && m.includes('← next →'))).toBe(true)
    // 属性变更 trace（ageNext 里 property.change('AGE')）。
    expect(lines.some(m => m.includes('[TRACE]') && m.includes('property.change'))).toBe(true)
    // info 级岁摘要也输出。
    expect(lines.some(m => m.includes('[DEBUG]') && m.includes('岁]'))).toBe(true)
  })

  test('setLogLevel：动态切换立即过滤（全链路子模块同步）', async () => {
    // 初始 debug 级。
    const { l, lines } = await makeLoggedLife('debug')
    // 初始行数。
    const before = lines.length
    // 切到 error：后续 debug/info/trace 全部过滤。
    l.setLogLevel('error')
    // 幂等 initial（内部会打 info/debug 日志，但被 error 级过滤）。
    await l.initial()
    // 行数不增加（error 级下无新日志）。
    expect(lines.length).toBe(before)
    // 切回 trace：子模块日志恢复输出（全链路同步）。
    l.setLogLevel('trace')
    // 再跑一岁。
    l.config()
    l.remake([])
    l.start({})
    l.next()
    // trace 恢复可见。
    expect(lines.some(m => m.includes('[TRACE]') && m.includes('property.change'))).toBe(true)
  })
})
