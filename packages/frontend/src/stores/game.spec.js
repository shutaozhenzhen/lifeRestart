/**
 * gameStore 单元测试 — 覆盖原生异常回归 + 日志链路
 *
 * 覆盖异常场景（均已修复，此处做回归保护）：
 *   A. Pinia reactive 代理破坏 Life # 私有字段（Cannot read private member）→ markRaw 修复
 *   B. markRaw(null) 崩溃（Cannot convert undefined or null to object）→ 初始 null、赋值时 markRaw
 *   C. 刷新后 hash 直进引擎页，life 为 null 抽卡报错 → 路由守卫 + drawTalents 防御
 *   D. 日志等级切换（setLogLevel）：持久化 + 引擎全链路同步
 *   E. 再次初始化（重开）后引擎仍可调用 → markRaw 持续生效
 *   F. 属性分配页读取点数崩溃（TypeError: ... reading 'TLT'）→ 天赋确认时先 remake
 *   G. begin 重复调用不重复执行 remake（替换链只跑一次）
 *   H. 日志带时间戳 + 错误计数/自动展开信号（悬浮窗用）
 *   I. logReport() 报告构建（Node 无 window 也不抛）
 *   J. 日志缓冲上限（超出丢弃最旧，保留最新）
 *   K. 人生轨迹累积（history 逐年追加；原实现每年覆盖 content，页面只剩一条）
 *   L. clearTrace：开局/重开清空轨迹
 *   M. 死亡后 isEnd/lif 响应式镜像更新（原实现直接读 markRaw 引擎 → computed 永久缓存 false，
 *      导致"死亡后还在继续"推进）
 *   N. advanceYear 守卫：人生结束后返回 false 且不再推进（自动播放据此停止）
 */

// 导入 vitest 测试 DSL。
import { describe, test, expect, beforeEach, vi } from 'vitest'
// Vue 响应式（M 用例验证「模板读法」的响应性：store 镜像 vs 直接读引擎）。
import { computed } from 'vue'
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

  test('F：天赋确认后属性页可读点数（回归：曾抛 reading TLT）', async () => {
    // store。
    const store = useGameStore()
    // 初始化引擎（此时尚未 remake）。
    await store.init(buildData())
    // 抽卡。
    store.drawTalents()
    // 选满天赋上限（跳过会互斥失败的候选）。
    const limit = store.life.talentSelectLimit
    for (let i = 0; i < store.talentPool.length && store.selectedTalents.length < limit; i++) {
      store.selectTalent(i)
    }
    // 已选满。
    expect(store.selectedTalents.length).toBe(limit)
    // 确认天赋（TalentView 点「下一步」时调用 → 引擎 remake）。
    store.confirmTalents()
    // 属性页渲染路径：曾经在这里抛 TypeError: Cannot read properties of undefined (reading 'TLT')。
    expect(() => store.propertyPoints).not.toThrow()
    // 可用点数 = 默认 20 + 天赋加成（≥20）。
    expect(store.propertyPoints).toBeGreaterThanOrEqual(20)
    // 尚未分配 → 剩余点数等于可用点数。
    expect(store.leftPoints).toBe(store.propertyPoints)
  })

  test('G：begin 不重复触发 remake（替换链只跑一次）', async () => {
    // store。
    const store = useGameStore()
    // 初始化。
    await store.init(buildData())
    // 换调用计数替身：只关心 remake/start 被调用的次数。
    let remakeCount = 0
    let startCount = 0
    store.life = {
      // sync() 会读该属性。
      propertys: { AGE: 0 },
      // 计数。
      remake() { remakeCount++ },
      start() { startCount++ },
      getPropertyPoints: () => 20,
      // sync() 还要读属性模块做 LIF/isEnd 镜像。
      request: () => ({ get: () => 1, isEnd: () => false }),
    }
    // 模拟从天赋页进入（尚未确认天赋、尚未开局）。
    store.talentsConfirmed = false
    store.started = false
    // 开局两次（例如轨迹页被重复挂载）。
    store.begin({})
    store.begin({})
    // 替换链只允许执行一次：重复会重新消耗随机源并重算替换结果。
    expect(remakeCount).toBe(1)
    // start 的次数不由 store 拦截，靠 GameView 的 store.started 守卫（此处记录现状）。
    expect(startCount).toBe(2)
    // 已标记开局。
    expect(store.started).toBe(true)
  })
})

describe('gameStore 日志与问题报告', () => {
  test('H：日志带时间戳，error 递增 errorSeq，计数可读', () => {
    // store。
    const store = useGameStore()
    // 三类日志。
    store.pushLog('info', '普通信息')
    store.pushLog('warn', '一个警告')
    store.pushLog('error', '一个错误')
    // 时间戳前缀：`[HH:MM:SS.mmm] [LEVEL] msg`。
    expect(store.logBuffer[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] 普通信息$/)
    // 级别大写。
    expect(store.logBuffer[1]).toContain('[WARN] 一个警告')
    // 计数（悬浮窗角标）。
    expect(store.errorCount).toBe(1)
    expect(store.warnCount).toBe(1)
    // errorSeq 只在 error 级递增（悬浮窗据此自动展开）。
    expect(store.errorSeq).toBe(1)
    // 再写一条 info 不改变序号。
    store.pushLog('info', '再一条')
    expect(store.errorSeq).toBe(1)
  })

  test('I：logReport 生成可导出的报告（无 window 环境也不抛）', () => {
    // store。
    const store = useGameStore()
    // 数据源（主页会写入）。
    store.dataSource = 'lifeRestart-data（184 天赋 / 1720 事件）'
    // 写日志。
    store.pushLog('info', '[UI][home] 开始新人生')
    store.pushLog('error', '[UI][game] 出问题了')
    // 构建报告。
    const report = store.logReport()
    // 头部与正文。
    expect(report).toContain('===== 人生重开模拟器 日志报告 =====')
    expect(report).toContain('数据源   : lifeRestart-data（184 天赋 / 1720 事件）')
    expect(report).toContain('日志条数 : 2（error 1')
    expect(report).toContain('[UI][home] 开始新人生')
    expect(report).toContain('[UI][game] 出问题了')
    // 游戏状态摘要。
    expect(report).toContain('initialized=false')
    // Node 无 location/navigator：降级为「（未知）」而不是崩溃。
    expect(report).toContain('页面地址 : （未知）')
  })

  test('J：日志缓冲超限丢弃最旧、保留最新', () => {
    // store。
    const store = useGameStore()
    // 静音 console（1005 条日志会刷屏）。
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    // 写满上限再多 5 条。
    for (let i = 0; i < 1005; i++) store.pushLog('info', `第 ${i} 条`)
    // 长度封顶。
    expect(store.logBuffer.length).toBe(1000)
    // 最旧的已丢弃。
    expect(store.logBuffer[0]).toContain('第 5 条')
    // 最新保留。
    expect(store.logBuffer[999]).toContain('第 1004 条')
    // 恢复 console。
    spy.mockRestore()
  })
})

describe('gameStore 人生轨迹累积', () => {
  test('K：next 逐年累积 history（原实现每年覆盖 content，页面只剩一条）', async () => {
    // store + 初始化 + 开局。
    const store = useGameStore()
    await store.init(buildData())
    store.begin({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
    // 拉满生命，避免 fixture 里 0 岁事件致死干扰后续推进。
    store.life.request('PROPERTY').set('LIF', 100)
    // 开局时轨迹为空。
    expect(store.history).toEqual([])
    // 推进两年。
    const r1 = store.next()
    const r2 = store.next()
    // 两年各一条（关键回归：不再只剩最新一岁）。
    expect(store.history.length).toBe(2)
    // 年龄与引擎返回一致且递增。
    expect(store.history[0].age).toBe(r1.age)
    expect(store.history[1].age).toBe(r2.age)
    expect(store.history[1].age).toBeGreaterThan(store.history[0].age)
    // 条目为该年流水的**快照**（不是同一个数组引用，避免被引擎就地改写）。
    expect(store.history[1].items.length).toBe(r2.content.length)
    expect(store.history[1].items).not.toBe(r2.content)
    // 当前一岁流水仍可读（兼容既有调用方）。
    expect(store.content.length).toBe(r2.content.length)
  })

  test('L：clearTrace 清空轨迹，begin 会重置', async () => {
    // store + 开局。
    const store = useGameStore()
    await store.init(buildData())
    store.begin({ CHR: 5 })
    // 拉满生命。
    store.life.request('PROPERTY').set('LIF', 100)
    // 推进一年。
    store.next()
    expect(store.history.length).toBe(1)
    // 手动清空（总结页「重开」会调用）。
    store.clearTrace()
    expect(store.history).toEqual([])
    expect(store.content).toEqual([])
    // 再推进重新累积。
    store.next()
    expect(store.history.length).toBe(1)
    // 新的一局（begin）重置轨迹。
    store.begin({ CHR: 5 })
    expect(store.history).toEqual([])
  })

  test('M：死亡后 isEnd 响应式更新（回归：曾因非响应式缓存而"死亡后还在继续"）', async () => {
    // store。
    const store = useGameStore()
    // 初始化 + 开局。
    await store.init(buildData())
    store.begin({ CHR: 5 })
    // 组件的两种读法：
    //   1) 修复后：读 store 的响应式镜像。
    const mirrored = computed(() => store.isEnd)
    //   2) 根因写法：直接读 markRaw 的引擎实例（不是响应式依赖 → 永久缓存首次结果）。
    const raw = computed(() => (store.life ? store.life.request('PROPERTY').isEnd() : false))
    // 先各读一次，触发 computed 缓存。
    expect(mirrored.value).toBe(false)
    expect(raw.value).toBe(false)
    // 生命归零（等价于死亡事件）。
    store.life.request('PROPERTY').set('LIF', 0)
    // 触发同步（next() 内部也会调用 sync）。
    store.sync()
    // 修复后：镜像立刻为 true → 自动播放停止、按钮禁用、总结可点。
    expect(mirrored.value).toBe(true)
    // 根因复现：直接读引擎的 computed 仍是缓存的 false（这就是"死亡后还在继续"的原因）。
    expect(raw.value).toBe(false)
    // 生命值镜像同步（非数字兜底为 1，此处是真实的 0）。
    expect(store.lif).toBe(0)
    // 死亡后引擎仍可被推进（引擎语义允许），但结束标志保持为真 → UI 层守卫会拦住。
    const r = store.next()
    expect(r.isEnd).toBe(true)
    expect(store.isEnd).toBe(true)
  })

  test('N：advanceYear 在人生结束后拒绝推进（自动播放据此停止）', async () => {
    // store + 开局。
    const store = useGameStore()
    await store.init(buildData())
    store.begin({ CHR: 5 })
    // 拉满生命：还能继续。
    store.life.request('PROPERTY').set('LIF', 100)
    expect(store.advanceYear()).toBe(true)
    // 轨迹 +1。
    expect(store.history.length).toBe(1)
    // 模拟死亡（生命归零）。
    store.life.request('PROPERTY').set('LIF', 0)
    store.sync()
    expect(store.isEnd).toBe(true)
    // 结束后：返回 false，且**不再推进**（轨迹条数不变）→ 自动播放 onTick 收到 false 即停。
    expect(store.advanceYear()).toBe(false)
    expect(store.history.length).toBe(1)
    // 未初始化时同样安全。
    const fresh = useGameStore()
    expect(fresh.advanceYear()).toBe(false)
  })
})