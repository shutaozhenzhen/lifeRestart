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
// 界面扩展的 schema 常量与空声明（2026-10 能力补齐 ③）。
import { UI_SLOTS, UI_LIMITS, emptyUiDeclaration } from './ui-schema.js'
// 异步逐岁介入（2026-10 能力补齐 ④）：`async` / `asyncHooks` 的语义只在 manifest.js 定义一次。
import { manifestAsync, hooksToAwait } from './manifest.js'

// #UNAVAILABLE_UI_ERROR
// 没有注入 `uiSink` 时，注册类调用的统一错误文案（**出声**：静默丢弃注册是最难查的问题）。
const UNAVAILABLE_UI_ERROR = '当前宿主没有界面注册能力（gameAPI.ui 需要宿主注入 uiSink：浏览器侧由 executeModCodes 接 stores/extensions.js）。要让界面扩展在所有时段都能看到，请改用 manifest.ui 静态声明（启动时收集，不需要先开一局）。'

// #createUiBridge
// 造 `gameAPI.ui`（2026-10 能力补齐 ③：**Mod 能加界面**）。
//
// 这条能力以前是硬边界（`AGENTS.md` 边界 ①：没有页面/组件/路由/属性面板注册 API）。
// 两种注册源的关系（**必须记住的差异**，文档里也写了）：
//   · `manifest.ui`（静态声明）→ 应用**启动时**收集，主页 / Mod 管理页也看得到；
//   · `gameAPI.ui.*`（运行期注册）→ `code.js` 执行时才可用（= 一局游戏已经建好），用于按条件显示。
//   两者产物在前端**汇进同一个注册表**。
//
// 降级行为（与 `property` / `asset` / `storage` 同一风格）：
//   · 没注入 `uiSink` → `available: false`；
//   · 读操作（`list()` / `hasAction()`）给空 / false；
//   · **注册操作抛可读错误**（不是静默丢弃 —— 那会表现成"界面里没有我加的东西，也没有任何提示"）；
//   · `onAction` 仍可用（动作表在本地，点击时由前端渲染器调用），返回注销函数。
//
// @param {object} params
// @param {object} [params.sink] - 宿主注册表（需有 `add(kind, item, modName)`；可选 `onAction` / `offAction`）
// @param {string} [params.modName] - 来源 Mod 名（宿主据此知道是谁注册的）
// @param {object} [params.log] - 日志器
// @returns {object} gameAPI.ui
export function createUiBridge({ sink, modName = 'anonymous', log } = {}) {
  // 有没有注册能力（**先判断 available 再用**是本项目的既有约定）。
  const hasSink = Boolean(sink && typeof sink === 'object')
  // 本实例注册过的动作（id → 回调）；dispose 时清空。
  const actions = new Map()
  // 本实例成功注册过的声明（`list()` 用；降级时给空）。
  const declared = emptyUiDeclaration()

  // #push
  // 把一条声明交给宿主（降级时抛可读错误）。
  //
  // @param {string} kind - 类别（pages/panels/properties/stats）
  // @param {object} item - 规范化的条目
  // @returns {object} 条目本身（便于链式使用）
  function push(kind, item) {
    // 降级：出声（抛可读错误）。
    if (!hasSink || typeof sink.add !== 'function') throw new Error(UNAVAILABLE_UI_ERROR)
    // 记进本地视图（便于 `list()` 与排障）。
    declared[kind].push(item)
    // 交给宿主（宿主内部做去重/上限，冲突规则见前端 utils/ui-extensions.js）。
    sink.add(kind, item, modName)
    // 返回条目。
    return item
  }

  // #requireObject
  // 校验注册内容是不是对象（形状错误**立即**抛可读错误，别塞进注册表里等到渲染时才炸）。
  //
  // @param {string} method - 方法名（错误信息定位用）
  // @param {*} decl - 声明
  // @returns {object} 声明本身
  function requireObject(method, decl) {
    // 必须是普通对象。
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
      // 抛可读错误。
      throw new Error(`gameAPI.ui.${method} 的声明必须是对象（收到：${Array.isArray(decl) ? '数组' : typeof decl}）`)
    }
    // 返回。
    return decl
  }

  // 返回门面。
  return {
    // 有没有界面注册能力（宿主没注入 sink 时为 false）。
    available: hasSink,
    // 合法 slot 白名单（Mod 作者可以据此在运行期自查，避免写错）。
    slots: [...UI_SLOTS],
    // 数量上限（超限由宿主/引擎 schema 报错）。
    limits: { ...UI_LIMITS },

    // #addPage：注册一个页面 → 路由 `/mods/page/:id`。
    addPage(decl) {
      // 形状。
      requireObject('addPage', decl)
      // 交给宿主。
      return push('pages', { id: decl.id, title: decl.title, blocks: Array.isArray(decl.blocks) ? decl.blocks : [] })
    },

    // #addPanel：注册一个面板 → 插到指定 slot 的一张卡片。
    addPanel(decl) {
      // 形状。
      requireObject('addPanel', decl)
      // slot 白名单在这里也拦一道（作者能立刻看到"写错了"，而不是等宿主校验）。
      if (!UI_SLOTS.includes(decl.slot)) {
        // 抛可读错误（列出合法值）。
        throw new Error(`gameAPI.ui.addPanel 的 slot "${decl.slot}" 不是合法 slot（可用：${UI_SLOTS.join('/')}）`)
      }
      // 交给宿主。
      return push('panels', { id: decl.id, slot: decl.slot, title: decl.title, blocks: Array.isArray(decl.blocks) ? decl.blocks : [] })
    },

    // #addProperty：注册一个属性项 → 属性分配面板多一行。
    // ⚠️ 只有该属性在**引擎参数注册表里真实存在**时界面才会渲染它（否则会显示成 NaN）——
    //    通常要先 `gameAPI.param.define(key, { type: 'local', label: '…' })`。
    addProperty(decl) {
      // 形状。
      requireObject('addProperty', decl)
      // 交给宿主。
      return push('properties', { key: decl.key, label: decl.label })
    },

    // #addStat：注册一个统计项 → 总结页统计多一项。
    // ⚠️ 只有 key 在 `life.statistics` 里**真实存在**时界面才会渲染（否则跳过并记 warn）。
    addStat(decl) {
      // 形状。
      requireObject('addStat', decl)
      // 交给宿主（kind 缺省 count）。
      return push('stats', { key: decl.key, label: decl.label, kind: decl.kind === 'ratio' ? 'ratio' : 'count' })
    },

    // #addStatistic：**真的产生一个统计键**（配合 `addStat` 用）。
    //
    // 为什么需要它：总结页只渲染"键真的出现在 `life.statistics` 里"的 Mod 统计声明
    // （否则会渲染成一行永远的 `—`，界面干脆跳过并记 warn）。所以"Mod 加统计"要两步：
    //   ① `gameAPI.ui.addStat({ key, label, kind })` —— 告诉界面怎么显示；
    //   ② `gameAPI.ui.addStatistic(key, value, judge?)` —— 让引擎真的产生这个键。
    //
    // 内置键（TMS/CACHV/RACHV/RTLT/REVT）不允许覆盖（返回 false + 一条 warn）。
    //
    // @param {string} key - 统计键
    // @param {number} value - 数值
    // @param {string} [judge] - 评价键（如 J_Good）
    // @returns {boolean} 是否登记成功；宿主没有该能力时抛可读错误
    addStatistic(key, value, judge) {
      // 降级：出声。
      if (typeof sink?.addStatistic !== 'function') throw new Error(UNAVAILABLE_UI_ERROR)
      // 交给宿主（宿主再转给 Life）。
      return sink.addStatistic(key, value, judge)
    },

    // #list：本次注册过的声明（降级时给空）。
    list() {
      // 浅拷贝一层（别让调用方改到内层）。
      return {
        // 页面。
        pages: declared.pages.map((x) => ({ ...x })),
        // 面板。
        panels: declared.panels.map((x) => ({ ...x })),
        // 属性。
        properties: declared.properties.map((x) => ({ ...x })),
        // 统计。
        stats: declared.stats.map((x) => ({ ...x })),
      }
    },

    // #onAction：注册一个动作按钮的处理函数（配合块类型 `{ t: 'action', id, label }`）。
    //
    // 与 `on()` 不同：**动作表由需要它的那一侧持有**（浏览器侧是前端渲染器按 id 查找），
    // 这里只保证"注册过就是可点、没注册就是禁用"。宿主若提供 `sink.onAction`，同时告知宿主。
    //
    // @param {string} id - 动作 id
    // @param {Function} fn - 回调（payload = 动作块本身；可返回 Promise）
    // @returns {Function} 注销函数（幂等）
    onAction(id, fn) {
      // 形状校验。
      if (typeof id !== 'string' || id.length === 0) throw new Error('gameAPI.ui.onAction 的 id 必须是非空字符串')
      // 回调校验。
      if (typeof fn !== 'function') throw new Error('gameAPI.ui.onAction 的第二个参数必须是函数')
      // 登记（同 id 覆盖：后注册者胜，与注册表合并规则一致）。
      actions.set(id, fn)
      // 告知宿主（可选能力；宿主没提供就只留在本地）。
      try {
        // 通知。
        sink?.onAction?.(id, fn, modName)
      } catch (e) {
        // 宿主失败不影响本地登记（但出声）。
        log?.warn?.(`[UI][mod-ui] 宿主的 onAction 注册失败（本地仍然有效）：${e?.message || e}`)
      }
      // 注销函数（幂等）。
      return () => {
        // 只删自己那一个（后注册者已经覆盖时不要误删）。
        if (actions.get(id) === fn) actions.delete(id)
        // 通知宿主。
        try {
          // 通知。
          sink?.offAction?.(id, modName)
        } catch {
          // 忽略。
        }
      }
    },

    // #hasAction：某个动作 id 有没有注册过（渲染器据此决定按钮是否禁用）。
    hasAction(id) {
      // 判断。
      return actions.has(id)
    },

    // #trigger：调用某个动作（渲染器点击时用；异常隔离由调用方负责，这里透传）。
    trigger(id, payload) {
      // 取回调。
      const fn = actions.get(id)
      // 没注册。
      if (!fn) throw new Error(`gameAPI.ui：动作 ${id} 没有注册处理函数`)
      // 调用（返回 Promise 时调用方 await）。
      return fn(payload)
    },

    // #dispose：清掉本实例的动作表（幂等，返回清掉的动作数）。
    // 注意：**已经交给宿主的界面声明不会因此消失**（宿主注册表由宿主管理）——
    // 这是刻意的：页面/面板是"静态结构"，不像钩子那样一局一变。
    dispose() {
      // 数量。
      const n = actions.size
      // 清空。
      actions.clear()
      // 返回。
      return n
    },
  }
}

// #createHookBus
// 创建钩子总线：注册/触发/移除，支持执行顺序与异常隔离。
//
// @returns {object} 钩子总线
export function createHookBus() {
  // 钩子映射：名称 → 回调**记录**数组。
  //
  // 记录形态（2026-10 能力补齐 ④）：`{ fn, modName, async }`。
  //   · `fn`      —— 回调本体（`off` 比的是它，所以对外行为与"数组里直接放函数"完全一致）；
  //   · `modName` —— 注册者（超时警告里要**指名道姓**，否则一句"某钩子超时"没法排查）；
  //   · `async`   —— 该回调是否走 await（由 `gameAPI.on(name, fn, { async: true })` 标记）。
  // 以前这里放的是裸函数。改成记录之后，`on/off/emit/emitSync/has/list` 的**对外语义一个字没变**
  // （既有回归用例原样绿），只是多了一条 `meta()` 给 `nextAsync()` 用。
  const hooks = {}

  // #push
  // 登记一条回调记录。
  //
  // @param {string} name - 钩子名
  // @param {Function} fn - 回调
  // @param {object} [opts] - { modName, async }
  // @returns {void}
  function push(name, fn, opts) {
    // 初始化数组。
    if (!hooks[name]) hooks[name] = []
    // 追加记录。
    hooks[name].push({ fn, modName: opts?.modName || '', async: opts?.async === true })
  }

  // 返回总线。
  return {
    // #on
    // 注册钩子。
    //
    // @param {string} name - 钩子名
    // @param {Function} fn - 回调
    // @param {object} [opts] - { modName?: string, async?: boolean }
    //   `async: true` = 这条回调在 `nextAsync()` 里要 await（由 `gameAPI.on` 按 manifest 的
    //   `async` / `asyncHooks` 自动标记；手写总线时也可以自己传）。
    // @returns {Function} 移除函数
    on(name, fn, opts) {
      // 登记。
      push(name, fn, opts)
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
      // 过滤移除（比的是记录里的 fn —— 与"数组里放函数"时同一套引用语义）。
      hooks[name] = hooks[name].filter(h => h.fn !== fn)
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
      for (const entry of hooks[name]) {
        // 异常隔离。
        try {
          // 执行并记录（await 支持 async 钩子）。
          results.push(await entry.fn(payload))
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
      for (const entry of hooks[name]) {
        // 异常隔离。
        try {
          // 同步调用（async 钩子的 Promise 直接入数组，不 await）。
          results.push(entry.fn(payload))
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

    // #meta
    // 某钩子的**逐回调元信息**（按注册顺序）：`[{ fn, modName, async }]`。
    //
    // 为什么需要它（2026-10 能力补齐 ④）：`nextAsync()` 只有拿到"这一条回调是不是
    // 异步 Mod 注册的"，才能决定 await 还是同步调用 —— 这就是 opt-in 的落点：
    // **没有 `async: true` 的 Mod，`nextAsync()` 里也是同步调用它**。
    //
    // @param {string} name - 钩子名
    // @returns {Array<{fn: Function, modName: string, async: boolean}>} 元信息（新数组）
    meta(name) {
      // 未注册 → 空。
      return (hooks[name] || []).map((h) => ({ fn: h.fn, modName: h.modName, async: h.async }))
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

// #DEFAULT_ASYNC_TIMEOUT_MS
// 单个异步钩子的缺省超时（毫秒）。
//
// 为什么必须有它：异步逐岁钩子的典型用法是"调一次后端/等一次宿主"，而**慢后端 = 卡死的游戏**。
// 缺省 3000ms 是"比任何合理首字节时间都宽松、但明显短于人类耐心的放弃阈值"。
export const DEFAULT_ASYNC_TIMEOUT_MS = 3000

// #resolveWithTimeout
// 给一个 thenable 套上超时。超时 → `{ timedOut: true }`；正常 → `{ ok: true, value }`；
// 抛错 → `{ error }`。**永不 reject**（调用方据此继续推进，绝不让慢后端把游戏卡死）。
//
// `timer` 是注入的定时器适配器（`{ setTimeout, clearTimeout }`，缺省取全局）：
// 单测要靠它精确验证"超时后确实继续、且定时器被清掉"。
//
// @param {*} value - Promise 或普通值
// @param {number} timeoutMs - 超时毫秒（<=0 / 非有限数 = 不设超时）
// @param {object} [params]
// @param {string} [params.name] - 钩子名（警告里用）
// @param {string} [params.modName] - Mod 名（警告里用；**要指名道姓**）
// @param {object} [params.log] - 日志器
// @param {object} [params.timer] - 定时器适配器
// @returns {Promise<{ok?: boolean, value?: *, timedOut?: boolean, ms?: number, error?: *}>} 结果
export async function resolveWithTimeout(value, timeoutMs, { name, modName, log, timer } = {}) {
  // 不是 thenable：同步值直接返回（同步回调走的也是这条）。
  if (!value || typeof value.then !== 'function') return { ok: true, value }
  // 有效超时。
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0
  // 无超时：直接等（作者显式关掉了保护）。
  if (ms <= 0) {
    try {
      // 等结果。
      return { ok: true, value: await value }
    } catch (error) {
      // 抛错照样隔离。
      return { error }
    }
  }
  // 定时器原语（缺省全局）。
  const t = timer || { setTimeout: (fn, m) => setTimeout(fn, m), clearTimeout: (id) => clearTimeout(id) }
  // 超时句柄。
  let handle = null
  // 竞速。
  const winner = await Promise.race([
    // 正常路径：包一层，异常也走"正常返回"，避免 Promise.race 因 reject 而短路掉另一个分支。
    value.then(
      (v) => ({ status: 'ok', value: v }),
      (e) => ({ status: 'error', error: e }),
    ),
    // 超时路径。
    new Promise((resolve) => {
      // 起定时器。
      handle = t.setTimeout(() => resolve({ status: 'timeout', ms }), ms)
    }),
  ])
  // 清掉定时器（不 clear 会在测试里留下未完成的计时器；浏览器里也是无意义的持有）。
  try { t.clearTimeout(handle) } catch { /* 忽略 */ }
  // 超时：记一条 warn 并继续推进（**不抛**）。
  if (winner.status === 'timeout') {
    // 出声：指名 Mod 与钩子（否则一句"某钩子超时"没法排查）。
    log?.warn?.(`异步钩子 ${name} 超时（${ms}ms，Mod ${modName || '未知'}）——已放弃这次等待并继续推进（超时的那段改动不会进轨迹）`)
    // 返回。
    return { timedOut: true, ms }
  }
  // 抛错：隔离（不让一个 Mod 的异常毁掉这一年）。
  if (winner.status === 'error') {
    // 出声。
    log?.warn?.(`异步钩子 ${name} 抛错（Mod ${modName || '未知'}）：${winner.error?.message || winner.error}`)
    // 返回。
    return { error: winner.error }
  }
  // 正常。
  return { ok: true, value: winner.value }
}

// #emitYearHooksAsync
// **逐岁钩子的异步分发**（`life.nextAsync()` 用）：按注册顺序触发，只 await 被标记为
// `async: true` 的回调，其余一律**同步调用**（保持"同步 Mod 行为不变"这条不变量）。
//
// 每条异步回调都套 `resolveWithTimeout` 的超时保护：慢/抛错都只出一条 warn，然后**继续推进**。
//
// @param {object} params
// @param {object} params.bus - 钩子总线（createHookBus 的产物；需有 `meta`）
// @param {string} params.name - 钩子名
// @param {*} params.payload - 负载（**引用传递**：钩子改的就是引擎随后读的那个对象）
// @param {object} [params.log] - 日志器
// @param {number} [params.timeoutMs] - 单个异步钩子的超时（缺省 DEFAULT_ASYNC_TIMEOUT_MS）
// @param {object} [params.timer] - 定时器适配器（测试注入）
// @returns {Promise<Array>} 各回调返回值的数组（超时/抛错的那条不进结果）
export async function emitYearHooksAsync({ bus, name, payload, log, timeoutMs, timer } = {}) {
  // 没有 meta（例如 CLI 传进来的极简替身总线）：退回同步广播，保证"钩子照样会被调用"。
  if (typeof bus?.meta !== 'function') {
    // 同步。
    bus?.emitSync?.(name, payload, log)
    // 无结果可报。
    return []
  }
  // 结果。
  const results = []
  // 逐条（按注册顺序）。
  for (const entry of bus.meta(name)) {
    // 同步回调：**与 next() 完全一样的调用方式**（没有额外的 await 点）。
    if (!entry.async) {
      // 异常隔离（与 emitSync 同一套语义）。
      try {
        // 调用。
        results.push(entry.fn(payload))
      } catch (e) {
        // 记录。
        log?.error?.(`钩子 ${name} 异常: ${e.message}`)
      }
      // 下一条。
      continue
    }
    // 异步回调：先调用（拿到 thenable），再带超时等待。
    let returned
    try {
      // 调用。
      returned = entry.fn(payload)
    } catch (e) {
      // 同步抛出：隔离。
      log?.warn?.(`异步钩子 ${name} 抛错（Mod ${entry.modName || '未知'}）：${e.message}`)
      // 下一条。
      continue
    }
    // 等（带超时；超时/抛错都只 warn）。
    const r = await resolveWithTimeout(returned, timeoutMs === undefined ? DEFAULT_ASYNC_TIMEOUT_MS : timeoutMs, {
      // 钩子名。
      name,
      // Mod 名。
      modName: entry.modName,
      // 日志器。
      log,
      // 定时器。
      timer,
    })
    // 正常完成才收结果（超时/抛错的不进结果 —— 免得调用方把半截结果当完整的用）。
    if (r.ok) results.push(r.value)
  }
  // 返回。
  return results
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
// @param {object} [deps.uiSink] - **界面注册表**（宿主注入；需有 `add(kind, item, modName)`，
//   可选 `onAction` / `offAction`）。缺省 → `gameAPI.ui.available === false`、
//   注册调用抛可读错误 —— 见 `createUiBridge`
// @param {object} [deps.log] - 日志器
// @param {object} [deps.manifest] - 本 Mod 的 manifest（**异步逐岁介入的 opt-in 来源**：
//   `async: true` + 可选 `asyncHooks` 决定本 Mod 的哪些逐岁钩子在 `nextAsync()` 里被 await，
//   见 mod/manifest.js 的 `hooksToAwait`）。不传 = 不是异步 Mod（行为与以前逐位相同）。
// @returns {object} gameAPI
export function createGameAPI({ data, hooks, ai, aiModFactory, params, host, property, asset, storage, uiSink, manifest, modName: _modName, log }) {
  // 日志器。
  const logger = log || { debug: () => {}, error: () => {} }
  // Mod 名（storage 命名空间 + 日志前缀用）。
  const modName = _modName || 'anonymous'
  // 本实例注册过的钩子（dispose 用）。
  const registrations = []
  // 本 Mod 的**异步逐岁策略**（2026-10 能力补齐 ④）：非异步 Mod → 空数组 → 注册的钩子
  // 全部按同步调用（于是 `nextAsync()` 里它的行为与 `next()` 一模一样）。
  const awaitHooks = hooksToAwait(manifest)
  // 该 Mod 用了异步逐岁介入吗（日志用）。
  const isAsyncMod = manifestAsync(manifest)
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
  // 界面桥（2026-10 能力补齐 ③）：把 `gameAPI.ui.*` 的注册交给宿主注册表（前端是
  // stores/extensions.js）。没注入 → 降级桥（`available: false`，注册调用抛可读错误）。
  //
  // 历史：这个键**以前根本不存在** —— `AGENTS.md` 边界 ① 写着"不能加界面"。
  const uiBridge = createUiBridge({ sink: uiSink, modName, log: logger })
  // 共享总线自检：属性变更通知是从 **Life 的总线**广播的（Property 由 Life 构造）。
  // 若调用方给 Life 传的不是这条总线，Mod 注册的 `propertyChange` 会**静默收不到**通知 ——
  // 这是很难查的一类问题，所以这里直接出声（不改语义：照样各用各的）。
  if (property && property.hooks && property.hooks !== hooks) {
    // 记 warn（调用方应把同一条总线同时给 Life 与 executeModCodes，`store.init` 就是这么做的）。
    logger.warn?.('gameAPI: property 桥挂在 Life 上，但 hooks 与 Life 的总线不是同一个对象 —— propertyChange 通知会发到 Life 的总线上，Mod 可能收不到')
  }

  // 异步逐岁介入的接线自检（2026-10 能力补齐 ④）：声明了 `async: true` 就说明一句，
  // 这样"我声明了异步但没人 await 我"这种失配能立刻在日志里看出来。
  if (isAsyncMod) {
    // 出声（info 级：这是正常的接线信息，不是问题）。
    logger.info?.(`[mod:${modName}] 异步逐岁介入已启用（async: true；将被 await 的钩子：${awaitHooks.join(', ') || '无'}）`)
  }

  // 返回 API。
  const api = {
    // 钩子系统（委托外部总线）。
    // `on` 会**记下本实例注册过的回调**，供 `dispose()` 一次性摘掉 —— 2026-10 能力补齐：
    // 以前 Mod 想卸载只能自己保存注销函数，漏摘就留下"幽灵钩子"。
    //
    // 异步逐岁介入（2026-10 能力补齐 ④）：本 Mod 声明了 `async: true` 且这个钩子名在
    // `asyncHooks`（或未细化 = 全部逐岁钩子）里 → 给这条回调打上 `async: true` 标记，
    // `life.nextAsync()` 就会 await 它（同步的 `life.next()` 一个字都不变）。
    on: (name, fn) => {
      // 登记（便于 dispose）。
      registrations.push([name, fn])
      // 委托总线（带元信息：谁注册的、要不要 await）。
      return bus.on(name, fn, { modName, async: awaitHooks.includes(name) })
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

    // 界面扩展（**Mod 能加界面**，2026-10 能力补齐 ③）。
    // 注入 `uiSink`（前端是 stores/extensions.js）→ `addPage/addPanel/addProperty/addStat`
    // 真的出现在界面上；没注入 → `available: false`、注册调用**抛可读错误**（不静默丢弃）。
    //
    // ⚠️ 运行期注册只有"一局游戏已经建好"之后才可能发生（启动时不执行 code.js）。
    //    要"所有时段都可见"就用 `manifest.ui` 静态声明（启动时收集）。
    ui: uiBridge,

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
