/**
 * 移动端 APK 收集脚本（Step 25，CI 用）
 *
 * 背景（为什么不能直接在 workflow 里上传 `**\/*.apk`）：
 *   actions/upload-artifact@v4 以「通配符之前的那段路径」作为压缩包的根目录，
 *   所以上传 `platforms/mobile/android/app/build/outputs/apk/**\/*.apk` 解包后得到的是
 *   `debug/app-debug.apk`（多了一层目录）；下游 release job 用平铺通配符 `artifacts/*.apk`
 *   就匹配不到 → **APK 被静默漏掉**，release 里只有 zip/exe 没有 apk（曾经真的发生过）。
 *
 * 这里的做法：把 Gradle 产出的 APK 复制到**固定路径 + 固定文件名**
 *   platforms/mobile/out/liferestart-mobile-debug.apk
 * 这样上传 `platforms/mobile/out/*.apk` 时压缩根就是 out/，解包后必定是**顶层文件**，
 * 文件名也和 release 里的其它产物（liferestart-web.zip / liferestart-frontend-dist.zip）风格一致。
 *
 * 用法：
 *   node scripts/collect-apk.js
 */

// 文件系统（异步）。
import fs from 'node:fs/promises'
// 路径拼接。
import path from 'node:path'
// 定位本脚本所在目录（不依赖 process.cwd()，从任意目录执行都正确）。
import { fileURLToPath, pathToFileURL } from 'node:url'

// 本目录（scripts/）。
const HERE = path.dirname(fileURLToPath(import.meta.url))
// mobile 包根目录。
const ROOT = path.join(HERE, '..')

// #APK_DIR
// Gradle 的 APK 输出目录（debug/release 都在它下面）。
export const APK_DIR = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk')
// #OUT_DIR
// 收集目录（上传 artifact 时以它为压缩根）。
export const OUT_DIR = path.join(ROOT, 'out')
// #APK_NAME
// 收集后的固定文件名（release 资源名，不含目录）。
export const APK_NAME = 'liferestart-mobile-debug.apk'

// #findApk
// 在目录里**递归**查找第一个 .apk（找不到或目录不存在返回 null）。
// 排序保证结果稳定：同一台机器重复执行、不同机器执行都能得到同一个文件。
//
// @param {string} dir - 起始目录
// @returns {Promise<string|null>} APK 的绝对路径
export async function findApk(dir) {
  // 目录读不到（还没构建过）：按「没有 APK」处理，由调用方给出可读报错。
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  // 当前层的候选文件与子目录。
  const apks = []
  const dirs = []
  // 分类。
  for (const entry of entries) {
    if (entry.isDirectory()) dirs.push(path.join(dir, entry.name))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.apk')) apks.push(path.join(dir, entry.name))
  }
  // 同层有 APK：排序后取第一个（稳定）。
  apks.sort()
  if (apks.length > 0) return apks[0]
  // 否则深度优先下探（子目录排序，保证确定性）。
  dirs.sort()
  for (const sub of dirs) {
    const found = await findApk(sub)
    if (found) return found
  }
  // 整棵树都没有。
  return null
}

// #collectApk
// 把找到的 APK 复制到固定路径；找不到或复制出空文件都**抛错**（不许静默通过）。
//
// @param {object} [options]
// @param {string} [options.from] - 源目录（默认 Gradle 输出目录）
// @param {string} [options.to] - 目标目录（默认 out/）
// @param {string} [options.name] - 目标文件名
// @returns {Promise<{source: string, target: string, size: number}>}
export async function collectApk({ from = APK_DIR, to = OUT_DIR, name = APK_NAME } = {}) {
  // 递归查找。
  const source = await findApk(from)
  // 没找到：明确报错（"没产出 APK" 必须失败，不能被后续 if-no-files-found 之外的东西掩盖）。
  if (!source) {
    throw new Error(`没有找到 APK：已在 ${from} 下递归查找 *.apk（Gradle 构建可能没有成功）`)
  }
  // 复制（目录可能还不存在）。
  await fs.mkdir(to, { recursive: true })
  const target = path.join(to, name)
  await fs.copyFile(source, target)
  // 空文件同样是失败：Gradle 偶尔会留下 0 字节的占位产物。
  const { size } = await fs.stat(target)
  if (size === 0) throw new Error(`APK 是空文件（0 字节）：${target}`)
  // 返回来源/目标/大小，便于调用方打印与测试断言。
  return { source, target, size }
}

// #main
// 命令行主流程：收集并打印结果。
async function main() {
  const { source, target, size } = await collectApk()
  console.log(`[mobile] APK 来源：${source}`)
  console.log(`[mobile] APK 收集 → ${target}（${(size / 1024 / 1024).toFixed(1)} MB）`)
}

// 仅在被直接执行时跑主流程（被测试 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
