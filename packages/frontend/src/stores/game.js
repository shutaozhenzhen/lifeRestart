/**
 * gameStore — 游戏状态管理
 *
 * 用 Pinia 包裹 Life 实例，向组件提供响应式状态：
 *   - propertys：当前六个基础属性（响应式快照）
 *   - life：Life 实例引用
 *   - initialized：是否已初始化
 *
 * 设计：
 *   - Life 是纯 JS 引擎，不感知 Vue。
 *   - gameStore 是 Vue 与引擎之间的桥，把引擎状态映射为响应式。
 *   - 组件通过 store.propertys 实时读取，引擎每次变化后调用 sync() 刷新。
 */

// 导入 Pinia。
import { defineStore } from 'pinia'
// markRaw：Life 实例含 # 私有字段，reactive 代理会破坏私有字段访问（Vue 响应式代理问题）。
import { markRaw } from 'vue'
// 导入 Life 引擎。
import Life from 'game-engine/src/modules/life.js'
// 日志器工厂（前端配置界面创建，注入引擎全链路）。
import { createLogger } from 'game-engine/src/functions/logger.js'
// 日志格式化/报告构建（纯函数，供悬浮窗导出与单测）。
import { formatLogLine, countByLevel, collectLogMeta, buildLogReport } from '../utils/log-report.js'
// Mod 启停状态（报告里带上，便于复现）。
import { loadModsState } from '../utils/mods-state.js'

// 日志缓冲上限：1000 条在 trace 级下也够覆盖一次完整复现（每条约 100 字节）。
const LOG_BUFFER_LIMIT = 1000

// #loadLogLevel
// 读取日志级别配置（localStorage 键 logLevel，缺省 info）。
function loadLogLevel() {
  // 读取。
  const v = localStorage.getItem('logLevel')
  // 合法级别列表。
  return ['trace', 'debug', 'info', 'warn', 'error'].includes(v) ? v : 'info'
}

// 定义 store。
export const useGameStore = defineStore('game', {
  // 状态。
  state: () => ({
    // Life 实例（初始 null；赋值时经 markRaw 保护 # 私有字段，见 init）。
    life: null,
    // 是否初始化完成。
    initialized: false,
    // 是否已开局（start 已执行）。GameView 挂载时据此判断，避免重复开局。
    started: false,
    // 天赋是否已确认（confirmTalents 已执行 → begin 不再重复触发替换链）。
    talentsConfirmed: false,
    // 当前六个基础属性（响应式）。
    propertys: {
      AGE: 0, CHR: 0, INT: 0, STR: 0, MNY: 0, SPR: 0,
    },
    // 游戏模式（custom 自定义 / celebrity 名人）。
    mode: 'custom',
    // 天赋池（抽取结果）。
    talentPool: [],
    // 已选天赋（ID 数组）。
    selectedTalents: [],
    // 每岁事件/天赋流水（响应式，仅当前这一岁）。
    content: [],
    // 完整人生轨迹：每年一条 { age, isEnd, items }，供轨迹页逐条渲染全部历史。
    // （原实现每年覆盖 content，导致页面上只剩最新一岁。）
    history: [],
    // 属性分配（CHR/INT/STR/MNY）。
    allocation: { CHR: 0, INT: 0, STR: 0, MNY: 0 },
    // 分配边界 [min, max]。
    allocLimit: [0, 10],
    // 日志级别（配置界面切换，localStorage 持久化）。
    logLevel: loadLogLevel(),
    // 日志缓冲（界面日志面板显示，最多保留 LOG_BUFFER_LIMIT 条）。
    logBuffer: [],
    // 错误发生序号（每写一条 error 级日志 +1；悬浮窗据此自动展开提醒）。
    errorSeq: 0,
    // 当前数据源描述（主页选原版数据 / fixture 降级时写入，报告里带上）。
    dataSource: '',
  }),

  // 计算属性。
  getters: {
    // 已初始化。
    isReady: (state) => state.initialized && state.life !== null,
    // 总可用点数（默认 20 + 天赋加成）。
    propertyPoints: (state) => state.life ? state.life.getPropertyPoints() : 0,
    // 已分配点数。
    allocatedTotal: (state) => state.allocation.CHR + state.allocation.INT + state.allocation.STR + state.allocation.MNY,
    // 剩余点数。
    leftPoints: (state) => (state.life ? state.life.getPropertyPoints() : 0) - state.allocatedTotal,
    // 错误条数（悬浮窗角标；按缓冲内容实时统计）。
    errorCount: (state) => countByLevel(state.logBuffer).error,
    // 警告条数（同上）。
    warnCount: (state) => countByLevel(state.logBuffer).warn,
  },

  // 动作。
  actions: {
    // 初始化引擎。
    async init(data) {
      // 重置单局状态：从主页重新开始时，不能残留上一局的进度标记与选择。
      this.started = false
      this.talentsConfirmed = false
      this.talentPool = []
      this.selectedTalents = []
      this.clearTrace()
      this.allocation = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
      // 创建日志器：级别从配置读取，输出到浏览器 console + 界面缓冲。
      // 引擎内核（Life/属性/天赋/事件/成就/角色/数据加载/Mod 钩子）全部日志经此汇入。
      const logger = createLogger({
        level: this.logLevel,
        sink: {
          trace: (m) => this.pushLog('trace', m),
          debug: (m) => this.pushLog('debug', m),
          info: (m) => this.pushLog('info', m),
          warn: (m) => this.pushLog('warn', m),
          error: (m) => this.pushLog('error', m),
        },
      })
      // 创建 Life 实例（注入日志器）。markRaw 防止被 reactive 代理（私有字段保护）。
      this.life = markRaw(new Life({ data, logger }))
      // 初始化。
      await this.life.initial()
      // 配置。
      this.life.config()
      // 标记完成。
      this.initialized = true
      // 同步属性。
      this.sync()
    },

    // 从引擎同步属性到响应式状态。
    sync() {
      // 引擎不可用则跳过。
      if (!this.life) return
      // 读取六个属性。
      const p = this.life.propertys
      // 写入响应式状态。
      this.propertys = { ...p }
    },

    // 开始一局。
    start(allocation) {
      // 需要已开局（remake 在页面流程中调用）。
      this.life.start(allocation)
      // 同步属性。
      this.sync()
    },

    // 推进一年。
    next() {
      // 引擎推进。
      const result = this.life.next()
      // 同步属性。
      this.sync()
      // 记录当前这岁流水（供需要"最新一岁"的调用方）。
      this.content = result.content
      // 累积到完整轨迹：条目做浅拷贝，避免后续被引擎就地修改（钩子可能回写 content）。
      this.history.push({
        // 年龄。
        age: result.age,
        // 该岁是否结束。
        isEnd: result.isEnd,
        // 条目快照。
        items: (result.content || []).map((c) => ({ ...c })),
      })
      // 返回结果（供组件渲染事件卡片）。
      return result
    },

    // 设置游戏模式。
    setMode(mode) {
      // 记录模式。
      this.mode = mode
    },

    // 抽取天赋池。
    drawTalents() {
      // 引擎未初始化保护（刷新后直进页面的双保险）。
      if (!this.life) {
        // 错误日志（常显进面板）。
        this.pushLog('error', '[UI][game] 引擎未初始化，无法抽取天赋（应回主页重新开始）')
        // 空池返回。
        return
      }
      // 调用引擎抽取（trace 引擎日志随级别过滤）。
      this.talentPool = this.life.talentRandom()
      // 页面日志：池规模。
      this.pushLog('debug', `[UI][game] 抽取天赋池 ${this.talentPool.length} 个`)
    },

    // 选中一个天赋（互斥校验 + 限 3 个）。
    // @param {number} index - 天赋池索引
    // @returns {{ok: boolean, message?: string}} 结果
    selectTalent(index) {
      // 池中天赋。
      const talent = this.talentPool[index]
      // 无效索引。
      if (!talent) return { ok: false, message: '无效索引' }
      // 已选则取消。
      if (this.selectedTalents.includes(talent.id)) {
        // 移除。
        this.selectedTalents = this.selectedTalents.filter(id => id !== talent.id)
        // 成功。
        return { ok: true }
      }
      // 限 3 个。
      if (this.selectedTalents.length >= this.life.talentSelectLimit) {
        return { ok: false, message: `最多选择 ${this.life.talentSelectLimit} 个天赋` }
      }
      // 互斥校验。
      const conflict = this.life.exclude(this.selectedTalents, talent.id)
      // 有冲突。
      if (conflict !== null) {
        return { ok: false, message: `与 ${conflict} 互斥` }
      }
      // 加入选中。
      this.selectedTalents.push(talent.id)
      // 成功。
      return { ok: true }
    },

    // 确认天赋（进入属性分配页之前必须调用）。
    //
    // 为什么必须在这里而不是开局时：属性分配页要显示「默认点数 + 天赋加成」，
    // 即读取 life.getPropertyPoints()，而该值来自引擎的 #initialData.TLT；
    // 原实现只在 begin() 里 remake，属性页先渲染 → #initialData 未建立 → 崩溃。
    //
    // 重复调用安全：remake 内部对入参做深拷贝后重建初始数据，替换链不会累积污染。
    //
    // @returns {number} 确认后的可用点数（引擎未初始化时返回 0）
    confirmTalents() {
      // 引擎未初始化保护（刷新后直进页面的双保险）。
      if (!this.life) {
        // 错误日志（常显进面板）。
        this.pushLog('error', '[UI][game] 引擎未初始化，无法确认天赋（应回主页重新开始）')
        // 无点数。
        return 0
      }
      // 触发替换链并把已选天赋写入初始数据。
      this.life.remake([...this.selectedTalents])
      // 标记已确认（begin 据此避免重复执行）。
      this.talentsConfirmed = true
      // 可用点数（默认 + 天赋加成）。
      const points = this.life.getPropertyPoints()
      // 页面日志：确认结果。
      this.pushLog('info', `[UI][talent] 已确认天赋 ${this.selectedTalents.length} 个，可用点数 ${points}`)
      // 返回，供调用方/测试断言。
      return points
    },

    // 开局（应用分配属性 + 进入人生轨迹）。
    // @param {object} allocation - 属性分配
    begin(allocation = {}) {
      // 引擎未初始化保护。
      if (!this.life) {
        // 错误日志（常显进面板）。
        this.pushLog('error', '[UI][game] 引擎未初始化，无法开局（应回主页重新开始）')
        // 中断。
        return
      }
      // 天赋未确认则补做一次（替换链只跑一次，避免重复消耗随机源）。
      if (!this.talentsConfirmed) this.confirmTalents()
      // 开局（写入分配属性 + 触发初始成就）。
      this.life.start(allocation)
      // 标记已开局（GameView 挂载时据此避免重复开局）。
      this.started = true
      // 清空轨迹（新的一局）。
      this.clearTrace()
      // 同步。
      this.sync()
    },

    // 清空人生轨迹（开局/重开/回主页时调用）。
    // @returns {void}
    clearTrace() {
      // 当前一岁流水。
      this.content = []
      // 完整轨迹。
      this.history = []
    },

    // 调整单个属性分配。
    // @param {string} key - 属性键（CHR/INT/STR/MNY）
    // @param {number} delta - 增量（±1）
    // @returns {{ok: boolean, message?: string}} 结果
    adjustAllocation(key, delta) {
      // 计算新值。
      const newValue = this.allocation[key] + delta
      // 单属性边界 [0, max]。
      const [, max] = this.allocLimit
      // 超出单属性上限。
      if (newValue < 0 || newValue > max) return { ok: false, message: `单属性范围 0-${max}` }
      // 剩余点数不足。
      if (this.leftPoints - delta < 0) return { ok: false, message: '点数不足' }
      // 更新分配。
      this.allocation[key] = newValue
      // 成功。
      return { ok: true }
    },

    // 随机分配全部点数。
    randomAllocate() {
      // 可用点数。
      let t = this.propertyPoints
      // 每项剩余可加空间（从上限倒扣）。
      const [, max] = this.allocLimit
      // 四项初始为剩余空间。
      const remain = new Array(4).fill(max)
      // 逐点分配。
      while (t > 0) {
        // 随机子步长（1 到 min(t, max)）。
        const sub = Math.round(Math.random() * (Math.min(t, max) - 1)) + 1
        // 尝试随机选择一项。
        while (true) {
          // 随机项。
          const select = Math.floor(Math.random() * 4) % 4
          // 该项剩余空间不足则重选。
          if (remain[select] - sub < 0) continue
          // 扣减空间。
          remain[select] -= sub
          // 扣减点数。
          t -= sub
          // 本子步完成。
          break
        }
      }
      // 写入四项分配（上限 - 剩余 = 已分配）。
      const keys = ['CHR', 'INT', 'STR', 'MNY']
      // 逐项写入。
      keys.forEach((k, i) => { this.allocation[k] = max - remain[i] })
      // 成功。
      return { ok: true }
    },

    // 重置分配。
    resetAllocation() {
      // 全部归零。
      this.allocation = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
    },

    // 切换日志级别：全链路实时生效（引擎自身 + 全部子模块日志器）并持久化。
    // @param {string} level - trace/debug/info/warn/error
    setLogLevel(level) {
      // 更新状态。
      this.logLevel = level
      // 引擎已创建则同步切换（Life.setLogLevel 遍历各子模块日志器）。
      if (this.life) this.life.setLogLevel(level)
      // 持久化。
      localStorage.setItem('logLevel', level)
      // 缓冲提示。
      this.pushLog('info', `[配置] 日志级别切换为 ${level}`)
    },

    // 收集日志到缓冲（logger sink 回调：级别过滤已在 logger 内完成）。
    // @param {string} level - 级别
    // @param {string} msg - 格式化消息
    pushLog(level, msg) {
      // 行文本（带时间戳：导出的报告要能看出问题发生顺序）。
      const line = formatLogLine(level, msg)
      // 缓冲。
      this.logBuffer.push(line)
      // 超限截断（保留最新）。
      if (this.logBuffer.length > LOG_BUFFER_LIMIT) this.logBuffer.splice(0, this.logBuffer.length - LOG_BUFFER_LIMIT)
      // error 级：递增序号（悬浮窗监听它以自动展开，让用户第一时间能导出）。
      if (level === 'error') this.errorSeq++
      // 同步到浏览器 console。
      console.log(line)
    },

    // 构建可导出的日志报告（悬浮窗「复制 / 下载」用）。
    // 除日志外还带上路由、UA、视口、游戏与 Mod 状态——报告可直接贴进 issue。
    // @returns {string} 报告文本
    logReport() {
      // 环境信息（Node 环境无 window，自动降级为 null）。
      const env = collectLogMeta({
        location: globalThis.location,
        navigatorLike: globalThis.navigator,
        screenLike: globalThis.screen,
        devicePixelRatio: globalThis.devicePixelRatio,
      })
      // Mod 启停状态（读 localStorage，失败不影响报告生成）。
      let mods = null
      try {
        // 持久化状态。
        const state = loadModsState()
        // 摘要文本。
        const pairs = Object.entries(state.enabled || {}).map(([name, on]) => `${name}=${on ? 'on' : 'off'}`)
        // 有内容才用。
        mods = pairs.length > 0 ? pairs.join(', ') : '（无记录）'
      } catch {
        // 读不到就留空（报告头部显示「未知」）。
        mods = null
      }
      // 游戏状态摘要。
      const game =
        `initialized=${this.initialized} started=${this.started} mode=${this.mode} ` +
        `life=${this.life ? '已创建' : '未创建'} propertys=${JSON.stringify(this.propertys)} ` +
        `allocation=${JSON.stringify(this.allocation)}`
      // 组装报告。
      return buildLogReport({
        // 当前缓冲（已是「最旧 → 最新」顺序）。
        logs: this.logBuffer,
        // 头部信息。
        meta: { level: this.logLevel, ...env, game, mods, dataSource: this.dataSource || null },
      })
    },

    // 清空日志缓冲。
    clearLog() {
      // 清空。
      this.logBuffer = []
    },
  },
})
