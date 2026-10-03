/**
 * mod/modules-node — 运行时模块的 Node 侧加载适配器
 *
 * 给 `createModuleRegistry` 提供一个 `load` 实现：**用原生 `import()` 加载随包分发的模块文件**。
 *
 * 为什么 Node 侧用真模块而不是读文本再 eval：
 *   `server.js` 与它的依赖本来就是 ESM 文件，走 Node 自己的模块系统能拿到
 *   正确的模块语义（单例缓存、`import.meta`、循环引用处理），而且**零解析开销**。
 *   浏览器侧没有这条路（见 modules.js 的说明），只能用 blob URL —— 差异被 `load` 这一次注入吸收。
 *
 * 注意：本模块只被 Node 侧引用（CLI / Electron），浏览器打包时不要引入它。
 */

// Node 内置：文件路径 → file:// URL。
import { pathToFileURL } from 'node:url'
// Node 内置：拼路径。
import { join } from 'node:path'

// #createNodeModuleLoader
// 造一个基于文件系统的模块加载器。
//
// @param {object} params
// @param {string} params.modsDir - Mods 根目录
// @returns {Function} load({ modName, path }) => Promise<namespace>
export function createNodeModuleLoader({ modsDir } = {}) {
  // 返回适配器。
  return async function load({ modName, path: rel }) {
    // 绝对路径。
    const abs = join(modsDir, modName, rel)
    // 原生导入（Node 会按文件内容与就近 package.json 判定 CJS/ESM）。
    return import(pathToFileURL(abs).href)
  }
}
