/**
 * mod/loader-node — Node 侧的加载器入口（便利封装）
 *
 * 为什么单独一个文件：
 *   平台无关的 loader 不能引用 `node:fs`（否则浏览器打包会炸）。
 *   于是 fs 只出现在 source-node.js 与本文件里 —— CLI / Electron / 脚本用这个入口，
 *   网页版用 createModLoader + createFetchSource（同一个内核）。
 */

// Node 文件源。
import { createNodeSource } from './source-node.js'
// 平台无关内核。
import { createModLoader } from './loader.js'
// Node 侧运行时模块加载器（Mod 随包分发的依赖，运行时解析）。
import { createNodeModuleLoader } from './modules-node.js'

// #createNodeModLoader
// 用文件系统源创建加载器。
//
// 默认接上 Node 侧的**运行时模块加载器**：Mod 在 `manifest.modules` 里声明的依赖
// （自包含单文件，随包分发）会在执行它的 code.js 之前被加载好，
// code.js 用注入的 `require(id)` 同步取用 —— 全程运行期，无任何构建步骤。
//
// @param {object} params
// @param {string} params.modsDir - mods 目录
// @param {object} [params.log] - 日志器
// @param {string[]} [params.only] - 只加载这些 Mod
// @returns {Promise<object>} 加载器（见 loader.js）
export async function createNodeModLoader({ modsDir, log, only } = {}) {
  // 建源 + 建加载器（带运行时模块适配器）。
  return createModLoader({
    // 文件源。
    source: createNodeSource(modsDir),
    // 日志。
    log,
    // 启用过滤。
    only,
    // 运行时模块：用原生 import() 加载 Mod 目录下的模块文件。
    moduleLoader: createNodeModuleLoader({ modsDir }),
  })
}
