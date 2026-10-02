/**
 * 打包「APK 内置 Node 侧」（Step 25 延伸）
 *
 * 做什么：把 `nodejs/entry.js` 连同 game-engine 的 AI 代理实现打成**单文件 CJS**，
 *         再和 `main.js`、`package.json` 一起放进 `nodejs-build/`。
 *         随后由 `scripts/prepare-android.js` 复制到 `android/app/src/main/assets/nodejs-project/`，
 *         设备上由 nodejs-mobile 运行时执行 `main.js`。
 *
 * 为什么要打包成单文件：
 *   nodejs-mobile 从 filesDir 启动，require 相对路径没问题，但 game-engine 是 ESM + 多文件，
 *   而移动端运行时对 ESM/多文件依赖的处理不如 CJS 稳（社区做法一律是 bundle 成 CJS）。
 *   顺带也大幅减少 APK 里 assets 的文件数（启动时复制更快）。
 *
 * 用法：
 *   node scripts/build-node-project.js            # → nodejs-build/{proxy.js,main.js,package.json}
 *   node scripts/build-node-project.js --out DIR  # 自定义输出目录
 */

// 文件系统（异步）。
import fs from 'node:fs/promises'
// 路径。
import path from 'node:path'
// 定位本脚本目录。
import { fileURLToPath, pathToFileURL } from 'node:url'
// esbuild（打包器；显式声明在 devDependencies 里，不依赖 vite 的传递依赖）。
import * as esbuild from 'esbuild'

// 本目录（scripts/）。
const HERE = path.dirname(fileURLToPath(import.meta.url))
// mobile 包根目录。
const ROOT = path.join(HERE, '..')
// Node 侧源码目录。
const SRC_DIR = path.join(ROOT, 'nodejs')
// 默认输出目录。
export const DEFAULT_OUT = path.join(ROOT, 'nodejs-build')

// #NODE_TARGET
// 目标运行时：nodejs-mobile v18.20.4（与官方 release 一致）。
export const NODE_TARGET = 'node18'

// #BUNDLE_MARKERS
// 产物自检标记：这些字符串必须出现在 proxy.js 里，否则说明引擎没被打进去
// （例如 esbuild 把 game-engine 当成了外部依赖）——宁可构建期就失败，也不要出一个空壳 APK。
export const BUNDLE_MARKERS = ['/v1/chat/completions', '/health', 'createServer']

// #bundleProxy
// 把 entry.js + game-engine 打成单文件 CJS。
//
// @param {object} [options]
// @param {string} [options.entry] - 入口文件
// @param {string} [options.outfile] - 输出文件
// @returns {Promise<{outfile: string, bytes: number}>}
export async function bundleProxy({ entry = path.join(SRC_DIR, 'entry.js'), outfile = path.join(DEFAULT_OUT, 'proxy.js') } = {}) {
  // 输出目录。
  await fs.mkdir(path.dirname(outfile), { recursive: true })
  // 打包：platform=node（node: 内置模块自动视为外部依赖）、format=cjs（移动端只跑 CJS）。
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: NODE_TARGET,
    // 保留标识符，便于在 logcat/崩溃栈里认出来。
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
  })
  // 产物内容 + 自检。
  const code = await fs.readFile(outfile, 'utf8')
  // 缺少标记：直接失败（否则会在设备上表现为"代理起来了但请求 404"）。
  const missing = BUNDLE_MARKERS.filter((marker) => !code.includes(marker))
  if (missing.length > 0) {
    throw new Error(`打包产物不完整：proxy.js 里缺少标记 ${missing.join(', ')}（game-engine 可能没被打进去）`)
  }
  // 返回体积，便于 CI 里看趋势。
  return { outfile, bytes: Buffer.byteLength(code) }
}

// #buildNodeProject
// 完整流程：打包 proxy.js + 复制 main.js / package.json。
//
// @param {object} [options]
// @param {string} [options.out] - 输出目录
// @param {Function} [options.log] - 日志函数
// @returns {Promise<{out: string, files: string[], proxyBytes: number}>}
export async function buildNodeProject({ out = DEFAULT_OUT, log = console.log } = {}) {
  // 清空输出目录（避免上一次的残留文件被打进 APK）。
  await fs.rm(out, { recursive: true, force: true })
  await fs.mkdir(out, { recursive: true })
  // 1) 打包代理。
  const { outfile, bytes } = await bundleProxy({ outfile: path.join(out, 'proxy.js') })
  log(`[nodejs] proxy.js（game-engine 代理，CJS 单文件）→ ${outfile}（${(bytes / 1024).toFixed(1)} KB）`)
  // 2) 复制运行入口与 package.json（这两个是设备上直接用到的文件，不需要打包）。
  const copied = []
  for (const name of ['main.js', 'package.json']) {
    await fs.copyFile(path.join(SRC_DIR, name), path.join(out, name))
    copied.push(name)
    log(`[nodejs] ${name} → ${path.join(out, name)}`)
  }
  // 3) 汇总（文件列表供测试与 CI 日志使用）。
  const files = ['proxy.js', ...copied]
  log(`[nodejs] 完成：${files.length} 个文件，交给 prepare-android.js 复制进 assets`)
  return { out, files, proxyBytes: bytes }
}

// 仅在被直接执行时跑主流程（被测试 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 解析 --out。
  const outIndex = process.argv.indexOf('--out')
  const out = outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : DEFAULT_OUT
  await buildNodeProject({ out })
}
