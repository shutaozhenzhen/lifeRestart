/**
 * ui-extensions — Mod 界面扩展的**收集 / 合并 / 查询**（纯函数，零 Vue/DOM import）
 *
 * 这是"Mod 能加界面"（2026-10 能力补齐 ③）的前端数据层。设计要点：
 *
 *   1. **两种注册源，同一个注册表**：
 *      · `manifest.ui`（静态声明）—— 应用**启动时**收集（`collectUiExtensions`），
 *        所以主页 / Mod 管理页这些"开局前"的页面也能看到 Mod 加的东西；
 *      · `gameAPI.ui.*`（运行期注册）—— `code.js` 执行时才可用（一局游戏已经建好），
 *        由 stores/extensions.js 的 `merge()` 追加同一张表，用于按条件显示。
 *      ⚠️ 差异必须记住：**manifest = 全时段可见；运行期 = 开局后可见**（启动时不执行 code.js）。
 *
 *   2. **只有四个扩展点**（与引擎 `mod/ui-schema.js` 的 schema 一一对应）：
 *      pages / panels / properties / stats。数量上限与 slot 白名单都在引擎侧校验，
 *      这里只做"收集 + 冲突规则 + 查询"，**不重复定义一份常量**（D3：同一份实现不许有两份）。
 *
 *   3. 冲突规则（**确定性**，见 `mergeUiExtensions`）：
 *      · 跨 Mod 同 id / 同 key → **后加载者胜**（与引擎"后加载覆盖先加载"的数据合并语义一致）；
 *      · 同一 Mod 内重复 id → 由引擎 schema 报错（这里再兜一层：**保留第一条并记 warn**）。
 */

// #EMPTY_EXTENSIONS
// 空注册表（四类都是空数组）。调用方可以无脑读，不用到处判空。
//
// @returns {object} 空注册表
export function emptyExtensions() {
  // 四类为空。
  return { pages: [], panels: [], properties: [], stats: [] }
}

// #hasUiDeclaration
// 这个 Mod 有没有声明任何界面扩展（决定"要不要进收集流程"）。
//
// ⚠️ 判据故意宽松：只要 `ui` 段**存在且是对象**就算"进流程"，哪怕里面写的是
//    非数组的垃圾值 —— 那种情况必须被**报出来**，不能因为"看起来没有声明"而静默跳过。
//
// @param {object} manifest - manifest 对象
// @returns {boolean} 是否声明了
export function hasUiDeclaration(manifest) {
  // 四类里任意一类非空就算声明了。
  const ui = manifest?.ui
  // 没有 ui 段。
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) return false
  // 只要有 ui 段（哪怕值为空数组/垃圾）就算进流程。
  return true
}

// #collectUiExtensions
// 从若干 Mod 的 manifest 收集界面扩展声明（**静态声明源**）。
//
// 输入形态：`[{ name, manifest }]`（与 `scanMods` / `loadModBundle` 的 `mods` 同形），
// 也接受直接的 manifest 数组（那时 name 从 manifest.name 取）。
//
// 坏数据（不是对象、ui 不是对象、某类不是数组、条目不是对象、id/title 缺失）**一律跳过后
// 记进 `errors`，绝不抛** —— 界面注册表坏了不该让整个应用白屏（启动路径上不允许抛）。
//
// ⚠️ 这里**不做上限与 slot 白名单校验**：那是引擎 `validateUiDeclaration` 的职责
//    （manifest 校验失败时这个 Mod 根本不会被加载）。这里只保证"喂给界面渲染器的东西形状正确"。
//
// @param {Array<object>} mods - Mod 列表（{ name, manifest } 或 manifest 本身）
// @returns {{pages: Array, panels: Array, properties: Array, stats: Array, errors: string[]}} 收集结果
export function collectUiExtensions(mods) {
  // 结果（每项都带上来源 Mod 名，供空态提示与排障）。
  const out = { ...emptyExtensions(), errors: [] }
  // 非数组输入。
  if (!Array.isArray(mods)) return out
  // 逐个 Mod。
  for (const entry of mods) {
    // 形态归一：{ name, manifest } 或直接 manifest。
    const manifest = entry?.manifest || entry
    // Mod 名（展示 + 冲突提示用）。
    const modName = entry?.name || manifest?.name || '(未命名)'
    // 没有声明就跳过（绝大多数 Mod 属于这一类）。
    if (!hasUiDeclaration(manifest)) continue
    // 逐类收集。
    for (const kind of ['pages', 'panels', 'properties', 'stats']) {
      // 该类的声明。
      const list = manifest.ui[kind]
      // 没写这一类 → 跳过（**不是错误**：`ui: { pages: [...] }` 只声明一类是完全正常的）。
      if (list === undefined || list === null) continue
      // 非数组。
      if (!Array.isArray(list)) {
        // 记错（不抛）。
        out.errors.push(`Mod ${modName} 的 ui.${kind} 不是数组，已跳过`)
        // 下一类。
        continue
      }
      // 逐个条目。
      for (const [i, item] of list.entries()) {
        // 必须是对象。
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          // 记错。
          out.errors.push(`Mod ${modName} 的 ui.${kind}[${i}] 不是对象，已跳过`)
          // 下一个。
          continue
        }
        // 标识键：属性/统计用 key，页面/面板用 id。
        const idKey = kind === 'properties' || kind === 'stats' ? 'key' : 'id'
        // 标识必须是非空字符串。
        if (typeof item[idKey] !== 'string' || item[idKey].trim().length === 0) {
          // 记错。
          out.errors.push(`Mod ${modName} 的 ui.${kind}[${i}] 缺少 ${idKey}，已跳过`)
          // 下一个。
          continue
        }
        // 收集（浅拷贝并补上来来源）。
        out[kind].push(cloneItem(kind, item, modName))
      }
    }
  }
  // 返回。
  return out
}

// #cloneItem
// 复制一条声明并补上来源 Mod 名（界面空态要说"这个页面属于 Mod X"）。
//
// @param {string} kind - 类别
// @param {object} item - 原始条目
// @param {string} modName - Mod 名
// @returns {object} 新条目
function cloneItem(kind, item, modName) {
  // 页面 / 面板带 blocks。
  if (kind === 'pages' || kind === 'panels') {
    // 复制（blocks 逐块浅拷贝：渲染器不该拿到原引用）。
    return {
      // id。
      id: item.id,
      // panel 专属：插槽。
      ...(kind === 'panels' ? { slot: item.slot } : {}),
      // 标题。
      title: item.title,
      // 内容块。
      blocks: Array.isArray(item.blocks) ? item.blocks.map((b) => ({ ...b })) : [],
      // 来源 Mod（空态提示 + 排障）。
      mod: modName,
    }
  }
  // 属性 / 统计。
  return {
    // key。
    key: item.key,
    // 标签。
    label: item.label,
    // 统计专属：kind（缺省 count，与引擎 schema 一致）。
    ...(kind === 'stats' ? { kind: item.kind === 'ratio' ? 'ratio' : 'count' } : {}),
    // 来源 Mod。
    mod: modName,
  }
}

// #mergeUiExtensions
// 把若干份注册表合并成一份（运行期注册就是"再合并一次"）。
//
// **冲突规则（确定性）**：同一类别里 id/key 相同 → **后出现者胜**（与引擎数据合并的
// "后加载覆盖先加载"语义一致：`list` 的顺序就是加载顺序，manifest 收集在前、运行期注册在后）。
// 同一份输入内部的重复 id：只有在**同一个 Mod**里才可能是笔误，但此处看不到分 Mod 的边界
// （运行期注册可以来自任意 Mod），所以统一按"后者胜 + 记 warn"处理 —— 引擎 schema 已经在
// 更早的地方把"同一 Mod 内重复 id"报成硬错误。
//
// @param {Array<object>} list - 若干份注册表（{ pages, panels, properties, stats }）
// @param {object} [options]
// @param {Function} [options.warn] - 警告回调（重复 id 时出声；缺省静默）
// @returns {object} 合并后的注册表（新对象）
export function mergeUiExtensions(list, { warn } = {}) {
  // 结果。
  const out = emptyExtensions()
  // 非数组输入。
  if (!Array.isArray(list)) return out
  // 逐份合并。
  for (const part of list) {
    // 空段跳过。
    if (!part || typeof part !== 'object') continue
    // 逐类。
    for (const kind of ['pages', 'panels', 'properties', 'stats']) {
      // 该段（非数组跳过）。
      if (!Array.isArray(part[kind])) continue
      // 标识键。
      const idKey = kind === 'properties' || kind === 'stats' ? 'key' : 'id'
      // 逐个条目。
      for (const item of part[kind]) {
        // 形状不对的跳过（收集阶段已经过滤过一次，这里兜底防运行期注册塞垃圾）。
        if (!item || typeof item !== 'object') continue
        // 缺标识。
        if (typeof item[idKey] !== 'string' || item[idKey].length === 0) continue
        // 已有同 id → 后者胜（覆盖到原位置，保持界面顺序稳定）。
        const at = out[kind].findIndex((x) => x[idKey] === item[idKey])
        // 命中。
        if (at !== -1) {
          // 出声（覆盖是明确规则，但静默覆盖会让人以为"我加的面板消失了"）。
          warn?.(`ui 扩展 ${kind} 的 ${idKey} "${item[idKey]}" 重复：后注册的覆盖先前的（Mod ${item.mod || '?'}）`)
          // 覆盖。
          out[kind][at] = { ...out[kind][at], ...item }
          // 下一个。
          continue
        }
        // 追加。
        out[kind].push({ ...item })
      }
    }
  }
  // 返回。
  return out
}

// #panelsForSlot
// 取某个 slot 的全部面板（按注册顺序；界面直接 v-for）。
//
// @param {object} merged - 合并后的注册表
// @param {string} slot - 插槽名（home / mods / property / game / summary / settings）
// @returns {Array<object>} 面板列表（新数组）
export function panelsForSlot(merged, slot) {
  // 过滤。
  return (merged?.panels || []).filter((p) => p && p.slot === slot)
}
