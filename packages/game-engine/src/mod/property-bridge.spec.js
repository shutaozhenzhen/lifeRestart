/**
 * property-bridge 回归测试 —— 「Mod 能改/能观察真实游戏属性」（2026-10 能力补齐）
 *
 * 这一组测的是**能力补齐本身**，所以刻意用**真 Life + 真数据**，而不是假对象：
 *   · 以前 `gameAPI.property` 读写的是数据对象上一个自定义键（全引擎无人读）→
 *     `property.set('CHR', 99)` **不会**改游戏里的颜值；文档明写"它不是游戏属性系统"。
 *   · 现在桥把它接到 Life 的 Property 模块：写入真的生效，并且**引擎内部**的变化
 *     （事件/天赋效果、年龄自增、成就记账）也会同步广播 `propertyChange`。
 *
 * 三个关键契约（都有用例）：
 *   1. `source` 区分来源：`'mod'`（Mod 自己调）/ `'engine'`（引擎内部）—— 观察者据此过滤自己造成的噪声；
 *   2. **同步**广播（emitSync）：回调里读到的就是变更后的值；
 *   3. 重入保护：回调里再改属性不会无限递归（否则"观察者顺手改一下"就把游戏挂死了）。
 */
import { describe, test, expect } from 'vitest'
// 属性模块（真实现）。
import Property from '../modules/property.js'
// 真 Life（端到端：Mod 改属性 → 游戏属性面板看到的就变了）。
import Life from '../modules/life.js'
// 桥。
import { createPropertyBridge, createUnavailablePropertyBridge } from './property-bridge.js'
// 钩子总线 + gameAPI。
import { createGameAPI, createHookBus } from './gameapi.js'
// 参数注册表（Life 内部持有，这里造独立实例给 Property 用）。
import { createParamRegistry } from '../params/param-registry.js'
// 种子 RNG（可复现）。
import { createRng } from '../functions/util.js'

// #memoryStorage
// 内存 storage（别写脏真实存档）。
function memoryStorage() {
  // 底层。
  const data = {}
  // 适配器。
  return {
    // 读。
    getItem: (k) => (k in data ? data[k] : null),
    // 写。
    setItem: (k, v) => { data[k] = String(v) },
  }
}

// #makeProperty
// 造一个可用的 Property 模块（注册表 + 年龄数据）。
//
// @param {object} [params]
// @param {Function} [params.onChange] - 变更回调
// @returns {object} Property 模块
function makeProperty({ onChange } = {}) {
  // 注册表。
  const registry = createParamRegistry({ data: {}, storage: memoryStorage() })
  // 模块。
  const p = new Property({ storage: memoryStorage(), random: createRng(1), logger: { trace: () => {}, debug: () => {}, warn: () => {}, error: () => {} }, onChange })
  // 初始化（年龄表给空 → 年龄自增照常工作）。
  p.initial({ age: {}, total: {} })
  // 备份注册表（测试要断言写入落到了注册表里）。
  p.__registry = registry
  // 返回。
  return p
}

describe('property-bridge - 真实属性读写', () => {
  test('available 反映是否连上了游戏属性系统', () => {
    // 连上。
    expect(createPropertyBridge(makeProperty()).available).toBe(true)
    // 没连上（宿主没有属性系统）。
    expect(createUnavailablePropertyBridge().available).toBe(false)
    // 空对象 / undefined 也走降级。
    expect(createPropertyBridge(undefined).available).toBe(false)
    expect(createPropertyBridge({}).available).toBe(false)
  })

  test('set / change / effect 真的写进属性（不是写进没人读的自定义键）', () => {
    // 属性模块 + 桥。
    const property = makeProperty()
    const bridge = createPropertyBridge(property)
    // 覆盖设置。
    bridge.set('CHR', 10)
    expect(property.get('CHR')).toBe(10)
    // 增量。
    bridge.change('CHR', 5)
    expect(property.get('CHR')).toBe(15)
    // 批量效果（与事件的 effect 字段同一语义）。
    bridge.effect({ CHR: 1, SPR: 2 })
    expect(property.get('CHR')).toBe(16)
    expect(property.get('SPR')).toBe(2)
    // 读全量与属性名。
    expect(bridge.all().CHR).toBe(16)
    expect(bridge.types()).toContain('CHR')
  })

  test('降级桥：读给 undefined，写给可读错误（不静默）', () => {
    // 降级桥。
    const bridge = createUnavailablePropertyBridge()
    // 读。
    expect(bridge.get('CHR')).toBeUndefined()
    // 写 → 报错（写属性却什么都没发生是最难查的问题）。
    expect(() => bridge.set('CHR', 1)).toThrow(/没有游戏属性系统/)
    // 空快照。
    expect(bridge.all()).toEqual({})
  })
})

describe('property-bridge - propertyChange 通知', () => {
  test('Mod 自己的写入触发通知，且 source=mod', () => {
    // 记录。
    const seen = []
    // 属性模块（回调收集）。
    const property = makeProperty({ onChange: (prop, value, source) => seen.push({ prop, value, source }) })
    // 桥。
    const bridge = createPropertyBridge(property)
    // 三种写法都要通知。
    bridge.set('CHR', 3)
    bridge.change('SPR', 1)
    bridge.effect({ MNY: 2 })
    // 逐条核对（effect 会逐键走 change → 一条）。
    expect(seen).toEqual([
      { prop: 'CHR', value: 3, source: 'mod' },
      { prop: 'SPR', value: 1, source: 'mod' },
      { prop: 'MNY', value: 2, source: 'mod' },
    ])
  })

  test('**引擎内部**的变化也通知（source=engine）—— 这是本次补齐的重点', () => {
    // 记录。
    const seen = []
    // 属性模块。
    const property = makeProperty({ onChange: (prop, value, source) => seen.push({ prop, value, source }) })
    // 模拟引擎：事件/天赋效果（effect 不带 source）。
    property.effect({ CHR: 1 })
    // 模拟引擎：年龄自增（ageNext 内部走 change('AGE', 1)）。
    property.ageNext()
    // 模拟引擎：成就记账（achieve 直接走注册表，但也要通知）。
    property.achieve('ACHV', ['a1', 0])
    // 全部标成 engine。
    expect(seen.map((s) => s.source)).toEqual(['engine', 'engine', 'engine'])
    // 属性名对得上（AGE 是年龄自增、ACHV 是成就）。
    expect(seen.map((s) => s.prop)).toEqual(['CHR', 'AGE', 'ACHV'])
  })

  test('set(TLT) 只通知一次（内部还会 acheive，不能重复通知）', () => {
    // 记录。
    const seen = []
    // 属性模块。
    const property = makeProperty({ onChange: (prop, value) => seen.push(prop) })
    // 设置天赋数组（Property.set 内部会调 achieve）。
    property.set('TLT', ['1001'])
    // 只通知一次。
    expect(seen).toEqual(['TLT'])
  })

  test('重入保护：回调里再改属性不会无限递归', () => {
    // 计数。
    let calls = 0
    // 属性模块：回调里**再改一次**属性（会重入）。
    const property = makeProperty({
      onChange: () => {
        // 计数。
        calls++
        // 重入尝试（应被保护挡掉）。
        property.change('SPR', 1)
      },
    })
    // 触发。
    property.change('CHR', 1)
    // 只通知一次（重入被跳过），且 SPR 仍然被改到了（保护只挡通知，不挡写入）。
    expect(calls).toBe(1)
    expect(property.get('SPR')).toBe(1)
  })

  test('回调抛错不会影响游戏主流程（记 warn 后继续）', () => {
    // 属性模块：回调直接抛。
    const property = makeProperty({ onChange: () => { throw new Error('观察者炸了') } })
    // 不抛。
    expect(() => property.change('CHR', 1)).not.toThrow()
    // 值照样写进去了。
    expect(property.get('CHR')).toBe(1)
  })
})

describe('property-bridge - 端到端（真 Life + 真 gameAPI）', () => {
  // 造一份最小可用数据（只需 age 表，属性系统就能跑）。
  const DATA = {
    age: { 0: { age: 0, event: [] }, 1: { age: 1, event: [] } },
    talents: {},
    events: {},
    achievements: {},
    characters: {},
  }

  test('Mod 通过 gameAPI.property 改属性 → Life 的属性面板读到的就变了', async () => {
    // 钩子总线（与 Life 共享）。
    const hooks = createHookBus()
    // Life。
    const life = new Life({ data: DATA, random: createRng(7), storage: memoryStorage(), hooks })
    await life.initial()
    life.config()
    life.start({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
    // 初始值。
    expect(life.propertys.CHR).toBe(5)
    // Mod 的 gameAPI（把 Life 当属性桥传进去 —— 与 mod-runtime.js 的接线一致）。
    const api = createGameAPI({ data: {}, hooks, property: life, params: life.params })
    // 可用。
    expect(api.property.available).toBe(true)
    // 改属性。
    api.property.change('CHR', 3)
    // **真的变了**（这就是补齐的能力）。
    expect(life.propertys.CHR).toBe(8)
    // 用 effect 也一样。
    api.property.effect({ MNY: 4 })
    expect(life.propertys.MNY).toBe(9)
  })

  test('Mod 注册的 propertyChange 能观察到引擎内部的属性变化（含 source）', async () => {
    // 总线。
    const hooks = createHookBus()
    // Life（onChange 接到总线 → emitSync 广播）。
    const life = new Life({ data: DATA, random: createRng(7), storage: memoryStorage(), hooks })
    await life.initial()
    life.config()
    life.start({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
    // 记录。
    const seen = []
    // Mod 通过 gameAPI 挂钩子。
    const api = createGameAPI({ data: {}, hooks, property: life, params: life.params })
    api.on('propertyChange', (payload) => seen.push(payload))
    // ① 引擎内部：年龄自增（life.next() 里会调 property.ageNext）。
    life.next()
    // ② 引擎内部：应用一组效果（事件/天赋效果走的就是它）。
    life.property.effect({ SPR: 1 })
    // ③ Mod 自己改。
    api.property.change('CHR', 1)
    // 三类都在，且 source 分得清。
    const sources = seen.map((s) => s.source)
    expect(sources).toContain('engine')
    expect(sources).toContain('mod')
    // AGE 的变化来自引擎。
    const age = seen.find((s) => s.prop === 'AGE')
    expect(age.source).toBe('engine')
    // Mod 那次是自己的。
    const modChr = seen.filter((s) => s.prop === 'CHR' && s.source === 'mod')
    expect(modChr.length).toBe(1)
    // **同步**：回调里看到的就是变更后的值（不是"等一会儿才生效"）。
    expect(life.propertys.CHR).toBe(6)
    expect(seen[seen.length - 1].value).toBe(1)
  })
})
