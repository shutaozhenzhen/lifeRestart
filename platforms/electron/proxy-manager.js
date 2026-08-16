/**
 * AI 代理进程管理器（Step 23 Electron 主进程）
 *
 * 职责：启动/停止 game-engine 的 AI 代理服务（node server.js）子进程，
 *       轮询 /health 确认就绪，退出时确保清理。
 *
 * 可测试性：spawn/fetch 注入式（测试用 mock），不依赖真实子进程。
 */

// 子进程。
const { spawn } = require('node:child_process')

// #createProxyManager
// 创建代理进程管理器。
//
// @param {object} [deps]
// @param {Function} [deps.spawnFn] - spawn 实现（缺省 node:child_process.spawn）
// @param {Function} [deps.fetchFn] - fetch 实现（缺省全局 fetch）
// @param {object} [deps.log] - 日志器（info/warn/error）
// @returns {object} { start, stop }
function createProxyManager({ spawnFn, fetchFn, log } = {}) {
  // spawn 实现。
  const doSpawn = spawnFn || spawn
  // fetch 实现。
  const doFetch = fetchFn || (typeof fetch !== 'undefined' ? fetch : null)
  // 日志器。
  const logger = log || { info: () => {}, warn: () => {}, error: () => {} }

  // #waitHealth
  // 轮询 /health 直到就绪或超时。
  //
  // @param {string} baseUrl - 代理地址
  // @param {number} timeout - 超时毫秒
  // @param {number} interval - 轮询间隔毫秒
  // @returns {Promise<boolean>} 是否就绪
  async function waitHealth(baseUrl, timeout, interval) {
    // 起始时间。
    const start = Date.now()
    // 轮询。
    while (Date.now() - start < timeout) {
      // 尝试请求。
      try {
        // 无 fetch 直接失败。
        if (!doFetch) return false
        // 健康检查。
        const res = await doFetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(interval) })
        // 就绪。
        if (res.ok) return true
      } catch {
        // 未就绪，继续等待。
      }
      // 等待间隔。
      await new Promise((r) => setTimeout(r, interval))
    }
    // 超时。
    return false
  }

  // #start
  // 启动代理子进程并等待就绪。
  //
  // @param {object} opts
  // @param {string} opts.script - server.js 路径
  // @param {Array<string>} [opts.args] - 额外参数（如 --mock）
  // @param {number} [opts.port] - 代理端口（默认 8787）
  // @param {number} [opts.timeout] - 就绪超时毫秒（默认 15000）
  // @returns {Promise<{url: string, stop: Function}>} 代理句柄
  // @throws {Error} 启动失败（spawn 错误 / 就绪超时）
  async function start({ script, args = [], port = 8787, timeout = 15000 }) {
    // 启动子进程。
    const child = doSpawn(process.execPath, [script, '--port', String(port), ...args], {
      // 继承输出（便于调试）。
      stdio: ['ignore', 'pipe', 'pipe'],
      // Windows 隐藏窗口。
      windowsHide: true,
    })
    // 转发日志（标记前缀，与主进程日志区分）。
    child.stdout.on('data', (d) => logger.info(`[ai-proxy] ${String(d).trimEnd()}`))
    child.stderr.on('data', (d) => logger.warn(`[ai-proxy] ${String(d).trimEnd()}`))
    // 代理地址。
    const url = `http://127.0.0.1:${port}`
    // 等待就绪。
    const ready = await waitHealth(url, timeout, 300)
    // 未就绪。
    if (!ready) {
      // 终止子进程。
      child.kill()
      // 记录。
      logger.error(`AI 代理启动超时（${timeout}ms）: ${script}`)
      // 抛错。
      throw new Error(`AI 代理启动超时（${timeout}ms）`)
    }
    // 记录。
    logger.info(`AI 代理已就绪: ${url}`)
    // 返回句柄。
    return {
      url,
      // 停止。
      stop: () => stopProxy(child),
    }
  }

  // #stopProxy
  // 停止代理子进程（先 SIGTERM，超时强杀）。
  //
  // @param {object} child - 子进程句柄
  // @returns {Promise<void>}
  function stopProxy(child) {
    // 已退出。
    if (!child || child.exitCode !== null) return Promise.resolve()
    // 记录。
    logger.info('停止 AI 代理…')
    // 优雅终止。
    child.kill()
    // 等待退出（超时强杀）。
    return new Promise((resolve) => {
      // 退出监听。
      child.once('exit', () => resolve())
      // 强杀兜底。
      setTimeout(() => {
        // 未退出则强杀。
        if (child.exitCode === null) child.kill('SIGKILL')
        // 结束。
        resolve()
      }, 3000)
    })
  }

  // 返回管理器。
  return { start, stop: stopProxy }
}

// 导出。
module.exports = { createProxyManager }
