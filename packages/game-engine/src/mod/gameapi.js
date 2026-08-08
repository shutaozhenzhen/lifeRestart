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
    // 支持同步与异步回调：async 钩子的 Promise 被 await，保证全部完成后返回。
    //
    // @param {string} name - 钩子名
    // @param {*} payload - 负载
    // @param {object} [log] - 日志器
    // @returns {Promise<Array>} 各回调返回值的数组
    async emit(name, payload, log) {
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
          // 执行并记录（await 支持 async 钩子）。
          results.push(await fn(payload))
        } catch (e) {
          // 记录。
          logger.error(`钩子 ${name} 异常: ${e.message}`)
        }
      }
      // 返回。
      return results
    },

    // #emitSync
    // 同步触发钩子（按注册顺序，异常隔离）。
    // 供同步场景使用（如 Life 引擎的 next()/format() 是同步方法）。
    // async 钩子会被调用但返回值被忽略（fire-and-forget）。
    //
    // @param {string} name - 钩子名
    // @param {*} payload - 负载
    // @param {object} [log] - 日志器
    // @returns {Array} 各回调返回值的数组（async 钩子为 Promise）
    emitSync(name, payload, log) {
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
          // 同步调用（async 钩子的 Promise 直接入数组，不 await）。
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
// 创建 gameAPI：钩子总线 + 数据操作 + AI 客户端 + 参数注册。
// 支持注入外部钩子总线（hooks），使 Life 引擎与 gameAPI 共享同一总线：
//   引擎在 next()/talentRandom()/format() 触发钩子，Mod 通过 gameAPI.on() 注册回调。
//
// @param {object} deps
// @param {object} deps.data - 合并后的 Mod 数据 { talents, events, achievements, characters }
// @param {object} [deps.hooks] - 外部钩子总线（createHookBus 实例）；缺省自建
// @param {object} [deps.ai] - AI 配置 { client, baseUrl, apiKey, model }；缺省不启用 ai
// @param {object} [deps.params] - 参数注册表（createParamRegistry 实例）；缺省不自建
// @param {object} [deps.log] - 日志器
// @returns {object} gameAPI
export function createGameAPI({ data, hooks, ai, params, log }) {
  // 日志器。
  const logger = log || { debug: () => {}, error: () => {} }
  // 钩子总线：注入外部实例（与 Life 共享）或自建。
  const bus = hooks || createHookBus()
  // 数据引用。
  const store = data
  // AI 客户端（注入式；未提供则 ai 不可用）。
  const aiClient = ai?.client || null
  // AI 默认配置。
  const aiConfig = ai || {}

  // 返回 API。
  return {
    // 钩子系统（委托外部总线）。
    on: (name, fn) => bus.on(name, fn),
    off: (name, fn) => bus.off(name, fn),
    emit: (name, payload) => bus.emit(name, payload, logger),
    emitSync: (name, payload) => bus.emitSync(name, payload, logger),
    hooks: () => bus.list(),

    // AI 客户端（Mod 代码通过 gameAPI.ai 调用；需 manifest 声明 ai 权限）。
    ai: {
      // 是否有可用 AI 客户端。
      get available() { return aiClient !== null },
      // 当前配置。
      config: { baseUrl: aiConfig.baseUrl, model: aiConfig.model },
      // 对话（透传客户端）。
      chat: (params) => {
        // 无客户端。
        if (!aiClient) throw new Error('AI 客户端不可用（未配置 ai 客户端）')
        // 委托客户端。
        return aiClient.chatCompletion({ ...aiConfig, ...params })
      },
      // 生成 JSON（透传客户端）。
      generate: (params) => {
        // 无客户端。
        if (!aiClient) throw new Error('AI 客户端不可用（未配置 ai 客户端）')
        // 委托客户端。
        return aiClient.generateJSON({ ...aiConfig, ...params })
      },
    },

    // 参数注册表（Mod 可定义/读取/修改可配置参数）。
    // 需传入 createParamRegistry 实例（与 Life 共享）才可用。
    param: params
      ? {
          // 注册参数。
          define: (name, def) => params.define(name, def),
          // 读参数。
          get: (name) => params.get(name),
          // 写参数。
          set: (name, v) => params.set(name, v),
          // 增量。
          change: (name, v) => params.change(name, v),
          // 全部参数名。
          get names() { return params.names },
          // 展开全部。
          getAll: () => params.getAll(),
        }
      : null,

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
        // 触发钩子（异步，返回 Promise 供调用方 await）。
        return bus.emit('propertyChange', { prop, value }, logger)
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
