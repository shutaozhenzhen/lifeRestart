/**
 * 冒烟：用**普通 Node** 把「APK 内置 Node 侧」跑一遍（Step 25 延伸）
 *
 * 价值：设备上的 nodejs-mobile 我们没法在 CI 里运行，但**跑的是同一份 JS**。
 * 所以这里用桌面 Node 起 `nodejs-build/main.js`，确认三件事：
 *   1. 打包产物能被 require（esbuild 打出来的 CJS 没把引擎漏掉）
 *   2. HTTP 服务真的起来了（GET /health）
 *   3. 对话路由能返回内容（POST /v1/chat/completions，mock 服务商，SSE 流式）
 * 这样就排除了「代码/打包错」这一大类问题，剩下的只有「原生侧装载」那一小类——
 * 而原生侧由 APK 内容校验（libnode.so / libnodejs_jni.so / assets 是否打进包）覆盖。
 *
 * 用法：
 *   node scripts/smoke-node-project.js              # 默认端口 18787
 *   node scripts/smoke-node-project.js --port 19000
 */

// 子进程（起 Node 服务）。
import { spawn } from 'node:child_process'
// 路径。
import path from 'node:path'
// 定位本脚本目录 + 判断是否被直接执行。
import { fileURLToPath, pathToFileURL } from 'node:url'

// 本目录（scripts/）。
const HERE = path.dirname(fileURLToPath(import.meta.url))
// mobile 包根。
const ROOT = path.join(HERE, '..')
// 默认产物目录（build-node-project.js 的输出）。
export const DEFAULT_BUILD_DIR = path.join(ROOT, 'nodejs-build')

// #sleep
// 等待若干毫秒。
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// #waitForHealth
// 轮询 /health 直到服务起来或超时。
//
// @param {string} baseUrl - 服务根地址
// @param {number} timeoutMs - 超时毫秒
// @returns {Promise<object>} 健康检查响应体
async function waitForHealth(baseUrl, timeoutMs) {
  // 截止时间。
  const deadline = Date.now() + timeoutMs
  // 最后一次错误（超时时报出来，便于定位）。
  let lastError = null
  // 轮询。
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`)
      if (res.ok) return await res.json()
      lastError = new Error(`/health 返回 ${res.status}`)
    } catch (error) {
      lastError = error
    }
    await sleep(250)
  }
  throw new Error(`等待 ${baseUrl}/health 超时（${timeoutMs}ms）：${lastError && lastError.message}`)
}

// #runSmoke
// 起服务 → 健康检查 → 跑一次 mock 对话 → 关掉服务。
//
// @param {object} [options]
// @param {number} [options.port] - 端口（默认 18787，避开开发时常用的 8787）
// @param {string} [options.buildDir] - 产物目录
// @param {number} [options.timeoutMs] - 启动等待上限
// @param {Function} [options.log] - 日志函数
// @returns {Promise<{baseUrl: string, health: object, chatStatus: number, chatText: string, nodeOutput: string}>}
export async function runSmoke({
  port = 18787,
  buildDir = DEFAULT_BUILD_DIR,
  timeoutMs = 30000,
  log = console.log,
} = {}) {
  // 服务根地址。
  const baseUrl = `http://127.0.0.1:${port}`
  // 启动 Node（与设备上 Java 层传参方式一致：main.js + 端口）。
  const child = spawn(process.execPath, [path.join(buildDir, 'main.js'), String(port)], {
    cwd: buildDir,
    // mock 模式：无需 API Key，便于 CI 与本地冒烟。
    env: { ...process.env, LIFERESTART_PROXY_MOCK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  // 收集输出（失败时附在错误信息里）。
  let nodeOutput = ''
  child.stdout.on('data', (chunk) => {
    nodeOutput += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    nodeOutput += String(chunk)
  })
  // 退出码（提前挂上，避免未捕获事件）。
  let exitInfo = null
  child.on('exit', (code, signal) => {
    exitInfo = { code, signal }
  })

  try {
    // 1) 等服务起来。
    const health = await waitForHealth(baseUrl, timeoutMs)
    log(`[smoke] /health → ${JSON.stringify(health)}`)
    // 2) 对话路由（mock 服务商，SSE 流式）。
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'mock',
        model: 'mock-chat',
        messages: [{ role: 'user', content: '冒烟测试' }],
        stream: true,
      }),
    })
    // 读完整响应（SSE 会被一次性读完）。
    const chatText = await res.text()
    log(`[smoke] POST /v1/chat/completions → ${res.status}，${chatText.length} 字节`)
    // 3) 断言在调用方（这里只回传事实，便于测试断言与 CI 打印）。
    return { baseUrl, health, chatStatus: res.status, chatText, nodeOutput }
  } catch (error) {
    // 失败时把 Node 的输出带上——否则只剩一句"超时"，没法定位。
    throw new Error(`${error.message}\n--- Node 输出 ---\n${nodeOutput || '(空)'}\n--- 进程状态 ---\n${JSON.stringify(exitInfo)}`)
  } finally {
    // 收尾：先 SIGTERM，1.5 秒后强杀（不阻塞 CI）。
    if (!child.killed) child.kill()
    await Promise.race([
      new Promise((resolve) => child.on('exit', resolve)),
      sleep(1500).then(() => {
        if (!child.killed) child.kill('SIGKILL')
      }),
    ])
  }
}

// 仅在被直接执行时跑主流程。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // --port 解析。
  const portIndex = process.argv.indexOf('--port')
  const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 18787
  // 跑冒烟。
  const result = await runSmoke({ port })
  // 校验（CLI 场景直接在这里失败，退出码非 0 即 CI 红）。
  if (result.chatStatus !== 200 || !result.chatText.includes('data:')) {
    console.error(`[smoke] 对话路由不符合预期：status=${result.chatStatus}`)
    process.exit(1)
  }
  console.log('[smoke] 通过：打包产物可启动、健康检查与对话路由均正常')
}
