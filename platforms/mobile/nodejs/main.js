/**
 * APK 内置 Node 运行时的入口（nodejs-mobile 直接执行的就是这个文件）
 *
 * 启动链：MainActivity → NodeRuntime.java（把 assets/nodejs-project 复制到 filesDir）
 *        → node::Start(["node", <filesDir>/nodejs-project/main.js, "<port>"]) → 本文件
 *        → require('./proxy.js')（esbuild 打好的 game-engine 代理）→ 监听 127.0.0.1:<port>
 * 前端（WebView）随后直连 http://127.0.0.1:<port>/v1/chat/completions。
 *
 * 用法：
 *   node main.js            # 默认端口 8787
 *   node main.js 9000       # 指定端口（Java 层按 NodeRuntime.PROXY_PORT 传入）
 *   LIFERESTART_PROXY_MOCK=1 node main.js   # 演示模式（CI 冒烟用，无需 API Key）
 *
 * 注意（nodejs-mobile 的移动端差异，见平台 README）：
 *   · process.cwd() 是文件系统根目录，不能依赖相对路径找资源 → 这里只用 __dirname
 *   · 只有一个 Node 实例，进程退出后无法在同一 App 进程里重启
 *   · child_process 不可用（本代理不需要）
 */

// 路径（产物与入口同目录）。
const path = require('node:path')
// 打包产物：game-engine 的代理实现（单文件 CJS）。
const { startProxyServer, PROVIDER_CONFIGS } = require(path.join(__dirname, 'proxy.js'))

// 端口：命令行 > 环境变量 > 8787。
// ⚠️ 8787 必须与两处保持一致：Java 的 NodeRuntime.PROXY_PORT、前端 utils/mod-runtime.js 的
//    NATIVE_AI_PROXY_PORT；有契约测试会解析这三个文件比对（改一处漏一处会红）。
const PORT = Number(process.argv[2] || process.env.LIFERESTART_PROXY_PORT || 8787)
// 监听地址：只监听回环（不要暴露到局域网，请求体里带用户 API Key）。
const HOST = '127.0.0.1'
// 演示模式（默认路由 mock）。
const MOCK = process.env.LIFERESTART_PROXY_MOCK === '1'

// 日志：nodejs-mobile 里 stdout/stderr 已被 JNI 层接到 logcat（Tag: LiferestartNode）。
function logLine(message) {
  console.log(`[proxy] ${message}`)
}

// 启动。
let server
try {
  server = startProxyServer({ port: PORT, host: HOST, mock: MOCK, log: console })
} catch (err) {
  // 端口被占用等启动失败：明确报错（前端会看到「测试连接」失败，logcat 里能看到原因）。
  console.error(`[proxy] 启动失败（port=${PORT}）：${err && err.message}`)
  process.exitCode = 1
  throw err
}

// 启动横幅（设备上可在 logcat 里看到，用于确认「Node 到底起来没有」）。
logLine(`AI 代理已启动：${server.url}`)
logLine(`模式：${MOCK ? '本地演示（默认路由 mock）' : '真实服务商转发（请求需带 apiKey）'}`)
logLine('路由：POST /v1/chat/completions、GET /health')
logLine(`可用服务商：${Object.keys(PROVIDER_CONFIGS).join(', ')}`)

// 退出清理（Android 杀进程时一般收不到信号，这里只是保持与桌面端一致的行为）。
process.on('SIGTERM', () => {
  Promise.resolve(server.close())
    .then(() => logLine('已关闭'))
    .catch((err) => console.error(`[proxy] 关闭出错：${err && err.message}`))
})
