/**
 * asset-text — 轨迹文本里的**受控资源占位符**解析（2026-10 能力补齐 ②）
 *
 * 语法：`{{asset:相对路径}}`，例如
 *   `你捡到一张明信片 {{asset:assets/postcard.png}}——上面画着海边。`
 *
 * 为什么需要它：Mod 包的图片不能直接"写进文本"（文本是字符串，图片是字节）。
 * 占位符是**唯一**把两者连起来的受控通道：Mod 作者写路径，引擎/界面把它换成
 * `<img src="blob:...">`。资源 URL **只能来自 `gameAPI.asset.url()`**
 * （也就是只能来自**本 Mod 包内**）—— 这是 XSS 边界的一部分：
 * 不认 `http(s):`、不认 `data:`、不认 `javascript:`，也不认绝对路径与 `..`。
 *
 * 三条硬规则：
 *   1. **纯函数**：本模块只做字符串切分，不做 IO、不碰 DOM（`resolveAssetText` 只依赖
 *      注入的 getter）—— 因此能在 node 环境直接单测。
 *   2. **只认严格正则**：不认识的形式原样当普通文本（`{{asset:../x}}`、
 *      `{{asset:http://evil/x.png}}` 都只是"字面上的这些字符"，不触发任何读取）。
 *   3. **渲染侧绝不用 `v-html`**：切分结果的消费方（GameView）用真 `<img>` 元素渲染，
 *      文本片段走插值 —— 这样"文本里带 HTML"永远不可能被当成标签执行。
 */

// #ASSET_PATH_PATTERN
// 占位符的正则（**严格**）。
//
// 路径允许：字母/数字/`_`/`-`/`.`/`/`，且不能有 `..` 段、不能以 `/` 开头、
// 不能有反斜杠（在字符类里就没放进来）、不能有 `:`（挡掉 `http:` / `data:`）。
// 不允许空路径（至少一个字符）。
//
// 为什么不用宽松的 `[^}]+` 再在代码里校验：宽松匹配会把"作者的笔误"也切成资源片段
// （然后渲染成一个破图），而严格匹配让笔误**原样显示在轨迹里** —— 作者一眼就能看出
// 自己写错了，用户也不会看到破图。
//
// 前面那个 `(?<!\{)`（负向后顾）是必要的：没有它，`{{{asset:a.png}}}`（多打了一个花括号）
// 会被匹配到**中间那两个**花括号并切出一个资源片段，剩下的 `{` 与 `}` 变成文本 ——
// 于是"写法不标准"变成了"渲染出一张图"，正是严格匹配想避免的事。
export const ASSET_PATH_PATTERN = /(?<!\{)\{\{asset:([A-Za-z0-9_][A-Za-z0-9_./-]*)\}\}/g

// #isSafeAssetPath
// 路径安全校验（与引擎 `asset-bridge.js` 的 `isSafeAssetPath` 同一套规则）。
//
// ⚠️ 为什么这里要**再写一份**：这是渲染侧的入口（引擎侧那份管的是"读"）。
// 两份规则必须一致，`asset-text.spec.js` 用同一组样本逐个核对，
// 避免"正则放进来、引擎读不到"这种半通状态。
//
// @param {string} path - 相对路径
// @returns {boolean} 是否安全
export function isSafeAssetPath(path) {
  // 必须是字符串且非空。
  if (typeof path !== 'string' || path === '') return false
  // 反斜杠。
  if (path.includes('\\')) return false
  // 前导斜杠（绝对路径）。
  if (path.startsWith('/')) return false
  // 盘符。
  if (/^[a-zA-Z]:/.test(path)) return false
  // 逐段（`.` 与 `..` 都拒绝；空段也拒绝）。
  for (const seg of path.split('/')) {
    // 空段。
    if (seg === '') return false
    // 点段。
    if (seg === '.' || seg === '..') return false
  }
  // 通过。
  return true
}

// #splitAssetText
// 把一段文本切成片段数组。
//
// 返回 `[{ type: 'text', text }]` 与 `[{ type: 'asset', path }]` 的**交替序列**
// （保证：片段里的 text 拼起来 + 占位符原文 = 输入，不会有字符被丢掉）。
//
// @param {string} input - 待切分的文本
// @returns {Array<{type: 'text', text: string}|{type: 'asset', path: string}>} 片段
export function splitAssetText(input) {
  // 非字符串（undefined / null / 数字）→ 空数组（调用方按"没有内容"处理）。
  if (typeof input !== 'string') return []
  // 空串。
  if (input === '') return []
  // 结果。
  const parts = []
  // 上一次匹配的结束位置。
  let last = 0
  // 重置正则的 lastIndex（正则带 g，是模块级共享的 —— 不重置会漏匹配）。
  ASSET_PATH_PATTERN.lastIndex = 0
  // 逐个匹配。
  let m
  // 循环。
  while ((m = ASSET_PATH_PATTERN.exec(input)) !== null) {
    // 路径。
    const path = m[1]
    // 正则虽然严格，但仍要过一遍路径校验（两份规则保持同步的最后一道）。
    if (!isSafeAssetPath(path)) continue
    // 占位符之前的普通文本。
    if (m.index > last) parts.push({ type: 'text', text: input.slice(last, m.index) })
    // 资源片段。
    parts.push({ type: 'asset', path })
    // 推进。
    last = m.index + m[0].length
  }
  // 结尾还有普通文本。
  if (last < input.length) parts.push({ type: 'text', text: input.slice(last) })
  // 一个都没匹配到 → 整段都是文本（**保持原样**）。
  if (parts.length === 0) return [{ type: 'text', text: input }]
  // 返回。
  return parts
}

// #hasAssetPlaceholder
// 这段文本里有没有（合法的）资源占位符。
//
// @param {string} input - 文本
// @returns {boolean} 有 → true
export function hasAssetPlaceholder(input) {
  // 直接看切分结果里有没有资源片段。
  return splitAssetText(input).some((p) => p.type === 'asset')
}

// #collectAssetPaths
// 从任意嵌套结构里收集**出现过的**资源路径（去重，保持出现顺序）。
//
// 用途：`store.trackAssets()` 拿它扫一遍轨迹，知道要为哪几个路径解析 URL ——
// 而不是把整段轨迹 JSON 化再正则（那样会把转义后的 `\"` 也算进去）。
//
// @param {*} value - 任意值（数组/对象/字符串）
// @returns {string[]} 路径数组
export function collectAssetPaths(value) {
  // 结果 + 去重集合。
  const out = []
  const seen = new Set()
  // 递归。
  const walk = (v) => {
    // 字符串：切分并收集。
    if (typeof v === 'string') {
      // 切。
      for (const part of splitAssetText(v)) {
        // 只要资源片段。
        if (part.type !== 'asset') continue
        // 去重。
        if (seen.has(part.path)) continue
        // 记录。
        seen.add(part.path)
        out.push(part.path)
      }
      // 完。
      return
    }
    // 数组：逐个进。
    if (Array.isArray(v)) {
      // 递归。
      for (const item of v) walk(item)
      // 完。
      return
    }
    // 对象：逐值进（**不碰键**：键名不是文本内容）。
    if (v && typeof v === 'object') {
      // 逐值。
      for (const item of Object.values(v)) walk(item)
    }
  }
  // 走。
  walk(value)
  // 返回。
  return out
}

// #resolveAssetText
// 把一段文本解析成"可直接渲染"的片段（文本片段 + 带 URL 的资源片段）。
//
// 资源缺失时的表现（**明确取舍**）：这个占位符**原样保留为文本**。
//   · 为什么原样保留而不是显示"（图片缺失）"：作者/玩家看到的原文是 `{{asset:x.png}}`，
//     能直接照着去查路径写错没有；换成一句中文提示就丢失了"是哪个路径"这个信息。
//   · 无论哪种情况都**不抛错、不产生 undefined**（页面永远不会因为资源缺失而白屏）。
//
// @param {string} text - 文本
// @param {object} params
// @param {(path: string) => (string|null)} params.getUrl - 同步取 URL（`store.assetUrl`）
// @returns {Array<{type:'text', text:string}|{type:'asset', path:string, url:string|null}>} 片段
export function resolveAssetText(text, { getUrl } = {}) {
  // 逐片段。
  return splitAssetText(text).map((part) => {
    // 文本片段原样。
    if (part.type === 'text') return part
    // 取 URL（getter 缺失 → 视为"没有资源能力"）。
    let url = null
    // 尝试。
    try {
      // 调。
      url = typeof getUrl === 'function' ? getUrl(part.path) : null
    } catch {
      // 取 URL 失败按"缺失"处理（占位符原样显示，不炸页面）。
      url = null
    }
    // 资源片段（url 为 null 时消费方渲染 `{{asset:path}}` 原文）。
    return { type: 'asset', path: part.path, url: typeof url === 'string' ? url : null }
  })
}
