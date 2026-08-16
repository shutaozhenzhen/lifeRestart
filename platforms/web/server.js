/**
 * Web + Termux 服务器（Step 24）
 *
 * 单进程双职责：
 *   1. 静态文件服务：前端构建产物（public/，含 index.html + assets）。
 *   2. 内嵌 AI 代理：/ai-proxy/* 路由 → game-engine 的 createProxyHandler
 *      （单一实现复用，Step 16/17 的 provider 路由 / SSE 流式 / CORS 全部继承）。
 *
 * 用法：
 *   node server.js                    # 默认 127.0.0.1:8080
 *   PORT=9000 node server.js          # 自定义端口
 *   MOCK=1 node server.js             # 默认路由 mock（无需 Key 演示）
 *
 * Termux（Android）：
 *   pkg install nodejs-lts && unzip liferestart-web.zip && cd liferestart-web && node server.js
 *
 * 结构：
 *   createRequestHandler()  —— 纯逻辑路由（静态 + 代理前缀剥离，可单测）
 *   startWebServer()        —— Node http 启动
 */

// 内置模块。
import { createServer } from 'node:http'
import { URL } from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'
// AI 代理核心（单一实现）。
import { createProxyHandler } from 'game-engine/src/ai/ai-proxy.js'

// MIME 类型表。
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

// #createRequestHandler
// 创建请求路由：/ai-proxy/* → 内嵌 AI 代理；其余 → 静态文件。
//
// @param {object} [opts]
// @param {string} [opts.root] - 静态文件根目录（缺省 public/）
// @param {Function} [opts.proxy] - AI 代理处理器（缺省 createProxyHandler）
// @param {object} [opts.log] - 日志器
// @returns {Function} (req, res) => Promise<void>
export function createRequestHandler({ root = 'public', proxy, log } = {}) {
  // 静态根目录（绝对路径）。
  const staticRoot = path.resolve(root)
  // AI 代理处理器。
  const proxyHandler = proxy || createProxyHandler({ log })
  // 日志器。
  const logger = log || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

  // #sendText
  // 简单文本响应。
  //
  // @param {object} res - 响应
  // @param {number} status - 状态码
  // @param {string} text - 内容
  // @param {string} type - Content-Type
  function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
    // 写入。
    res.writeHead(status, { 'Content-Type': type })
    // 结束。
    res.end(text)
  }

  // #serveStatic
  // 静态文件服务（带路径穿越防护 + index.html 兜底）。
  //
  // @param {string} pathname - 请求路径
  // @param {object} res - 响应
  // @returns {Promise<boolean>} 是否已处理
  async function serveStatic(pathname, res) {
    // 规范化：去除 query（调用方已剥离）。
    let rel = decodeURIComponent(pathname)
    // 目录 → index.html。
    if (rel.endsWith('/')) rel += 'index.html'
    // 拼接绝对路径。
    const filePath = path.resolve(staticRoot, '.' + rel)
    // 路径穿越防护：必须位于根目录内。
    if (filePath !== staticRoot && !filePath.startsWith(staticRoot + path.sep)) {
      // 记录。
      logger.warn(`[web] 路径穿越拦截: ${pathname}`)
      // 拒绝。
      sendText(res, 403, 'Forbidden')
      // 已处理。
      return true
    }
    // 尝试读取。
    try {
      // 读取文件。
      const data = await fs.readFile(filePath)
      // 扩展名。
      const ext = path.extname(filePath).toLowerCase()
      // 内容类型。
      const type = MIME[ext] || 'application/octet-stream'
      // 响应。
      res.writeHead(200, { 'Content-Type': type })
      // 结束。
      res.end(data)
      // 记录。
      logger.debug(`[web] 200 ${pathname}`)
      // 已处理。
      return true
    } catch {
      // 不存在：SPA 兜底（hash 路由下通常只请求 '/'，兜底仅防御）。
      if (!pathname.startsWith('/assets/')) {
        // 尝试 index.html。
        try {
          // 读取。
          const data = await fs.readFile(path.join(staticRoot, 'index.html'))
          // 响应。
          res.writeHead(200, { 'Content-Type': MIME['.html'] })
          // 结束。
          res.end(data)
          // 已处理。
          return true
        } catch {
          // 无 index.html。
          sendText(res, 404, 'Not Found')
          // 已处理。
          return true
        }
      }
      // assets 缺失直接 404。
      sendText(res, 404, 'Not Found')
      // 已处理。
      return true
    }
  }

  // #handler
  // 请求路由。
  //
  // @param {object} req - 请求
  // @param {object} res - 响应
  // @returns {Promise<void>}
  async function handler(req, res) {
    // 原始路径（未解析，用于穿越检测——URL 解析会吞掉 ../）。
    const rawPath = req.url.split('?')[0]
    // 原始路径含 .. 段：直接拒绝。
    if (rawPath.split('/').includes('..')) {
      // 记录。
      logger.warn(`[web] 路径穿越拦截: ${rawPath}`)
      // 拒绝。
      sendText(res, 403, 'Forbidden')
      // 完成。
      return
    }
    // 解析 URL。
    const url = new URL(req.url, 'http://localhost')
    // /ai-proxy/* → 内嵌 AI 代理（剥离前缀后透传）。
    if (url.pathname === '/ai-proxy' || url.pathname.startsWith('/ai-proxy/')) {
      // 剥离前缀（保留 query）。
      req.url = url.pathname.replace(/^\/ai-proxy/, '') + url.search
      // 记录。
      logger.debug(`[web] → AI 代理 ${req.url}`)
      // 交给代理。
      return proxyHandler(req, res)
    }
    // 其余 → 静态文件。
    return serveStatic(url.pathname, res)
  }

  // 返回。
  return handler
}

// #startWebServer
// 启动 Web 服务器。
//
// @param {object} [opts]
// @param {number} [opts.port] - 端口（默认 8080）
// @param {string} [opts.host] - 监听地址（默认 127.0.0.1）
// @param {string} [opts.root] - 静态根目录
// @param {Function} [opts.handler] - 请求处理器（缺省 createRequestHandler）
// @returns {object} { server, url, close }
export function startWebServer({ port = 8080, host = '127.0.0.1', root, handler } = {}) {
  // 请求处理器。
  const h = handler || createRequestHandler({ root })
  // HTTP 服务。
  const server = createServer((req, res) => {
    // 执行。
    Promise.resolve(h(req, res)).catch((e) => {
      // 未发送响应头 → 500。
      if (!res.headersSent) {
        // 返回。
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(`服务器错误: ${e.message}`)
      } else {
        // 中断。
        res.destroy()
      }
    })
  })
  // 监听。
  server.listen(port, host)
  // 返回。
  return {
    server,
    url: `http://${host}:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

// 直接执行（node server.js）。
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1])))) {
  // 端口。
  const port = Number(process.env.PORT || 8080)
  // 监听地址。
  const host = process.env.HOST || '127.0.0.1'
  // mock 模式（默认路由 mock）。
  const mock = process.env.MOCK === '1'
  // 启动。
  const { url, close } = startWebServer({
    port,
    host,
    root: 'public',
    // 内嵌 AI 代理（mock 模式默认路由 mock）。
    handler: createRequestHandler({ root: 'public', proxy: createProxyHandler({ log: console, defaultProvider: mock ? 'mock' : 'openai' }) }),
  })
  // 横幅。
  console.log('')
  console.log('🌐 人生重开模拟器 Web/Termux 版已启动')
  console.log(`   地址: http://${host}:${port}`)
  console.log(`   模式: ${mock ? 'AI 演示（mock，无需 Key）' : '真实服务商转发（AI 设置页配置 Key）'}`)
  console.log(`   静态: ${path.resolve('public')}`)
  console.log(`   AI:   POST ${url}/ai-proxy/v1/chat/completions（内嵌代理，SSE 流式支持）`)
  console.log('')
  // 退出清理。
  process.on('SIGINT', async () => {
    // 关闭。
    await close()
    // 提示。
    console.log('\n[web] 已关闭')
    // 退出。
    process.exit(0)
  })
}
