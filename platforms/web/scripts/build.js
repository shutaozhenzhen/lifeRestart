/**
 * Web/Termux 版构建 + 分发打包（Step 24）
 *
 * 流程：
 *   1. 构建前端（packages/frontend → vite build → dist/）。
 *   2. 复制构建产物到 public/（服务器静态根）。
 *   3. 用 archiver 打 zip（node + public + server.js + package.json + README），
 *      产出 release/liferestart-web.zip —— 解压即可运行，Termux 同款。
 *
 * 用法：node scripts/build.js
 */

// Node 模块。
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// zip 打包。
import archiver from 'archiver'

// require（ESM 内解析 vite bin 路径）。
const require = createRequire(import.meta.url)

// 本目录（scripts/）。
const HERE = path.dirname(fileURLToPath(import.meta.url))
// web 平台根。
const ROOT = path.join(HERE, '..')
// 前端源码目录。
const FRONTEND = path.join(ROOT, '..', '..', 'packages', 'frontend')
// 前端构建产物。
const FRONTEND_DIST = path.join(FRONTEND, 'dist')
// 静态根。
const PUBLIC = path.join(ROOT, 'public')
// 发布目录。
const RELEASE = path.join(ROOT, 'release')
// 引擎源码目录（打包进分发，保持 bare import 可解析）。
const ENGINE = path.join(ROOT, '..', '..', 'packages', 'game-engine')

// 打包排除（测试/夹具/CLI 原型/node_modules 不进分发）。
const EXCLUDE = (p) =>
  p.endsWith('.spec.js') ||
  p.includes(`${path.sep}cli${path.sep}`) ||
  p.includes(`${path.sep}fixtures${path.sep}`) ||
  p.includes(`${path.sep}node_modules${path.sep}`) ||
  p.endsWith(`${path.sep}node_modules`)

// #buildFrontend
// 构建前端（node 直接跑 vite bin，避免 Windows 上 npx.cmd spawn 问题）。
async function buildFrontend() {
  // 提示。
  console.log('[build] 构建前端…')
  // vite bin（vite 的 exports 不暴露 ./bin/vite.js，经 package.json 解析目录后拼接）。
  const vitePkg = require.resolve('vite/package.json', { paths: [FRONTEND] })
  // bin 路径。
  const viteBin = path.join(path.dirname(vitePkg), 'bin', 'vite.js')
  // 执行。
  await new Promise((resolve, reject) => {
    // spawn（node 执行，跨平台）。
    const child = spawn(process.execPath, [viteBin, 'build'], {
      cwd: FRONTEND,
      stdio: 'inherit',
      windowsHide: true,
    })
    // 完成。
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`前端构建失败（exit ${code}）`))))
  })
}

// #copyDirFiltered
// 递归复制（带排除过滤）。
//
// @param {string} src - 源
// @param {string} dest - 目标
// @param {Function} exclude - (绝对路径) => boolean 是否排除
async function copyDirFiltered(src, dest, exclude) {
  // 创建目标。
  await fs.mkdir(dest, { recursive: true })
  // 遍历。
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    // 源路径。
    const s = path.join(src, entry.name)
    // 排除。
    if (exclude(s)) continue
    // 目标路径。
    const d = path.join(dest, entry.name)
    // 目录。
    if (entry.isDirectory()) {
      await copyDirFiltered(s, d, exclude)
    } else {
      // 文件。
      await fs.copyFile(s, d)
    }
  }
}

// #makeZip
// 打包 zip（node 运行时 + 静态 + 服务 + 说明）。
async function makeZip() {
  // 输出。
  const out = path.join(RELEASE, 'liferestart-web.zip')
  // 创建目录。
  await fs.mkdir(RELEASE, { recursive: true })
  // 提示。
  console.log('[build] 打包 zip…')
  // Promise。
  await new Promise((resolve, reject) => {
    // 输出流。
    const output = createWriteStream(out)
    // 归档器。
    const archive = archiver('zip', { zlib: { level: 9 } })
    // 完成。
    output.on('close', resolve)
    // 错误。
    archive.on('error', reject)
    // 管道。
    archive.pipe(output)
    // 静态文件。
    archive.directory(PUBLIC, 'public')
    // 引擎核心（分发自包含：node_modules/game-engine，bare import 可解析）。
    archive.directory(path.join(ROOT, 'bundle', 'game-engine'), 'node_modules/game-engine')
    // 服务端文件。
    archive.file(path.join(ROOT, 'server.js'), { name: 'server.js' })
    archive.file(path.join(ROOT, 'package.json'), { name: 'package.json' })
    archive.file(path.join(ROOT, 'README.md'), { name: 'README.md' })
    // 开始。
    archive.finalize()
  })
  // 提示。
  console.log(`[build] 已生成 ${out}`)
}

// 主流程。
// 1. 构建前端。
await buildFrontend()
// 2. 复制到 public。
await fs.rm(PUBLIC, { recursive: true, force: true })
await copyDirFiltered(FRONTEND_DIST, PUBLIC, () => false)
console.log(`[build] 静态产物 → ${PUBLIC}`)
// 2.5 引擎核心副本（进 zip 的 node_modules/game-engine）。
const BUNDLE_ENGINE = path.join(ROOT, 'bundle', 'game-engine')
await fs.rm(path.join(ROOT, 'bundle'), { recursive: true, force: true })
await copyDirFiltered(ENGINE, BUNDLE_ENGINE, EXCLUDE)
console.log(`[build] 引擎核心 → ${BUNDLE_ENGINE}`)
// 3. 打包 zip。
await makeZip()
// 清理临时 bundle。
await fs.rm(path.join(ROOT, 'bundle'), { recursive: true, force: true })
console.log('[build] 完成')
