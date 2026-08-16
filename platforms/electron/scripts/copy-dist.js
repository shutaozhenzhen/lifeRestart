/**
 * 复制前端构建产物到 dist-web/（Step 23 predist 钩子）
 *
 * 前置：先执行 pnpm --filter frontend build（本脚本只做复制）。
 * 产物结构：dist-web/index.html + dist-web/assets/*（electron-builder 打包进应用）。
 */

// Node 文件系统。
const fs = require('node:fs')
// Node 路径。
const path = require('node:path')

// 前端 dist 源（工作区相对路径：scripts → electron → platforms → lifeRestart → packages/frontend/dist）。
const SRC = path.join(__dirname, '..', '..', '..', 'packages', 'frontend', 'dist')
// 目标目录。
const DEST = path.join(__dirname, '..', 'dist-web')

// #copyDir
// 递归复制目录。
//
// @param {string} src - 源目录
// @param {string} dest - 目标目录
function copyDir(src, dest) {
  // 不存在源。
  if (!fs.existsSync(src)) {
    // 报错。
    throw new Error(`前端构建产物不存在: ${src}（请先执行 pnpm --filter frontend build）`)
  }
  // 创建目标。
  fs.mkdirSync(dest, { recursive: true })
  // 遍历源。
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // 源路径。
    const s = path.join(src, entry.name)
    // 目标路径。
    const d = path.join(dest, entry.name)
    // 目录递归。
    if (entry.isDirectory()) {
      copyDir(s, d)
    } else {
      // 复制文件。
      fs.copyFileSync(s, d)
    }
  }
}

// 清空旧目标。
fs.rmSync(DEST, { recursive: true, force: true })
// 复制。
copyDir(SRC, DEST)
// 提示。
console.log(`[copy-dist] ${SRC} → ${DEST}`)
