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
// 导入 Life 引擎。
import Life from 'game-engine/src/modules/life.js'

// 定义 store。
export const useGameStore = defineStore('game', {
  // 状态。
  state: () => ({
    // Life 实例。
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
  }),

  // 计算属性。
  getters: {
    // 已初始化。
    isReady: (state) => state.initialized && state.life !== null,
  },

  // 动作。
  actions: {
    // 初始化引擎。
    async init(data) {
      // 创建 Life 实例。
      this.life = new Life({ data })
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
      // 调用引擎抽取。
      this.talentPool = this.life.talentRandom()
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
  },
})
