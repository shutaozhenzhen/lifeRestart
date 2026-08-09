/**
 * AI 生成结果导出 CLI（Step 21）
 *
 * 用法：
 *   node src/cli/export-ai.cli.js --journal <file> --out <dir> [--name <mod-name>]
 *
 * 功能：
 *   1. 读取 AI 运行流水（journal JSON，AI 生成条目已记录）。
 *   2. 提取 AI 生成的天赋/事件（id 以 ai_ 前缀标记）。
 *   3. 构建增量 Data Mod（manifest + talents.json/events.json）落盘。
 *   4. 产物可直接放入 mods/ 目录加载，实现"AI 生成结果固化/分享"。
 *
 * 说明：
 *   - journal 条目格式：{ age, type, description, grade }（journal.push 记录）。
 *   - AI 条目通过 id 前缀 'ai_' 识别（ai-mod code.js 生成时用 ai_ 前缀）。
 *   - 此 CLI 是导出闭环；真实 AI 结果的完整结构需 ai-mod 在生成时也写入 store。
 *
 * 示例：
 *   node src/cli/export-ai.cli.js --journal journal.json --out ../../mods --name ai-result
 */

// 导入。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { makeCliLogger } from './cli-util.js'

// #loadJournal
// 读取 journal JSON 文件。
//
// @param {string} file - 路径
// @returns {Promise<Array>} 条目数组
async function loadJournal(file) {
  // 读文件。
  const raw = await readFile(file, 'utf8')
  // 解析。
  return JSON.parse(raw)
}

// #buildAIMod
// 从 journal 条目构建 AI 增量 Mod 结构。
// 纯逻辑，供 CLI 与测试共用。
//
// @param {Array} entries - journal 条目
// @param {string} name - Mod 名
// @returns {object} Mod 结构 { manifest, talents, events }
export function buildAIMod(entries, name = 'ai-result') {
  // 结果。
  const mod = { manifest: {}, talents: {}, events: {} }
  // manifest。
  mod.manifest = {
    name,
    version: '1.0.0',
    author: 'lifeRestart-ai',
    description: 'AI 生成内容（可编辑/分享）',
    permissions: [],
    dependencies: [],
  }
  // 遍历条目。
  for (const e of entries) {
    // 按类型分发（description 含 AI 标记或 id 前缀）。
    const isAI = (e.id && e.id.startsWith('ai_')) || (e.description && e.description.startsWith('AI'))
    // 非 AI 条目跳过。
    if (!isAI) continue
    // 天赋条目。
    if (e.type === 'TLT' || e.type === 'talent') {
      // 天赋 id。
      const id = e.id || `ai_t_${entries.indexOf(e)}`
      // 写入。
      mod.talents[id] = {
        id,
        name: e.name || e.description || `AI天赋${id}`,
        description: e.description || '',
        grade: e.grade || 0,
        maxTriggers: 1,
      }
    }
    // 事件条目。
    if (e.type === 'EVT' || e.type === 'event') {
      // 事件 id。
      const id = e.id || `ai_e_${entries.indexOf(e)}`
      // 写入。
      mod.events[id] = {
        id,
        event: e.description || '',
        grade: e.grade || 0,
      }
    }
  }
  // 返回。
  return mod
}

// #writeAIMod
// 把 AI Mod 落盘到目录。
//
// @param {object} params
// @param {object} params.mod - Mod 结构
// @param {string} params.outDir - 输出根目录
// @param {object} [params.log] - 日志器
// @returns {Promise<string>} 落盘目录
async function writeAIMod({ mod, outDir, log }) {
  // 日志器。
  const logger = log || makeCliLogger([], 'export-ai')
  // 目标目录。
  const target = join(outDir, mod.manifest.name)
  // 创建。
  await mkdir(target, { recursive: true })
  // 写文件。
  for (const [file, content] of Object.entries({ 'manifest.json': mod.manifest, 'talents.json': mod.talents, 'events.json': mod.events })) {
    // 写。
    await writeFile(join(target, file), JSON.stringify(content, null, 2))
    // 日志。
    logger.debug(`写入 ${target}/${file}`)
  }
  // 返回。
  return target
}

// #entryPoint
// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 参数。
  const argv = process.argv.slice(2)
  // journal 文件。
  const jIdx = argv.indexOf('--journal')
  const journalFile = jIdx !== -1 ? argv[jIdx + 1] : undefined
  // 输出目录。
  const oIdx = argv.indexOf('--out')
  const outDir = oIdx !== -1 ? argv[oIdx + 1] : undefined
  // 名称。
  const nIdx = argv.indexOf('--name')
  const name = nIdx !== -1 ? argv[nIdx + 1] : 'ai-result'
  // 日志。
  const log = makeCliLogger(argv, 'export-ai')
  // 缺参数。
  if (!journalFile || !outDir) {
    // 提示。
    console.error('用法: node src/cli/export-ai.cli.js --journal <file> --out <dir> [--name <name>]')
    process.exit(1)
  }
  // 读 journal。
  const entries = await loadJournal(journalFile)
  // 构建 Mod。
  const mod = buildAIMod(entries, name)
  // 统计。
  const stats = {
    talents: Object.keys(mod.talents).length,
    events: Object.keys(mod.events).length,
  }
  // 落盘。
  const target = await writeAIMod({ mod, outDir, log })
  // 输出。
  console.log(`AI 生成内容导出: ${JSON.stringify(stats)}`)
  console.log(`落盘: ${target}`)
}
