/**
 * Mod 系统 CLI 原型（Step 12/13 观测方式）
 *
 * 用法：
 *   node src/cli/mod.cli.js <modsDir>
 *
 * 功能：
 *   1. 扫描 mods 目录，打印依赖图 + 加载顺序。
 *   2. 加载全部 Mod，合并数据（后加载覆盖）。
 *   3. 可指定 --code 执行某 Mod 的 code.js（演示 gameAPI 钩子）。
 *
 * 示例：
 *   node src/cli/mod.cli.js mods
 */

// 导入。
import { createModLoader } from '../mod/loader.js'
import { createGameAPI, createHookBus } from '../mod/gameapi.js'
import { createAIClient } from '../ai/ai-client.js'
// AI Mod 工厂（code.js 经 gameAPI.createAIMod 使用）。
import { createAIMod } from '../ai/ai-mod.js'
import { makeCliLogger } from './cli-util.js'

// #makeAIConfig
// 从环境变量/--mock-ai 构建 AI 配置。
// --mock-ai 时用本地 mock fetch（返回固定天赋/事件），无需真实 Key 即可演示。
//
// @param {string[]} argv - CLI 参数
// @returns {object|null} AI 配置 { client, baseUrl, apiKey, model } 或 null
function makeAIConfig(argv) {
  // mock 模式。
  const mockIdx = argv.indexOf('--mock-ai')
  // mock：返回 mock 客户端。
  if (mockIdx !== -1) {
    // mock fetch：按请求类型返回合法 JSON（talent 或 event）。
    const mockFetch = async (url, opts) => {
      // 解析请求体。
      const body = JSON.parse(opts.body)
      // 系统提示判断类型。
      const system = body.messages[0].content
      // 事件生成。
      const content = system.includes('剧情')
        ? '{"id":"ai_e1","event":"AI 生成事件：你遇到了一位神秘的旅行者。","effect":{"LIF":-1},"include":"params.CHR > 0"}'
        // 天赋生成。
        : '{"id":"ai_001","name":"AI天赋","description":"由 AI 生成","condition":"params.CHR > 0","effect":{"INT":1},"grade":3}'
      // 返回响应。
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }
    }
    // mock 客户端。
    const client = createAIClient({ fetch: mockFetch })
    // 返回。
    return { client, baseUrl: 'mock', apiKey: 'mock', model: 'mock-model' }
  }
  // 真实模式：读环境变量。
  const apiKey = process.env.AI_API_KEY
  // 无 Key。
  if (!apiKey) return null
  // baseUrl。
  const baseUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1'
  // 模型。
  const model = process.env.AI_MODEL || 'gpt-4o-mini'
  // 客户端。
  const client = createAIClient({})
  // 返回。
  return { client, baseUrl, apiKey, model }
}

// #entryPoint
// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 参数。
  const argv = process.argv.slice(2)
  // mods 目录。
  const modsDir = argv[0]
  // 日志器。
  const log = makeCliLogger(argv, 'mod')
  // 目录缺失。
  if (!modsDir) {
    // 提示。
    console.error('用法: node src/cli/mod.cli.js <modsDir> [--mock-ai]')
    console.error('   --mock-ai: 用 mock AI 客户端演示（无需 API Key）')
    console.error('   真实 AI: 设置环境变量 AI_API_KEY / AI_BASE_URL / AI_MODEL')
    // 退出。
    process.exit(1)
  }
  // AI 配置。
  const aiConfig = makeAIConfig(argv)
  // 提示 AI 状态。
  if (aiConfig) log.info(`AI 客户端: ${aiConfig.apiKey === 'mock' ? 'mock 模式' : aiConfig.model}`)
  else log.info('未配置 AI（设 AI_API_KEY 或加 --mock-ai 启用）')
  // 创建加载器。
  const loader = createModLoader({ modsDir, log })
  // 打印依赖图与顺序。
  console.log('=== Mod 依赖图 ===')
  // 每个 Mod。
  for (const m of loader.mods) {
    // 依赖。
    const deps = (m.manifest.dependencies || []).join(', ') || '无'
    // 打印。
    console.log(`  ${m.name} → 依赖: [${deps}]`)
  }
  // 加载顺序。
  console.log(`\n=== 加载顺序 ===`)
  // 顺序。
  loader.order.forEach((name, i) => console.log(`  ${i + 1}. ${name}`))
  // 错误。
  if (loader.errors.length > 0) {
    // 打印错误。
    console.log(`\n=== 错误 ===`)
    // 逐个。
    loader.errors.forEach(e => console.log(`  ✗ ${e}`))
  }
  // 共享钩子总线（loader 的 code.js 与演示共用同一总线，AI 钩子才能互相触发）。
  const bus = createHookBus()
  // 加载数据并执行各 Mod 的 code.js（注入 gameAPI + AI 客户端 + AI Mod 工厂 + 共享总线）。
  const { data, codeList } = loader.loadAll({
    createAPI: (name, mergedData) => createGameAPI({ data: mergedData, hooks: bus, ai: aiConfig, aiModFactory: createAIMod, log }),
  })
  // 数据统计。
  console.log(`\n=== 合并数据 ===`)
  // 各数据集数量。
  for (const key in data) {
    // 打印数量。
    console.log(`  ${key}: ${Object.keys(data[key]).length} 项`)
  }
  // gameAPI 演示（复用共享总线，AI 钩子会被触发）。
  const api = createGameAPI({ data, hooks: bus, ai: aiConfig, aiModFactory: createAIMod, log })
  // 触发 onYearAdvance（AI 注入事件）。
  const payload = { age: 1, content: [], isEnd: false }
  api.emit('onYearAdvance', payload).then(() => {
    // 打印 AI 注入。
    if (payload.content.length > 0) {
      console.log(`\n=== AI 注入（onYearAdvance）===`)
      payload.content.forEach(c => console.log(`  ${c.description}`))
    } else {
      console.log(`\n=== onYearAdvance 无 AI 注入（code.js 未注册或 ai 不可用）===`)
    }
  })
  // 触发 onTalentPoolGenerate（AI 注入天赋）。
  const pool = { pool: [] }
  api.emit('onTalentPoolGenerate', pool).then(() => {
    // 打印 AI 天赋注入。
    if (pool.pool.length > 0) {
      console.log(`\n=== AI 注入（onTalentPoolGenerate）===`)
      pool.pool.forEach(t => console.log(`  ${t.name} (${t.id})`))
    } else {
      console.log(`\n=== onTalentPoolGenerate 无 AI 注入 ===`)
    }
  })
  // 打印钩子列表。
  console.log(`\n=== 钩子 ===`)
  // 钩子。
  console.log(JSON.stringify(api.hooks()))
}
