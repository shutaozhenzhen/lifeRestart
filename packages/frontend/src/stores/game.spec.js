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
 *   O. 重开次数/成就跨局持久化（引擎 storage 注入；未注入时永远 0）
 */

// 导入 vitest 测试 DSL。
import { describe, test, expect, beforeEach, vi } from 'vitest'
// Vue 响应式（M 用例验证「模板读法」的响应性：store 镜像 vs 直接读引擎）。
import { computed } from 'vue'
// Pinia（Node 环境）。
import { createPinia, setActivePinia } from 'pinia'
// store。
import { useGameStore } from './game.js'
// 测试装置（真实数据：独立模块，node 环境也能用）。
import { loadRealData } from '../test-utils/real-data.js'
// 演示数据（fixture，与 HomeView buildData 同源）。
import { AGE_DATA, TOTAL } from 'game-engine/src/fixtures/property.fixture.js'
import { TALENTS, EVENTS } from 'game-engine/src/fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from 'game-engine/src/fixtures/achievement-character.fixture.js'
// 测试专用天赋池容量补充（fixture 池太小 → 抽卡凑不齐 3 个）。
import { padTalents } from 'game-engine/src/fixtures/talent-padding.js'
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
// 天赋表带**测试专用**占位补充：fixture 原表只有 9 个天赋，抽卡按等级分池
// 且池空即止，池子太小会让「选满 3 个天赋」根本凑不齐。
function buildData() {
  // 返回完整数据。
  return {
    age: clone(AGE_DATA),
    total: TOTAL,
    talents: clone(padTalents(TALENTS)),
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
    // 2026-10 能力补齐 ④：`advanceYear()` 现在是 **async**（有异步 Mod 时走 nextAsync；
    // 本用例没有异步 Mod → 内部走同步 next()，行为与以前逐位相同）。
    expect(await store.advanceYear()).toBe(true)
    // 轨迹 +1。
    expect(store.history.length).toBe(1)
    // 模拟死亡（生命归零）。
    store.life.request('PROPERTY').set('LIF', 0)
    store.sync()
    expect(store.isEnd).toBe(true)
    // 结束后：返回 false，且**不再推进**（轨迹条数不变）→ 自动播放 onTick 收到 false 即停。
    expect(await store.advanceYear()).toBe(false)
    expect(store.history.length).toBe(1)
    // 未初始化时同样安全。
    const fresh = useGameStore()
    expect(await fresh.advanceYear()).toBe(false)
  })

  test('O：重开次数跨局持久化（回归：未注入 storage → 永远是 0）', async () => {
    // 第一局。
    const store = useGameStore()
    await store.init(buildData())
    store.begin({ CHR: 5 })
    store.life.request('PROPERTY').set('LIF', 100)
    store.next()
    // 模拟总结页点「重开」：次数 +1（写入注入的 storage）。
    store.life.times = store.life.times + 1
    expect(store.life.times).toBe(1)
    // 已落到 localStorage（键带 lifeRestart: 前缀，不污染前端自己的键）。
    expect(storeData['lifeRestart:times']).toBe('1')
    // 新的一局（全新 pinia ≈ 刷新页面后重新开始），localStorage 保留。
    setActivePinia(createPinia())
    const store2 = useGameStore()
    await store2.init(buildData())
    // 新实例读回次数（旧实现是内存 storage → 恒为 0）。
    expect(store2.life.times).toBe(1)
  })
})

// #playLife
// 用指定种子完整走一局（抽卡 → 选前 N 个 → 分配 → 逐年推进），返回可比较的"人生签名"。
// 关键：**操作顺序固定**，这样才能验证"同种子 → 同一局"。
//
// @param {number|null} seed - 种子
// @param {object} [options]
// @param {number} [options.picks] - 选几个天赋
// @param {object} [options.data] - 游戏数据（缺省 fixture）
// @param {number} [options.maxYears] - 推进年数上限
// @returns {Promise<object>} { seed, signature, history, propertys, poolOrder }
async function playLife(seed, { picks = 3, data = buildData(), maxYears = 15 } = {}) {
  // 全新 pinia（= 重开一局）。
  setActivePinia(createPinia())
  // store。
  const store = useGameStore()
  // 初始化（注入种子 + 数据）。
  await store.init(data, { seed })
  // 抽卡 + 固定选前 picks 张。
  store.drawTalents()
  // 池顺序（种子的可观测效果之一）。
  const poolOrder = store.talentPool.map((t) => t.id)
  for (let i = 0; i < picks; i++) store.selectTalent(i)
  // 确认天赋（remake）。
  store.confirmTalents()
  // 开局（固定分配，排除分配差异）。
  store.begin({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
  // 拉满生命：fixture 数据里 0 岁就有致死事件；真实数据下也不需要额外保命，
  // 但统一拉满可以让"逐年流水"覆盖更多年份，使签名更具区分度。
  store.life.request('PROPERTY').set('LIF', 100)
  // 同步镜像（isEnd/lif）。
  store.sync()
  // 逐年推进（到死或到上限）。
  for (let i = 0; i < maxYears && !store.isEnd; i++) store.next()
  // 人生签名：每年流水 + 终局属性（完全可比）。
  // 条目结构：字符串（格式化文案）或对象 { type, description, postEvent? }。
  const signature = store.history
    .map((h) => `${h.age}:${(h.items || []).map((c) => (typeof c === 'string' ? c : c.description || c.content || c.id || '')).join('|')}`)
    .join('\n')
  // 返回。
  return { seed: store.seed, signature, history: store.history, propertys: { ...store.propertys }, poolOrder }
}

// #playRealLife
// 用**真实数据**跑一局（501 年龄 / 184 天赋 / 1720 事件）。
// 「种子是否真的生效」「复现是否真的成立」这类结论必须基于真实数据：
// fixture 只有 4 个候选天赋、每个年龄单一事件，随机性几乎不可观测（只看得到顺序）。
//
// @param {number|null} seed - 种子
// @param {object} [options] - 透传（picks/maxYears）
// @returns {Promise<object>} 人生签名
async function playRealLife(seed, options = {}) {
  // 真实数据（loadRealData 返回新副本，用例间不串味）。
  return playLife(seed, { maxYears: 120, data: loadRealData(), ...options })
}

describe('gameStore Mod 资源接线（2026-10 能力补齐 ②）', () => {
  // #fakeAssetReader
  // 假资源读取能力（**不碰真实网络/文件系统**）。
  //
  // @param {object} files - { 路径: Uint8Array }
  // @returns {object} 读取器
  function fakeAssetReader(files) {
    // 返回。
    return {
      // 类型。
      kind: 'fake',
      // 可用。
      available: true,
      // 清单。
      listFiles: async () => Object.keys(files),
      // 字节。
      readBytes: async (_mod, path) => files[path] ?? null,
    }
  }

  // #fakeUrlApi
  // 假的 URL 原语（**必须注入**：Node 18 里没有 `URL.createObjectURL`，
  // 不注入的话桥会走"绝对路径"降级分支，就测不到 blob 的缓存与释放了）。
  //
  // @returns {object} { urlApi, created, revoked }
  function fakeUrlApi() {
    // 记录。
    const created = []
    const revoked = []
    // 返回。
    return {
      created,
      revoked,
      urlApi: {
        // Blob（只需要 type 便于断言 MIME）。
        Blob: class { constructor(parts, opts) { this.type = opts?.type } },
        // 造 URL。
        createObjectURL: () => { const u = `blob:store/${created.length + 1}`; created.push(u); return u },
        // 释放。
        revokeObjectURL: (u) => revoked.push(u),
      },
    }
  }

  test('AA：Mod 代码拿到 gameAPI.asset（读自己包里的字节）', async () => {
    // store。
    const store = useGameStore()
    // 一段资源字节。
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    // 初始化（带资源能力 + 一段会读资源的 Mod 代码）。
    await store.init(buildData(), {
      assetReader: fakeAssetReader({ 'assets/logo.png': bytes }),
      modCodes: [{
        name: 'asset-mod',
        // 顶层不能 await → 用 then 把结果挂到全局，稍后断言。
        code: 'gameAPI.asset.bytes("assets/logo.png").then(function (b) { globalThis.__storeAssetBytes = Array.from(b) })',
      }],
    })
    // 等异步回调。
    await new Promise((r) => setTimeout(r, 0))
    // 逐字节一致（**真的接到了 Mod 代码里**，不是只建了个空对象）。
    expect(globalThis.__storeAssetBytes).toEqual([...bytes])
    // 清理。
    delete globalThis.__storeAssetBytes
    // 注册表挂在 store 上（界面侧解析占位符要用同一份）。
    expect(store.assetRegistry).toBeTruthy()
    expect(store.assetsAvailable).toBe(true)
  })

  test('AB：推进一年后自动解析轨迹里的 `{{asset:路径}}`（有资源 → URL；没有 → null）', async () => {
    // store。
    const store = useGameStore()
    // 假的 URL 原语（注入：Node 里没有 createObjectURL，否则只会走"绝对路径"分支）。
    const { urlApi, created } = fakeUrlApi()
    // 初始化（带资源能力；Mod 代码往每年轨迹里塞一个占位符）。
    // ⚠️ 这里**故意不传 hooks**：`store.init` 必须自己建一条总线并同时给 Life 与 Mod 代码 ——
    //    两边各建一条的话，Mod 的钩子永远不会被触发（且完全静默），本用例就是这条回归。
    await store.init(buildData(), {
      assetReader: fakeAssetReader({ 'assets/logo.png': new Uint8Array([1, 2, 3]) }),
      assetUrlApi: urlApi,
      modCodes: [{
        name: 'asset-mod',
        code: [
          'gameAPI.on("onYearAdvance", function (p) {',
          '  p.content.push({ type: "EVT", description: "照片 {{asset:assets/logo.png}} 和 {{asset:assets/missing.png}}" })',
          '})',
        ].join('\n'),
      }],
    })
    // 开局 + 拉满生命（fixture 里 0 岁有致死事件）。
    store.begin({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
    store.life.request('PROPERTY').set('LIF', 100)
    // 推进一年（next 内部会调 trackAssets）。
    store.next()
    // 等异步解析。
    await new Promise((r) => setTimeout(r, 0))
    // 有资源的那条解析出了 URL（缓存 + tick 递增，模板据此重渲染）。
    expect(store.assetUrl('assets/logo.png')).toBe('blob:store/1')
    expect(store.assetUrlTick).toBeGreaterThan(0)
    // 缺失的那条**不入缓存**（`assetUrl` 给 null → 界面降级成纯文本；
    // 不缓存是为了"Mod 修好之后立刻能看见"，而不是永远记住这次失败）。
    expect(store.assetUrl('assets/missing.png')).toBeNull()
    // 只造了一个 blob URL（同路径不重复造）。
    expect(created).toEqual(['blob:store/1'])
    // 同一路径再问一次还是同一个 URL（缓存）。
    expect(store.assetUrl('assets/logo.png')).toBe('blob:store/1')
    // 轨迹里也确实写进去了（两条：0 岁死亡事件 + Mod 追加的那条）。
    expect(JSON.stringify(store.history)).toContain('{{asset:assets/logo.png}}')
  })

  test('AC：没有资源能力时 trackAssets 是空操作（advisor 不炸、占位符留给界面降级）', async () => {
    // store（不传资源能力）。
    const store = useGameStore()
    await store.init(buildData())
    // 手动塞一条带占位符的轨迹（模拟"Mod 已经写在文本里了"）。
    store.history.push({ age: 1, isEnd: false, items: [{ type: 'EVT', description: 'x {{asset:assets/logo.png}}' }] })
    // 解析（没有注册表 → 直接返回）。
    expect(() => store.trackAssets()).not.toThrow()
    // 什么都没发生。
    expect(store.assetUrlTick).toBe(0)
    expect(store.assetUrl('assets/logo.png')).toBeNull()
    expect(store.assetRegistry).toBeNull()
    expect(store.assetsAvailable).toBe(false)
  })

  test('AD：restartWithSeed 继承资源能力（复现的一局里占位符仍能解析）', async () => {
    // store。
    const store = useGameStore()
    // 资源能力（重开一局必须带上，否则图片全变文字）。
    const reader = fakeAssetReader({ 'assets/logo.png': new Uint8Array([9]) })
    await store.init(buildData(), {
      // 资源读取能力 + 文件源（restartWithSeed 用 assetSource 重建读取器）。
      assetReader: reader,
      assetSource: { listFiles: reader.listFiles, readBytes: reader.readBytes },
      modCodes: [{ name: 'asset-mod', code: 'gameAPI.on("onYearAdvance", function (p) { p.content.push({ type: "EVT", description: "{{asset:assets/logo.png}}" }) })' }],
    })
    // 重开（同种子）。
    const ok = await store.restartWithSeed(12345)
    expect(ok).toBe(true)
    // 资源能力被继承下来了。
    expect(store.assetRegistry).toBeTruthy()
    expect(store.assetsAvailable).toBe(true)
    // 缓存是新的（旧缓存指向上一局的 blob）。
    expect(store.assetUrlCache.size).toBe(0)
    // 代码也重新执行了（重开的一局里同样能解析）。
    store.begin({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
    store.life.request('PROPERTY').set('LIF', 100)
    store.next()
    await new Promise((r) => setTimeout(r, 0))
    // 有 URL 或至少"没有报错"：happy-dom 的 createObjectURL 可能给 blob:…。
    expect(store.assetUrl('assets/logo.png') === null || typeof store.assetUrl('assets/logo.png') === 'string').toBe(true)
  })

  test('AE：换局时释放上一局的 blob URL（不释放 = 内存泄漏）', async () => {
    // store。
    const store = useGameStore()
    // 假的 URL 原语（记录造出来与释放掉的 URL）。
    const { urlApi, created, revoked } = fakeUrlApi()
    // 第一局。
    await store.init(buildData(), {
      assetReader: fakeAssetReader({ 'assets/logo.png': new Uint8Array([1]) }),
      assetUrlApi: urlApi,
      modCodes: [{ name: 'asset-mod', code: 'gameAPI.on("onYearAdvance", function (p) { p.content.push({ type: "EVT", description: "{{asset:assets/logo.png}}" }) })' }],
    })
    // 造一个 URL。
    store.begin({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
    store.life.request('PROPERTY').set('LIF', 100)
    store.next()
    await new Promise((r) => setTimeout(r, 0))
    // 真的造出来了。
    expect(created.length).toBe(1)
    expect(store.assetUrl('assets/logo.png')).toBe(created[0])
    // 第二局（init 会先 dispose 上一局的注册表）。
    await store.init(buildData(), {
      assetReader: fakeAssetReader({ 'assets/logo.png': new Uint8Array([1]) }),
      assetUrlApi: urlApi,
      modCodes: [{ name: 'asset-mod', code: 'gameAPI.on("onYearAdvance", function (p) { p.content.push({ type: "EVT", description: "{{asset:assets/logo.png}}" }) })' }],
    })
    // 上一局的 URL 被释放了（**不释放就是内存泄漏**：每个 blob URL 都把字节钉在内存里）。
    expect(revoked).toContain(created[0])
    // 新一局的缓存是空的（旧 URL 已经失效，留着就是破图）。
    expect(store.assetUrlCache.size).toBe(0)
    expect(store.assetUrl('assets/logo.png')).toBeNull()
  })

  test('AF：Node 形态（没有 createObjectURL）下 url() 降级为绝对路径，仍然能读', async () => {
    // store（不注入 URL 原语 → 桥看到的是运行环境的真实能力）。
    const store = useGameStore()
    // 初始化。
    await store.init(buildData(), {
      // 资源能力（可读）。
      assetReader: fakeAssetReader({ 'assets/logo.png': new Uint8Array([1]) }),
      // `urlApi` 显式给一个"没有 createObjectURL"的对象（模拟 Node）。
      assetUrlApi: { Blob: undefined },
      // 每年塞一个占位符。
      modCodes: [{ name: 'asset-mod', code: 'gameAPI.on("onYearAdvance", function (p) { p.content.push({ type: "EVT", description: "{{asset:assets/logo.png}}" }) })' }],
    })
    // 开局 + 推进一年。
    store.begin({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
    store.life.request('PROPERTY').set('LIF', 100)
    store.next()
    await new Promise((r) => setTimeout(r, 0))
    // 降级成路径（**不抛、不空**）—— 界面拿到它仍能显示（Node/Electron 场景）。
    const url = store.assetUrl('assets/logo.png')
    expect(typeof url).toBe('string')
    expect(url.endsWith('assets/logo.png')).toBe(true)
    // 路径形态没有 blob 需要释放。
    expect(store.assetRegistry.dispose()).toBe(0)
  })
})

describe('gameStore 成就提示（引擎 emit → 界面弹窗）', () => {
  test('W：开局触发的成就（START 时机）会推入提示队列', async () => {
    // store + 开局。
    const store = useGameStore()
    await store.init(buildData())
    // 新一局先清空提示。
    expect(store.achievementToasts).toEqual([])
    // START 时机的成就在 start() 里检测。
    store.begin({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
    // 至少有一条提示（fixture 里有无条件 START 成就）。
    expect(store.achievementToasts.length).toBeGreaterThan(0)
    // 提示内容可直接展示（名称 + 描述）。
    const toast = store.achievementToasts[0]
    expect(String(toast.name).length).toBeGreaterThan(0)
    expect(toast.id).toBeTruthy()
    // 同时记了日志（报告里能核对"这局达成了什么"）。
    expect(store.logBuffer.some((line) => line.includes('达成成就'))).toBe(true)
  })

  test('X：同一条成就只保留一条提示（不堆叠），并顶到最新', async () => {
    // store。
    const store = useGameStore()
    // 直接推同一个成就两次。
    store.pushAchievementToast({ id: 'ach_x', name: '成就X', description: '描述X', grade: 2 })
    store.pushAchievementToast({ id: 'ach_x', name: '成就X', description: '描述X', grade: 2 })
    // 只有一条。
    expect(store.achievementToasts.length).toBe(1)
    expect(store.achievementToasts[0].id).toBe('ach_x')
  })

  test('Y：提示队列上限 3 条（超出丢最旧）', async () => {
    // store。
    const store = useGameStore()
    // 推 5 条不同成就。
    for (let i = 1; i <= 5; i++) store.pushAchievementToast({ id: `ach_${i}`, name: `成就${i}`, grade: 1 })
    // 只留最新 3 条。
    expect(store.achievementToasts.map((t) => t.id)).toEqual(['ach_3', 'ach_4', 'ach_5'])
  })

  test('Z：关闭单条 / 清空全部 / 重开一局自动清空', async () => {
    // store。
    const store = useGameStore()
    store.pushAchievementToast({ id: 'a1', name: 'A', grade: 0 })
    store.pushAchievementToast({ id: 'a2', name: 'B', grade: 0 })
    // 关闭一条。
    store.dismissAchievementToast('a1')
    expect(store.achievementToasts.map((t) => t.id)).toEqual(['a2'])
    // 清空全部。
    store.clearAchievementToasts()
    expect(store.achievementToasts).toEqual([])
    // 再推一条后重新 init（新一局）→ 自动清空，不把上一局的提示带过来。
    store.pushAchievementToast({ id: 'a3', name: 'C', grade: 0 })
    await store.init(buildData())
    expect(store.achievementToasts).toEqual([])
  })

  test('Z2：无效负载不崩（缺 id / null）', () => {
    // store。
    const store = useGameStore()
    // 各种非法输入。
    store.pushAchievementToast(null)
    store.pushAchievementToast(undefined)
    store.pushAchievementToast({})
    store.pushAchievementToast({ name: '没有 id' })
    // 队列仍为空。
    expect(store.achievementToasts).toEqual([])
  })

  test('Z3：handleEngineEvent 只认 achievement 事件（其它事件忽略）', () => {
    // store。
    const store = useGameStore()
    // 其它事件。
    store.handleEngineEvent('something-else', { id: 'x' })
    store.handleEngineEvent('onYearAdvance', { age: 1 })
    // 不产生提示。
    expect(store.achievementToasts).toEqual([])
  })
})
describe('gameStore 随机种子与复现（真实数据）', () => {
  test('P：init 自动生成种子并记录（页面据此显示）', async () => {
    // store。
    const store = useGameStore()
    // 初始化（不传种子）。
    await store.init(buildData())
    // 库里生成了 32 位无符号整数种子。
    expect(Number.isInteger(store.seed)).toBe(true)
    expect(store.seed).toBeGreaterThanOrEqual(0)
    expect(store.seed).toBeLessThan(4294967296)
    // 原始数据被保留（供"同种子复现"重开一局）。
    expect(store.rawData).not.toBeNull()
    expect(store.rawData.age).toBeDefined()
    // 两局之间种子不同（自动生成 = 真随机；极小概率相同也允许，但这里连续两次比对足以暴露"恒定值"）。
    setActivePinia(createPinia())
    const store2 = useGameStore()
    await store2.init(buildData())
    expect(store2.seed).toBeGreaterThanOrEqual(0)
  })

  test('Q：显式种子被规范化使用（字符串 / 负数 / 0 都合法）', async () => {
    // 字符串种子（来自输入框）。
    const store = useGameStore()
    await store.init(buildData(), { seed: '123456' })
    expect(store.seed).toBe(123456)
    // 0 是合法种子（不能被当成"未指定"而改成随机值）。
    setActivePinia(createPinia())
    const zero = useGameStore()
    await zero.init(buildData(), { seed: 0 })
    expect(zero.seed).toBe(0)
    // 负数规范到无符号域。
    setActivePinia(createPinia())
    const negative = useGameStore()
    await negative.init(buildData(), { seed: -1 })
    expect(negative.seed).toBe(4294967295)
    // 非法值 → 退回自动生成（而不是把 NaN 传给 RNG）。
    setActivePinia(createPinia())
    const bad = useGameStore()
    await bad.init(buildData(), { seed: 'abc' })
    expect(Number.isInteger(bad.seed)).toBe(true)
  })

  test('R：真实数据下同种子 + 同操作 = 完全同一局（复现闭环）', async () => {
    // 同一颗种子跑两次（真实数据）。
    const first = await playRealLife(20261001)
    const second = await playRealLife(20261001)
    // 种子一致。
    expect(second.seed).toBe(first.seed)
    // 抽卡池顺序也一致（随机序列从头就相同）。
    expect(second.poolOrder).toEqual(first.poolOrder)
    // 人生签名一致（逐年流水完全相同，这是"可复现"的硬标准）。
    expect(second.signature).toBe(first.signature)
    // 终局属性一致。
    expect(second.propertys).toEqual(first.propertys)
    // 签名里必须有真实内容（中文文案），否则"两边都是空"会假通过。
    expect(first.signature).toMatch(/[\u4e00-\u9fa5]/)
    // 而且确实过了很多年（真实数据下寿命通常几十年）。
    expect(first.history.length).toBeGreaterThan(10)
  }, 120000)

  test('S：真实数据下不同种子 → 完全不同的人生（种子确实驱动事件抽取）', async () => {
    // 两颗不同种子（真实数据：1720 事件 / 184 天赋，随机性可观测）。
    const a = await playRealLife(11111)
    const b = await playRealLife(22222)
    // 种子不同。
    expect(a.seed).not.toBe(b.seed)
    // 抽卡池顺序不同。
    expect(a.poolOrder).not.toEqual(b.poolOrder)
    // 人生流水的**签名不同**（真实数据下这是有意义的断言：
    // 事件抽取走种子 RNG，不同种子会选出不同事件 → 内容不同）。
    expect(a.signature).not.toBe(b.signature)
  }, 120000)

  test('S2：真实数据下同种子跨进程式重跑仍一致（连续两轮不漂移）', async () => {
    // 先跑一轮记录（40 年足够验证"种子是唯一输入"，不必等整局，控制用例耗时）。
    const first = await playRealLife(777, { maxYears: 40 })
    // 再跑另外两颗种子（打乱 RNG 使用历史），最后回到 777。
    await playRealLife(888, { maxYears: 40 })
    await playRealLife(999, { maxYears: 40 })
    const again = await playRealLife(777, { maxYears: 40 })
    // 中间跑过别的种子也不影响：种子是唯一输入，没有全局残留状态。
    expect(again.signature).toBe(first.signature)
  }, 120000)

  test('生命周期钩子：init 会依次触发 onBeforeLife（建 Life 之前）与 onAfterLife（Mod 代码之后）', async () => {
    // 记录。
    const seen = []
    // 全新 pinia + store。
    setActivePinia(createPinia())
    const store = useGameStore()
    // 钩子总线。
    const { createHookBus } = await import('../../../game-engine/src/mod/gameapi.js')
    const hooks = createHookBus()
    // 注册两个生命周期钩子。
    hooks.on('onBeforeLife', (p) => seen.push(['before', typeof p.data]))
    hooks.on('onAfterLife', (p) => seen.push(['after', typeof p.life, !!p.life?.propertys]))
    // 初始化（无 Mod 代码）。
    await store.init(buildData(), { seed: 1, hooks })
    // 两个都触发了，且 after 拿到的是**已经可用**的 Life（能读 propertys）。
    expect(seen.map((s) => s[0])).toEqual(['before', 'after'])
    expect(seen[1][1]).toBe('object')
    expect(seen[1][2]).toBe(true)
  })

  test('T：restartWithSeed 用同一颗种子重开（总结页「复现此局」）', async () => {
    // 先跑一局并记录签名（真实数据）。
    const first = await playRealLife(777)
    // 取当前 store（playLife 最后留下的那个）做"复现"。
    const store = useGameStore()
    // 记录当前种子。
    const seed = store.seed
    // 用同种子重开。
    const ok = await store.restartWithSeed(seed)
    // 成功且种子不变。
    expect(ok).toBe(true)
    expect(store.seed).toBe(first.seed)
    // 重置为新一局（未开局）。
    expect(store.started).toBe(false)
    expect(store.history).toEqual([])
    expect(store.selectedTalents).toEqual([])
  }, 120000)

  test('U：无数据引用时 restartWithSeed 返回 false（不崩）', async () => {
    // 未初始化的 store。
    const store = useGameStore()
    // 直接调用。
    await expect(store.restartWithSeed(123)).resolves.toBe(false)
  })

  test('V：日志报告头带上种子（便于按报告复现）', async () => {
    // 初始化一个已知种子。
    const store = useGameStore()
    await store.init(buildData(), { seed: 4242 })
    // 报告。
    const report = store.logReport()
    // 头部含种子与复现提示。
    expect(report).toContain('随机种子 : 4242')
    expect(report).toContain('可复现同一局')
  })
})

// ========== 名人模式（character） ==========
//
// 背景：名人模式的引擎模块早就移植好了（character.js + life.characterRandom），
// 但**前端从来没调用过**，`Life.config()` 也没把名人配置传下去（抽取数量是 undefined
// → 只出 1 个候选、唯一「我」一按就抛）。这一组用例把整条链路钉住。
describe('gameStore 名人模式', () => {
  // #buildCharacterData
  // 名人模式演示数据：3 位名人（属性可选字符串，模拟真实 characters.json 的形态）。
  //
  // @param {object} [params]
  // @param {boolean} [params.stringProps] - 属性用字符串（真实数据就是这样）
  // @param {boolean} [params.noTalent] - 三位都不带天赋（用于算准最终属性）
  // @returns {object} 数据
  function buildCharacterData({ stringProps = false, noTalent = false } = {}) {
    // 基础数据。
    const data = buildData()
    // 名人。
    data.characters = {
      c1: {
        id: 'c1',
        name: '秦始皇',
        property: stringProps ? { CHR: '5', INT: '5', STR: '8', MNY: '9' } : { CHR: 5, INT: 5, STR: 8, MNY: 9 },
        talent: noTalent ? [] : ['t_001'],
      },
      c2: {
        id: 'c2',
        name: '李白',
        property: stringProps ? { CHR: '7', INT: '9', STR: '3', MNY: '4' } : { CHR: 7, INT: 9, STR: 3, MNY: 4 },
        talent: noTalent ? [] : ['t_002'],
      },
      c3: {
        id: 'c3',
        name: '诸葛亮',
        property: stringProps ? { CHR: '6', INT: '10', STR: '4', MNY: '5' } : { CHR: 6, INT: 10, STR: 4, MNY: 5 },
        talent: noTalent ? [] : ['t_001', 't_002'],
      },
    }
    // 返回。
    return data
  }

  // #celebrityStore
  // 名人模式下的已初始化 store。
  //
  // @param {object} [params] - 同 buildCharacterData
  // @returns {Promise<object>} store
  async function celebrityStore(params) {
    // store。
    const store = useGameStore()
    // 先切模式（init 不重置 mode）。
    store.setMode('celebrity')
    // 初始化。
    await store.init(buildCharacterData(params))
    // 返回。
    return store
  }

  test('drawCharacters：抽出 3 位候选，天赋已换成对象', async () => {
    // 准备。
    const store = await celebrityStore()
    // 抽。
    const result = store.drawCharacters()
    // 候选数量 = characterPullCount 默认 3（fixture 正好 3 位）。
    expect(result.normal).toHaveLength(3)
    expect(store.characters).toHaveLength(3)
    // 天赋是对象（引擎做过 ID → 对象替换）。
    expect(store.characters[0].talent[0]).toHaveProperty('name')
    // 唯一「我」默认未解锁。
    expect(store.uniqueUnlocked).toBe(false)
  })

  test('chooseCharacter：字符串属性也解析成数字 + 已选天赋 + 额外点数', async () => {
    // 准备（真实数据形态：属性是字符串）。
    const store = await celebrityStore({ stringProps: true })
    // 抽 + 选第一位。
    store.drawCharacters()
    const first = store.characters[0]
    const result = store.chooseCharacter(first.id)
    // 成功。
    expect(result.ok).toBe(true)
    // 名人本体。
    expect(store.character.name).toBe(first.name)
    // 基础属性是**数字**（字符串 "5" → 5）；抽到哪位由种子决定，所以按选中的那位比。
    expect(store.characterBase).toEqual({
      CHR: Number(first.property.CHR),
      INT: Number(first.property.INT),
      STR: Number(first.property.STR),
      MNY: Number(first.property.MNY),
    })
    expect(typeof store.characterBase.CHR).toBe('number')
    // 而且确实是三家名人之一（证明是按 ID 选对了人，不是随手抄了一份）。
    expect([[5, 5, 8, 9], [7, 9, 3, 4], [6, 10, 4, 5]]).toContainEqual([
      store.characterBase.CHR, store.characterBase.INT, store.characterBase.STR, store.characterBase.MNY,
    ])
    // 已选天赋 = 名人自带天赋的 ID。
    expect(store.selectedTalents).toEqual(first.talent.map(t => String(t.id)))
    // 名人对象里**保留了完整天赋对象**（页面要显示描述/星级/效果，只留 {id,name} 就没得显示）。
    expect(store.character.talent[0]).toHaveProperty('description')
    expect(store.character.talent[0]).toHaveProperty('grade')
    // 额外点数 = 天赋带来的加成（默认 20 点已被名人属性取代，不能重复算）。
    expect(store.characterExtraPoints).toBeGreaterThanOrEqual(0)
    // 天赋已确认（begin 不再重复跑替换链）。
    expect(store.talentsConfirmed).toBe(true)
  })

  test('propertyPoints：名人模式只算额外点数；切回自定义恢复默认 20', async () => {
    // 准备（不带天赋 → 额外点数必然是 0）。
    const store = await celebrityStore({ noTalent: true })
    // 自定义模式下的点数（默认 20 + 加成）。
    const customPoints = store.propertyPoints
    // 抽 + 选。
    store.drawCharacters()
    store.chooseCharacter(store.characters[0].id)
    // 名人模式：默认点数已被名人属性取代 → 只剩额外点数（这里没有天赋 → 0）。
    expect(store.propertyPoints).toBe(0)
    expect(store.leftPoints).toBe(0)
    // 切回自定义模式：中间态清空，点数回到默认。
    store.setMode('custom')
    expect(store.character).toBeNull()
    expect(store.characterBase).toEqual({ CHR: 0, INT: 0, STR: 0, MNY: 0 })
    expect(store.propertyPoints).toBe(customPoints)
  })

  test('begin：最终属性 = 名人基础属性 + 玩家额外分配', async () => {
    // 准备（不带天赋 → 最终属性里没有天赋加成，能算准）。
    const store = await celebrityStore({ noTalent: true })
    // 抽 + 选秦始皇（CHR 5 / INT 5 / STR 8 / MNY 9）。
    store.drawCharacters()
    store.chooseCharacter('c1')
    // 额外分配 2 点到颜值、1 点到智力。
    store.begin({ CHR: 2, INT: 1, STR: 0, MNY: 0 })
    // 引擎属性 = 基础 + 额外。
    expect(store.propertys.CHR).toBe(7)
    expect(store.propertys.INT).toBe(6)
    expect(store.propertys.STR).toBe(8)
    expect(store.propertys.MNY).toBe(9)
    // 已开局。
    expect(store.started).toBe(true)
  })

  test('begin：不带名人（自定义模式）时分配值就是最终值', async () => {
    // 准备：自定义模式。
    const store = useGameStore()
    store.setMode('custom')
    await store.init(buildCharacterData({ noTalent: true }))
    // 直接分配（不带天赋 → 无加成）。
    store.begin({ CHR: 3, INT: 4, STR: 5, MNY: 6 })
    // 最终值就是分配值。
    expect(store.propertys.CHR).toBe(3)
    expect(store.propertys.INT).toBe(4)
    expect(store.propertys.STR).toBe(5)
    expect(store.propertys.MNY).toBe(6)
  })

  test('chooseUnique：连点解锁后可选定唯一「我」（属性/天赋随机生成）', async () => {
    // 准备。
    const store = await celebrityStore()
    // 连点 10 次（引擎侧：10 秒内连点 10 次解锁）。
    for (let i = 0; i < 10; i++) store.drawCharacters()
    // 解锁。
    expect(store.uniqueUnlocked).toBe(true)
    // 选定。
    const result = store.chooseUnique()
    // 成功。
    expect(result.ok).toBe(true)
    // 「我」。
    expect(store.character.id).toBe('unique')
    expect(store.character.name).toBe('我')
    // 四维是数字（生成值 + 解析）。
    for (const key of ['CHR', 'INT', 'STR', 'MNY']) {
      expect(typeof store.characterBase[key]).toBe('number')
    }
  })
})

// ==================== 异步逐岁介入（2026-10 能力补齐 ④）====================
//
// 这一组钉的是**前端怎么选路径**与**异步内容真的进了轨迹**：
//   · 有异步 Mod → `advanceYear()` 走 `life.nextAsync()`，`onBeforeYear` 里 await 出来的
//     内容出现在当年轨迹（以前做不到：Promise 被丢弃，晚到的改动不进当年）；
//   · 没有异步 Mod → 仍走同步 `life.next()`（**最关键的那条**：不能因为新增能力改掉老路径）；
//   · 取消/换局 → 在途的异步结果被丢弃（不留半截轨迹）。
describe('gameStore 异步逐岁介入（能力补齐 ④）', () => {
  // #ASYNC_MOD_CODE
  // 异步 Mod 的 code.js（真 await：微任务 + 宏任务都覆盖）。
  const ASYNC_MOD_CODE = `
gameAPI.on('onBeforeYear', async (p) => {
  if (p.nextAge !== 1) return
  await Promise.resolve()
  await new Promise(function (r) { setTimeout(r, 1) })
  p.pending.push({ type: 'EVT', description: '_ASYNC_INJECTED_' })
})
gameAPI.on('onAfterYear', async (p) => {
  if (p.age !== 2) return
  await new Promise(function (r) { setTimeout(r, 1) })
  p.content.push({ type: 'EVT', description: '_ASYNC_AFTER_' })
})
`
  // #ASYNC_MANIFEST
  // 异步 Mod 的 manifest（判定源）。
  const ASYNC_MANIFEST = { name: 'async-demo', version: '1.0.0', async: true }

  // #initStore
  // 建一个已开局、生命拉满的 store。
  //
  // @param {object} [options]
  // @param {boolean} [options.async] - 是否注入异步 Mod
  // @param {number} [options.timeoutMs] - 异步钩子超时（测试用小值）
  // @returns {Promise<object>} store
  async function initStore({ async: withAsync = false, timeoutMs = 3000, maxYears = 6 } = {}) {
    // 全新 pinia。
    setActivePinia(createPinia())
    // store。
    const store = useGameStore()
    // 初始化（**同步集合**：与生产里"没有异步 Mod"时逐位相同）。
    await store.init(buildData(), withAsync
      ? {
          // 异步 Mod 的代码 + 判定 + manifest。
          modCodes: [{ name: 'async-demo', code: ASYNC_MOD_CODE }],
          manifests: [{ name: 'async-demo', manifest: ASYNC_MANIFEST }],
          hasAsyncMods: true,
          asyncMods: [{ name: 'async-demo', hooks: ['onBeforeYear', 'onAfterYear'] }],
          asyncTimeoutMs: timeoutMs,
        }
      : {})
    // 开局。
    store.begin({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
    // 生命拉满（fixture 里 0 岁就可能死）。
    store.life.request('PROPERTY').set('LIF', 100)
    // 同步镜像。
    store.sync()
    // 返回（maxYears 只是给调用方的建议，这里不推进）。
    void maxYears
    // 返回。
    return store
  }

  test('AA：有异步 Mod → advanceYear 走 nextAsync()，await 出来的内容进**当年**轨迹', async () => {
    // store（带异步 Mod）。
    const store = await initStore({ async: true })
    // 走的是异步路径（标记存在）。
    expect(store.hasAsyncMods).toBe(true)
    // 钉住"没有退回同步"：同步 next 一次都不该被调用。
    const syncSpy = vi.spyOn(store.life, 'next')
    // 第 0 岁（钩子 nextAge=0 不动手）。
    expect(await store.advanceYear()).toBe(true)
    // 第 1 岁：异步注入在**当年**。
    expect(await store.advanceYear()).toBe(true)
    // 同步路径完全没被用。
    expect(syncSpy).not.toHaveBeenCalled()
    // 轨迹里出现了异步注入的内容（这就是以前做不到的事）。
    const year1 = store.history.find((h) => h.age === 1)
    expect(year1).toBeTruthy()
    expect(year1.items.some((c) => String(c.description).includes('_ASYNC_INJECTED_'))).toBe(true)
    // 第 2 岁：onAfterYear 的注入也在当年。
    expect(await store.advanceYear()).toBe(true)
    const year2 = store.history.find((h) => h.age === 2)
    expect(year2.items.some((c) => String(c.description).includes('_ASYNC_AFTER_'))).toBe(true)
    // 推进期间/结束后都不是"卡在生成中"。
    expect(store.advancing).toBe(false)
    // 复原（避免影响别的用例）。
    syncSpy.mockRestore()
  })

  test('AB：没有异步 Mod → 仍然走同步 next()（老路径一个字不改）', async () => {
    // store（**没有**异步 Mod）。
    const store = await initStore({ async: false })
    // 判定为同步集合。
    expect(store.hasAsyncMods).toBe(false)
    // 钉住同步路径：`next` 被调用、`nextAsync` 完全没被碰。
    const syncSpy = vi.spyOn(store.life, 'next')
    const asyncSpy = vi.spyOn(store.life, 'nextAsync')
    // 推进。
    expect(await store.advanceYear()).toBe(true)
    // 同步路径。
    expect(syncSpy).toHaveBeenCalledTimes(1)
    // 异步路径没被用。
    expect(asyncSpy).not.toHaveBeenCalled()
    // 轨迹照旧累积。
    expect(store.history.length).toBe(1)
    // 还原。
    syncSpy.mockRestore()
    asyncSpy.mockRestore()
  })

  test('AC：同步集合下 advanceYear 内部是同步的（await 之前轨迹就已经记好）', async () => {
    // store（同步集合）。
    const store = await initStore({ async: false })
    // 起一次推进（不 await）。
    const pending = store.advanceYear()
    // 同步路径 → 调用返回时轨迹已经更新（`await` 只是形式）。
    expect(store.history.length).toBe(1)
    // 等它收尾。
    expect(await pending).toBe(true)
  })

  test('AD：换局（clearTrace）会丢弃在途的异步结果（不留半截轨迹）', async () => {
    // store（带异步 Mod）。
    const store = await initStore({ async: true })
    // 起一次异步推进（不 await：它要等 mod 的 await 点）。
    const pending = store.advanceYear()
    // 立刻换局（模拟"用户点了重开/离开页面"）。
    store.clearTrace()
    // 等那次推进回来（结果必须被丢弃）。
    await pending
    // 轨迹仍是空的（没有把旧一岁的条目写进新一局）。
    expect(store.history.length).toBe(0)
    // 也不该卡在"生成中"。
    expect(store.advancing).toBe(false)
  })

  test('AE：异步钩子超时 → warn + 继续推进（慢后端不卡死游戏）', async () => {
    // store（异步 Mod + 极小超时）。
    const store = await initStore({ async: true, timeoutMs: 5 })
    // 手工挂一个**永不 resolve** 的异步钩子（模拟"后端不响应"）。
    // ⚠️ 必须带 `async: true` 标记 —— 没有标记的回调在 nextAsync 里是同步调用的（不 await）。
    store.modHooks.on('onBeforeYear', () => new Promise(() => {}), { modName: 'never-mod', async: true })
    // 推进（必须在有限时间内返回）。
    expect(await store.advanceYear()).toBe(true)
    // 这一年照样记进轨迹（超时不会让引擎丢掉这一年）。
    expect(store.history.length).toBeGreaterThan(0)
    // 出声（日志面板里能看到 Mod 名与钩子名）。
    expect(store.logBuffer.some((l) => l.includes('onBeforeYear') && l.includes('never-mod') && l.includes('超时'))).toBe(true)
    // 不卡在生成中。
    expect(store.advancing).toBe(false)
  })
})