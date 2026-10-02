/**
 * 移动端构建脚本（Step 25）
 *
 * 把前端产物（packages/frontend/dist）同步到 www/ —— 也就是 Capacitor 的 webDir。
 * 之后再由 `npx cap sync android` 把 www/ 灌进 Android 工程。
 *
 * 为什么默认「复用已有产物」：
 *   CI 与本地流程通常已经先跑过 `pnpm --filter frontend build`，
 *   若这里再无脑构建一次，等于每次打包都把前端建两遍（慢，且可能出现两份产物不一致）。
 *   只有产物缺失、或显式 `--rebuild` 时才自己调 vite 构建。
 *
 * 用法：
 *   node scripts/copy-dist.js             # 有完整产物就复用，缺失才构建
 *   node scripts/copy-dist.js --rebuild   # 强制重新构建前端
 */

// Node 模块。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// require（解析 vite bin）。
const require = createRequire(import.meta.url)
// 本目录。
const HERE = path.dirname(fileURLToPath(import.meta.url))
// mobile 根。
const ROOT = path.join(HERE, '..')
// 前端目录。
const FRONTEND = path.join(ROOT, '..', '..', 'packages', 'frontend')
// 目标（Capacitor webDir，见 capacitor.config.json）。
const WWW = path.join(ROOT, 'www')

// #REQUIRED_DIST_FILES
// 产物完整性判据：这些文件都在，才算「可以直接复用」。
// 少一样就重新构建——宁可多建一次，也不要把残缺产物打进 APK（到了 WebView 里就是白屏）。
export const REQUIRED_DIST_FILES = ['index.html', 'data/age.json']

// #isDistReady
// 判断前端产物是否完整可复用。
//
// @param {string} dist - 前端产物目录
// @returns {Promise<boolean>}
export async function isDistReady(dist) {
  // 逐个必备文件探测。
  for (const rel of REQUIRED_DIST_FILES) {
    try {
      await fs.access(path.join(dist, rel))
    } catch {
      // 任一缺失即视为不可复用。
      return false
    }
  }
  // 全部存在。
  return true
}

// #shouldBuildFrontend
// 是否需要构建前端（纯函数，便于测试）。
//
// @param {object} options
// @param {boolean} options.distReady - 现有产物是否完整
// @param {boolean} [options.forceRebuild] - 是否强制重建
// @returns {boolean}
export function shouldBuildFrontend({ distReady, forceRebuild = false }) {
  return forceRebuild || !distReady
}

// #buildFrontend
// 调用前端自己的 vite 构建（用 frontend 包里的 vite，不依赖 PATH）。
//
// @param {object} [options]
// @param {string} [options.frontend] - 前端包目录
export async function buildFrontend({ frontend = FRONTEND } = {}) {
  // vite bin。
  const vitePkg = require.resolve('vite/package.json', { paths: [frontend] })
  // 执行 vite build（stdio 继承，日志直接透传）。
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(path.dirname(vitePkg), 'bin', 'vite.js'), 'build'], {
      cwd: frontend,
      stdio: 'inherit',
      windowsHide: true,
    })
    // 退出码非 0：抛错（上层不再继续复制残缺产物）。
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`前端构建失败（exit ${code}）`))))
  })
}

// #syncDist
// 主流程：确保产物存在 → 清空 www/ → 复制。
//
// @param {object} [options]
// @param {string} [options.frontend] - 前端包目录
// @param {string} [options.www] - 目标目录
// @param {boolean} [options.forceRebuild] - 强制重建
// @param {Function} [options.build] - 构建函数（测试可注入）
// @param {Function} [options.log] - 日志函数（测试可注入）
// @returns {Promise<{built: boolean, www: string}>}
export async function syncDist({
  frontend = FRONTEND,
  www = WWW,
  forceRebuild = false,
  build = buildFrontend,
  log = console.log,
} = {}) {
  // 前端产物目录。
  const dist = path.join(frontend, 'dist')
  // 现有产物是否完整。
  const distReady = await isDistReady(dist)
  // 是否要构建。
  const built = shouldBuildFrontend({ distReady, forceRebuild })
  // 构建（或复用）。
  if (built) {
    log(distReady ? '[mobile] --rebuild：强制重新构建前端…' : '[mobile] 未发现完整前端产物，开始构建前端…')
    await build()
    // 构建后仍然残缺：直接失败（否则会静默复制出白屏 www/）。
    if (!(await isDistReady(dist))) {
      throw new Error(`前端构建后产物仍不完整（缺 ${REQUIRED_DIST_FILES.join(' / ')}）：${dist}`)
    }
  } else {
    log(`[mobile] 复用已有前端产物：${dist}`)
  }
  // 清空目标目录（避免上一轮的残留文件被打进 APK）。
  await fs.rm(www, { recursive: true, force: true })
  // 复制。
  await fs.cp(dist, www, { recursive: true })
  // 汇总。
  log(`[mobile] 静态产物 → ${www}`)
  log('[mobile] 完成。下一步：npx cap sync android（需 Android SDK）')
  // 返回结果（built 供日志/测试断言）。
  return { built, www }
}

// 仅在被直接执行时跑主流程（被测试 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncDist({ forceRebuild: process.argv.includes('--rebuild') })
}
