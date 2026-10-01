/**
 * mod/source-fetch — 浏览器侧的 Mod 文件源（HTTP 实现）
 *
 * 与 source-node 实现同一个源接口，因此浏览器与 CLI 跑的是**同一套 Mod 加载逻辑**
 * （manifest 校验、依赖拓扑、数据合并、code.js 执行、错误隔离）。
 *
 * HTTP 无法"列目录"，所以需要一个索引文件：
 *   <baseUrl>/index.json          → ["base-mod", "fun-mod", ...]（或 { mods: [...] }）
 *   <baseUrl>/<mod>/files.json    → ["manifest.json", "code.js", ...]（可选；用于避免 404 探测）
 *   <baseUrl>/<mod>/manifest.json
 *   <baseUrl>/<mod>/code.js
 *   <baseUrl>/<mod>/<age|talents|events|achievements|characters>.json
 *
 * index.json 缺失时返回空列表（调用方据此回退到"无 Mod"路径，不报错）。
 */

// #createFetchSource
// 创建基于 HTTP 的 Mod 源。
//
// @param {object} params
// @param {string} [params.baseUrl] - Mod 根路径（缺省 '/mods/'）
// @param {Function} [params.fetchImpl] - fetch 实现（缺省全局 fetch；测试可注入）
// @param {object} [params.log] - 日志器
// @returns {{listMods: Function, listFiles: Function, readText: Function, kind: string}} 源
export function createFetchSource({ baseUrl = '/mods/', fetchImpl, log } = {}) {
  // fetch 实现。
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  // 根路径规范化（保证以 / 结尾）。
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  // 索引缓存（一次加载内不重复请求）。
  let indexCache = null
  // 文件清单缓存（按 Mod）。
  const filesCache = new Map()

  // #readText：读文本（404/异常 → null）。
  async function readText(mod, rel) {
    // 无 fetch（老环境）。
    if (!doFetch) return null
    // URL：注意 mod 为空时不能拼出 `/mods//index.json` 这种双斜杠（部分静态服务器会 404）。
    const url = mod ? `${base}${mod}/${rel}` : `${base}${rel}`
    // 请求。
    try {
      // 请求。
      const res = await doFetch(url)
      // 不存在（不同实现返回 404 或 ok=false）。
      if (!res || res.ok === false || res.status === 404) return null
      // 取文本。
      return await res.text()
    } catch {
      // 网络异常按"不存在"处理（由调用方决定是否回退）。
      return null
    }
  }

  // #readJson：读 JSON（失败返回 null）。
  async function readJson(mod, rel) {
    // 文本。
    const text = await readText(mod, rel)
    // 无内容。
    if (text === null) return null
    // 解析。
    try {
      // 返回对象。
      return JSON.parse(text)
    } catch (e) {
      // 记录（便于定位坏 JSON）。
      if (log?.error) log.error(`  ${mod}/${rel} 解析失败: ${e.message}`)
      // 失败。
      return null
    }
  }

  // 返回源。
  return {
    // 源类型。
    kind: 'fetch',
    // #listMods：从 index.json 读 Mod 列表。
    async listMods() {
      // 有缓存。
      if (indexCache) return indexCache
      // 读索引。
      const index = await readJson('', 'index.json')
      // 支持数组与 { mods: [...] } 两种写法。
      const list = Array.isArray(index)
        ? index
        : Array.isArray(index?.mods)
          ? index.mods.map((m) => (typeof m === 'string' ? m : m?.name)).filter(Boolean)
          : []
      // 缓存。
      indexCache = list
      // 返回。
      return list
    },
    // #listFiles：读 files.json（无则返回 null，由 loader 按约定清单探测）。
    async listFiles(mod) {
      // 有缓存。
      if (filesCache.has(mod)) return filesCache.get(mod)
      // 读清单。
      const files = await readJson(mod, 'files.json')
      // 规范化（数组才认）。
      const list = Array.isArray(files) ? files.map((f) => String(f)) : null
      // 缓存。
      filesCache.set(mod, list)
      // 返回。
      return list
    },
    // #readText：读文本。
    readText,
  }
}
