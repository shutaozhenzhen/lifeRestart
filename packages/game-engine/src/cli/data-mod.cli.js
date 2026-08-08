/**
 * Data Mod 打包 CLI（把原版 JSON 落盘为 Mod 目录）
 *
 * 用法：
 *   node src/cli/data-mod.cli.js --data <dir> [--out <dir>] [--locale zh-cn|en-us]
 *
 * 功能：
 *   1. 读取原版 JSON（--data 指向数据目录，如 remake 的 public/data）。
 *   2. prepareForEngine（ID 字符串化）+ buildDataMod（旧语法→新语法）。
 *   3. 落盘到 <out>/lifeRestart-data/：manifest.json + 各数据 JSON。
 *
 * 输出结构（与 loader 数据文件约定一致）：
 *   <out>/lifeRestart-data/manifest.json
 *   <out>/lifeRestart-data/age.json
 *   <out>/lifeRestart-data/talents.json
 *   <out>/lifeRestart-data/events.json
 *   <out>/lifeRestart-data/achievements.json
 *   <out>/lifeRestart-data/characters.json
 *
 * 落盘后可用 mod.cli.js 直接加载验证：
 *   node src/cli/mod.cli.js <out>
 *
 * 示例：
 *   node src/cli/data-mod.cli.js --data ../../../remake/public/data --out ../../mods
 */

// 数据加载层：createLoader + prepareForEngine（ID 字符串化）。
import { createLoader, prepareForEngine } from '../data-loader.js'
// Data Mod 打包。
import { buildDataMod } from '../mod/datamod.js'
// 共享日志。
import { makeCliLogger } from './cli-util.js'
// Node 内置：本地文件读写。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// #makeNodeFetch
// 创建本地文件 fetch：把 (baseUrl/locale/file) 拼成真实路径读取 JSON。
//
// @param {string} dataDir - 数据目录根路径
// @returns {(url: string) => Promise<{ok: boolean, json: () => Promise<object>}>}
function makeNodeFetch(dataDir) {
  // 返回 fetch 实现。
  return async (url) => {
    // 拼成文件路径（url 形如 /zh-cn/talents.json）。
    const file = join(dataDir, url.replace(/^\/+/, ''))
    // 读取 JSON。
    const json = JSON.parse(await readFile(file, 'utf8'))
    // 返回 { ok, json }。
    return { ok: true, json: async () => json }
  }
}

// #buildDataModFromDir
// 从数据目录加载并打包为 Data Mod 结构（纯逻辑，供 CLI 与测试共用）。
//
// @param {object} params
// @param {string} params.dataDir - 数据目录（含 {locale}/ 各 JSON）
// @param {string} [params.locale] - 语言目录名
// @returns {Promise<object>} Data Mod 结构 { manifest, age, talents, events, achievements, characters }
export async function buildDataModFromDir({ dataDir, locale = 'zh-cn' }) {
  // 创建加载器（注入本地文件 fetch）。
  const loader = createLoader({ fetch: makeNodeFetch(dataDir), baseUrl: '', locale })
  // 加载全部数据文件。
  const raw = await loader.loadAll()
  // ID 字符串化 + 打包为 Data Mod（含旧语法转换）。
  return buildDataMod(prepareForEngine(raw))
}

// #writeDataMod
// 把 Data Mod 结构落盘到目标目录（lifeRestart-data/）。
//
// @param {object} params
// @param {object} params.mod - Data Mod 结构
// @param {string} params.outDir - 输出根目录（如 mods/）
// @param {object} [params.log] - 日志器
// @returns {Promise<string>} 落盘目录路径
export async function writeDataMod({ mod, outDir, log }) {
  // 日志器。
  const logger = log || makeCliLogger([], 'data-mod')
  // 目标目录：<outDir>/lifeRestart-data。
  const target = join(outDir, mod.manifest.name)
  // 创建目录（递归）。
  await mkdir(target, { recursive: true })
  // 数据文件：文件名 → 数据。
  const files = {
    'manifest.json': mod.manifest,
    'age.json': mod.age,
    'talents.json': mod.talents,
    'events.json': mod.events,
    'achievements.json': mod.achievements,
    'characters.json': mod.characters,
  }
  // 逐个写盘（2 空格缩进 + 换行，便于人工审阅）。
  for (const [file, content] of Object.entries(files)) {
    // 空数据集写空对象（保持结构完整）。
    const data = content || {}
    // 写文件（缩进 2 空格）。
    await writeFile(join(target, file), JSON.stringify(data, null, 2))
    // 日志。
    logger.debug(`  写入 ${target}/${file} (${Object.keys(data).length} 项)`)
  }
  // 返回落盘目录。
  return target
}

// #entryPoint
// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 解析参数。
  const argv = process.argv.slice(2)
  // --data 数据目录。
  const dataArg = argv.indexOf('--data')
  const dataDir = dataArg !== -1 ? argv[dataArg + 1] : undefined
  // --out 输出目录。
  const outArg = argv.indexOf('--out')
  const outDir = outArg !== -1 ? argv[outArg + 1] : undefined
  // --locale 语言。
  const localeArg = argv.indexOf('--locale')
  const locale = localeArg !== -1 ? argv[localeArg + 1] : 'zh-cn'
  // 缺少必要参数。
  if (!dataDir || !outDir) {
    // 提示用法。
    console.error('用法: node src/cli/data-mod.cli.js --data <dir> --out <dir> [--locale zh-cn|en-us]')
    // 退出。
    process.exit(1)
  }
  // 日志器。
  const log = makeCliLogger(argv, 'data-mod')
  // 打包。
  const mod = await buildDataModFromDir({ dataDir, locale })
  // 落盘。
  const target = await writeDataMod({ mod, outDir, log })
  // 统计。
  const stats = {
    age: Object.keys(mod.age || {}).length,
    talents: Object.keys(mod.talents || {}).length,
    events: Object.keys(mod.events || {}).length,
    achievements: Object.keys(mod.achievements || {}).length,
    characters: Object.keys(mod.characters || {}).length,
  }
  // 输出。
  console.log(`已打包 Data Mod: ${mod.manifest.name}`)
  console.log(`落盘目录: ${target}`)
  console.log(`规模: ${JSON.stringify(stats)}`)
}
