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

// #createNodeModLoader
// 用文件系统源创建加载器。
//
// @param {object} params
// @param {string} params.modsDir - mods 目录
// @param {object} [params.log] - 日志器
// @param {string[]} [params.only] - 只加载这些 Mod
// @returns {Promise<object>} 加载器（见 loader.js）
export async function createNodeModLoader({ modsDir, log, only } = {}) {
  // 建源 + 建加载器。
  return createModLoader({ source: createNodeSource(modsDir), log, only })
}
