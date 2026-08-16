/**
 * Web 服务器单元测试 — server.spec.js（Step 24）
 *
 * 覆盖范围：
 *   1. 静态文件：/ → index.html、/assets/*.js 正确类型、404
 *   2. 路径穿越防护：../ 拒绝（403）
 *   3. AI 代理前缀路由：/ai-proxy/health、/ai-proxy/v1/chat/completions
 *   4. 真实 HTTP 起服验证（startWebServer）
 */

// 导入 vitest。
import { describe, test, expect } from 'vitest'
// Node 路径（Windows 兼容）。
import { fileURLToPath } from 'node:url'
// 被测模块。
import { createRequestHandler, startWebServer } from './server.js'
// AI 代理核心（mock fetch 用）。
import { createProxyHandler } from 'game-engine/src/ai/ai-proxy.js'

// 静态根目录（测试夹具，Windows 下必须用 fileURLToPath）。
const ROOT = fileURLToPath(new URL('./test-fixtures/public/', import.meta.url))

// #makeReq / #makeRes：与 ai-proxy.spec 同款 mock（静态路由不需要 body）。
function makeReq({ method = 'GET', url = '/' } = {}) {
  // 请求对象。
  return { method, url }
}

// #makeRes
// mock 响应（writeHead 记录头，end 记录 Buffer/文本）。
function makeRes() {
  // 响应对象。
  return {
    _status: null,
    _headers: null,
    _chunks: [],
    headersSent: false,
    writeHead(status, headers) { this._status = status; this._headers = headers; this.headersSent = true },
    write(chunk) { this._chunks.push(chunk) },
    end(chunk) { if (chunk !== undefined) this._chunks.push(chunk); this._ended = true },
    destroy() { this._destroyed = true },
    // 测试辅助：文本。
    get text() { return this._chunks.map((c) => (typeof c === 'string' ? c : Buffer.from(c).toString())).join('') },
  }
}

// #run
// 执行处理器。
async function run(handler, reqOpts) {
  // 响应。
  const res = makeRes()
  // 执行。
  await handler(makeReq(reqOpts), res)
  // 返回。
  return res
}

// #makeHandler
// 构造带 mock 代理的请求处理器（静态走真实文件，代理走 mock fetch）。
function makeHandler() {
  // mock 代理。
  const proxy = createProxyHandler({
    fetch: async (url, opts) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'pong' } }] }) }),
  })
  // 处理器。
  return createRequestHandler({ root: ROOT, proxy })
}

// ========== 测试组 1：静态文件 ==========
describe('web-server - 静态文件', () => {
  test('GET / 返回 index.html', async () => {
    // 处理器。
    const handler = makeHandler()
    // 请求。
    const res = await run(handler, { url: '/' })
    // 状态与类型。
    expect(res._status).toBe(200)
    expect(res._headers['Content-Type']).toContain('text/html')
    // 内容。
    expect(res.text).toContain('fixture-home')
  })

  test('GET /assets/app.js 返回正确类型', async () => {
    // 处理器。
    const handler = makeHandler()
    // 请求。
    const res = await run(handler, { url: '/assets/app.js' })
    // 状态与类型。
    expect(res._status).toBe(200)
    expect(res._headers['Content-Type']).toContain('text/javascript')
    // 内容。
    expect(res.text).toContain('__FIXTURE__')
  })

  test('不存在的资源返回 404（assets 下不兜底）', async () => {
    // 处理器。
    const handler = makeHandler()
    // 请求。
    const res = await run(handler, { url: '/assets/missing.js' })
    // 404。
    expect(res._status).toBe(404)
  })

  test('路径穿越 ../ 被拒绝（403）', async () => {
    // 处理器。
    const handler = makeHandler()
    // 穿越请求。
    const res = await run(handler, { url: '/../server.js' })
    // 403。
    expect(res._status).toBe(403)
  })
})

// ========== 测试组 2：AI 代理前缀路由 ==========
describe('web-server - /ai-proxy 前缀路由', () => {
  test('/ai-proxy/health 交给代理', async () => {
    // 处理器。
    const handler = makeHandler()
    // 请求。
    const res = await run(handler, { url: '/ai-proxy/health' })
    // 代理健康检查。
    expect(res._status).toBe(200)
    // ok 标记。
    expect(JSON.parse(res.text).ok).toBe(true)
  })

  test('/ai-proxy/v1/chat/completions 转发对话（真实服务商路径）', async () => {
    // 处理器。
    const handler = makeHandler()
    // 响应。
    const res = makeRes()
    // 构造带 body 的 req（真实服务商：mock fetch 拦截上游，返回 pong）。
    const req = {
      method: 'POST',
      url: '/ai-proxy/v1/chat/completions',
      _handlers: {},
      on(ev, fn) { this._handlers[ev] = fn },
      destroy() {},
    }
    // 派发 body（nextTick）。
    process.nextTick(() => {
      // data。
      req._handlers.data(JSON.stringify({ provider: 'openai', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] }))
      // end。
      req._handlers.end()
    })
    // 执行。
    await handler(req, res)
    // 透传成功。
    expect(res._status).toBe(200)
    expect(JSON.parse(res.text).choices[0].message.content).toBe('pong')
  })
})

// ========== 测试组 3：startWebServer 起服 ==========
describe('web-server - startWebServer', () => {
  test('真实 HTTP：静态 + 代理全链路', async () => {
    // 启动（mock 代理）。
    const { server, close } = startWebServer({
      port: 0,
      root: ROOT,
      handler: makeHandler(),
    })
    // 等待监听。
    await new Promise((resolve) => server.once('listening', resolve))
    // 实际端口。
    const { port } = server.address()
    // 静态。
    const index = await fetch(`http://127.0.0.1:${port}/`)
    expect(index.status).toBe(200)
    expect(await index.text()).toContain('fixture-home')
    // 代理。
    const health = await fetch(`http://127.0.0.1:${port}/ai-proxy/health`)
    expect(health.status).toBe(200)
    expect((await health.json()).ok).toBe(true)
    // 穿越（编码形式，绕过 fetch 自身的 URL 规范化）。
    const traversal = await fetch(`http://127.0.0.1:${port}/..%2Fserver.js`)
    expect([403, 404]).toContain(traversal.status)
    // 关闭。
    await close()
  })
})
