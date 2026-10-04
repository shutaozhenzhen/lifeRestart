/**
 * source-scan — 测试用的**源码扫描**（守卫类用例共用）
 *
 * 有一类规矩没法用行为测试表达，只能读源码来钉住，例如：
 *   · 本应用用到的每个 localStorage 键都必须在「重置数据」清单里（reset-data.spec.js）
 *   · 前端**不许写死绝对站点路径** `/mods/`（子路径部署会 404，mod-runtime.spec.js）
 * 这类用例不需要 DOM，也不该各自抄一份目录遍历 —— 所以收敛到这里。
 */

// node 文件/路径。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 前端 src 目录（本文件在 src/test-utils/ 下）。
export const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

// #walkSourceFiles
// 递归列出 src 下的 .js / .vue 源码文件。
//
// 默认跳过：`*.spec.js`（测试自己可以随便写）与 `test-utils/`（测试装置）。
//
// @param {object} [params]
// @param {string} [params.dir] - 起始目录（缺省 src）
// @returns {string[]} 文件绝对路径
export function walkSourceFiles({ dir = SRC_DIR } = {}) {
  // 结果。
  const out = []
  // 逐项。
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // 全路径。
    const full = join(dir, entry.name)
    // 子目录。
    if (entry.isDirectory()) {
      // 跳过测试装置目录。
      if (entry.name === 'test-utils') continue
      // 递归。
      out.push(...walkSourceFiles({ dir: full }))
      continue
    }
    // 只收 js / vue。
    if (!['.js', '.vue'].includes(extname(entry.name))) continue
    // 跳过测试。
    if (entry.name.endsWith('.spec.js')) continue
    // 收。
    out.push(full)
  }
  // 返回。
  return out
}

// #readSourceFiles
// 读出全部源码（含内容），供正则扫描。
//
// @param {object} [params] - 同 walkSourceFiles
// @returns {Array<{file: string, text: string}>} 文件与内容
export function readSourceFiles(params) {
  // 逐个读。
  return walkSourceFiles(params).map((file) => ({ file, text: readFileSync(file, 'utf8') }))
}
