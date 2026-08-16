/**
 * AI 代理服务（Step 16/17）
 *
 * 零依赖 Node HTTP 服务，运行于 localhost，职责：
 *   1. 接收前端/CLI 的 AI 调用请求（含用户 API Key，由前端传入）。
 *   2. 按 provider 名路由到对应服务商（多模型路由，Step 17）。
 *   3. 转发 OpenAI 协议请求，透传 SSE 流式响应（Step 16）。
 *   4. 追加 CORS 响应头（浏览器直连可用，无需依赖 Vite 代理）。
 *
 * 设计决策（阶段四修正）：
 *   - 代理不建独立 package（已确认决策），单一实现下沉 game-engine
 *     （与 createAIMod 同模式），平台侧（Electron/Web/Termux）经 server.js 启动复用。
 *   - 使用 Node 内置 http 模块而非 Fastify：保持引擎零运行时依赖，
 *     离线/Termux 环境无需安装任何包即可运行。
 *
 * 结构：
 *   createProxyHandler()  —— 纯逻辑请求处理器（注入 fetch/log，可单测）
 *   startProxy()          —— Node http server 启动（含 close 句柄）
 *   PROVIDER_CONFIGS      —— 服务商路由表（openai/deepseek/glm/qwen/mock）
 *
 * 请求格式（POST /v1/chat/completions）：
 *   {
 *     provider?: 'openai'|'deepseek'|'glm'|'qwen'|'mock',  // 路由名
 *     baseUrl?: string,        // 覆盖 provider 默认地址（自定义服务商）
 *     apiKey: string,          // 必填（mock 除外），401 无 Key 拒绝
 *     model: string,
 *     messages: [...],
 *     max_tokens?: number,
 *     stream?: boolean         // true → SSE 流式透传
 *   }
 *
 * 错误码：400（缺字段/非法 JSON）401（无 Key/Key 无效）413（体过大）
 *         429（上游限流）500（上游/转发错误）504（超时）
 */

// 内置 http 模块（零依赖）。
import { createServer } from 'node:http'
// URL 解析（全局 URL 亦可用，node:url 显式导入更稳）。
import { URL } from 'node:url'
// 服务商 baseUrl 对照（单一来源，避免与 ai-client 漂移）。
import { OPENAI_CONFIG } from './ai-client.js'

// #PROVIDER_CONFIGS
// 服务商路由表：OpenAI 协议 baseUrl + 默认模型 + 展示名。
// mock 为本地演示服务商：无需 API Key，返回脚本化回复（含流式）。
export const PROVIDER_CONFIGS = {
  openai: { label: 'OpenAI', baseUrl: OPENAI_CONFIG.openai, model: 'gpt-4o-mini' },
  deepseek: { label: 'DeepSeek', baseUrl: OPENAI_CONFIG.deepseek, model: 'deepseek-chat' },
  glm: { label: 'GLM', baseUrl: OPENAI_CONFIG.glm, model: 'glm-4-flash' },
  qwen: { label: '通义千问', baseUrl: OPENAI_CONFIG.qwen, model: 'qwen-plus' },
  mock: { label: '本地演示（无需 Key）', baseUrl: 'mock://local', model: 'mock-chat' },
}

// 默认请求体大小上限（2MB）。
const MAX_BODY = 2 * 1024 * 1024

// #sendJSON
// 统一 JSON 响应（追加 CORS 头）。
//
// @param {object} res - HTTP 响应对象
// @param {number} status - 状态码
// @param {object} body - 响应体（自动 JSON 序列化）
// @param {object} [extraHeaders] - 额外响应头
function sendJSON(res, status, body, extraHeaders = {}) {
  // 写入状态 + 头。
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders })
  // 结束响应。
  res.end(JSON.stringify(body))
}

// #readBody
// 读取请求体（带大小上限，超限 413 并断开连接）。
//
// @param {object} req - HTTP 请求对象
// @param {number} limit - 大小上限（字节）
// @returns {Promise<{ok: boolean, data?: string, status?: number, message?: string}>}
function readBody(req, limit) {
  // Promise 化。
  return new Promise((resolve) => {
    // 累积数据。
    let data = ''
    // 是否超限。
    let tooLarge = false
    // 数据到达。
    req.on('data', (chunk) => {
      // 累积（Buffer/string 均可拼接）。
      data += chunk
      // 超限。
      if (data.length > limit) {
        // 标记。
        tooLarge = true
        // 断开连接（防止恶意大包拖垮内存）。
        req.destroy()
        // 直接解析（避免 'end' 不再触发导致悬挂）。
        resolve({ ok: false, status: 413, message: '请求体过大' })
      }
    })
    // 数据结束。
    req.on('end', () => {
      // 已超限则忽略（前面已 resolve）。
      if (tooLarge) return
      // 正常解析。
      resolve({ ok: true, data })
    })
    // 读取异常。
    req.on('error', () => {
      // 400（客户端断开/传输错误）。
      resolve({ ok: false, status: 400, message: '读取请求体失败' })
    })
  })
}

// #createProxyHandler
// 创建 AI 代理请求处理器（纯逻辑，不依赖真实 HTTP 服务，可单测）。
//
// @param {object} [opts]
// @param {object} [opts.providers] - 服务商路由表（缺省 PROVIDER_CONFIGS）
// @param {Function} [opts.fetch] - fetch 实现（缺省全局 fetch，测试注入 mock）
// @param {object} [opts.log] - 日志器（debug/info/warn/error）
// @param {number} [opts.timeout] - 上游请求超时毫秒（默认 30000）
// @param {number} [opts.maxBody] - 请求体上限字节（默认 2MB）
// @param {number} [opts.mockDelay] - mock 流式逐字延时毫秒（默认 60，测试可置 0）
// @param {string} [opts.defaultProvider] - 请求未指定 provider 时的默认路由（--mock 模式为 'mock'）
// @returns {Function} (req, res) => Promise<void>
export function createProxyHandler({
  providers = PROVIDER_CONFIGS,
  fetch: fetchImpl,
  log,
  timeout = 30000,
  maxBody = MAX_BODY,
  mockDelay = 60,
  defaultProvider = 'openai',
} = {}) {
  // fetch 实现。
  const doFetch = fetchImpl || globalThis.fetch
  // 日志器。
  const logger = log || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

  // CORS 响应头（统一追加）。
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  // #mockCompletion
  // 本地演示服务商：无需 API Key，返回脚本化回复。
  // stream=true 时逐字 SSE 输出（模拟打字效果）；否则一次性返回完整 JSON。
  //
  // @param {object} body - 请求体
  // @param {object} res - HTTP 响应
  // @returns {Promise<void>}
  function mockCompletion(body, res) {
    // 回复文本（拼接消息内容，便于单测断言）。
    const text = (body.messages || []).map((m) => m.content).join(' | ') || 'mock 回复'
    // 非流式：一次性返回完整 JSON。
    if (!body.stream) {
      return sendJSON(res, 200, {
        id: 'mock',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      }, cors)
    }
    // 流式：SSE 逐字输出。
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...cors,
    })
    // 首个 chunk：声明角色（贴合 OpenAI 协议）。
    res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`)
    // 逐字符。
    const chars = [...text]
    let i = 0
    // Promise 化（延时逐字输出）。
    return new Promise((resolve) => {
      // 定时输出一个字符。
      const tick = () => {
        // 输出完毕。
        if (i >= chars.length) {
          // 结束标记。
          res.write('data: [DONE]\n\n')
          // 结束。
          res.end()
          // 完成。
          return resolve()
        }
        // 当前字符。
        const c = chars[i++]
        // SSE 数据行。
        res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: c }, finish_reason: null }] })}\n\n`)
        // 延时后输出下一个。
        setTimeout(tick, mockDelay)
      }
      // 启动。
      tick()
    })
  }

  // #handleCompletion
  // 处理对话请求：校验 → provider 路由 → 上游转发（流式/非流式）。
  //
  // @param {object} body - 解析后的请求体
  // @param {object} res - HTTP 响应
  // @returns {Promise<void>}
  async function handleCompletion(body, res) {
    // 基础校验：messages 必填且为数组。
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return sendJSON(res, 400, { error: { message: '缺少 messages（对话消息数组）' } }, cors)
    }
    // 基础校验：model 必填。
    if (!body.model) {
      return sendJSON(res, 400, { error: { message: '缺少 model（模型名）' } }, cors)
    }
    // provider 路由名（缺省走 defaultProvider）。
    const pname = body.provider || defaultProvider
    // 服务商配置。
    const cfg = providers[pname]
    // 最终上游地址：显式 baseUrl 覆盖 > provider 表 > 兜底 openai。
    const baseUrl = body.baseUrl || (cfg && cfg.baseUrl) || OPENAI_CONFIG.openai
    // mock 服务商（本地演示，无需 Key）。
    if (pname === 'mock' || String(baseUrl).startsWith('mock:')) {
      // 记录。
      logger.debug(`[proxy] mock 模式（${body.stream ? '流式' : '非流式'}）`)
      // 本地回复。
      return mockCompletion(body, res)
    }
    // 401：无 API Key（mock 除外）。
    if (!body.apiKey) {
      // 记录。
      logger.warn('[proxy] 缺少 API Key，拒绝（401）')
      // 返回。
      return sendJSON(res, 401, { error: { message: '缺少 API Key（请配置后重试）' } }, cors)
    }
    // 构造上游请求体（只透传 OpenAI 协议字段，防止前端走私无关字段）。
    const upstreamBody = {
      model: body.model,
      messages: body.messages,
      // 可选字段。
      ...(body.max_tokens != null ? { max_tokens: body.max_tokens } : {}),
      ...(body.stream ? { stream: true } : {}),
    }
    // 超时控制。
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    // 超时定时器。
    const timer = controller ? setTimeout(() => controller.abort(), body.timeout || timeout) : null
    // 记录请求。
    logger.debug(`[proxy] → ${pname}(${baseUrl}) model=${body.model} stream=${!!body.stream} messages=${body.messages.length}`)
    try {
      // 上游请求。
      const upstream = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${body.apiKey}`,
          // 流式时声明 Accept。
          ...(body.stream ? { Accept: 'text/event-stream' } : {}),
        },
        body: JSON.stringify(upstreamBody),
        signal: controller ? controller.signal : undefined,
      })
      // 上游错误：透传状态码 + 错误信息。
      if (!upstream.ok) {
        // 错误详情（尝试解析）。
        let detail = ''
        // 解析。
        try { detail = (await upstream.json())?.error?.message || '' } catch { /* 忽略 */ }
        // 记录。
        logger.error(`[proxy] 上游 ${upstream.status}: ${detail}`)
        // 返回。
        return sendJSON(res, upstream.status, { error: { message: `上游错误(${upstream.status}): ${detail}` } }, cors)
      }
      // 流式透传（SSE）。
      if (body.stream) {
        // 流式响应头。
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...cors,
        })
        // 逐块转发（web ReadableStream 可异步迭代）。
        for await (const chunk of upstream.body) {
          // 转发。
          res.write(chunk)
        }
        // 结束。
        res.end()
        // 完成。
        return
      }
      // 非流式：原样转发上游 JSON。
      const data = await upstream.json()
      // 返回。
      sendJSON(res, 200, data, cors)
    } catch (e) {
      // 超时/主动中断。
      if (e && (e.name === 'AbortError' || (controller && controller.signal.aborted))) {
        // 记录。
        logger.error(`[proxy] 上游超时（${body.timeout || timeout}ms）`)
        // 未发送响应头 → 504；已开始流式 → 断开连接。
        if (!res.headersSent) return sendJSON(res, 504, { error: { message: '上游请求超时' } }, cors)
        // 流式中断。
        return res.destroy()
      }
      // 记录。
      logger.error(`[proxy] 转发失败: ${e.message}`)
      // 未发送响应头 → 500。
      if (!res.headersSent) return sendJSON(res, 500, { error: { message: `转发失败: ${e.message}` } }, cors)
      // 流式中断。
      res.destroy()
    } finally {
      // 清理定时器。
      if (timer) clearTimeout(timer)
    }
  }

  // #handler
  // 请求处理器：路由分发 + 统一 CORS。
  //
  // @param {object} req - HTTP 请求
  // @param {object} res - HTTP 响应
  // @returns {Promise<void>}
  async function handler(req, res) {
    // 预检（CORS）。
    if (req.method === 'OPTIONS') {
      // 204。
      res.writeHead(204, cors)
      // 结束。
      res.end()
      // 完成。
      return
    }
    // 解析路径。
    const url = new URL(req.url, 'http://localhost')
    // 健康检查。
    if (req.method === 'GET' && url.pathname === '/health') {
      // 记录。
      logger.info(`[proxy] 健康检查（${req.socket?.remoteAddress || 'unknown'}）`)
      // 返回。
      return sendJSON(res, 200, {
        ok: true,
        service: 'ai-proxy',
        providers: Object.keys(providers),
        defaultProvider,
        time: new Date().toISOString(),
      }, cors)
    }
    // 对话接口。
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      // 读取请求体（带大小上限）。
      const raw = await readBody(req, maxBody)
      // 读取失败（413/400）。
      if (!raw.ok) {
        // 记录。
        logger.warn(`[proxy] 读取请求体失败（${raw.status}）`)
        // 返回。
        return sendJSON(res, raw.status, { error: { message: raw.message } }, cors)
      }
      // 解析 JSON。
      let body
      // 尝试解析。
      try {
        body = JSON.parse(raw.data)
      } catch {
        // 非法 JSON。
        return sendJSON(res, 400, { error: { message: '请求体不是合法 JSON' } }, cors)
      }
      // 处理对话。
      return handleCompletion(body, res)
    }
    // 未知路由。
    return sendJSON(res, 404, { error: { message: `未知路由 ${req.method} ${url.pathname}` } }, cors)
  }

  // 返回处理器。
  return handler
}

// #startProxy
// 启动 AI 代理 HTTP 服务（Node 内置 http，零依赖）。
//
// @param {object} [opts]
// @param {number} [opts.port] - 端口（默认 8787）
// @param {string} [opts.host] - 监听地址（默认 127.0.0.1）
// @param {Function} [opts.handler] - 请求处理器（缺省 createProxyHandler）
// @param {object} [opts...rest] - 其余透传 createProxyHandler
// @returns {object} { server, url, close }
export function startProxy({ port = 8787, host = '127.0.0.1', handler, ...opts } = {}) {
  // 请求处理器。
  const h = handler || createProxyHandler(opts)
  // HTTP 服务（handler 内部已捕获全部异常，此处防御性兜底）。
  const server = createServer((req, res) => {
    // 执行。
    Promise.resolve(h(req, res)).catch((e) => {
      // 未发送响应头 → 500。
      if (!res.headersSent) {
        // 返回。
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: { message: `代理内部错误: ${e.message}` } }))
      } else {
        // 流式中断。
        res.destroy()
      }
    })
  })
  // 监听。
  server.listen(port, host)
  // 返回控制句柄。
  return {
    // 服务实例。
    server,
    // 访问地址。
    url: `http://${host}:${port}`,
    // 关闭服务。
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
