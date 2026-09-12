/**
 * gameStore 单元测试 — 覆盖原生异常回归 + 日志链路
 *
 * 覆盖异常场景（均已修复，此处做回归保护）：
 *   A. Pinia reactive 代理破坏 Life # 私有字段（Cannot read private member）→ markRaw 修复
 *   B. markRaw(null) 崩溃（Cannot convert undefined or null to object）→ 初始 null、赋值时 markRaw
 *   C. 刷新后 hash 直进引擎页，life 为 null 抽卡报错 → 路由守卫 + drawTalents 防御
 *   D. 日志等级切换（setLogLevel）：持久化 + 引擎全链路同步
 */

// 导入 vitest 测试 DSL。
import { describe, test, expect, beforeEach } from 'vitest'
// Pinia（Node 环境）。
import { createPinia, setActivePinia } from 'pinia'
// store。
import { useGameStore } from './game.js'
// 演示数据（fixture，与 HomeView buildData 同源）。
import { AGE_DATA, TOTAL } from 'game-engine/src/fixtures/property.fixture.js'
import { TALENTS, EVENTS } from 'game-engine/src/fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from 'game-engine/src/fixtures/achievement-character.fixture.js'
// 克隆工具。
import { clone } from 'game-engine/src/functions/util.js'

// #mockLocalStorage
// 模拟 localStorage（Node 环境无全局 localStorage）。
function mockLocalStorage() {
  // 存储。
  const _d = {}
  // 注入全局。
  globalThis.localStorage = {
    // 读取：存在返回，否则 null。
    getItem(k) { return k in _d ? _d[k] : null },
    // 写入：字符串化。
    setItem(k, v) { _d[k] = String(v) },
    // 删除。
    removeItem(k) { delete _d[k] },
  }
  // 返回底层数据（测试断言用）。
  return _d
}

// #buildData
// 组装演示数据（与 HomeView.buildData 一致）。
function buildData() {
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

// 每个用例前重置（pinia 全新 + localStorage 干净）。
let storeData
beforeEach(() => {
  // 激活全新 pinia（store 状态重置，模拟刷新）。
  setActivePinia(createPinia())
  // localStorage mock（干净）。
  storeData = mockLocalStorage()
})

describe('gameStore 异常回归测试', () => {
  test('A：init 后引擎可正常调用（markRaw 保护 # 私有字段）', async () => {
    // store。
    const store = useGameStore()
    // 初始化（内部 new Life + markRaw + initial）。
    await store.init(buildData())
    // 就绪。
    expect(store.isReady).toBe(true)
    // 开局（begin = remake + start，走引擎私有字段路径）。
    store.begin()
    // 引擎方法可调（这些路径读 # 私有字段，若仍被 Proxy 代理必抛错）。
    expect(store.life.getPropertyPoints()).toBe(20)
    // 翻一年不抛（经 store.next 自动同步属性）。
    expect(() => store.next()).not.toThrow()
    // 属性同步到响应式（引擎 AGE 开局前为 -1，翻年 +1 → 0）。
    expect(store.propertys.AGE).toBe(0)
  })

  test('B：创建 store 不抛错（曾因 markRaw(null) 崩溃）', () => {
    // 创建（state() 初始化路径）。
    const store = useGameStore()
    // 初始状态。
    expect(store.life).toBeNull()
    expect(store.initialized).toBe(false)
    expect(store.isReady).toBe(false)
  })

  test('C：未初始化时 drawTalents 防御（不抛 TypeError，记错误日志）', () => {
    // store（未 init，模拟刷新直进引擎页后未初始化）。
    const store = useGameStore()
    // 防御：不抛。
    expect(() => store.drawTalents()).not.toThrow()
    // 空池。
    expect(store.talentPool).toEqual([])
    // 错误日志进面板。
    expect(store.logBuffer.some(l => l.includes('[ERROR]') && l.includes('引擎未初始化'))).toBe(true)
  })

  test('D：setLogLevel 切换 trace（持久化 + 引擎同步 + trace 日志进面板）', async () => {
    // store。
    const store = useGameStore()
    // 初始化（默认 info 级；期间引擎日志已进缓冲）。
    await store.init(buildData())
    // 初始级别（缺省 info）。
    expect(store.logLevel).toBe('info')
    // 切 trace。
    store.setLogLevel('trace')
    // 状态更新 + 持久化。
    expect(store.logLevel).toBe('trace')
    expect(storeData.logLevel).toBe('trace')
    // 清缓冲，便于断言后续。
    store.clearLog()
    // 开局（begin 内部 remake+start，引擎日志按 trace 级进面板）。
    store.begin()
    // 引擎翻年（Life.setLogLevel 已把引擎日志器切到 trace）。
    expect(() => store.life.next()).not.toThrow()
    // 引擎 trace 日志（函数级追踪）进入面板。
    expect(store.logBuffer.some(l => l.includes('[TRACE]') && l.includes('→ next()'))).toBe(true)
    expect(store.logBuffer.some(l => l.includes('[DEBUG]') && l.includes('岁]'))).toBe(true)
  })

  test('E：再次初始化（重开）后引擎仍可调用（markRaw 持续生效）', async () => {
    // store。
    const store = useGameStore()
    // 第一次初始化。
    await store.init(buildData())
    // 第二次初始化（模拟重新开始）。
    await store.init(buildData())
    // 开局 + 翻年不抛（再次验证 markRaw 持续生效、私有字段可访问）。
    store.begin()
    expect(() => store.life.next()).not.toThrow()
    // 就绪。
    expect(store.isReady).toBe(true)
  })
})