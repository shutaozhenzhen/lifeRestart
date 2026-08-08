/**
 * AI Mod 可玩版 CLI 原型（Step 16-22 冒烟）
 *
 * 用法：
 *   node src/cli/ai-game.cli.js [--mods <dir>] [--mock-ai] [--seed <n>] [--years <n>]
 *
 * 功能：
 *   1. 用 createModLoader 加载 mods 目录（含 ai-mod 的 code.js，自动注册 AI 钩子）。
 *   2. 创建共享钩子总线，注入 Life 引擎（引擎在 next/talentRandom 触发钩子）。
 *   3. AI Mod 通过钩子向游戏注入 AI 生成的天赋/事件。
 *
 * --mock-ai：用 mock AI 客户端（无需 API Key 即可演示）。
 * 真实 AI：设置环境变量 AI_API_KEY / AI_BASE_URL / AI_MODEL。
 *
 * 示例：
 *   node src/cli/ai-game.cli.js --mods ../../mods --mock-ai --seed 7
 */

// 导入。
import { createModLoader } from '../mod/loader.js'
import { createGameAPI, createHookBus } from '../mod/gameapi.js'
import { createAIClient } from '../ai/ai-client.js'
import Life from '../modules/life.js'
import { createRng } from '../functions/util.js'
import { makeCliLogger } from './cli-util.js'

// #makeAIConfig
// 构建 AI 配置（--mock-ai 或环境变量）。
// @param {string[]} argv - CLI 参数
// @returns {object|null} AI 配置或 null
function makeAIConfig(argv) {
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

// #entryPoint
// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 参数。
  const argv = process.argv.slice(2)
  // mods 目录。
  const modsIdx = argv.indexOf('--mods')
  const modsDir = modsIdx !== -1 ? argv[modsIdx + 1] : undefined
  // 随机源。
  const seedIdx = argv.indexOf('--seed')
  const random = seedIdx !== -1 ? createRng(Number(argv[seedIdx + 1])) : Math.random
  // 年数。
  const yearsIdx = argv.indexOf('--years')
  const years = yearsIdx !== -1 ? Number(argv[yearsIdx + 1]) : 20
  // 日志。
  const log = makeCliLogger(argv, 'ai-game')
  // 缺 mods 目录。
  if (!modsDir) {
    // 提示。
    console.error('用法: node src/cli/ai-game.cli.js --mods <dir> [--mock-ai] [--seed <n>] [--years <n>]')
    process.exit(1)
  }
  // AI 配置。
  const aiConfig = makeAIConfig(argv)
  // 状态。
  log.info(`AI: ${aiConfig ? (aiConfig.apiKey === 'mock' ? 'mock 模式' : aiConfig.model) : '未启用（原版）'}`)
  // 加载 Mod（含 ai-mod code.js）。
  const loader = createModLoader({ modsDir, log })
  // 共享总线。
  const bus = createHookBus()
  // 加载 + 执行 code.js。
  const { data } = loader.loadAll({
    createAPI: (name, mergedData) => createGameAPI({ data: mergedData, hooks: bus, ai: aiConfig, log }),
  })
  // 加载器错误。
  if (loader.errors.length > 0) loader.errors.forEach(e => log.warn(`Mod 错误: ${e}`))
  // 打印 Mod 列表。
  console.log(`Mod: ${loader.order.join(', ')}`)
  // 创建 Life（注入共享总线 → 引擎触发钩子 → AI 注入）。
  const life = new Life({
    data,
    random,
    hooks: bus,
    storage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null }, setItem(k, v) { this._d[k] = String(v) } },
  })
  // 初始化。
  await life.initial()
  // 配置。
  life.config()
  // 抽取天赋池（触发 onTalentPoolGenerate，AI 异步注入）。
  const pool = life.talentRandom()
  // 等 AI 注入落地。
  await new Promise(res => setTimeout(res, 20))
  // 打印天赋池。
  console.log(`\n天赋池 ${pool.length} 个:`)
  pool.slice(0, 8).forEach((t, i) => console.log(`  [${i}] ${t.name} (${t.id})`))
  // 选前 3 个。
  const selected = pool.slice(0, 3).map(t => t.id)
  // 开局。
  life.remake(selected)
  life.start({ CHR: 4, INT: 4, STR: 4, MNY: 4, SPR: 4 })
  // 推进。
  let aiEvents = 0
  for (let i = 0; i < years; i++) {
    // 推进（AI 钩子 fire-and-forget 异步注入）。
    const r = life.next()
    // 等微任务，让 AI 注入落地（真实场景是下一帧/下一岁可见）。
    await new Promise(res => setTimeout(res, 20))
    // 统计 AI 事件。
    aiEvents += r.content.filter(c => c.description && c.description.includes('AI')).length
    // 结束。
    if (r.isEnd) break
  }
  // 总结。
  console.log(`\n=== 结果 ===`)
  console.log(`推进 ${years} 年，AI 生成内容 ${aiEvents} 条`)
  // AI 状态。
  if (!aiConfig) console.log('（未配置 AI，以上为原版数据）')
}