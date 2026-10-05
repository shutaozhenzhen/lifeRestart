/**
 * mod-runtime — 浏览器侧的 Mod 运行时（把 Mod 支持从前端能做的部分全部接上）
 *
 * 与 CLI 的关系：**同一个引擎内核**（game-engine/src/mod/loader.js + manifest 校验 +
 * 依赖拓扑 + 数据合并 + code.js 执行），只是文件源换成 HTTP（source-fetch）。
 *
 * 为什么要分两阶段（关键设计）：
 *   1. `loadModBundle()`：加载所有启用 Mod 的**数据与代码文本**（不执行），
 *      数据合并进游戏数据 —— 必须在 Life.initial() 之前完成（引擎开局时读数据）。
 *   2. `executeModCodes()`：等 Life 建好之后执行 code.js，把 `life.params` 作为
 *      `gameAPI.param` 注入 —— Mod 于是能**注册新属性**、读写参数、注册钩子。
 *   （CLI 里之所以能一步完成，是因为那边没有"参数注册表必须先有 Life"的限制；
 *     浏览器里 Life 由 store 构造，所以拆成两阶段。）
 */

// 引擎：Mod 加载内核 + HTTP 文件源 + 钩子/API + AI 客户端与工厂 + zip 解析。
import { createModLoader, scanMods } from 'game-engine/src/mod/loader.js'
import { createFetchSource } from 'game-engine/src/mod/source-fetch.js'
import { readModPackage } from 'game-engine/src/mod/zip.js'
import { createHookBus, createGameAPI } from 'game-engine/src/mod/gameapi.js'
// 运行时模块注册表（依赖随包分发、运行期解析；见引擎的 mod/modules.js）。
import { createModuleRegistry, createDenyRequire } from 'game-engine/src/mod/modules.js'
import { createAIClient } from 'game-engine/src/ai/ai-client.js'
import { createAIMod } from 'game-engine/src/ai/ai-mod.js'

// #resolveSitePath
// 把"相对站点根的路径"解析成可直接请求的 URL 前缀（**必须拼 BASE_URL**）。
//
// ⚠️ 这里踩过一次线上坑（2026-10，GitHub Pages 实测）：Mod 根路径曾写死 `/mods/`。
// dev 里站点根就是 `/`，一切正常；但 Pages 部署在**子路径** `/lifeRestart/` 下，
// `/mods/...` 会请求到**域名根** → 404，整条 Mod 链路静默失效：
//   · Mod 管理页"可用 Mod 0 个"（`index.json` 404，只剩内置清单的卡片）
//   · 点「查看数据」全是"未找到"（`manifest.json` 404）
//   · 游戏里的 Mod 数据与代码也不加载（只有 `data/` 的原版数据还在）
// 判断标准很简单：**这个前缀会不会被 fetch** —— 会，就必须过这里。
//
// @param {string} rel - 相对站点根的路径（如 `mods/`、`data`）
// @param {string} [baseUrl] - 站点基础路径（dev `/`、Pages `./`；缺省 import.meta.env.BASE_URL）
// @returns {string} URL 前缀（以 / 结尾）
export function resolveSitePath(rel, baseUrl) {
  // 基础路径（与 utils/game-data.js 的 fetchOriginalData 同一套规则）。
  const base = String(baseUrl !== undefined ? baseUrl : (import.meta.env.BASE_URL || '/'))
  // 相对路径：**剥掉前导斜杠** —— 留着就变成"域名根"，正是上面那个坑。
  const clean = String(rel).replace(/^\/+/, '')
  // 拼（两侧都保证有 /）。
  return `${base.endsWith('/') ? base : `${base}/`}${clean.endsWith('/') ? clean : `${clean}/`}`
}

// Mod 静态资源根路径（由 scripts/sync-mods.mjs 生成到 `<BASE_URL>mods/`）。
// dev = `/mods/`，Pages = `./mods/`（相对当前文档，子路径部署下自动正确）。
export const MODS_BASE_URL = resolveSitePath('mods/')

// #NATIVE_AI_PROXY_PORT
// 移动端（Capacitor 壳）里内置 Node 运行时监听的端口。
//
// ⚠️ 三处必须一致（有契约测试 platforms/mobile/nodejs-contract.spec.js 逐个解析比对）：
//   1. 这里（前端请求地址）
//   2. platforms/mobile/android-patch/java/com/liferestart/mobile/NodeRuntime.java 的 PROXY_PORT
//   3. platforms/mobile/nodejs/main.js 的默认端口
export const NATIVE_AI_PROXY_PORT = 8787

// #resolveAIProxyBase
// 解析 AI 代理地址（纯函数，便于测试；三种运行环境优先级从高到低）：
//   1. Electron 桌面版：主进程通过 preload 注入 window.electronAIProxy.baseUrl
//   2. Capacitor 移动端：App 内嵌 Node 运行时（nodejs-mobile）监听 127.0.0.1:NATIVE_AI_PROXY_PORT
//      —— 移动端没有 vite 代理，必须给**绝对地址**；WebView 里页面是 https://localhost，
//         访问 http://127.0.0.1 属于混合内容，靠 capacitor.config.json 的
//         android.allowMixedContent 放行（明文 HTTP 则由 network_security_config 只对回环放行）
//   3. 浏览器/Web 单进程版：vite 代理或平台内嵌服务的 /ai-proxy 前缀
//
// @param {object} [params]
// @param {object} [params.window] - 注入的 window（测试用）
// @param {string} [params.viteProxy] - 构建期注入的代理地址
// @returns {string} 代理根地址（不含 /v1）
export function resolveAIProxyBase({ window: win = globalThis.window, viteProxy = import.meta.env?.VITE_AI_PROXY } = {}) {
  // 1) Electron 注入（桌面版）。
  const electronBase = win?.electronAIProxy?.baseUrl
  if (electronBase) return electronBase
  // 2) Capacitor 原生壳（Android/iOS）：App 内嵌 Node 运行时。
  if (win?.Capacitor?.isNativePlatform?.()) return `http://127.0.0.1:${NATIVE_AI_PROXY_PORT}`
  // 3) 构建期注入 → 默认前缀。
  return viteProxy || '/ai-proxy'
}

// AI 代理地址（运行时解析一次；纯逻辑在 resolveAIProxyBase 里，可单测）。
export const AI_PROXY_BASE = resolveAIProxyBase()

// #readAIConfig
// 读取 Mod 管理页保存的 AI 配置（localStorage 键 aiConfig）。
//
// @param {object} [storage] - 存储适配器（缺省 localStorage）
// @returns {object|null} { provider, apiKey, baseUrl, model }；未配置 Key 返回 null
export function readAIConfig(storage) {
  // 读取。
  try {
    // 解析。
    const cfg = JSON.parse((storage || localStorage).getItem('aiConfig'))
    // 没 Key 视为未配置（ai-mod 的 code.js 会自行跳过）。
    if (!cfg || !cfg.apiKey) return null
    // 返回。
    return cfg
  } catch {
    // 无配置。
    return null
  }
}

// #createBrowserAIConfig
// 构造给 gameAPI 的 AI 配置（走本地代理，避免浏览器直连服务商 + CORS）。
//
// 代理协议（见 game-engine/server.js）：POST /v1/chat/completions，
// body 需要 provider / apiKey / model / messages。引擎的 ai-client 只发标准 OpenAI 字段，
// 因此这里注入一个 fetch 包装，把 provider 与 apiKey 补进 body。
//
// @param {object} params
// @param {object} params.config - readAIConfig 的结果
// @param {string} [params.proxyBase] - 代理地址
// @param {Function} [params.fetchImpl] - fetch 实现（测试注入）
// @returns {object|null} { client, baseUrl, apiKey, model }；无法构造返回 null
export function createBrowserAIConfig({ config, proxyBase = AI_PROXY_BASE, fetchImpl } = {}) {
  // 无配置。
  if (!config?.apiKey) return null
  // fetch 实现。
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  // 老环境无 fetch。
  if (!doFetch) return null
  // 包装 fetch：补 provider / apiKey 到 body（代理据此路由）。
  const client = createAIClient({
    // 包装。
    fetch: async (url, init = {}) => {
      // 解析原 body。
      let body = {}
      // 有 body 才解析。
      if (init.body) {
        // 解析失败按空对象（让代理给出可读错误）。
        try { body = JSON.parse(init.body) } catch { body = {} }
      }
      // 补字段并转发。
      return doFetch(url, { ...init, body: JSON.stringify({ ...body, provider: config.provider, apiKey: config.apiKey }) })
    },
  })
  // baseUrl 指向代理的 /v1（ai-client 会拼 /chat/completions）。
  return { client, baseUrl: `${String(proxyBase).replace(/\/$/, '')}/v1`, apiKey: config.apiKey, model: config.model }
}

// #createBlobModuleLoader
// 浏览器侧的**运行时模块**加载适配器：把随包分发的依赖（自包含单文件）变成模块命名空间。
//
// 为什么用 blob URL：zip 安装到 IndexedDB 的 Mod **没有 URL**，只有文件文本；
// `import()` 需要一个 URL，于是把文本包成 Blob 再造一个 `blob:` URL。
//
// ⚠️ **依赖必须是自包含单文件**（硬要求）：`blob:http://…/uuid` 没有目录基准，
// 依赖内部的相对导入（`./inner.js`）会解析成不存在的 `blob:http://…/inner.js` 而失败。
// 这条限制是方案选择的直接后果，不是实现偷懒。
//
// @param {object} [deps] - 注入点（测试用；缺省用全局 Blob/URL/import）
// @returns {Function} load({ id, path, code, modName }) => Promise<namespace>（带 dispose()）
export function createBlobModuleLoader({ createObjectURL, revokeObjectURL, importModule } = {}) {
  // 三个平台原语（可注入，便于在 happy-dom 下单测）。
  const makeUrl = createObjectURL || ((blob) => URL.createObjectURL(blob))
  const dropUrl = revokeObjectURL || ((url) => URL.revokeObjectURL?.(url))
  // `/* @vite-ignore */`：这是运行时才决定的 URL，别让打包器去静态分析它。
  const doImport = importModule || ((url) => import(/* @vite-ignore */ url))
  // 造出来的 URL（便于用完释放）。
  const urls = []
  // 适配器。
  const load = async ({ code }) => {
    // 包成 JS Blob 并造 URL。
    const url = makeUrl(new Blob([code], { type: 'text/javascript' }))
    // 记录。
    urls.push(url)
    // 导入。
    try {
      // 等模块求值完成。
      return await doImport(url)
    } catch (e) {
      // 补上"为什么"（最常见的成因就是依赖不是单文件）。
      throw new Error(`${e.message}（浏览器侧依赖必须是自包含单文件：blob URL 没有目录基准，依赖内部的相对导入会失败）`)
    }
  }
  // #dispose：释放所有 blob URL（页面卸载/Mod 卸载时调用；不释放会一直占内存）。
  load.dispose = () => {
    // 逐个释放。
    for (const url of urls) dropUrl(url)
    // 清空。
    urls.length = 0
  }
  // 返回。
  return load
}

// #createStoreSource
// 把"已安装 Mod 存储"（mod-store）适配成文件源。
//
// @param {object} store - mod-store 实例
// @returns {object} 源
export function createStoreSource(store) {
  // 返回源。
  return {
    // 类型。
    kind: 'store',
    // 已安装的 Mod 名。
    async listMods() {
      // 列表。
      return (await store.list()).map((m) => m.name)
    },
    // 文件清单。
    async listFiles(mod) {
      // 委托。
      return store.listFiles(mod)
    },
    // 读文本。
    async readText(mod, rel) {
      // 委托。
      return store.readText(mod, rel)
    },
  }
}

// #createCompositeSource
// 组合多个源：Mod 列表取并集，读文件按顺序命中即返回（**本地已安装优先**）。
//
// @param {Array<object>} sources - 源列表（前面的优先）
// @returns {object} 源
export function createCompositeSource(sources = []) {
  // 过滤空源。
  const list = sources.filter(Boolean)
  // 返回源。
  return {
    // 类型。
    kind: 'composite',
    // Mod 名并集（保持先后顺序）。
    async listMods() {
      // 结果。
      const names = []
      // 逐个源。
      for (const source of list) {
        // 读列表（源自身失败不影响其它源）。
        let part = []
        // 容错。
        try {
          // 读。
          part = (await source.listMods()) || []
        } catch {
          // 忽略该源。
          part = []
        }
        // 去重合并。
        for (const name of part) if (!names.includes(name)) names.push(name)
      }
      // 返回。
      return names
    },
    // 文件清单：第一个非 null 的源胜出。
    async listFiles(mod) {
      // 逐个源。
      for (const source of list) {
        // 尝试。
        try {
          // 读。
          const files = await source.listFiles(mod)
          // 命中。
          if (files) return files
        } catch {
          // 继续下一个源。
        }
      }
      // 都没命中。
      return null
    },
    // 读文本：第一个非 null 的源胜出。
    async readText(mod, rel) {
      // 逐个源。
      for (const source of list) {
        // 尝试。
        try {
          // 读。
          const text = await source.readText(mod, rel)
          // 命中。
          if (text !== null && text !== undefined) return text
        } catch {
          // 继续下一个源。
        }
      }
      // 都没命中。
      return null
    },
  }
}

// #createBrowserModSource
// 组装浏览器侧的 Mod 文件源：**本地已安装优先** → 服务器（HTTP）。
//
// 为什么收敛成一处：`discoverMods` / `loadModBundle` / `mod-detail` 都要同一个源，
// 各写一遍必然分叉（本仓库反复踩过的坑：同一件事有两份实现）。
//
// @param {object} [params]
// @param {string} [params.baseUrl] - Mod 根路径
// @param {Function} [params.fetchImpl] - fetch 实现（测试注入）
// @param {object} [params.store] - 已安装 Mod 的本地存储（可选）
// @param {object} [params.log] - 日志器
// @returns {object} 文件源（无 store 时就是纯 HTTP 源）
export function createBrowserModSource({ baseUrl = MODS_BASE_URL, fetchImpl, store, log } = {}) {
  // HTTP 源。
  const http = createFetchSource({ baseUrl, fetchImpl, log })
  // 有本地存储就组合（**本地优先**）。
  return store ? createCompositeSource([createStoreSource(store), http]) : http
}

// #SYSTEM_MOD_NAMES
// 系统 Mod 的名字（保留名）：**不允许被 zip 覆盖**，否则会把数据源（lifeRestart-data）
// 或 AI 通道（ai-mod）顶掉。
//
// 为什么做成常量而不是写在函数里：导出（`mod-export.js` 的「下载」按钮）也要用它来
// 告诉用户"系统 Mod 的包装回来前得改 manifest.name" —— 两份清单迟早会分叉。
export const SYSTEM_MOD_NAMES = ['lifeRestart-data', 'ai-mod']

// #installModFromZip
// 从 zip 安装 Mod 到本地存储（**前端 zip 安装的入口**）。
// 解析/校验/安全防护都在引擎的 zip 模块里（与 CLI 的 manager.importZip 同一实现）。
//
// 系统 Mod 名（`SYSTEM_MOD_NAMES`）默认**拒绝**：防"随手一个 zip 静默顶掉数据源 / AI 通道"。
// 但调用方可以显式 `allowSystem: true` 放行 —— Mod 管理页在**用户二次确认后**才这么传，
// 支撑「完全移除 → 重新上传 zip 装回来」这条闭环（这不是访问控制，见 `_准则_Mod设计.md` B3：
// 挡的是误操作，不是权限）。
//
// @param {object} params
// @param {Uint8Array|ArrayBuffer} params.bytes - zip 内容
// @param {object} params.store - mod-store 实例
// @param {object} [params.log] - 日志器
// @param {boolean} [params.allowSystem] - 是否允许安装系统 Mod 名（缺省 false）
// @returns {Promise<{ok: boolean, name?: string, manifest?: object, system?: boolean, errors: string[], files?: number, binaries?: string[]}>} 结果
export async function installModFromZip({ bytes, store, log, allowSystem = false } = {}) {
  // 解析（共用的 zip 模块）。
  const parsed = readModPackage(bytes, { log })
  // 失败。
  if (!parsed.ok) return { ok: false, errors: parsed.errors }
  // 是不是系统 Mod 名（供调用方决定要不要问用户）。
  const system = SYSTEM_MOD_NAMES.includes(parsed.name)
  // 系统 Mod 名保留：不允许**未经确认**用 zip 覆盖内置/系统 Mod（避免把数据源或 ai-mod 顶掉）。
  if (system && !allowSystem) {
    // 拒绝（带上 system 标记，界面据此弹"确认后重试"）。
    return { ok: false, system: true, name: parsed.name, errors: [`${parsed.name} 是系统 Mod，不能被 zip 覆盖（要装请二次确认，或先改 manifest.name）`] }
  }
  // 写入本地存储。
  await store.install({ name: parsed.name, manifest: parsed.manifest, files: parsed.files })
  // 返回（把路径/尺寸警告一并带出）。
  return {
    // 成功。
    ok: true,
    // 名字。
    name: parsed.name,
    // manifest（界面展示权限用）。
    manifest: parsed.manifest,
    // 系统 Mod 名（界面据此提示"这是覆盖了系统预装"）。
    system,
    // 警告。
    errors: [...parsed.errors, ...(parsed.skipped || []).map((s) => `已跳过：${s}`)],
    // 文件数。
    files: Object.keys(parsed.files).length,
    // 非文本文件提示。
    binaries: parsed.binaries || [],
  }
}

// #discoverMods
// 只做"发现"：列出服务器上可用的 Mod（供 Mod 管理页展示 + 计算启用集合）。
//
// @param {object} [params]
// @param {string} [params.baseUrl] - Mod 根路径
// @param {Function} [params.fetchImpl] - fetch 实现
// @param {object} [params.log] - 日志器
// @returns {Promise<{mods: Array<{name: string, manifest: object}>, errors: string[]}>} 发现结果
export async function discoverMods({ baseUrl = MODS_BASE_URL, fetchImpl, log, store } = {}) {
  // 源：有本地存储就组合（**本地已安装优先**），否则纯 HTTP。
  const source = createBrowserModSource({ baseUrl, fetchImpl, store, log })
  // 扫描。
  return scanMods({ source, log })
}

// #loadModBundle
// 阶段一：加载启用 Mod 的数据与代码文本（不执行代码）。
//
// @param {object} [params]
// @param {string} [params.baseUrl] - Mod 根路径
// @param {Function} [params.fetchImpl] - fetch 实现（测试注入）
// @param {string[]} [params.enabled] - 启用的 Mod 名（缺省全加载）
// @param {object} [params.log] - 日志器
// @returns {Promise<{data: object, codes: Array<{name: string, code: string}>, loaded: string[], disabled: string[], errors: string[], hooks: object}>} 结果
export async function loadModBundle({ baseUrl = MODS_BASE_URL, fetchImpl, enabled, log, store } = {}) {
  // 钩子总线（一次游戏一个：所有 Mod 共享，Life 也注入它）。
  const hooks = createHookBus()
  // 文件源（本地已安装优先 → HTTP）。
  const source = createBrowserModSource({ baseUrl, fetchImpl, store, log })
  // 加载器（只加载启用的 Mod）。
  const loader = await createModLoader({ source, log, only: enabled })
  // 加载数据与代码（**不**执行 code：浏览器要等 Life 建好拿 params）。
  const { data, codeList, errors } = await loader.loadAll()
  // 只保留有代码的项。
  const codes = codeList.filter((c) => c.code).map((c) => ({ name: c.name, code: c.code }))
  // 阶段一附加：为每个 Mod 建好**运行时模块**注册表（依赖随包分发、运行期解析）。
  //
  // 为什么放在这里而不是 executeModCodes 里：模块加载是**异步**的，而 executeModCodes
  // 要同步执行 code.js（注入的 require 必须立刻可用）。两阶段架构天然适合：
  // 阶段一加载模块文本（本函数），阶段二同步执行。
  const moduleLoader = createBlobModuleLoader()
  // 每个 Mod 的 require（同步取用）。
  const requires = {}
  // 模块加载错误（一路带到报告，不许静默）。
  const moduleErrors = []
  // 逐个 Mod（按拓扑顺序）。
  for (const name of loader.order) {
    // 找它的 manifest。
    const mod = loader.mods.find((m) => m.name === name)
    // 建注册表。
    const reg = await createModuleRegistry({ modName: name, manifest: mod?.manifest, source, load: moduleLoader, log })
    // 记录 require（没声明 modules 时它也是可用的 deny 版）。
    requires[name] = reg.require
    // 收集错误。
    for (const e of reg.errors) moduleErrors.push(`Mod ${name}: ${e}`)
  }
  // 返回。
  return {
    // 合并后的 Mod 数据（调用方合并进游戏数据）。
    data,
    // 待执行代码。
    codes,
    // 每个 Mod 的 require（阶段二注入给 code.js）。
    requires,
    // blob URL 释放器（页面/Mod 卸载时调用）。
    disposeModules: moduleLoader.dispose,
    // 实际加载的 Mod（按拓扑顺序）。
    loaded: [...loader.order],
    // 被启用开关挡掉的。
    disabled: [...loader.disabled],
    // 扫描/排序/解析/模块错误（不致命，报告里可见）。
    errors: [...loader.errors, ...errors, ...moduleErrors],
    // 共享钩子总线。
    hooks,
  }
}

// #executeModCodes
// 阶段二：执行 Mod 代码（此时 Life 已存在 → 可注入 params）。
//
// @param {object} params
// @param {Array<{name: string, code: string}>} [params.codes] - 待执行代码
// @param {object} params.hooks - 钩子总线
// @param {object} params.life - Life 实例（提供 params）
// @param {object} [params.data] - 合并后的游戏数据
// @param {object} [params.aiConfig] - createBrowserAIConfig 的结果
// @param {Record<string, Function>} [params.requires] - 每个 Mod 的 require（阶段一产出）
// @param {object} [params.log] - 日志器
// @returns {{executed: string[], errors: string[]}} 结果
export function executeModCodes({ codes = [], hooks, life, data = {}, aiConfig = null, requires = null, log } = {}) {
  // 结果。
  const executed = []
  const errors = []
  // 逐个执行（异常隔离：单个 Mod 崩掉不影响其它，也不影响游戏）。
  for (const { name, code } of codes) {
    // 为该 Mod 构造 gameAPI（与 Life 共享参数注册表 + 钩子总线）。
    const gameAPI = createGameAPI({
      // 合并数据（Mod 可读取/注入数据）。
      data,
      // 钩子总线。
      hooks,
      // 参数注册表（Life 的，Mod 可注册新属性）。
      params: life?.params,
      // AI 配置（未配置时为 null → gameAPI.ai.available 为 false）。
      ai: aiConfig,
      // AI Mod 工厂（ai-mod 的 code.js 用它）。
      aiModFactory: createAIMod,
      // 日志。
      log,
    })
    // 执行。
    try {
      // 该 Mod 的 require（阶段一已把它的运行时模块加载好；没声明则是 deny 版）。
      const requireFn = requires?.[name] || createDenyRequire(name)
      // 编译执行（作用域隔离，注入 gameAPI 与 require）。
      new Function('gameAPI', 'require', '"use strict";\n' + code)(gameAPI, requireFn)
      // 记录。
      executed.push(name)
      // 日志。
      log?.debug?.(`执行 ${name}/code.js`)
    } catch (e) {
      // 记录（不抛）。
      errors.push(`执行 ${name}/code.js 失败: ${e.message}`)
      // 日志。
      log?.error?.(`执行 ${name}/code.js 失败: ${e.message}`)
    }
  }
  // 返回。
  return { executed, errors }
}
