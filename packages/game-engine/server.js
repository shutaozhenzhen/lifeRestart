/**
 * AI 代理独立启动入口（Step 16/17）
 *
 * 用法（在 packages/game-engine/ 下执行）：
 *   node server.js                # 默认 127.0.0.1:8787，真实服务商转发
 *   node server.js --port 9000    # 自定义端口
 *   node server.js --mock         # 本地演示模式（默认路由 mock，无需 API Key）
 *   node server.js --mock --port 9000
 *   PORT=9000 node server.js      # 环境变量指定端口
 *
 * 职责：接收前端/CLI 的 AI 调用请求（含用户 API Key），按 provider 路由转发，
 *       追加 CORS 响应头，透传 SSE 流式响应。Web/Termux/Electron 平台复用。
 *
 * curl 演示（流式，无需 Key）：
 *   curl -N http://127.0.0.1:8787/v1/chat/completions \
 *     -H "Content-Type: application/json" \
 *     -d '{"provider":"mock","model":"mock-chat","messages":[{"role":"user","content":"你好"}],"stream":true}'
 */

// 代理核心（单一实现）。
import { createProxyHandler, startProxy, PROVIDER_CONFIGS } from './src/ai/ai-proxy.js'

// 解析命令行参数（--key value / --flag 两种形态）。
const args = process.argv.slice(2)
// 读取参数值。
const getArg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
// 端口：--port > PORT 环境变量 > 8787。
const port = Number(getArg('--port') || process.env.PORT || 8787)
// mock 模式：--mock > MOCK=1。
const mock = args.includes('--mock') || process.env.MOCK === '1'
// 监听地址：--host > HOST 环境变量 > 127.0.0.1。
const host = getArg('--host') || process.env.HOST || '127.0.0.1'

// 日志（注入 console 输出）。
const log = {
  debug: (m) => console.log(`[proxy][debug] ${m}`),
  info: (m) => console.log(`[proxy][info] ${m}`),
  warn: (m) => console.warn(`[proxy][warn] ${m}`),
  error: (m) => console.error(`[proxy][error] ${m}`),
}

// 启动（mock 模式：请求未指定 provider 时默认路由 mock）。
const { url, close } = startProxy({
  port,
  host,
  log,
  // mock 模式默认路由。
  ...(mock ? { defaultProvider: 'mock' } : {}),
})

// 启动横幅。
console.log('')
console.log('🤖 AI 代理已启动')
console.log(`   地址: http://${host}:${port}`)
console.log(`   模式: ${mock ? '本地演示（默认路由 mock，无需 API Key）' : '真实服务商转发（需请求携带 apiKey）'}`)
console.log('   路由:')
console.log('     POST /v1/chat/completions   对话（body: provider/apiKey/model/messages/max_tokens/stream）')
console.log('     GET  /health                 健康检查')
console.log('   CORS: 全开（浏览器直连可用）')
console.log('')
console.log('   curl 演示（流式，本地演示服务商无需 Key）:')
console.log(`   curl -N ${url}/v1/chat/completions -H "Content-Type: application/json" -d '{"provider":"mock","model":"mock-chat","messages":[{"role":"user","content":"你好"}],"stream":true}'`)
console.log('')
console.log('   可用服务商:')
// 逐行打印服务商。
for (const [name, cfg] of Object.entries(PROVIDER_CONFIGS)) {
  // 名称左对齐。
  console.log(`     ${String(name).padEnd(9)} ${cfg.label}  (${cfg.baseUrl})`)
}
console.log('')

// 退出清理（Ctrl+C）。
process.on('SIGINT', async () => {
  // 关闭服务。
  await close()
  // 提示。
  console.log('\n[proxy] 已关闭')
  // 退出。
  process.exit(0)
})
