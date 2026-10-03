/**
 * demo-runtime-mod / server.js —— Node 侧用同一个依赖（**相对路径**导入）
 *
 * 为什么 Node 侧不用 `require('fflate')`：
 *   本文件是被原生 `import()` 加载的**真 ESM 模块**（见 src/mod/host-node.js），
 *   而引擎注入的 `require` 只给浏览器侧的 `code.js`。原生 ESM 里最自然的写法就是
 *   **相对路径**导入同一个 vendor 文件 —— 它本来就能用，不需要引擎做任何事。
 *
 * 两侧的差异是真实存在的，不是遗漏：
 *   · 浏览器 `code.js`：没有模块系统 → 引擎预先加载 + 注入同步 `require`
 *   · Node `server.js`：本来就是模块 → 相对路径导入（或原生裸说明符，只要有 node_modules）
 *   两侧共用**同一个 vendor 文件**，所以依赖只分发一份。
 */

// 相对路径导入随包分发的自包含单文件（原生 ESM，零构建）。
import { strFromU8, strToU8, unzipSync, zipSync } from './vendor/fflate.mjs'

/**
 * 注册后端处理器。
 *
 * @param {object} ctx
 * @param {(name: string, fn: Function) => void} ctx.handle - 注册命名处理器
 * @param {object} ctx.log - 日志器
 */
export default function setup({ handle, log }) {
  // 日志。
  log?.debug?.('demo-runtime-mod 注册处理器')

  // #zipRoundTrip —— 用运行时依赖做一次真实往返
  handle('zipRoundTrip', ({ text }) => {
    // 打包。
    const zip = zipSync({ 'a.txt': strToU8(String(text)) }, { level: 6 })
    // 解回来。
    const back = unzipSync(zip)
    // 返回。
    return { zipBytes: zip.length, text: strFromU8(back['a.txt']) }
  })

  // #whereIsDep —— 证明依赖来自包内 vendor 文件（而不是宿主环境）
  handle('whereIsDep', async () => {
    // 定位本文件。
    const path = await import('node:path')
    const url = await import('node:url')
    // vendor 文件是否存在。
    const fs = await import('node:fs')
    // 本文件目录。
    const here = path.dirname(url.fileURLToPath(import.meta.url))
    // 返回。
    return { dep: 'vendor/fflate.mjs', exists: fs.existsSync(path.join(here, 'vendor', 'fflate.mjs')) }
  })
}
