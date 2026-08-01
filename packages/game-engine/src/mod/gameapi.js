/**
 * gameAPI 核心 — 钩子系统与数据操作
 *
 * 实现设计文档 6.7 gameAPI：
 *   - 钩子注册/触发/移除/执行顺序/异常隔离
 *   - 属性/事件/天赋/成就 CRUD
 *   - 冲突覆盖（后加载覆盖）
 *
 * 钩子点（设计文档 4.1）：
 *   onTalentPoolGenerate / onEventGenerate / onEventRender / onYearAdvance
 *   propertyChange / achievement 等
 */

// #createHookBus
// 创建钩子总线：注册/触发/移除，支持执行顺序与异常隔离。
//
// @returns {object} 钩子总线
export function createHookBus() {
  // 钩子映射：名称 → 回调数组。
  const hooks = {}

  // 返回总线。
  return {
    // #on
    // 注册钩子。
    //
    // @param {string} name - 钩子名
    // @param {Function} fn - 回调
    // @returns {Function} 移除函数
    on(name, fn) {
      // 初始化数组。
      if (!hooks[name]) hooks[name] = []
      // 追加回调。
      hooks[name].push(fn)
      // 返回移除函数。
      return () => this.off(name, fn)
    },

    // #off
    // 移除钩子。
    //
    // @param {string} name - 钩子名
    // @param {Function} fn - 回调
    // @returns {void}
    off(name, fn) {
      // 无该钩子。
      if (!hooks[name]) return
      // 过滤移除。
      hooks[name] = hooks[name].filter(f => f !== fn)
    },

    // #emit
    // 触发钩子（按注册顺序，异常隔离——单个失败不影响后续）。
    //
    // @param {string} name - 钩子名
    // @param {*} payload - 负载
    // @param {object} [log] - 日志器
    // @returns {Array} 各回调返回值的数组
    emit(name, payload, log) {
      // 日志器。
      const logger = log || { debug: () => {}, error: () => {} }
      // 无钩子。
      if (!hooks[name]) return []
      // 结果。
      const results = []
      // 按序执行。
      for (const fn of hooks[name]) {
        // 异常隔离。
        try {
          // 执行并记录。
          results.push(fn(payload))
        } catch (e) {
          // 记录。
          logger.error(`钩子 ${name} 异常: ${e.message}`)
        }
      }
      // 返回。
      return results
    },

    // #has
    // 是否有某钩子。
    //
    // @param {string} name - 钩子名
    // @returns {boolean}
    has(name) {
      // 有回调。
      return (hooks[name] || []).length > 0
    },

    // #list
    // 列出全部钩子与回调数。
    //
    // @returns {object} 钩子名 → 数量
    list() {
      // 映射。
      const result = {}
      // 遍历。
      for (const name in hooks) result[name] = hooks[name].length
      // 返回。
      return result
    },
  }
}

// #createGameAPI
// 创建 gameAPI：钩子总线 + 数据操作。
//
// @param {object} deps
// @param {object} deps.data - 合并后的 Mod 数据 { talents, events, achievements, characters }
// @param {object} [deps.log] - 日志器
// @returns {object} gameAPI
export function createGameAPI({ data, log }) {
  // 日志器。
  const logger = log || { debug: () => {}, error: () => {} }
  // 钩子总线。
  const hooks = createHookBus()
  // 数据引用。
  const store = data

  // 返回 API。
  return {
    // 钩子系统。
    on: (name, fn) => hooks.on(name, fn),
    off: (name, fn) => hooks.off(name, fn),
    emit: (name, payload) => hooks.emit(name, payload, logger),
    hooks: () => hooks.list(),

    // 属性操作。
    property: {
      // 读取属性值。
      get: (prop) => store.properties?.[prop],
      // 设置属性值。
      set: (prop, value) => {
        // 初始化属性存储。
        if (!store.properties) store.properties = {}
        // 赋值。
        store.properties[prop] = value
        // 触发钩子。
        hooks.emit('propertyChange', { prop, value }, logger)
      },
    },

    // 天赋 CRUD。
    addTalent: (talent) => {
      // 初始化。
      if (!store.talents) store.talents = {}
      // 冲突覆盖（同名 ID 覆盖）。
      store.talents[talent.id] = talent
      // 返回。
      return talent.id
    },
    getTalent: (id) => store.talents?.[id],
    removeTalent: (id) => {
      // 删除。
      delete store.talents[id]
    },

    // 事件 CRUD。
    addEvent: (event) => {
      // 初始化。
      if (!store.events) store.events = {}
      // 冲突覆盖。
      store.events[event.id] = event
      // 返回。
      return event.id
    },
    getEvent: (id) => store.events?.[id],
    removeEvent: (id) => {
      // 删除。
      delete store.events[id]
    },

    // 成就 CRUD。
    addAchievement: (ach) => {
      // 初始化。
      if (!store.achievements) store.achievements = {}
      // 冲突覆盖。
      store.achievements[ach.id] = ach
      // 返回。
      return ach.id
    },
    getAchievement: (id) => store.achievements?.[id],

    // 数据访问（只读视图）。
    data: store,
  }
}
