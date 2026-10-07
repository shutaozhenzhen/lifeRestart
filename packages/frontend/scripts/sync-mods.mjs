/**
 * sync-mods — 把仓库里的 mods/ 同步到前端 public/mods/（浏览器可 fetch）
 *
 * 为什么需要（把 Mod 支持搬到前端）：
 *   HTTP 没法"列目录"，浏览器要加载 Mod 就必须有静态文件 + 一份索引。
 *   本脚本在 dev/build 前跑一次，产出：
 *     public/mods/index.json          → ["base-mod", "fun-mod", ...]
 *     public/mods/<mod>/files.json    → ["manifest.json", "code.js", ...]
 *     public/mods/<mod>/manifest.json + code.js + 数据文件（按需）
 *   前端用 source-fetch 源 + 引擎同一套加载内核即可在浏览器里跑 Mod。
 *
 * 特例：Data Mod（lifeRestart-data）的**数据**已经作为静态产物放在 public/data/
 *   （前端一直从这里 fetch），所以只同步它的 manifest（体积 4MB 不重复一份）；
 *   它的数据由 fetchOriginalData 提供，等价于"数据已在浏览器侧"。
 */

// Node 内置。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本文件位置 → 默认目录。
const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = resolve(HERE, '..')
// 仓库 mods 目录（packages/frontend/scripts → 上三级 = lifeRestart/）。
const DEFAULT_MODS_DIR = resolve(FRONTEND_DIR, '..', '..', 'mods')
// 前端静态目录。
const DEFAULT_OUT_DIR = join(FRONTEND_DIR, 'public', 'mods')

// #DATA_FILES
// Mod 包约定的数据文件（与引擎 loader 的约定一致）。
export const DATA_FILES = ['age.json', 'talents.json', 'events.json', 'achievements.json', 'characters.json']

// #DATA_FROM_PUBLIC
// 数据已由 public/data 提供的 Mod（只同步 manifest/code，避免 4MB 重复）。
export const DATA_FROM_PUBLIC = ['lifeRestart-data']

// #ASSET_EXT
// 视为**资源**的后缀（图片 / 音频 / 字体）。
//
// ⚠️ 与引擎的 `mod/zip.js` 的 `ASSET_EXT` **必须一致**（那边是"zip 收哪些二进制"、
// 这里是"哪些二进制要同步到站点"）。多列一个不会错（只是白复制一份），
// **少列一个就是静默少读**：`files.json` 是浏览器的权威清单，
// 漏列的文件前端根本不会去请求（有既有守卫：mod-detail.spec.js 的"清单与实际文件一致"）。
//
// 这里刻意**不 import 引擎模块**：`scripts/sync-mods.mjs` 在 vite 配置里被 Node 直接
// 加载（`node scripts/sync-mods.mjs`），保持零依赖最稳。
export const ASSET_EXT = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.mp3', '.ogg', '.wav', '.m4a', '.flac',
  '.woff', '.woff2', '.ttf', '.otf',
]

// #listFilesRecursive
// 递归列出目录下的全部文件（相对路径，`/` 分隔；跳过 node_modules）。
//
// @param {string} dir - 目录
// @param {string} [prefix] - 前缀（递归用）
// @returns {string[]} 相对路径
export function listFilesRecursive(dir, prefix = '') {
  // 结果。
  const out = []
  // 读不到就当空。
  let entries = []
  // 尝试。
  try {
    // 列目录。
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    // 空。
    return out
  }
  // 逐项。
  for (const entry of entries) {
    // 依赖目录（不该进 Mod 包）。
    if (entry.name === 'node_modules') continue
    // 相对路径（统一 `/`，与 files.json / zip 内的键一致）。
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    // 子目录 → 递归。
    if (entry.isDirectory()) out.push(...listFilesRecursive(join(dir, entry.name), rel))
    // 文件 → 记录。
    else if (entry.isFile()) out.push(rel)
  }
  // 返回。
  return out
}

// #isAssetPath
// 是不是资源文件（按后缀）。
//
// @param {string} rel - 相对路径
// @returns {boolean} 是 → true
export function isAssetPath(rel) {
  // 后缀（小写）。
  const lower = String(rel).toLowerCase()
  // 命中任一资源后缀。
  return ASSET_EXT.some((ext) => lower.endsWith(ext))
}

// #buildSyncPlan
// 扫描 mods 目录，算出"要同步哪些文件"（纯计算，便于单测）。
//
// @param {object} params
// @param {string} params.modsDir - 源目录
// @returns {{index: string[], mods: Array<{name: string, files: string[], skipData: boolean}>, errors: string[]}} 计划
export function buildSyncPlan({ modsDir }) {
  // 结果。
  const index = []
  const mods = []
  const errors = []
  // 目录不存在。
  if (!existsSync(modsDir)) {
    // 记录（调用方可据此跳过同步，不算致命）。
    errors.push(`mods 目录不存在: ${modsDir}`)
    // 返回。
    return { index, mods, errors }
  }
  // 逐个目录。
  for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
    // 只处理目录，跳过 disabled。
    if (!entry.isDirectory() || entry.name === 'disabled') continue
    // Mod 名与目录。
    const name = entry.name
    const dir = join(modsDir, name)
    // manifest 必须存在（没有 manifest 的不是合法 Mod）。
    if (!existsSync(join(dir, 'manifest.json'))) {
      // 记录并跳过。
      errors.push(`Mod ${name} 缺少 manifest.json（已跳过）`)
      continue
    }
    // 该 Mod 是否跳过数据文件（其数据在 public/data）。
    const skipData = DATA_FROM_PUBLIC.includes(name)
    // 要复制的文件。
    const files = ['manifest.json']
    // code.js（有就带）。
    if (existsSync(join(dir, 'code.js'))) files.push('code.js')
    // 数据文件（未被跳过时）。
    if (!skipData) {
      // 逐个检查。
      for (const file of DATA_FILES) {
        // 存在即带上。
        if (existsSync(join(dir, file))) files.push(file)
      }
    }
    // 运行时模块（manifest.modules 声明的依赖，随包分发的自包含单文件）。
    // 必须一起同步：浏览器侧由引擎在**运行时**读这些文件并加载（见 src/mod/modules.js）。
    // 读失败/JSON 坏 → 记错误但继续（与其它容错一致）。
    try {
      // manifest。
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
      // 声明的模块路径。
      for (const rel of Object.values(manifest.modules || {})) {
        // 路径安全（构建期也挡一次，避免同步出目录穿越）。
        if (typeof rel !== 'string' || rel.includes('..')) {
          // 记错误。
          errors.push(`Mod ${name} 的 modules 路径不安全（已跳过）：${rel}`)
          // 下一个。
          continue
        }
        // 存在即带上。
        if (existsSync(join(dir, rel))) files.push(rel)
        // 声明了却没有文件 → 记错误（否则浏览器侧要到运行时才发现）。
        else errors.push(`Mod ${name} 声明的模块文件不存在：${rel}`)
      }
    } catch (e) {
      // manifest 读不了（上面已按"缺 manifest"处理过），这里只记模块解析失败。
      errors.push(`Mod ${name} 的 modules 解析失败：${e.message}`)
    }
    // 资源文件（图片/音频/字体）—— **递归**找出并一起同步（2026-10 能力补齐 ②）。
    //
    // 为什么必须在这里列出来：`files.json` 是浏览器侧的**权威清单**
    // （清单即权威：引擎只请求清单里有的文件）。漏掉一个 png，表现是
    // "`{{asset:图标.png}}` 永远是文字而没有任何报错" —— 正是最难查的一类静默失败。
    //
    // `copyFileSync` 本来就是按字节复制的（不像 readFileSync+writeFileSync 那样
    // 要注意编码），所以二进制不会被破坏。
    for (const rel of listFilesRecursive(dir)) {
      // 非资源后缀不管（文本走上面的白名单，避免把包里的无关文件也复制出去）。
      if (!isAssetPath(rel)) continue
      // 已列过（理论上不会，保险去重）。
      if (files.includes(rel)) continue
      // 带上。
      files.push(rel)
    }
    // 记录。
    index.push(name)
    mods.push({ name, files, skipData })
  }
  // 返回。
  return { index, mods, errors }
}

// #writeSync
// 执行同步：复制文件 + 写 files.json / index.json（会先清掉目标目录里的旧 Mod，保证不残留）。
//
// @param {object} params
// @param {object} params.plan - buildSyncPlan 的结果
// @param {string} params.modsDir - 源目录
// @param {string} params.outDir - 目标目录（public/mods）
// @returns {{copied: number, mods: string[]}} 统计
export function writeSync({ plan, modsDir, outDir }) {
  // 建目标目录。
  mkdirSync(outDir, { recursive: true })
  // 清掉目标目录里已不存在的 Mod（重命名/删除后不残留）。
  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    // 只处理目录。
    if (!entry.isDirectory()) continue
    // 不在计划里 → 删除。
    if (!plan.index.includes(entry.name)) rmSync(join(outDir, entry.name), { recursive: true, force: true })
  }
  // 逐 Mod 复制。
  let copied = 0
  for (const mod of plan.mods) {
    // 目标目录。
    const target = join(outDir, mod.name)
    // 建目录。
    mkdirSync(target, { recursive: true })
    // 复制文件。
    for (const file of mod.files) {
      // 目标路径。
      const dst = join(target, file)
      // 运行时模块可能在子目录里（如 vendor/x.mjs）→ 先建父目录。
      mkdirSync(dirname(dst), { recursive: true })
      // 复制。
      copyFileSync(join(modsDir, mod.name, file), dst)
      // 计数。
      copied++
    }
    // 写文件清单（浏览器据此只请求存在的文件，避免一堆 404）。
    writeFileSync(join(target, 'files.json'), JSON.stringify(mod.files, null, 2))
  }
  // 写索引。
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(plan.index, null, 2))
  // 返回。
  return { copied, mods: plan.index }
}

// #syncMods
// 一步到位：扫描 → 同步。
//
// @param {object} [params]
// @param {string} [params.modsDir] - 源目录
// @param {string} [params.outDir] - 目标目录
// @param {Function} [params.log] - 输出函数
// @returns {{copied: number, mods: string[], errors: string[]}} 结果
export function syncMods({ modsDir = DEFAULT_MODS_DIR, outDir = DEFAULT_OUT_DIR, log = () => {} } = {}) {
  // 计划。
  const plan = buildSyncPlan({ modsDir })
  // 源目录都没有：不建空目录，直接返回（dev 仍可跑，只是没有 Mod）。
  if (plan.errors.length > 0 && plan.mods.length === 0) {
    // 提示。
    log(`[sync-mods] 跳过：${plan.errors.join('; ')}`)
    // 返回。
    return { copied: 0, mods: [], errors: plan.errors }
  }
  // 执行。
  const result = writeSync({ plan, modsDir, outDir })
  // 输出。
  log(`[sync-mods] ${result.mods.length} 个 Mod → ${outDir}（${result.copied} 个文件）`)
  // 返回。
  return { ...result, errors: plan.errors }
}

// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 同步（把跳过的说明也打出来）。
  const r = syncMods({ log: (m) => console.log(m) })
  // 有跳过项就提示。
  if (r.errors.length > 0) console.log(`[sync-mods] 提示：${r.errors.join('; ')}`)
}
