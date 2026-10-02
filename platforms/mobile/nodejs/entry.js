/**
 * APK 内置 Node 侧：AI 代理的打包入口（ESM）
 *
 * 这个文件不会被直接执行——`scripts/build-node-project.js` 用 esbuild 把它连同
 * game-engine 的代理实现打成**单文件 CJS**（`nodejs-build/proxy.js`），
 * 再由 `main.js` 在设备上 require。设备上跑的代码与桌面/Web 版是**同一份实现**。
 *
 * 为什么不直接打包 `packages/game-engine/server.js`：
 *   server.js 里有**顶层 await**（启动横幅 + 退出钩子），esbuild 打成 CJS 时会直接报错
 *   （top-level await 不支持 cjs 输出）。这里改成导出函数、由 main.js 调用，行为一致。
 */

// 代理核心（单一实现，桌面/Web/移动共用）。
import { startProxy, PROVIDER_CONFIGS } from 'game-engine/src/ai/ai-proxy.js'

// #startProxyServer
// 启动 AI 代理服务。
//
// @param {object} [options]
// @param {number} [options.port] - 监听端口（默认 8787，与前端 NATIVE_AI_PROXY_PORT 一致）
// @param {string} [options.host] - 监听地址（默认只监听回环，不暴露到局域网）
// @param {boolean} [options.mock] - 本地演示模式（默认路由 mock，无需 API Key；CI 冒烟用）
// @param {object} [options.log] - 日志对象（注入 console 即可）
// @returns {{url: string, close: Function}} 服务地址与关闭函数
export function startProxyServer({ port = 8787, host = '127.0.0.1', mock = false, log = console } = {}) {
  // mock 模式下把默认 provider 指向 mock，请求不带 provider 也能跑通。
  return startProxy({ port, host, log, ...(mock ? { defaultProvider: 'mock' } : {}) })
}

// 服务商表（打印用；也让打包器确认这一段真的进了产物）。
export { PROVIDER_CONFIGS }
