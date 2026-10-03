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
