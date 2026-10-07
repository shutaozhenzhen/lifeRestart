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
// 资源桥（Mod 包内二进制资源；2026-10 能力补齐 ②）。
import { createAssetBridge, createUnavailableAssetBridge } from './asset-bridge.js'

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
// @param {object} [deps.asset] - **资源桥**（`createAssetBridge({ modName, listFiles, readBytes })`
//   的结果）；缺省用降级桥（`available: false`、读操作报错）—— 见 `mod/asset-bridge.js`
// @param {object} [deps.log] - 日志器
// @returns {object} gameAPI
export function createGameAPI({ data, hooks, ai, aiModFactory, params, host, property, asset, storage, modName: _modName, log }) {
  // 日志器。
  const logger = log || { debug: () => {}, error: () => {} }
  // Mod 名（storage 命名空间 + 日志前缀用）。
  const modName = _modName || 'anonymous'
  // 本实例注册过的钩子（dispose 用）。
  const registrations = []
  // storage 键名：`mod:<Mod 名>:<键>`（与引擎自己的键隔离）。
  const storageKey = (key) => `mod:${modName}:${key}`
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
  // 资源桥（2026-10 能力补齐 ②）：注入的若是 `{ listFiles, readBytes }` 形态则包成桥；
  // 没注入 → 降级桥（`available: false`，读操作抛可读错误）。
  //
  // 历史：以前这里**根本没有** asset 这个键 —— Mod 包只收文本，二进制在 zip 安装时
  // 就被丢弃了（`AGENTS.md` 边界 ④ 曾写着"不能带资源文件进 zip"）。现在包能带图片/
  // 音频/字体，字节逐字节保留，由这个桥交给 Mod。
  const assetBridge = asset
    ? (typeof asset.list === 'function' ? asset : createAssetBridge({ modName, ...asset }))
    : createUnavailableAssetBridge(modName)
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
    // `on` 会**记下本实例注册过的回调**，供 `dispose()` 一次性摘掉 —— 2026-10 能力补齐：
    // 以前 Mod 想卸载只能自己保存注销函数，漏摘就留下"幽灵钩子"。
    on: (name, fn) => {
      // 登记（便于 dispose）。
      registrations.push([name, fn])
      // 委托总线。
      return bus.on(name, fn)
    },
    // 注销钩子（同步从登记表里去掉）。
    off: (name, fn) => {
      // 从登记表移除。
      const i = registrations.findIndex(([n, f]) => n === name && f === fn)
      // 命中则删。
      if (i !== -1) registrations.splice(i, 1)
      // 委托总线。
      return bus.off(name, fn)
    },
    emit: (name, payload) => bus.emit(name, payload, logger),
    emitSync: (name, payload) => bus.emitSync(name, payload, logger),
    hooks: () => bus.list(),

    // 日志：接宿主日志器（别再只能 console.log —— Node/打包环境里 console 不进日志面板）。
    // 级别与引擎一致：debug / info / warn / error（缺省实现只保证 debug/error 存在，故都用可选调用）。
    log: {
      // 调试。
      debug: (...args) => logger.debug?.(`[mod:${modName}] ${args.join(' ')}`),
      // 信息。
      info: (...args) => (logger.info || logger.debug)?.(`[mod:${modName}] ${args.join(' ')}`),
      // 警告。
      warn: (...args) => (logger.warn || logger.debug)?.(`[mod:${modName}] ${args.join(' ')}`),
      // 错误。
      error: (...args) => (logger.error || logger.debug)?.(`[mod:${modName}] ${args.join(' ')}`),
    },

    // 跨局存储：命名空间 `mod:<Mod 名>:<键>`，与引擎自己的键（TMS/ACHV/…）互不干扰。
    // 需注入 storage 适配器（与引擎同一份，浏览器侧是 localStorage 适配器）。
    // ⚠️ 键名仍受「重置数据」管辖：见 `frontend/src/utils/reset-data.js` 的 `mod:` 前缀清理。
    storage: {
      // 读（JSON 解析；缺失 / 解析失败返回 fallback）。
      get: (key, fallback) => {
        // 无 storage：给 fallback（不抛，Mod 可以无脑读）。
        if (!storage) return fallback
        // 读原始串。
        const raw = storage.getItem(storageKey(key))
        // 缺失 / 'undefined'。
        if (raw === null || raw === undefined || raw === 'undefined') return fallback
        // 解析。
        try {
          // JSON 解析。
          return JSON.parse(raw)
        } catch {
          // 坏数据给 fallback（不炸）。
          return fallback
        }
      },
      // 写（JSON 序列化）。
      set: (key, value) => {
        // 无 storage → 明确报错（静默丢弃是最难查的）。
        if (!storage) throw new Error('当前宿主没有可用的 storage（gameAPI.storage 需要注入 storage 适配器）')
        // 写。
        storage.setItem(storageKey(key), JSON.stringify(value))
      },
      // 删。
      remove: (key) => {
        // 无 storage → 无事可做。
        if (!storage) return
        // 删除。
        storage.removeItem?.(storageKey(key))
      },
      // 列出本 Mod 的全部键（去掉命名空间前缀）。
      keys: () => {
        // 无 storage / 不支持枚举 → 空数组。
        if (!storage || typeof storage.keys !== 'function') return []
        // 前缀。
        const p = `mod:${modName}:`
        // 过滤 + 去前缀。
        return storage.keys().filter((k) => k.startsWith(p)).map((k) => k.slice(p.length))
      },
    },

    // 卸载：摘掉本 Mod 通过 gameAPI.on 注册的**全部**钩子（返回摘掉的数量）。
    // 用于"换局 / 禁用 Mod / 重新加载"时避免幽灵钩子重复生效。
    dispose: () => {
      // 取出并清空登记表。
      const list = registrations.splice(0)
      // 逐个摘。
      for (const [name, fn] of list) bus.off(name, fn)
      // 返回摘掉的数量（调用方可观测）。
      return list.length
    },

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

    // 资源（**Mod 包内的二进制资源**，2026-10 能力补齐 ②）。
    // 注入 `asset` 桥（`createAssetBridge({ modName, listFiles, readBytes })`）→ 能读包里的
    // 图片/音频/字体（`list/has/bytes/url/text`）；没注入 → 降级桥（`available: false`，
    // 读操作抛可读错误）。
    //
    // 历史：以前这个键**不存在** —— zip 安装只收文本，二进制被丢弃并给警告；
    // 想用图片只能靠宿主桥 `fs` 读本地文件（见 `AGENTS.md` 边界 ④ 的旧写法）。
    asset: assetBridge,

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
    // 删除成就（2026-10 补齐：以前只有 add/get，没有 remove）。
    removeAchievement: (id) => {
      // 删除。
      delete store.achievements?.[id]
    },

    // 名人 CRUD（2026-10 补齐：以前只能直接操作 `gameAPI.data.characters`，没有专用接口）。
    // ⚠️ 名人表主键 = 条目自己的 `id`（与事件表不同：事件不读对象里的 id）。
    addCharacter: (ch) => {
      // 初始化。
      if (!store.characters) store.characters = {}
      // 写入（同名 id 覆盖）。
      store.characters[ch.id] = ch
      // 返回 id。
      return ch.id
    },
    getCharacter: (id) => store.characters?.[id],
    removeCharacter: (id) => {
      // 删除。
      delete store.characters?.[id]
    },

    // 年龄表操作（2026-10 补齐）。键是**年龄字符串**，值是 `{ age, event: [[id, weight]], talent: [] }`。
    // ⚠️ `addAge` 是**整个年龄键替换**：想给某一岁追加事件，必须把原条目的 id 一起抄进来。
    addAge: (age, entry) => {
      // 初始化。
      if (!store.age) store.age = {}
      // 写入（整键替换）。
      store.age[String(age)] = entry
      // 返回键（字符串）。
      return String(age)
    },
    getAge: (age) => store.age?.[String(age)],
    removeAge: (age) => {
      // 删除。
      delete store.age?.[String(age)]
    },

    // 列举某张表的全部条目（2026-10 补齐：以前只能自己 `Object.keys(gameAPI.data.xxx)`）。
    // 表名：`talents` / `events` / `achievements` / `characters` / `age`；未知表名 → 空数组（不抛）。
    list: (table) => {
      // 取表。
      const t = store[table]
      // 非对象 → 空数组。
      if (!t || typeof t !== 'object') return []
      // 条目数组（浅拷贝：别让调用方顺手改到原表结构）。
      return Object.values(t).slice()
    },

    // 数据访问（只读视图）。
    data: store,
  }
  // 返回 API（含 createAIMod 闭包引用自身）。
  return api
}
