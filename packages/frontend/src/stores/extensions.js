/**
 * extensions store — Mod 界面扩展的注册表（应用启动时装载，运行期追加）
 *
 * 两种注册源汇进同一张表（2026-10 能力补齐 ③）：
 *   1. **启动时**：`load()` 读启用 Mod 的 manifest.ui（不需要先开局 → 主页 / Mod 管理页
 *      也能看到 Mod 加的东西）。挂在 `App.vue` 的 `onMounted`（与 LogDock / AchievementToast 同级）。
 *   2. **运行期**：`code.js` 里的 `gameAPI.ui.addPage/addPanel/...` 经 `append()` 追加
 *      （前端通过 `executeModCodes` 注入 `uiSink` → 本 store 的 `append`）。
 *      ⚠️ 运行期注册只有"一局游戏已经建好"之后才可能发生（启动时不执行 code.js），
 *      所以 **manifest = 全时段可见；运行期 = 开局后可见**。
 *
 * 健壮性要求（**启动路径，不许抛、不许白屏**）：
 *   · Mod 目录没同步（`index.json` 404）→ 空注册表；
 *   · 全部 Mod 被禁用 / 被完全移除 → 空注册表；
 *   · manifest 里的 ui 写坏 → 逐条进 `errors`（在日志面板里能看到），界面照常。
 */
import { defineStore } from 'pinia'
// Mod 发现 + 目录合并 + 状态读取（与游戏路径共用同一套实现）。
import { discoverMods } from '../utils/mod-runtime.js'
import { buildModCatalog } from '../utils/mod-catalog.js'
import { loadModsState, isModRemoved } from '../utils/mods-state.js'
// 已安装 Mod 的浏览器存储（与游戏路径同一份）。
import { getModStore } from '../utils/mod-store.js'
// 纯函数：收集 / 合并 / 查询（零 Vue 依赖，单独可测）。
import { collectUiExtensions, mergeUiExtensions, panelsForSlot, emptyExtensions } from '../utils/ui-extensions.js'

// #enabledByCatalog
// 判断一个 Mod 在"启停+移除"状态里是否启用（与游戏路径同一套判据）。
//
// 为什么不用 `enabledModNames(catalog)`：那个只看内置清单/发现表里**已在目录中**的项，
// 而 `discoverMods()` 的 `mods` 里还可能有一些目录构造时被过滤掉的项。这里逐个按
// `modsState`（`removed` 优先，其次 `enabled`，都没有则默认启用）判断，语义与
// `game-data.js` 的 `loadModState()` 一致。
//
// @param {string} name - Mod 名
// @param {{enabled: object, removed: string[]}} saved - 持久化状态
// @returns {boolean} 是否启用
function enabledBySaved(name, saved) {
  // 被完全移除 = 不加载（也不再贡献界面扩展）。
  if ((saved?.removed || []).includes(name)) return false
  // 显式禁用。
  if (saved?.enabled?.[name] === false) return false
  // 其余默认启用（与"第三方 Mod 装上就生效"一致）。
  return true
}

// 定义 store。
export const useExtensionsStore = defineStore('extensions', {
  // 状态。
  state: () => ({
    // **静态**注册表（来自 manifest.ui；启动时装载，换局不变）。
    base: emptyExtensions(),
    // **运行期**注册表（来自 gameAPI.ui.*；每局由 append 累积，换局时 reset）。
    runtime: emptyExtensions(),
    // 合并后的注册表（页面/组件只读这一份）。
    merged: emptyExtensions(),
    // 当前启用的 Mod 名（空态提示要判断"这个页面属于 Mod X，它当前未启用"）。
    enabled: [],
    // 启动时发现的所有 Mod 名（含被禁用的；空态提示的判据）。
    discovered: [],
    // 每个 Mod 的**原始**界面声明（即使它被禁用也记着）——用于"这个页面属于 Mod X，X 未启用"。
    // 形态：{ <mod 名>: { pages: [{id,title}], panels: [...], properties: [...], stats: [...] } }
    declared: {},
    // 坏数据 / 重复 id 的说明（日志里能看，不许静默）。
    errors: [],
    // 是否已装载（避免重复 load）。
    loaded: false,
    // 装载状态描述（日志/排障用）。
    status: '未装载',
  }),

  // 计算属性。
  getters: {
    // 某个 slot 的面板（界面直接 v-for）。
    // 注意：返回函数形式，调用方传 slot（pinia getter 不能带参，用返回函数表达）。
    panelsOf: (state) => (slot) => panelsForSlot(state.merged, slot),
    // 有没有任何界面扩展（决定"要不要渲染卡片容器"）。
    isEmpty: (state) => state.merged.pages.length === 0 && state.merged.panels.length === 0
      && state.merged.properties.length === 0 && state.merged.stats.length === 0,
  },

  // 动作。
  actions: {
    // #load
    // 应用启动时装载：读启用 Mod 的 manifest.ui（**不执行 code.js**）。
    //
    // 任何一步失败都只降级为"没有界面扩展"，绝不抛（这是启动路径）。
    //
    // @param {object} [deps]
    // @param {Function} [deps.fetchImpl] - fetch 替身（测试用）
    // @param {string} [deps.baseUrl] - Mod 根路径
    // @param {object} [deps.storage] - 存储适配器（缺省 localStorage）
    // @param {object} [deps.saved] - **直接给启停/移除状态**（跳过 storage 读取；测试与
    //   调用方已知状态时用，语义与 `loadModsState()` 的返回值一致）
    // @param {object} [deps.log] - 日志器（可选）
    // @returns {Promise<object>} 合并后的注册表
    async load({ fetchImpl, baseUrl, storage, saved: savedInput, log } = {}) {
      // 已装载（App 只会调一次；重复调用直接返回当前结果，避免重复请求）。
      if (this.loaded) return this.merged
      // 状态与错误重置（重新装载要重新算）。
      this.errors = []
      // 读启停/移除状态（调用方给了就用它）。
      let saved = savedInput || { enabled: {}, removed: [] }
      // 容错（localStorage 不可用等）。
      try {
        // 没给就用存储里的。
        if (!savedInput) saved = loadModsState(storage)
      } catch {
        // 保持缺省。
        saved = { enabled: {}, removed: [] }
      }
      // 发现的 Mod（失败 → 空，绝不抛）。
      let discovered = []
      try {
        // 本地已安装 Mod 的存储（无 IndexedDB 时它内部会退回内存）。
        const store = await getModStore().catch(() => null)
        // 发现（index.json 404 → createFetchSource 内部给空列表 + 错误信息）。
        const result = await discoverMods({ fetchImpl, baseUrl, store, log })
        // 取列表。
        discovered = result?.mods || []
        // 发现阶段的错误也记下来（例如"目录没同步"）。
        for (const e of result?.errors || []) this.errors.push(e)
      } catch (e) {
        // 记下原因（不抛）。
        this.errors.push(`Mod 发现失败（界面扩展为空）：${e?.message || e}`)
      }
      // 目录（合并内置清单 + 启停状态；仅用于展示/统计启用数）。
      let catalog = []
      try {
        // 构造（失败也不影响下面的逐个判断）。
        catalog = buildModCatalog({ discovered, saved })
      } catch {
        // 忽略（目录只是展示用）。
        catalog = []
      }
      // 启用判定：**逐个按** saved 判断（与游戏路径同一套语义）。
      const enabledMods = discovered.filter((m) => {
        // 目录名（发现项的主键）。
        const dir = m?.name
        // 名（manifest.name 可能不同）。
        const name = m?.manifest?.name
        // 两个名字都要过关（`removed` 记录的可能是目录名，也可能是 manifest.name）。
        return enabledBySaved(dir, saved) && !(name && name !== dir && isModRemoved(name, storage))
      })
      // 所有发现项的名字（含被禁用的）。
      this.discovered = discovered.map((m) => m?.name).filter(Boolean)
      // 启用名（展示用）。
      this.enabled = enabledMods.map((m) => m?.name).filter(Boolean)
      // 原始声明（**所有**发现项，含禁用的）：空态提示要用它说清"这个页面属于哪个 Mod"。
      this.declared = {}
      // 逐个记录（只记"声明了什么"，不记内容细节）。
      for (const m of discovered) {
        // 名字。
        const name = m?.name || m?.manifest?.name
        // 没名字跳过。
        if (!name) continue
        // 没声明跳过。
        const ui = m?.manifest?.ui
        // 记录形态（缺字段给空数组，渲染时不用判空）。
        if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
          // 存。
          this.declared[name] = {
            // 页面（只留 id/title，够做空态提示）。
            pages: Array.isArray(ui.pages) ? ui.pages.map((p) => ({ id: p?.id, title: p?.title })) : [],
            // 面板。
            panels: Array.isArray(ui.panels) ? ui.panels.map((p) => ({ id: p?.id, title: p?.title })) : [],
            // 属性。
            properties: Array.isArray(ui.properties) ? ui.properties.map((p) => ({ key: p?.key, label: p?.label })) : [],
            // 统计。
            stats: Array.isArray(ui.stats) ? ui.stats.map((p) => ({ key: p?.key, label: p?.label })) : [],
          }
        }
      }
      // 收集（**只收集启用的 Mod**；被禁用 = 它的界面扩展不出现，与内容数据一致）。
      const collected = collectUiExtensions(enabledMods)
      // 收集期间的坏数据说明带出来。
      for (const e of collected.errors) this.errors.push(e)
      // 静态注册表（去掉 errors 字段）。
      this.base = { pages: collected.pages, panels: collected.panels, properties: collected.properties, stats: collected.stats }
      // 运行期注册表清空（换一次装载 = 重新开始，运行期注册要重新发生）。
      this.runtime = emptyExtensions()
      // 合并。
      this.rebuild(log)
      // 标记。
      this.loaded = true
      // 状态描述。
      this.status = this.isEmpty
        ? `无界面扩展（启用 Mod ${this.enabled.length} 个：${this.enabled.join(', ') || '（无）'}）`
        : `已装载界面扩展：页面 ${this.merged.pages.length} / 面板 ${this.merged.panels.length} / 属性 ${this.merged.properties.length} / 统计 ${this.merged.stats.length}`
      // 返回。
      return this.merged
    },

    // #append
    // **运行期注册**（`gameAPI.ui.*` 的落点）：把一份声明追加进注册表。
    //
    // 冲突规则与合并一致（同 id 后者胜）；重复 id 会记一条 warn（不静默）。
    //
    // @param {object} part - 声明片段（{ pages?, panels?, properties?, stats? }）
    // @param {object} [options]
    // @param {string} [options.mod] - 来源 Mod 名（补进每条记录，便于排障与空态提示）
    // @param {object} [options.log] - 日志器
    // @returns {{ok: boolean, errors: string[]}} 结果
    append(part, { mod, log } = {}) {
      // 错误（形状不对的条目）。
      const errors = []
      // 形状检查（不抛：运行期注册出错不该炸游戏）。
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        // 报错。
        errors.push('gameAPI.ui 的注册内容必须是对象（{ pages, panels, properties, stats }）')
        // 记日志。
        log?.warn?.(`[UI][mod-ui] ${errors[0]}`)
        // 返回。
        return { ok: false, errors }
      }
      // 逐类追加（补上来源 Mod）。
      for (const kind of ['pages', 'panels', 'properties', 'stats']) {
        // 该类（非数组跳过）。
        if (!Array.isArray(part[kind])) continue
        // 逐条。
        for (const item of part[kind]) {
          // 非对象跳过。
          if (!item || typeof item !== 'object') {
            // 记错。
            errors.push(`ui.${kind} 里有一条不是对象，已跳过`)
            // 下一个。
            continue
          }
          // 收下（补 mod）。
          this.runtime[kind].push({ ...item, mod: mod || item.mod || '?' })
        }
      }
      // 重建合并表。
      this.rebuild(log)
      // 有错逐条记日志。
      for (const e of errors) {
        // 记错。
        this.errors.push(`运行期注册：${e}`)
        // 日志。
        log?.warn?.(`[UI][mod-ui] 运行期注册：${e}`)
      }
      // 返回。
      return { ok: errors.length === 0, errors }
    },

    // #rebuild
    // 重新计算合并表：静态（base）+ 运行期（runtime），后加载者胜。
    //
    // @param {object} [log] - 日志器
    // @returns {object} 合并后的注册表
    rebuild(log) {
      // 合并（重复 id 出声）。
      this.merged = mergeUiExtensions([this.base, this.runtime], { warn: (m) => { this.errors.push(m); log?.warn?.(`[UI][mod-ui] ${m}`) } })
      // 返回。
      return this.merged
    },

    // #beginRuntime
    // 开一局之前清掉上一局的**运行期**注册（静态声明 `base` 保留 —— 它来自 manifest，
    // 与"开不开局"无关）。
    //
    // @param {object} [log] - 日志器
    // @returns {void}
    beginRuntime(log) {
      // 清空运行期注册。
      this.runtime = emptyExtensions()
      // 重建合并表。
      this.rebuild(log)
    },

    // #uiSink
    // 交给 `executeModCodes` 的**界面注册表**（`gameAPI.ui.*` 的落点）。
    //
    // 形态是引擎侧 `createUiBridge` 约定的最小接口：
    //   `add(kind, item, modName)` + 可选 `onAction(id, fn, modName)` / `offAction(id, modName)`。
    //
    // 动作的查找不走这里：渲染器问的是**各 Mod 的 `gameAPI.ui` 桥**
    // （`stores/game.js` 的 `modUiBridges`）—— 桥自己持有动作表，天然按 Mod 隔离。
    //
    // @param {object} [deps]
    // @param {object} [deps.life] - Life 实例（提供 `addStatistic`：让 Mod 声明的统计键
    //   **真的产生**在 `life.statistics` 里）。没给 → `addStatistic` 记一条 warn 并返回 false
    //   （不抛：不该因为"统计登记不了"把整局游戏搞崩）
    // @returns {object} sink
    uiSink({ life } = {}) {
      // 返回。
      return {
        // 追加一条声明（kind = pages/panels/properties/stats）。
        add: (kind, item, mod) => {
          // 走统一的 append（内部按 kind 归类 + 重建合并表 + 记重复警告）。
          this.append({ [kind]: [item] }, { mod })
          // 返回。
          return item
        },
        // 真的产生统计键（Mod 的 `gameAPI.ui.addStatistic` → Life.addStatistic）。
        addStatistic: (key, value, judge) => {
          // 没有 Life 的统计登记能力 → 出声（不静默）。
          if (!life || typeof life.addStatistic !== 'function') {
            // 记进 errors（日志面板里能看到）。
            this.errors.push(`运行期注册：宿主没有统计登记能力，addStatistic(${key}) 被忽略`)
            // 失败。
            return false
          }
          // 转给 Life（内置键不可覆盖，它自己会记 warn）。
          return life.addStatistic(key, value, judge)
        },
      }
    },

    // #reload
    // 重新装载静态声明（Mod 启停/移除变化后调用；界面扩展要跟着"启用即出现、禁用即消失"）。
    //
    // @param {object} [deps] - 同 load
    // @returns {Promise<object>} 合并后的注册表
    async reload(deps) {
      // 清装载标记再走一次 load。
      this.loaded = false
      // 重新装载。
      return this.load(deps)
    },

    // #reset
    // 清空注册表（重置数据 / 测试用）。装载标记也一起清（下次 load 会重新发现）。
    //
    // @returns {void}
    reset() {
      // 全清。
      this.base = emptyExtensions()
      this.runtime = emptyExtensions()
      this.merged = emptyExtensions()
      this.enabled = []
      this.discovered = []
      this.declared = {}
      this.errors = []
      this.loaded = false
      this.status = '未装载'
    },

    // #findPage
    // 找一个页面声明（`/mods/page/:id` 的查询）。
    //
    // @param {string} id - 页面 id
    // @returns {object|null} 页面声明（含 mod 名）或 null
    findPage(id) {
      // 查。
      return this.merged.pages.find((p) => p.id === id) || null
    },

    // #explainMissingPage
    // 页面找不到时给出**可读**原因（"这个页面属于 Mod X，它当前未启用"）。
    //
    // @param {string} id - 页面 id
    // @returns {string} 原因文案
    explainMissingPage(id) {
      // 在所有 Mod 的原始声明里找这个页面 id。
      for (const [mod, decl] of Object.entries(this.declared)) {
        // 命中。
        if ((decl.pages || []).some((p) => p?.id === id)) {
          // 该 Mod 是不是被禁用了（启用列表里没有它）。
          const on = this.enabled.includes(mod)
          // 启用状态与 merged 不一致 = 被禁用/被移除。
          return on
            ? `这个页面属于 Mod ${mod}，但它的声明没能载入（多半是 manifest.ui 校验没过，见日志面板）`
            : `这个页面属于 Mod ${mod}，它当前未启用（去「Mod 管理」页启用它）`
        }
      }
      // 没有任何 Mod 声明过它。
      return `没有找到 id 为「${id}」的 Mod 页面（它可能来自一个已卸载 / 已完全移除的 Mod）`
    },
  },
})
