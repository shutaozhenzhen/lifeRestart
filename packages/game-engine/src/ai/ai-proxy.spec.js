/**
 * AI 代理单元测试 — ai-proxy.spec.js（Step 16/17）
 *
 * 覆盖范围：
 *   1. CORS 预检（OPTIONS 204 + 响应头）
 *   2. 健康检查（GET /health）
 *   3. 请求校验：缺 messages/model/Key → 400/401，非法 JSON → 400，体过大 → 413
 *   4. 多模型路由（Step 17）：provider 名路由 / baseUrl 覆盖 / 401 无 Key 拒绝
 *   5. 上游转发：成功透传、上游 401/429/500 透传
 *   6. 流式透传（Step 16）：SSE 逐块转发
 *   7. mock 服务商：非流式完整 JSON + 流式逐字 SSE（无需 Key 的本地演示）
 *   8. 超时 → 504，未知路由 → 404
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// AI 代理。
import { createProxyHandler, startProxy, PROVIDER_CONFIGS } from './ai-proxy.js'

// #makeReq
// 构造 mock HTTP 请求（模拟 req.on('data'/'end') 事件流）。
//
// @param {object} opts
// @param {string} [opts.method]
// @param {string} [opts.url]
// @param {string|Buffer} [opts.body] - 请求体（经 data/end 派发）
// @returns {object} mock req
function makeReq({ method = 'POST', url = '/v1/chat/completions', body } = {}) {
  // 请求对象。
  const req = {
    method,
    url,
    // 事件表。
    _handlers: {},
    // 订阅事件。
    on(ev, fn) { this._handlers[ev] = fn },
    // 断开。
    destroy() { this._destroyed = true },
  }
  // 派发 body（下一事件循环，模拟真实异步）。
  // 注：OPTIONS/健康检查等路径不会注册 data/end 处理器，需判空防御。
  process.nextTick(() => {
    // 有 body 且已注册 data 处理器。
    if (body !== undefined && req._handlers.data) req._handlers.data(body)
    // 已注册 end 处理器。
    if (req._handlers.end) req._handlers.end()
  })
  // 返回。
  return req
}

// #makeRes
// 构造 mock HTTP 响应（记录 writeHead/write/end）。
//
// @returns {object} mock res
function makeRes() {
  // 响应对象。
  return {
    // 状态码。
    _status: null,
    // 响应头。
    _headers: null,
    // 数据块。
    _chunks: [],
    // 是否已发送响应头。
    headersSent: false,
    // 写入状态 + 头。
    writeHead(status, headers) {
      // 记录。
      this._status = status
      this._headers = headers
      // 标记。
      this.headersSent = true
    },
    // 写入数据块。
    write(chunk) { this._chunks.push(chunk) },
    // 结束。
    end(chunk) {
      // 追加末块。
      if (chunk !== undefined) this._chunks.push(chunk)
      // 标记。
      this._ended = true
    },
    // 断开。
    destroy() { this._destroyed = true },
    // 测试辅助：解析 JSON 响应体。
    get json() { return JSON.parse(this._chunks.join('')) },
    // 测试辅助：原始文本。
    get text() { return this._chunks.map((c) => (typeof c === 'string' ? c : Buffer.from(c).toString())).join('') },
  }
}

// #runHandler
// 执行处理器并返回 mock 响应（等待异步完成）。
//
// @param {Function} handler - createProxyHandler 返回的处理器
// @param {object} reqOpts - makeReq 参数
// @returns {Promise<object>} mock res
async function runHandler(handler, reqOpts) {
  // 构造响应。
  const res = makeRes()
  // 执行（等待完成）。
  await handler(makeReq(reqOpts), res)
  // 返回。
  return res
}

// #makeUpstream
// 构造上游 mock fetch。
//
// @param {object} opts
// @param {number} [opts.status] - 上游状态码（默认 200）
// @param {object} [opts.jsonBody] - 非流式响应体
// @param {Array<string>} [opts.streamChunks] - 流式 SSE 块
// @param {Function} [opts.onRequest] - 请求拦截（检查 URL/头/体）
// @param {number} [opts.timeout] - 模拟上游挂起（配合超时测试）
// @returns {Function} mock fetch
function makeUpstream({ status = 200, jsonBody = {}, streamChunks, onRequest, timeout } = {}) {
  // 返回 mock fetch。
  return async (url, opts) => {
    // 拦截记录。
    if (onRequest) onRequest(url, opts)
    // 模拟挂起（直到 abort）。
    if (timeout) {
      // 等待 abort。
      return new Promise((resolve, reject) => {
        // 无 signal 则永挂（测试勿用）。
        if (!opts.signal) return
        // abort 时拒绝。
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
    }
    // 上游错误。
    if (status >= 400) {
      // 错误响应。
      return { ok: false, status, json: async () => ({ error: { message: 'upstream error' } }) }
    }
    // 流式响应（web ReadableStream）。
    if (streamChunks) {
      // 构造流。
      const stream = new ReadableStream({
        start(controller) {
          // 逐个入队。
          for (const c of streamChunks) controller.enqueue(c)
          // 关闭。
          controller.close()
        },
      })
      // 返回。
      return { ok: true, status, body: stream }
    }
    // 非流式成功。
    return { ok: true, status, json: async () => jsonBody }
  }
}

// ========== 测试组 1：CORS 与健康检查 ==========
describe('ai-proxy - CORS & health', () => {
  test('OPTIONS 预检返回 204 + CORS 头', async () => {
    // 处理器。
    const handler = createProxyHandler({ fetch: makeUpstream() })
    // 预检。
    const res = await runHandler(handler, { method: 'OPTIONS', url: '/v1/chat/completions' })
    // 状态码。
    expect(res._status).toBe(204)
    // CORS 头。
    expect(res._headers['Access-Control-Allow-Origin']).toBe('*')
    expect(res._headers['Access-Control-Allow-Methods']).toContain('POST')
    expect(res._headers['Access-Control-Allow-Headers']).toContain('Authorization')
  })

  test('GET /health 返回服务信息', async () => {
    // 处理器。
    const handler = createProxyHandler({ fetch: makeUpstream() })
    // 健康检查。
    const res = await runHandler(handler, { method: 'GET', url: '/health' })
    // 状态码。
    expect(res._status).toBe(200)
    // 数据。
    const data = res.json
    expect(data.ok).toBe(true)
    expect(data.service).toBe('ai-proxy')
    // 路由表包含主要服务商。
    expect(data.providers).toContain('openai')
    expect(data.providers).toContain('deepseek')
    expect(data.providers).toContain('glm')
    expect(data.providers).toContain('qwen')
    expect(data.providers).toContain('mock')
  })

  test('未知路由返回 404', async () => {
    // 处理器。
    const handler = createProxyHandler({ fetch: makeUpstream() })
    // 未知路由。
    const res = await runHandler(handler, { method: 'GET', url: '/nope' })
    // 状态码。
    expect(res._status).toBe(404)
    // 错误体。
    expect(res.json.error.message).toContain('未知路由')
  })
})

// ========== 测试组 2：请求校验 ==========
describe('ai-proxy - 请求校验', () => {
  test('缺 messages 返回 400', async () => {
    // 处理器。
    const handler = createProxyHandler({ fetch: makeUpstream() })
    // 缺 messages。
    const res = await runHandler(handler, { body: JSON.stringify({ model: 'm', apiKey: 'k' }) })
    // 状态码。
    expect(res._status).toBe(400)
    // 错误信息。
    expect(res.json.error.message).toContain('messages')
  })

  test('缺 model 返回 400', async () => {
    // 处理器。
    const handler = createProxyHandler({ fetch: makeUpstream() })
    // 缺 model。
    const res = await runHandler(handler, { body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' }) })
    // 状态码。
    expect(res._status).toBe(400)
    // 错误信息。
    expect(res.json.error.message).toContain('model')
  })

  test('非法 JSON 返回 400', async () => {
    // 处理器。
    const handler = createProxyHandler({ fetch: makeUpstream() })
    // 非法 JSON。
    const res = await runHandler(handler, { body: 'not-json' })
    // 状态码。
    expect(res._status).toBe(400)
    // 错误信息。
    expect(res.json.error.message).toContain('JSON')
  })

  test('请求体超限返回 413', async () => {
    // 处理器（上限 10 字节，便于测试）。
    const handler = createProxyHandler({ fetch: makeUpstream(), maxBody: 10 })
    // 超限请求体。
    const res = await runHandler(handler, { body: JSON.stringify({ model: 'm', messages: [], apiKey: 'k' }) })
    // 状态码。
    expect(res._status).toBe(413)
    // 错误信息。
    expect(res.json.error.message).toContain('过大')
  })
})

// ========== 测试组 3：多模型路由（Step 17） ==========
describe('ai-proxy - 多模型路由', () => {
  test('provider 名路由到对应服务商 baseUrl', async () => {
    // 捕获上游请求。
    let captured = null
    // 处理器。
    const handler = createProxyHandler({
      fetch: makeUpstream({ jsonBody: { choices: [{ message: { content: 'ok' } }] }, onRequest: (url, opts) => { captured = { url, opts } } }),
    })
    // deepseek。
    const res = await runHandler(handler, {
      body: JSON.stringify({ provider: 'deepseek', apiKey: 'k', model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] }),
    })
    // 响应透传。
    expect(res._status).toBe(200)
    expect(res.json.choices[0].message.content).toBe('ok')
    // 上游地址 = deepseek baseUrl + /chat/completions。
    expect(captured.url).toBe(`${PROVIDER_CONFIGS.deepseek.baseUrl}/chat/completions`)
  })

  test('显式 baseUrl 覆盖 provider 表（自定义服务商）', async () => {
    // 捕获上游请求。
    let captured = null
    // 处理器。
    const handler = createProxyHandler({
      fetch: makeUpstream({ jsonBody: {}, onRequest: (url) => { captured = url } }),
    })
    // 自定义 baseUrl。
    await runHandler(handler, {
      body: JSON.stringify({ provider: 'openai', baseUrl: 'https://custom.example.com/v1', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    })
    // 上游地址。
    expect(captured).toBe('https://custom.example.com/v1/chat/completions')
  })

  test('无 API Key 返回 401（真实服务商）', async () => {
    // 处理器。
    const handler = createProxyHandler({ fetch: makeUpstream() })
    // 无 Key。
    const res = await runHandler(handler, {
      body: JSON.stringify({ provider: 'openai', model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    })
    // 状态码。
    expect(res._status).toBe(401)
    // 错误信息。
    expect(res.json.error.message).toContain('API Key')
  })

  test('默认 provider 可配置（--mock 模式）', async () => {
    // 处理器（默认路由 mock，无需 Key）。
    const handler = createProxyHandler({ fetch: makeUpstream(), defaultProvider: 'mock' })
    // 不指定 provider（走默认 mock）。
    const res = await runHandler(handler, {
      body: JSON.stringify({ model: 'mock-chat', messages: [{ role: 'user', content: 'hello' }] }),
    })
    // mock 无需 Key 也成功。
    expect(res._status).toBe(200)
    // 回复包含消息内容。
    expect(res.json.choices[0].message.content).toContain('hello')
  })

  test('PROVIDER_CONFIGS 覆盖主要服务商', () => {
    // 各服务商地址与默认模型。
    expect(PROVIDER_CONFIGS.openai.baseUrl).toContain('openai.com')
    expect(PROVIDER_CONFIGS.deepseek.baseUrl).toContain('deepseek.com')
    expect(PROVIDER_CONFIGS.glm.baseUrl).toContain('bigmodel.cn')
    expect(PROVIDER_CONFIGS.qwen.baseUrl).toContain('aliyuncs.com')
    // mock 标记。
    expect(PROVIDER_CONFIGS.mock.baseUrl).toContain('mock')
  })
})

// ========== 测试组 4：上游转发 ==========
describe('ai-proxy - 上游转发', () => {
  test('非流式成功：透传 Authorization 与请求体', async () => {
    // 捕获请求。
    let captured = null
    // 处理器。
    const handler = createProxyHandler({
      fetch: makeUpstream({ jsonBody: { choices: [{ message: { content: 'hello' } }] }, onRequest: (url, opts) => { captured = { url, opts } } }),
    })
    // 调用。
    const res = await runHandler(handler, {
      body: JSON.stringify({ provider: 'openai', apiKey: 'key123', model: 'm', messages: [{ role: 'user', content: 'hi' }], max_tokens: 64 }),
    })
    // 透传响应。
    expect(res._status).toBe(200)
    expect(res.json.choices[0].message.content).toBe('hello')
    // 上游地址。
    expect(captured.url).toBe(`${PROVIDER_CONFIGS.openai.baseUrl}/chat/completions`)
    // 请求头。
    expect(captured.opts.headers.Authorization).toBe('Bearer key123')
    // 请求体只含 OpenAI 协议字段（不含 provider/apiKey/baseUrl）。
    const upstreamBody = JSON.parse(captured.opts.body)
    expect(upstreamBody.model).toBe('m')
    expect(upstreamBody.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(upstreamBody.max_tokens).toBe(64)
    // 不得泄漏内部字段。
    expect(upstreamBody.provider).toBeUndefined()
    expect(upstreamBody.apiKey).toBeUndefined()
    expect(upstreamBody.baseUrl).toBeUndefined()
  })

  test('上游 401/429/500 状态码透传', async () => {
    // 各状态码逐一验证。
    for (const status of [401, 429, 500]) {
      // 处理器（上游错误）。
      const handler = createProxyHandler({ fetch: makeUpstream({ status }) })
      // 调用。
      const res = await runHandler(handler, {
        body: JSON.stringify({ provider: 'openai', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
      })
      // 透传状态码。
      expect(res._status).toBe(status)
      // 错误信息。
      expect(res.json.error.message).toContain('upstream error')
    }
  })

  test('上游超时返回 504', async () => {
    // 处理器（上游挂起，超时 30ms）。
    const handler = createProxyHandler({ fetch: makeUpstream({ timeout: true }), timeout: 30 })
    // 调用。
    const res = await runHandler(handler, {
      body: JSON.stringify({ provider: 'openai', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    })
    // 超时。
    expect(res._status).toBe(504)
    // 错误信息。
    expect(res.json.error.message).toContain('超时')
  })

  test('流式透传（Step 16）：SSE 逐块转发', async () => {
    // 上游流块。
    const chunks = ['data: {"choices":[{"delta":{"content":"你"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"好"}}]}\n\n', 'data: [DONE]\n\n']
    // 处理器（流式上游）。
    const handler = createProxyHandler({ fetch: makeUpstream({ streamChunks: chunks }) })
    // 调用（stream: true）。
    const res = await runHandler(handler, {
      body: JSON.stringify({ provider: 'openai', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true }),
    })
    // 流式响应头。
    expect(res._status).toBe(200)
    expect(res._headers['Content-Type']).toContain('text/event-stream')
    // 逐块转发。
    expect(res.text).toContain('"content":"你"')
    expect(res.text).toContain('"content":"好"')
    expect(res.text).toContain('[DONE]')
    // 结束。
    expect(res._ended).toBe(true)
  })
})

// ========== 测试组 5：mock 服务商（本地演示） ==========
describe('ai-proxy - mock 服务商', () => {
  test('非流式：无需 Key 返回完整 JSON', async () => {
    // 处理器。
    const handler = createProxyHandler({ fetch: makeUpstream() })
    // mock 调用。
    const res = await runHandler(handler, {
      body: JSON.stringify({ provider: 'mock', model: 'mock-chat', messages: [{ role: 'user', content: '你好' }] }),
    })
    // 成功。
    expect(res._status).toBe(200)
    // 回复拼接消息内容。
    expect(res.json.choices[0].message.content).toBe('你好')
  })

  test('流式：逐字 SSE + [DONE] 结束标记', async () => {
    // 处理器（mock 延时 0，测试快速完成）。
    const handler = createProxyHandler({ fetch: makeUpstream(), mockDelay: 0 })
    // mock 流式。
    const res = await runHandler(handler, {
      body: JSON.stringify({ provider: 'mock', model: 'mock-chat', messages: [{ role: 'user', content: 'AB' }], stream: true }),
    })
    // 流式头。
    expect(res._status).toBe(200)
    expect(res._headers['Content-Type']).toContain('text/event-stream')
    // 角色声明 chunk。
    expect(res.text).toContain('"role":"assistant"')
    // 逐字输出。
    expect(res.text).toContain('"content":"A"')
    expect(res.text).toContain('"content":"B"')
    // 结束标记。
    expect(res.text).toContain('[DONE]')
  })
})

// ========== 测试组 6：startProxy 启动 ==========
describe('ai-proxy - startProxy', () => {
  test('启动真实 HTTP 服务并响应 /health', async () => {
    // 启动（随机端口）。
    const { server, close } = startProxy({ port: 0, fetch: makeUpstream() })
    // 等待监听完成。
    await new Promise((resolve) => server.once('listening', resolve))
    // 实际绑定地址（port: 0 → 系统分配）。
    const { port } = server.address()
    // 真实请求健康检查。
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    // 解析。
    const data = await res.json()
    // 断言。
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    // 关闭。
    await close()
  })

  test('真实 HTTP 请求走通对话接口（mock provider）', async () => {
    // 启动（mock 延时 0）。
    const { server, close } = startProxy({ port: 0, mockDelay: 0 })
    // 等待监听。
    await new Promise((resolve) => server.once('listening', resolve))
    // 实际绑定地址（port: 0 → 系统分配）。
    const { port } = server.address()
    // 真实请求。
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'mock', model: 'mock-chat', messages: [{ role: 'user', content: 'ping' }] }),
    })
    // 解析。
    const data = await res.json()
    // 断言。
    expect(res.status).toBe(200)
    expect(data.choices[0].message.content).toBe('ping')
    // 关闭。
    await close()
  })
})
