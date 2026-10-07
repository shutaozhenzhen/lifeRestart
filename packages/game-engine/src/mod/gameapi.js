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
 *
 * Mod 架构 v2：增加 `host` 命名空间（宿主桥，见 mod/host.js 与
 * `_设计方案_Mod宿主能力与双目标.md`）——浏览器侧的 code.js 经它调用
 * **该 Mod 自己的** Node 侧入口（`server.js` 注册的命名处理器）。
 */

// 宿主桥（seam #3）：缺省用"无后端"的空桥，保证 gameAPI.host 永远可用。
import { createHostBridge, createDenyHost } from './host.js'
// 属性桥（Mod ↔ 真实游戏属性系统；2026-10 能力补齐）。
import { createPropertyBridge, createUnavailablePropertyBridge } from './property-bridge.js'

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
// @param {object} [deps.host] - 宿主桥（createHostBridge 的结果）**或其适配器**
//   （{ available, call }）；缺省 createDenyHost()（available 为空、调用报错）
// @param {object} [deps.property] - **属性桥**（`createPropertyBridge(life)` 的结果，或 Life 本身）；
//   缺省用降级桥（`available: false`、写操作报错）—— 见 `mod/property-bridge.js`
// @param {object} [deps.log] - 日志器
// @returns {object} gameAPI
export function createGameAPI({ data, hooks, ai, aiModFactory, params, host, property, log }) {
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
  // 宿主桥（Mod 架构 v2）：注入的若是适配器（只有 available/call）则先包成桥；
  // 完全没注入 → 用空桥（静态站语义），这样 Mod 代码可以无条件写 gameAPI.host.has(...)。
  const hostBridge = host ? (typeof host.has === 'function' ? host : createHostBridge(host)) : createDenyHost()
  // 属性桥：注入的若是 Life（有 .property）或 Property 模块，都包成桥；没注入 → 降级桥。
  const propertyBridge = property ? createPropertyBridge(property) : createUnavailablePropertyBridge()
  // 共享总线自检：属性变更通知是从 **Life 的总线**广播的（Property 由 Life 构造）。
  // 若调用方给 Life 传的不是这条总线，Mod 注册的 `propertyChange` 会**静默收不到**通知 ——
  // 这是很难查的一类问题，所以这里直接出声（不改语义：照样各用各的）。
  if (property && property.hooks && property.hooks !== hooks) {
    // 记 warn（调用方应把同一条总线同时给 Life 与 executeModCodes，`store.init` 就是这么做的）。
    logger.warn?.('gameAPI: property 桥挂在 Life 上，但 hooks 与 Life 的总线不是同一个对象 —— propertyChange 通知会发到 Life 的总线上，Mod 可能收不到')
  }

  // 返回 API。
  const api = {
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

    // 宿主桥（Mod 架构 v2）：调用**本 Mod 自己的**后端入口（server.js 注册的处理器）。
    // 与 ai 同构：available 是环境探测，不是授权；无后端时 has() 恒为 false。
    host: hostBridge,

    // AI Mod 工厂（注入式；code.js 用它创建 AI Mod 增强器，避免逻辑重复）。
    createAIMod: aiModFactory
      ? (cfg) => aiModFactory({ gameAPI: api, config: { ...aiConfig, ...cfg }, log: logger })
      : null,

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

    // 属性系统（**真实**的游戏属性，2026-10 起）。
    // 注入 `property` 桥（`createPropertyBridge(life)`）→ 读写真实属性并触发 `propertyChange`；
    // 没注入 → 降级桥（`available: false`，写操作抛可读错误）。
    //
    // 历史：这里以前读写 `store.properties` 这个自定义键（全引擎无人读），是个"看起来能用、
    // 实际什么都没发生"的假 API；已由本次能力补齐替换掉。
    property: propertyBridge,

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
  // 返回 API（含 createAIMod 闭包引用自身）。
  return api
}
