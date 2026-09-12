/**
 * AI 冒烟对比 CLI（Step 22）
 *
 * 用法：
 *   node src/cli/smoke.cli.js --mods <dir> --seed <n> [--years <n>] [--mock-ai]
 *
 * 功能：
 *   1. 同一 seed 双跑同一局：关闭 AI vs 开启 AI。
 *   2. 分别导出每岁轨迹（复用 export 的轨迹格式）。
 *   3. diff 两份输出：列出差异（AI 注入的天赋/事件、属性变化）。
 *
 * 观测：验证 AI Mod 开启后确实改变了游戏内容（AI 增强前后对比）。
 *
 * 示例：
 *   node src/cli/smoke.cli.js --mods ../../mods --seed 7 --mock-ai
 */

// 导入。
import { createModLoader } from '../mod/loader.js'
import { createGameAPI, createHookBus } from '../mod/gameapi.js'
import { createAIClient } from '../ai/ai-client.js'
// AI Mod 工厂。
import { createAIMod } from '../ai/ai-mod.js'
import Life from '../modules/life.js'
import { createRng } from '../functions/util.js'
import { SILENT_LOGGER } from '../functions/logger.js'
import { makeCliLogger } from './cli-util.js'
// Node 内置：路径。
import { basename } from 'node:path'

// #makeAIConfig
// 构建 AI 配置（--mock-ai 或环境变量）。
// @param {string[]} argv - CLI 参数
// @returns {object|null} AI 配置或 null
export function makeAIConfig(argv) {
  // mock 模式。
  const mockIdx = argv.indexOf('--mock-ai')
  // mock。
  if (mockIdx !== -1) {
    // mock fetch：按请求类型返回。
    const mockFetch = async (url, opts) => {
      // 请求体。
      const body = JSON.parse(opts.body)
      // 系统提示。
      const system = body.messages[0].content
      // 事件或天赋。
      const content = system.includes('剧情')
        ? '{"id":"ai_e1","event":"AI 事件：你被星光照耀，命运改变。","effect":{"SPR":5}}'
        : '{"id":"ai_001","name":"AI天赋","description":"AI 生成","condition":"params.CHR > 0","effect":{"INT":2},"grade":3}'
      // 返回。
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }
    }
    // 客户端。
    const client = createAIClient({ fetch: mockFetch })
    // 返回。
    return { client, baseUrl: 'mock', apiKey: 'mock', model: 'mock-model' }
  }
  // 真实模式。
  const apiKey = process.env.AI_API_KEY
  // 无 Key。
  if (!apiKey) return null
  // 返回。
  return {
    client: createAIClient({}),
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    apiKey,
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  }
}

// #loadModData
// 用 mods 加载器加载数据（含 ai-mod code.js 注册钩子）。
// 返回共享总线 + 合并数据。
//
// @param {object} params
// @param {string} params.modsDir - mods 目录
// @param {object|null} params.aiConfig - AI 配置
// @param {object} params.log - 日志器
// @returns {{data: object, bus: object}} 数据与共享总线
export function loadModData({ modsDir, aiConfig, log }) {
  // 加载器。
  const loader = createModLoader({ modsDir, log })
  // 共享总线。
  const bus = createHookBus()
  // 加载 + 执行 code.js。
  const { data } = loader.loadAll({
    createAPI: (name, mergedData) => createGameAPI({ data: mergedData, hooks: bus, ai: aiConfig, aiModFactory: createAIMod, log }),
  })
  // 返回。
  return { data, bus }
}

// #runWithAI
// 跑一局（固定 seed），返回轨迹。aiBus 非空则注入共享钩子（AI 生效）。
//
// @param {object} params
// @param {number} params.seed - 种子
// @param {object} params.data - 合并数据
// @param {object|null} params.aiBus - AI 钩子总线（null 表示关闭 AI）
// @param {number} [params.years] - 年数
// @param {number} [params.startLif] - 起始生命
// @param {object} [params.log] - 日志器
// @returns {Promise<object>} 轨迹
export async function runWithAI({ seed, data, aiBus, years = 20, startLif = 10, log } = {}) {
  // 日志器（缺省静默，保持冒烟输出干净；用 SILENT_LOGGER 保证 child() 可用）。
  const logger = log || SILENT_LOGGER
  // 创建 Life（固定种子 + 共享钩子总线 + 日志器）。
  const life = new Life({
    data,
    random: createRng(seed),
    hooks: aiBus || { emit: () => [], emitSync: () => [] },
    storage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null }, setItem(k, v) { this._d[k] = String(v) } },
    logger,
  })
  // 初始化。
  await life.initial()
  // 配置。
  life.config({ propertyConfig: { judge: makeJudgeConfig() } })
  // 开局。
  life.remake([])
  life.start({ CHR: 4, INT: 4, STR: 4, MNY: 4, SPR: 4 })
  // 起始生命。
  if (startLif !== 1) life.request('PROPERTY').set('LIF', startLif)
  // 每岁记录。
  const yearLogs = []
  // 结束原因。
  let endReason = null
  // 逐岁。
  for (let i = 0; i < years; i++) {
    // 推进。
    const { age, content, isEnd } = life.next()
    // 等 AI 异步注入落地。
    await new Promise(res => setTimeout(res, 20))
    // 分离事件与天赋。
    const events = content.filter(c => c.type === 'EVT').map(c => c.description)
    const talentsList = content.filter(c => c.type === 'TLT').map(c => c.name)
    // 记录。
    yearLogs.push({ age, props: { ...life.propertys }, events, talents: talentsList })
    // 结束。
    if (isEnd) {
      // 原因。
      endReason = `LIF=${life.request('PROPERTY').get('LIF')}`
      // 停。
      break
    }
  }
  // 返回。
  return { seed, years: yearLogs.length, log: yearLogs, end: { age: yearLogs.length ? yearLogs[yearLogs.length - 1].age : -1, reason: endReason || 'reach_max' } }
}

// #diffTraces
// 对比两份轨迹，列出差异摘要。
//
// @param {object} base - 关闭 AI 的轨迹
// @param {object} ai - 开启 AI 的轨迹
// @returns {object} 差异摘要
export function diffTraces(base, ai) {
  // 结果。
  const diff = {
    aiEvents: 0,      // AI 注入的事件数
    aiTalents: 0,     // AI 注入的天赋数
    changedProps: {}, // 属性变化差异
    aiOnlyDescriptions: [],
  }
  // 逐岁对比。
  const maxLen = Math.max(base.log.length, ai.log.length)
  // 遍历。
  for (let i = 0; i < maxLen; i++) {
    // 两边该岁。
    const b = base.log[i]
    const a = ai.log[i]
    // 跳过缺失。
    if (!b || !a) continue
    // 事件差异（AI 新增的）。
    const bEvents = new Set(b.events)
    // AI 侧独有事件。
    for (const e of a.events) {
      // AI 独有。
      if (!bEvents.has(e)) {
        // 计数。
        diff.aiEvents++
        // 记录描述。
        if (e.includes('AI')) diff.aiOnlyDescriptions.push(`  [${a.age}岁] ${e}`)
      }
    }
    // 天赋差异。
    const bTalents = new Set(b.talents)
    // AI 侧独有天赋。
    for (const t of a.talents) {
      // AI 独有。
      if (!bTalents.has(t)) diff.aiTalents++
    }
    // 属性差异（记录变化）。
    for (const key in a.props) {
      // 值不同。
      if (a.props[key] !== b.props[key]) {
        // 记录。
        diff.changedProps[key] = true
      }
    }
  }
  // 返回。
  return diff
}

// #makeJudgeConfig
// 生成评价分档（与 export 一致）。
// @returns {object} judge 配置
function makeJudgeConfig() {
  // 基础属性。
  const base = ['CHR', 'INT', 'STR', 'MNY', 'SPR', 'HCHR', 'HINT', 'HSTR', 'HMNY', 'HSPR']
  // judge 对象。
  const judge = {}
  // 逐属性。
  for (const key of base) judge[key] = [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']]
  // 年龄/总分档。
  judge.HAGE = [[0, 1, 'J_Normal'], [10, 2, 'J_Good'], [20, 3, 'J_Great']]
  judge.SUM = [[0, 1, 'J_Normal'], [50, 2, 'J_Good'], [100, 3, 'J_Great']]
  // 返回。
  return judge
}

// #entryPoint
// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 参数。
  const argv = process.argv.slice(2)
  // mods 目录。
  const modsIdx = argv.indexOf('--mods')
  const modsDir = modsIdx !== -1 ? argv[modsIdx + 1] : undefined
  // seed。
  const seedIdx = argv.indexOf('--seed')
  const seed = seedIdx !== -1 ? Number(argv[seedIdx + 1]) : 7
  // 年数。
  const yearsIdx = argv.indexOf('--years')
  const years = yearsIdx !== -1 ? Number(argv[yearsIdx + 1]) : 20
  // 日志。
  const log = makeCliLogger(argv, 'smoke')
  // 缺 mods 目录。
  if (!modsDir) {
    // 提示。
    console.error('用法: node src/cli/smoke.cli.js --mods <dir> [--seed <n>] [--years <n>] [--mock-ai]')
    process.exit(1)
  }
  // AI 配置。
  const aiConfig = makeAIConfig(argv)
  // 状态。
  console.log(`AI: ${aiConfig ? (aiConfig.apiKey === 'mock' ? 'mock 模式' : aiConfig.model) : '未配置（将回退原版对比）'}`)
  // 加载 mods 数据 + 钩子（AI code.js 已注册）。
  const { data, bus } = loadModData({ modsDir, aiConfig, log })
  // 打印 Mod。
  console.log(`Mod: ${basename(modsDir)} → 加载完成`)
  // ==== 第一跑：关闭 AI（不注入 bus）====
  console.log(`\n=== 关闭 AI（seed ${seed}）===`)
  const base = await runWithAI({ seed, data, aiBus: null, years })
  console.log(`推进 ${base.years} 年，事件 ${base.log.reduce((s, y) => s + y.events.length, 0)} 条`)
  // ==== 第二跑：开启 AI（注入共享 bus，AI 钩子触发）====
  console.log(`\n=== 开启 AI（seed ${seed}）===`)
  const ai = await runWithAI({ seed, data, aiBus: aiConfig ? bus : null, years })
  console.log(`推进 ${ai.years} 年，事件 ${ai.log.reduce((s, y) => s + y.events.length, 0)} 条`)
  // ==== diff ====
  const diff = diffTraces(base, ai)
  // 输出对比。
  console.log(`\n=== 对比结果（同 seed ${seed}）===`)
  console.log(`AI 新增事件: ${diff.aiEvents}`)
  console.log(`AI 新增天赋: ${diff.aiTalents}`)
  console.log(`属性变化: ${Object.keys(diff.changedProps).join(', ') || '无'}`)
  // AI 独有描述。
  if (diff.aiOnlyDescriptions.length > 0) {
    // 打印。
    console.log(`\nAI 注入的事件:`)
    diff.aiOnlyDescriptions.slice(0, 10).forEach(d => console.log(d))
  }
  // 总结。
  console.log(`\n结论: ${diff.aiEvents > 0 || diff.aiTalents > 0 ? 'AI Mod 增强生效 ✅' : '无 AI 注入（检查 ai-mod 是否启用 / API Key）'}`)
}
