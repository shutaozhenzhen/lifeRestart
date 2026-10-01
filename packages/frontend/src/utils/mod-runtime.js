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

// 引擎：Mod 加载内核 + HTTP 文件源 + 钩子/API + AI 客户端与工厂。
import { createModLoader, scanMods } from 'game-engine/src/mod/loader.js'
import { createFetchSource } from 'game-engine/src/mod/source-fetch.js'
import { createHookBus, createGameAPI } from 'game-engine/src/mod/gameapi.js'
import { createAIClient } from 'game-engine/src/ai/ai-client.js'
import { createAIMod } from 'game-engine/src/ai/ai-mod.js'

// Mod 静态资源根路径（由 scripts/sync-mods.mjs 生成）。
export const MODS_BASE_URL = '/mods/'

// AI 代理地址（与 Mod 管理页的"测试连接"一致：Electron 注入 → 环境变量 → 默认路径）。
export const AI_PROXY_BASE = globalThis.window?.electronAIProxy?.baseUrl || import.meta.env?.VITE_AI_PROXY || '/ai-proxy'

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

// #discoverMods
// 只做"发现"：列出服务器上可用的 Mod（供 Mod 管理页展示 + 计算启用集合）。
//
// @param {object} [params]
// @param {string} [params.baseUrl] - Mod 根路径
// @param {Function} [params.fetchImpl] - fetch 实现
// @param {object} [params.log] - 日志器
// @returns {Promise<{mods: Array<{name: string, manifest: object}>, errors: string[]}>} 发现结果
export async function discoverMods({ baseUrl = MODS_BASE_URL, fetchImpl, log } = {}) {
  // 源 + 扫描（与加载器共用同一个 HTTP 源实现）。
  const source = createFetchSource({ baseUrl, fetchImpl, log })
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
export async function loadModBundle({ baseUrl = MODS_BASE_URL, fetchImpl, enabled, log } = {}) {
  // 钩子总线（一次游戏一个：所有 Mod 共享，Life 也注入它）。
  const hooks = createHookBus()
  // 文件源。
  const source = createFetchSource({ baseUrl, fetchImpl, log })
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
