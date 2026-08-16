/**
 * 移动端构建脚本（Step 25）
 *
 * 构建前端 → 复制到 www/（Capacitor webDir）。
 * 之后执行 npx cap sync android 生成/同步 Android 工程。
 */

// Node 模块。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// require（解析 vite bin）。
const require = createRequire(import.meta.url)
// 本目录。
const HERE = path.dirname(fileURLToPath(import.meta.url))
// mobile 根。
const ROOT = path.join(HERE, '..')
// 前端目录。
const FRONTEND = path.join(ROOT, '..', '..', 'packages', 'frontend')
// 前端产物。
const FRONTEND_DIST = path.join(FRONTEND, 'dist')
// 目标。
const WWW = path.join(ROOT, 'www')

// 构建前端。
console.log('[mobile] 构建前端…')
// vite bin。
const vitePkg = require.resolve('vite/package.json', { paths: [FRONTEND] })
// 执行 vite。
await new Promise((resolve, reject) => {
  // spawn。
  const child = spawn(process.execPath, [path.join(path.dirname(vitePkg), 'bin', 'vite.js'), 'build'], {
    cwd: FRONTEND,
    stdio: 'inherit',
    windowsHide: true,
  })
  // 完成。
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`前端构建失败（exit ${code}）`))))
})

// 复制到 www。
await fs.rm(WWW, { recursive: true, force: true })
await fs.cp(FRONTEND_DIST, WWW, { recursive: true })
console.log(`[mobile] 静态产物 → ${WWW}`)
console.log('[mobile] 完成。下一步：npx cap sync android（需 Android SDK）')
