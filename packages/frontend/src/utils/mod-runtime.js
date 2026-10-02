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
import { createAIClient } from 'game-engine/src/ai/ai-client.js'
import { createAIMod } from 'game-engine/src/ai/ai-mod.js'

// Mod 静态资源根路径（由 scripts/sync-mods.mjs 生成）。
export const MODS_BASE_URL = '/mods/'

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

// #installModFromZip
// 从 zip 安装 Mod 到本地存储（**前端 zip 安装的入口**）。
// 解析/校验/安全防护都在引擎的 zip 模块里（与 CLI 的 manager.importZip 同一实现）。
//
// @param {object} params
// @param {Uint8Array|ArrayBuffer} params.bytes - zip 内容
// @param {object} params.store - mod-store 实例
// @param {object} [params.log] - 日志器
// @returns {Promise<{ok: boolean, name?: string, manifest?: object, errors: string[], files?: number, binaries?: string[]}>} 结果
export async function installModFromZip({ bytes, store, log } = {}) {
  // 解析（共用的 zip 模块）。
  const parsed = readModPackage(bytes, { log })
  // 失败。
  if (!parsed.ok) return { ok: false, errors: parsed.errors }
  // 系统 Mod 名保留：不允许用 zip 覆盖内置/系统 Mod（避免把数据源或 ai-mod 顶掉）。
  if (['lifeRestart-data', 'ai-mod'].includes(parsed.name)) {
    // 拒绝。
    return { ok: false, errors: [`${parsed.name} 是系统 Mod，不能被 zip 覆盖`] }
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
  const http = createFetchSource({ baseUrl, fetchImpl, log })
  const source = store ? createCompositeSource([createStoreSource(store), http]) : http
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
  const http = createFetchSource({ baseUrl, fetchImpl, log })
  const source = store ? createCompositeSource([createStoreSource(store), http]) : http
  // 加载器（只加载启用的 Mod）。
  const loader = await createModLoader({ source, log, only: enabled })
  // 加载数据与代码（**不**执行 code：浏览器要等 Life 建好拿 params）。
  const { data, codeList, errors } = await loader.loadAll()
  // 只保留有代码的项。
  const codes = codeList.filter((c) => c.code).map((c) => ({ name: c.name, code: c.code }))
  // 返回。
  return {
    // 合并后的 Mod 数据（调用方合并进游戏数据）。
    data,
    // 待执行代码。
    codes,
    // 实际加载的 Mod（按拓扑顺序）。
    loaded: [...loader.order],
    // 被启用开关挡掉的。
    disabled: [...loader.disabled],
    // 扫描/排序/解析错误（不致命，报告里可见）。
    errors: [...loader.errors, ...errors],
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
// @param {object} [params.log] - 日志器
// @returns {{executed: string[], errors: string[]}} 结果
export function executeModCodes({ codes = [], hooks, life, data = {}, aiConfig = null, log } = {}) {
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
      // 编译执行（作用域隔离，只注入 gameAPI）。
      new Function('gameAPI', '"use strict";\n' + code)(gameAPI)
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
