/**
 * mod/host-node — Node 侧的宿主桥适配器（seam #3 的 host-node 实现）
 *
 * 职责：把 `mods/<name>/server.js` 里注册的**命名处理器**变成宿主桥可调用的目标。
 *
 * 权限模型（设计文档第一节，已实证）：**完全权限，不设白名单**。
 *   server.js 是普通 ESM 模块，随便 `import('node:fs')` / `child_process` / 原生模块。
 *   本模块只负责"加载 + 注册 + 找到那个函数 + 调它并归一化错误"，
 *   **不做**能力校验、路径限制、沙箱（那是设计明确不做的范围）。
 *
 * 为什么用真 `import()` 而不是像 code.js 那样 `new Function`：
 *   server.js 是 ESM（`export default`），且"完全 Node 权限"本就意味着它是一种
 *   一等模块 —— 用真的模块系统加载，语法/相对导入/缓存都按 Node 语义走。
 *
 * 与浏览器侧的分工：
 *   浏览器侧 code.js 拿 `gameAPI.host`（本模块产出的桥），`host.call(...)` → 这里的 handlers。
 *   静态站没有本模块 → 用 createDenyHost()，`host.available` 为空（降级契约）。
 */

// Node 内置：判断入口文件是否存在。
import { existsSync } from 'node:fs'
// Node 内置：拼路径。
import { join } from 'node:path'
// Node 内置：文件路径 → file:// URL（import() 需要）。
import { pathToFileURL } from 'node:url'
// manifest 取值助手（默认值只在那里定义一次）。
import { manifestEntry, manifestTargets } from './manifest.js'

// #parseHint
// 解析类失败的补充提示。
//
// 为什么需要：`.js` 是 CJS 还是 ESM 由**就近的 package.json 的 type 字段**决定。
// 忘了声明时，`export default` 会在 Node 原生加载器下报 SyntaxError（"Unexpected
// token 'export'"）；而经 Vite/vitest 加载时抛的是普通 Error（"invalid JS syntax"）。
// 两种都归为"解析失败"，给出同一句可操作提示 —— 但措辞必须留有余地，
// 因为解析失败也可能是真的写错了（不能一律断言"就是 CJS/ESM 问题"）。
//
// @param {Error} e - 捕获到的错误
// @returns {string} 提示（不需要时为空串）
function parseHint(e) {
  // 错误信息。
  const msg = String(e?.message ?? '')
  // 判定是否解析类失败（兼容原生 SyntaxError 与打包器的普通 Error）。
  const isParseError =
    e instanceof SyntaxError ||
    /invalid JS syntax|Unexpected token|Unexpected identifier|Unexpected reserved word|Cannot use import statement|Unexpected end of input/i.test(msg)
  // 需要提示才给。
  return isParseError
    ? '（若报的是 export/import 相关语法错误，通常是该文件被当成 CommonJS 解析：请在 Mods 目录放 {"type":"module"} 的 package.json，或把入口文件名改成 .mjs）'
    : ''
}

// #createNodeHost
// 扫描给定的 Mod 列表，加载其中声明了 node 目标者的 server.js，收集其处理器。
//
// @param {object} params
// @param {string} params.modsDir - Mods 根目录（server.js 相对它解析）
// @param {Array<{name: string, manifest: object}>} [params.mods] - 来自 loader 的 Mod 元信息
// @param {object} [params.log] - 日志器
// @returns {Promise<{available: string[], errors: string[], handlersOf: Function, call: Function}>} 适配器
export async function createNodeHost({ modsDir, mods = [], log } = {}) {
  // 日志器（缺省静默，与项目其它模块一致）。
  const logger = log || { debug: () => {}, info: () => {}, error: () => {} }
  // 注册表：Mod 名 → { handlers: Map, file: string }
  const registry = new Map()
  // 加载期错误（逐 Mod 隔离，不因一个 Mod 坏掉就整体失败）。
  const errors = []

  // 逐个 Mod。
  for (const m of mods) {
    // 没声明 node 目标 → 与宿主无关，跳过。
    if (!manifestTargets(m?.manifest).includes('node')) continue
    // 该 Mod 声明的后端入口文件名。
    const rel = manifestEntry(m.manifest, 'node')
    // 声明了 node 却给不出入口名（entry.node 缺失）→ 记录。
    if (!rel) {
      // 记录。
      errors.push(`Mod ${m.name} 声明了 node 目标但缺少 entry.node`)
      // 下一个。
      continue
    }
    // 绝对路径。
    const abs = join(modsDir, m.name, rel)
    // 文件不存在。
    if (!existsSync(abs)) {
      // 记录。
      errors.push(`Mod ${m.name} 的 node 入口不存在: ${m.name}/${rel}`)
      // 下一个。
      continue
    }
    // 该 Mod 的处理器表。
    const handlers = new Map()

    // #handle
    // server.js 用它注册处理器（同名后注册覆盖先注册，与"后加载覆盖"一致）。
    //
    // @param {string} name - 处理器名
    // @param {Function} fn - 处理函数 (args) => any | Promise<any>
    const handle = (name, fn) => {
      // 名字校验。
      if (typeof name !== 'string' || name.length === 0) throw new Error('处理器名必须是非空字符串')
      // 函数校验。
      if (typeof fn !== 'function') throw new Error(`处理器 ${name} 必须是函数`)
      // 同名覆盖提示（不报错：允许，但要说出来）。
      if (handlers.has(name)) logger.debug(`宿主 Mod ${m.name} 覆盖处理器: ${name}`)
      // 登记。
      handlers.set(name, fn)
    }

    // 加载并初始化（异常隔离）。
    try {
      // 真模块加载。
      const mod = await import(pathToFileURL(abs).href)
      // 取默认导出。
      const setup = mod.default
      // 必须是函数。
      if (typeof setup !== 'function') {
        // 记录。
        errors.push(`Mod ${m.name} 的 ${rel} 必须 export default 一个 setup 函数`)
        // 下一个。
        continue
      }
      // 执行 setup（把 handle 交给 Mod）。
      await setup({ handle, log: logger, modsDir, name: m.name })
      // 登记进注册表。
      registry.set(m.name, { handlers, file: rel })
      // 日志。
      logger.debug(`宿主 Mod 已注册: ${m.name}（${handlers.size} 个处理器）`)
    } catch (e) {
      // 解析类失败（含 CJS/ESM 误判）单独给出可操作的提示。
      const hint = parseHint(e)
      // 记录（不影响其它 Mod）。
      errors.push(`Mod ${m.name} 的 ${rel} 加载失败: ${e.message}${hint}`)
      // 日志。
      logger.error(`宿主 Mod ${m.name} 加载失败: ${e.message}${hint}`)
    }
  }

  // 返回适配器（available / call 供 createHostBridge 消费；errors / handlersOf 供诊断与 CLI）。
  return {
    // 在线 Mod 名。
    available: [...registry.keys()],
    // 加载期错误（可读，供 UI/CLI 呈现）。
    errors,

    // #handlersOf
    // 列出某 Mod 注册的处理器名（诊断/CLI 用；未注册返回空数组）。
    //
    // @param {string} name - Mod 名
    // @returns {string[]} 处理器名
    handlersOf(name) {
      // 取记录。
      const rec = registry.get(name)
      // 无记录。
      return rec ? [...rec.handlers.keys()] : []
    },

    // #call
    // 调用某 Mod 的某处理器。
    //
    // @param {string} name - Mod 名
    // @param {string} handler - 处理器名
    // @param {*} [args] - 参数（同进程按引用传递，不强制 JSON）
    // @returns {Promise<*>} 返回值
    async call(name, handler, args) {
      // 找 Mod。
      const rec = registry.get(name)
      // 未注册（直接使用适配器时才会走到这里；经宿主桥调用时桥已先拦截）。
      if (!rec) throw new Error(`宿主 Mod 未注册: ${name}`)
      // 找处理器。
      const fn = rec.handlers.get(handler)
      // 未注册该处理器（**不带 Mod 名前缀**：宿主桥会补上「Mod X 处理器 Y 失败」，
      // 这里再加一次就成了 "Mod X ... Mod X ..." 的重复噪音）。
      if (!fn) {
        // 报错（带上该 Mod 现有的处理器名，便于定位拼写错误）。
        const known = [...rec.handlers.keys()]
        throw new Error(`未注册处理器: ${handler}（现有：${known.length ? known.join(', ') : '无'}）`)
      }
      // 调用（await 兼容同步与异步处理器）。
      return await fn(args)
    },
  }
}
