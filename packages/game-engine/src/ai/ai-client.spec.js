/**
 * AI 客户端单元测试 — ai-client.spec.js
 *
 * 覆盖范围：
 *   1. chatCompletion：请求构造、响应解析、错误码
 *   2. generateJSON：markdown 剥离、JSON 解析、解析失败标记
 *   3. 错误处理：401/429/500、缺 Key、缺 fetch
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// AI 客户端。
import { createAIClient, OPENAI_CONFIG } from './ai-client.js'

// #makeFetch
// 构造模拟 fetch。
//
// @param {object} opts
// @param {number} [opts.status] - 响应状态码（缺省 200）
// @param {object|string} [opts.body] - 响应体
// @param {Function} [opts.onRequest] - 请求拦截（检查请求参数）
// @returns {Function} mock fetch
function makeFetch({ status = 200, body = {}, onRequest } = {}) {
  // 返回 mock fetch。
  return async (url, opts) => {
    // 记录请求。
    if (onRequest) onRequest(url, opts)
    // 非 2xx。
    if (status >= 400) {
      // 错误响应。
      return { ok: false, status, json: async () => ({ error: { message: 'mock error' } }) }
    }
    // 成功响应。
    return { ok: true, status, json: async () => body }
  }
}

// ========== 测试组 1：chatCompletion ==========
describe('ai-client - chatCompletion', () => {
  test('sends OpenAI protocol request', async () => {
    // 捕获请求。
    let captured = null
    // 客户端。
    const client = createAIClient({
      fetch: makeFetch({ body: { choices: [{ message: { content: 'hello' } }] }, onRequest: (url, opts) => { captured = { url, opts } } }),
    })
    // 调用。
    const text = await client.chatCompletion({
      baseUrl: 'https://api.test.com/v1', apiKey: 'key123', model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    })
    // 返回内容。
    expect(text).toBe('hello')
    // URL 正确。
    expect(captured.url).toBe('https://api.test.com/v1/chat/completions')
    // 请求体。
    const body = JSON.parse(captured.opts.body)
    expect(body.model).toBe('m')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    // Authorization 头。
    expect(captured.opts.headers.Authorization).toBe('Bearer key123')
  })

  test('throws 401 when api key missing', async () => {
    // 客户端。
    const client = createAIClient({ fetch: makeFetch() })
    // 缺 Key。
    try {
      await client.chatCompletion({ baseUrl: 'x', model: 'm', messages: [] })
      // 不应走到这里。
      expect(true).toBe(false)
    } catch (e) {
      // 状态码 401。
      expect(e.status).toBe(401)
    }
  })

  test('throws status on 429', async () => {
    // 客户端（429 响应）。
    const client = createAIClient({ fetch: makeFetch({ status: 429 }) })
    // 调用。
    try {
      await client.chatCompletion({ baseUrl: 'x', apiKey: 'k', model: 'm', messages: [] })
      expect(true).toBe(false)
    } catch (e) {
      // 状态码。
      expect(e.status).toBe(429)
    }
  })

  test('throws status on 500', async () => {
    // 客户端（500 响应）。
    const client = createAIClient({ fetch: makeFetch({ status: 500 }) })
    // 调用。
    try {
      await client.chatCompletion({ baseUrl: 'x', apiKey: 'k', model: 'm', messages: [] })
      expect(true).toBe(false)
    } catch (e) {
      // 状态码。
      expect(e.status).toBe(500)
    }
  })
})

// ========== 测试组 2：generateJSON ==========
describe('ai-client - generateJSON', () => {
  test('parses plain JSON response', async () => {
    // 客户端。
    const client = createAIClient({
      fetch: makeFetch({ body: { choices: [{ message: { content: '{"id":"t1"}' } }] } }),
    })
    // 调用。
    const data = await client.generateJSON({ baseUrl: 'x', apiKey: 'k', model: 'm', system: 'sys', user: 'u' })
    // 解析结果。
    expect(data).toEqual({ id: 't1' })
  })

  test('strips markdown code block', async () => {
    // 客户端（返回 markdown 包裹）。
    const client = createAIClient({
      fetch: makeFetch({ body: { choices: [{ message: { content: '```json\n{"id":"t2"}\n```' } }] } }),
    })
    // 调用。
    const data = await client.generateJSON({ baseUrl: 'x', apiKey: 'k', model: 'm', system: 's', user: 'u' })
    // 解析成功。
    expect(data).toEqual({ id: 't2' })
  })

  test('throws aiParseError on invalid JSON', async () => {
    // 客户端（返回非法 JSON）。
    const client = createAIClient({
      fetch: makeFetch({ body: { choices: [{ message: { content: 'not json' } }] } }),
    })
    // 调用。
    try {
      await client.generateJSON({ baseUrl: 'x', apiKey: 'k', model: 'm', system: 's', user: 'u' })
      expect(true).toBe(false)
    } catch (e) {
      // 解析失败标记。
      expect(e.aiParseError).toBe(true)
    }
  })
})

// ========== 测试组 3：provider 对照 ==========
describe('ai-client - OPENAI_CONFIG', () => {
  test('includes common providers', () => {
    // 各服务商 baseUrl。
    expect(OPENAI_CONFIG.openai).toContain('openai.com')
    expect(OPENAI_CONFIG.deepseek).toContain('deepseek.com')
    expect(OPENAI_CONFIG.glm).toContain('bigmodel.cn')
    expect(OPENAI_CONFIG.qwen).toContain('aliyuncs.com')
  })
})
