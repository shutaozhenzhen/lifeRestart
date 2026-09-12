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
    // 每岁事件/天赋流水（响应式）。
    content: [],
    // 属性分配（CHR/INT/STR/MNY）。
    allocation: { CHR: 0, INT: 0, STR: 0, MNY: 0 },
    // 分配边界 [min, max]。
    allocLimit: [0, 10],
    // 日志级别（配置界面切换，localStorage 持久化）。
    logLevel: loadLogLevel(),
    // 日志缓冲（界面日志面板显示，最多保留 500 条）。
    logBuffer: [],
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
  },

  // 动作。
  actions: {
    // 初始化引擎。
    async init(data) {
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
      // 记录流水。
      this.content = result.content
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

    // 开局（remake + start）。
    begin(allocation = {}) {
      // 触发替换链。
      this.life.remake(this.selectedTalents)
      // 开局。
      this.life.start(allocation)
      // 清空流水。
      this.content = []
      // 同步。
      this.sync()
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
      // 行文本。
      const line = `[${level.toUpperCase()}] ${msg}`
      // 缓冲。
      this.logBuffer.push(line)
      // 超限截断（保留最新）。
      if (this.logBuffer.length > 500) this.logBuffer.splice(0, this.logBuffer.length - 500)
      // 同步到浏览器 console。
      console.log(line)
    },

    // 清空日志缓冲。
    clearLog() {
      // 清空。
      this.logBuffer = []
    },
  },
})
