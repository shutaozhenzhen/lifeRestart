/**
 * Mod 界面扩展的 **schema 校验**（2026-10 能力补齐 ③）
 *
 * 背景（这条曾经是硬边界）：`AGENTS.md` 的边界 ① 写着"**不能加界面**——没有页面/组件/路由/
 * 属性面板注册 API"。属性清单、统计项、页面结构全是前端源码硬编码。现在 Mod 可以在两个
 * **注册源**里声明界面扩展，本模块负责**引擎侧的 schema 校验**（前端只消费规范化后的结果）：
 *
 *   1. `manifest.ui`（静态声明）—— 应用**启动时**就收集，不需要先开一局。
 *      所以主页 / Mod 管理页这些"开局前"的页面也能看到 Mod 加的东西。
 *   2. `gameAPI.ui.*`（运行期注册）—— `code.js` 执行时才可用（即"一局游戏已经建好"），
 *      用于按条件显示。两条路的产物在前端**汇进同一个注册表**。
 *
 * ⚠️ **为什么不在启动时执行 `code.js`**：它需要 Life（`param.define` 要注册表），而且
 *    重复执行会让钩子/数据重复注册。于是两者有明确差异（文档里如实写明）：
 *      manifest 声明 = 全时段可见；运行期注册 = 开局后可见。
 *
 * 支持的扩展点（**只有这四个**，别在这里加第五个）：
 *   pages      [{ id, title, blocks: [...] }]            → 页面 `/mods/page/:id`
 *   panels     [{ id, slot, title, blocks: [...] }]      → 插到指定 slot 的一张卡片
 *   properties [{ key, label }]                          → 属性分配面板多一行
 *   stats      [{ key, label, kind: 'count'|'ratio' }]   → 总结页统计多一项
 *
 * `blocks` 复用**文档页那套块类型**（前端 `components/DocBlocks.vue`；本模块只校验
 * "是非空数组"，逐块字段由文档侧的既有约定管）。
 */

// #UI_SLOTS
// 合法插槽白名单（panels 的 slot 只能取这里的值）。
//
// ⚠️ 写别的值是**校验错误**，不是静默忽略 —— "面板不出现、也没有任何提示"是最难查的一类问题。
// ⚠️ 白名单里有 slot，**不等于界面上真的挂了那个位置**（见前端文档：目前只挂了 home / mods）。
//    校验与注册先支持全部六个，界面按需逐个挂载，这样以后挂载不需要改 manifest schema。
export const UI_SLOTS = ['home', 'mods', 'property', 'game', 'summary', 'settings']

// #UI_LIMITS
// 数量上限（防"一个 Mod 塞 200 个面板"）。超限**报错**并说明上限，不是截断。
export const UI_LIMITS = {
  // 每类扩展点各自的条数上限。
  pages: 8,
  panels: 8,
  properties: 8,
  stats: 8,
  // 单个页面/面板的块数上限（一个声明不该比整份文档还长）。
  blocks: 64,
}

// #UI_KINDS
// 统计项的类型（count 原样显示；ratio 按 0~1 显示成百分比）。
export const UI_KINDS = ['count', 'ratio']

// #EMPTY_UI
// 空声明（没有任何界面扩展时的规范形态；调用方可以无脑读，不用到处判空）。
//
// @returns {object} 规范化后的空声明
export function emptyUiDeclaration() {
  // 四类都是空数组。
  return { pages: [], panels: [], properties: [], stats: [] }
}

// #isPlainObject
// 是不是"普通对象"（数组 / null / 函数都不算）。
//
// @param {*} v - 待判断值
// @returns {boolean} 是否普通对象
function isPlainObject(v) {
  // 排除 null 与数组（typeof 函数是 'function'，也会被挡掉）。
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

// #isNonEmptyString
// 是不是非空字符串（首尾空白不算内容）。
//
// @param {*} v - 待判断值
// @returns {boolean} 是否非空字符串
function isNonEmptyString(v) {
  // 判断。
  return typeof v === 'string' && v.trim().length > 0
}

// #normalizeBlocks
// 规范化 blocks（复制成新数组；非法的返回 null 让调用方报错）。
//
// @param {*} blocks - 原始 blocks
// @returns {Array|null} 新数组或 null
function normalizeBlocks(blocks) {
  // 必须是非空数组。
  if (!Array.isArray(blocks) || blocks.length === 0) return null
  // 逐块必须是对象（块类型/字段由前端渲染器负责，未知块会显式显示"未知内容块类型"）。
  if (!blocks.every((b) => isPlainObject(b))) return null
  // 浅拷贝每个块（不交出调用方的引用）。
  return blocks.map((b) => ({ ...b }))
}

// #validateUiDeclaration
// 校验并**规范化** `manifest.ui`（或等价的运行期声明集合）。
//
// 返回值里的 `ui` 一定是可安全读写的四元组（`{ pages, panels, properties, stats }`），
// 且每一项都已复制 —— 调用方拿到的不是 manifest 里的引用。
//
// @param {*} ui - manifest.ui 原文（未声明时 undefined）
// @returns {{ok: boolean, errors: string[], ui: object}} 校验结果
export function validateUiDeclaration(ui) {
  // 错误列表。
  const errors = []
  // 未声明：合法的"没有界面扩展"。
  if (ui === undefined || ui === null) return { ok: true, errors, ui: emptyUiDeclaration() }
  // 必须是对象（非数组）。
  if (!isPlainObject(ui)) {
    // 报错（可操作：告诉它应该长什么样）。
    return { ok: false, errors: ['ui 必须是对象（{ pages, panels, properties, stats }）'], ui: emptyUiDeclaration() }
  }
  // 未知键（写错名字会让整段静默失效，所以出声）。
  for (const key of Object.keys(ui)) {
    // 不在支持范围。
    if (!Object.prototype.hasOwnProperty.call(UI_LIMITS, key)) {
      // 报错。
      errors.push(`ui 含未知字段: ${key}（支持：pages / panels / properties / stats）`)
    }
  }
  // 结果容器。
  const out = emptyUiDeclaration()

  // ---------- 通用：逐条校验 + 上限 ----------
  // #checkList
  // 校验一类扩展点的数组形态与上限。
  //
  // @param {string} kind - 类别名（pages/panels/properties/stats）
  // @returns {Array|null} 合法时返回原数组，非法返回 null
  const checkList = (kind) => {
    // 未声明 → 空。
    if (ui[kind] === undefined) return []
    // 必须是数组。
    if (!Array.isArray(ui[kind])) {
      // 报错（指出应该是什么）。
      errors.push(`ui.${kind} 必须是数组`)
      // 无效。
      return null
    }
    // 上限（超限报错并说明上限，不截断）。
    if (ui[kind].length > UI_LIMITS[kind]) {
      // 报错。
      errors.push(`ui.${kind} 最多 ${UI_LIMITS[kind]} 项（当前 ${ui[kind].length} 项）`)
      // 无效。
      return null
    }
    // 合法。
    return ui[kind]
  }

  // #checkId
  // 校验一个扩展项的 id：必须是非空字符串 + **同一 Mod 内唯一**。
  //
  // @param {string} kind - 类别名
  // @param {number} i - 下标（错误信息定位用）
  // @param {object} item - 条目
  // @param {Set<string>} seen - 已见 id 集合（跨类别共用：id 是页面的 URL 段/面板的键，
  //   同类内撞车必然出错；跨类别撞车同样是笔误，一起挡掉更安全）
  // @returns {string|null} 合法时返回 id
  const checkId = (kind, i, item, seen) => {
    // 非对象。
    if (!isPlainObject(item)) {
      // 报错。
      errors.push(`ui.${kind}[${i}] 必须是对象`)
      // 无效。
      return null
    }
    // id 必须是非空字符串。
    if (!isNonEmptyString(item.id)) {
      // 报错。
      errors.push(`ui.${kind}[${i}].id 必须是非空字符串`)
      // 无效。
      return null
    }
    // 同一 Mod 内重复 id → 直接报错（"谁覆盖谁"在这里没有合理答案）。
    if (seen.has(item.id)) {
      // 报错。
      errors.push(`ui.${kind}[${i}].id "${item.id}" 与前面某个扩展项重复（id 在同一个 Mod 内必须唯一）`)
      // 无效。
      return null
    }
    // 记录。
    seen.add(item.id)
    // 合法。
    return item.id
  }

  // ---------- pages ----------
  // 已见 id（跨类别共享一份，见 checkId 的说明）。
  const seen = new Set()
  // 页面列表。
  const pages = checkList('pages')
  // 逐页（列表非法时跳过，错误已经记过）。
  for (const [i, page] of (pages || []).entries()) {
    // id。
    if (!checkId('pages', i, page, seen)) continue
    // 标题（页头要显示）。
    if (!isNonEmptyString(page.title)) {
      // 报错。
      errors.push(`ui.pages[${i}].title 必须是非空字符串（页面要有个标题）`)
      // 下一页。
      continue
    }
    // 内容块。
    const blocks = normalizeBlocks(page.blocks)
    // 非法。
    if (!blocks) {
      // 报错。
      errors.push(`ui.pages[${i}].blocks 必须是非空的内容块数组（块类型见文档页：p/sub/note/list/table/code/link/api/action）`)
      // 下一页。
      continue
    }
    // 块数上限。
    if (blocks.length > UI_LIMITS.blocks) {
      // 报错。
      errors.push(`ui.pages[${i}].blocks 最多 ${UI_LIMITS.blocks} 块（当前 ${blocks.length} 块）`)
      // 下一页。
      continue
    }
    // 收下。
    out.pages.push({ id: page.id, title: page.title, blocks })
  }

  // ---------- panels ----------
  // 面板列表。
  const panels = checkList('panels')
  // 逐个。
  for (const [i, panel] of (panels || []).entries()) {
    // id。
    if (!checkId('panels', i, panel, seen)) continue
    // slot 白名单。
    if (!isNonEmptyString(panel.slot) || !UI_SLOTS.includes(panel.slot)) {
      // 报错（**可操作**：把合法值列出来）。
      errors.push(`ui.panels[${i}].slot "${panel.slot}" 不是合法 slot（可用：${UI_SLOTS.join('/')}）`)
      // 下一个。
      continue
    }
    // 标题。
    if (!isNonEmptyString(panel.title)) {
      // 报错。
      errors.push(`ui.panels[${i}].title 必须是非空字符串（卡片要有个标题）`)
      // 下一个。
      continue
    }
    // 内容块。
    const blocks = normalizeBlocks(panel.blocks)
    // 非法。
    if (!blocks) {
      // 报错。
      errors.push(`ui.panels[${i}].blocks 必须是非空的内容块数组（块类型见文档页：p/sub/note/list/table/code/link/api/action）`)
      // 下一个。
      continue
    }
    // 块数上限。
    if (blocks.length > UI_LIMITS.blocks) {
      // 报错。
      errors.push(`ui.panels[${i}].blocks 最多 ${UI_LIMITS.blocks} 块（当前 ${blocks.length} 块）`)
      // 下一个。
      continue
    }
    // 收下（补上 slot）。
    out.panels.push({ id: panel.id, slot: panel.slot, title: panel.title, blocks })
  }

  // ---------- properties ----------
  // 属性列表。
  const properties = checkList('properties')
  // 逐个。
  for (const [i, prop] of (properties || []).entries()) {
    // id（属性用 key，但唯一性判据同样是"这个 Mod 内的标识"）。
    if (!isPlainObject(prop)) {
      // 报错。
      errors.push(`ui.properties[${i}] 必须是对象（{ key, label }）`)
      // 下一个。
      continue
    }
    // key 必须是非空字符串。
    if (!isNonEmptyString(prop.key)) {
      // 报错。
      errors.push(`ui.properties[${i}].key 必须是非空字符串（= 参数名，如 CHR / LUCK）`)
      // 下一个。
      continue
    }
    // 同一 Mod 内重复 key。
    if (seen.has(prop.key)) {
      // 报错。
      errors.push(`ui.properties[${i}].key "${prop.key}" 与前面某个扩展项重复（id 在同一个 Mod 内必须唯一）`)
      // 下一个。
      continue
    }
    // 记录。
    seen.add(prop.key)
    // label 必须是非空字符串（中文标签是这一行的显示文本）。
    if (!isNonEmptyString(prop.label)) {
      // 报错。
      errors.push(`ui.properties[${i}].label 必须是非空字符串（属性行的显示名）`)
      // 下一个。
      continue
    }
    // 收下。
    out.properties.push({ key: prop.key, label: prop.label })
  }

  // ---------- stats ----------
  // 统计列表。
  const stats = checkList('stats')
  // 逐个。
  for (const [i, stat] of (stats || []).entries()) {
    // 对象 + key 唯一。
    if (!isPlainObject(stat)) {
      // 报错。
      errors.push(`ui.stats[${i}] 必须是对象（{ key, label, kind }）`)
      // 下一个。
      continue
    }
    // key 必须是非空字符串。
    if (!isNonEmptyString(stat.key)) {
      // 报错。
      errors.push(`ui.stats[${i}].key 必须是非空字符串（= 引擎 life.statistics 里的键）`)
      // 下一个。
      continue
    }
    // 同一 Mod 内重复 key。
    if (seen.has(stat.key)) {
      // 报错。
      errors.push(`ui.stats[${i}].key "${stat.key}" 与前面某个扩展项重复（id 在同一个 Mod 内必须唯一）`)
      // 下一个。
      continue
    }
    // 记录。
    seen.add(stat.key)
    // label。
    if (!isNonEmptyString(stat.label)) {
      // 报错。
      errors.push(`ui.stats[${i}].label 必须是非空字符串（统计行的显示名）`)
      // 下一个。
      continue
    }
    // kind 白名单（缺省 count，与引擎 statistics 里"计数居多"的事实一致）。
    const kind = stat.kind === undefined ? 'count' : stat.kind
    // 非法。
    if (!UI_KINDS.includes(kind)) {
      // 报错。
      errors.push(`ui.stats[${i}].kind "${stat.kind}" 不是合法类型（可用：${UI_KINDS.join('/')}）`)
      // 下一个。
      continue
    }
    // 收下。
    out.stats.push({ key: stat.key, label: stat.label, kind })
  }

  // 返回。
  return { ok: errors.length === 0, errors, ui: out }
}

// #uiPages / #uiPanels / #uiProperties / #uiStats
// 四个取值助手（与 `getTargets` / `getEntry` 一类同样的风格）：
// 校验通过就用规范化结果，没写 / 写坏就用空数组 —— **调用方不用到处判空**。
//
// 为什么要"写坏也给空数组"而不是抛：manifest 校验已经会把错误报出来（`validateManifest`），
// 取值助手是给"已经通过校验"的路径用的；这里保持与 `manifestTargets()` 同样的宽容语义。
//
// @param {object} manifest - manifest 对象
// @returns {Array} 规范化后的数组（新数组）
export function uiPages(manifest) {
  // 校验并取。
  return validateUiDeclaration(manifest?.ui).ui.pages
}

// 面板。
export function uiPanels(manifest) {
  // 同上。
  return validateUiDeclaration(manifest?.ui).ui.panels
}

// 属性项。
export function uiProperties(manifest) {
  // 同上。
  return validateUiDeclaration(manifest?.ui).ui.properties
}

// 统计项。
export function uiStats(manifest) {
  // 同上。
  return validateUiDeclaration(manifest?.ui).ui.stats
}

// #manifestUi
// 取**规范化后的整份**界面声明（一个模组一次校验，比调四个助手更省）。
//
// @param {object} manifest - manifest 对象
// @returns {{pages: Array, panels: Array, properties: Array, stats: Array}} 规范化声明
export function manifestUi(manifest) {
  // 校验并返回规范化结果。
  return validateUiDeclaration(manifest?.ui).ui
}
