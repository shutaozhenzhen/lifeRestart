/**
 * Mod 系统 CLI 原型（Step 12/13 观测方式 + Mod 架构 v2 宿主桥）
 *
 * 用法：
 *   node src/cli/mod.cli.js <modsDir> [--mock-ai] [--call <mod>:<handler>[:<jsonArgs>]]
 *
 * 功能：
 *   1. 扫描 mods 目录，打印依赖图 + 加载顺序。
 *   2. 加载全部 Mod，合并数据（后加载覆盖），并执行各 Mod 的 code.js（注入 gameAPI）。
 *   3. 打印**宿主（Node 侧 Mod）**：manifest 声明 targets 含 node 的 Mod，
 *      会加载其 server.js（entry.node）并注册命名处理器 —— 即"后端 Mod 完全权限"的入口。
 *   4. `--call` 直接调用某个处理器，观察"后端 Mod 调用后端 Node"的真实结果。
 *
 * 示例：
 *   node src/cli/mod.cli.js ../../mods
 *   node src/cli/mod.cli.js examples
 *   node src/cli/mod.cli.js examples --call demo-node-mod:nodeInfo
 *   node src/cli/mod.cli.js examples --call demo-node-mod:echo:{"a":1}
 */

// 导入。
import { createNodeModLoader } from '../mod/loader-node.js'
import { createGameAPI, createHookBus } from '../mod/gameapi.js'
// 宿主桥（Mod 架构 v2）：Node 侧适配器 + 平台无关的桥。
import { createNodeHost } from '../mod/host-node.js'
import { createHostBridge } from '../mod/host.js'
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
  // mods 目录：第一个非选项参数（跳过 --log-level / --call 的取值）。
  const modsDir = argv.find((a, i) => !a.startsWith('--') && !['--log-level', '--call'].includes(argv[i - 1]))
  // 日志器。
  const log = makeCliLogger(argv, 'mod')
  // 目录缺失。
  if (!modsDir) {
    // 提示。
    console.error('用法: node src/cli/mod.cli.js <modsDir> [--mock-ai] [--call <mod>:<handler>[:<jsonArgs>]]')
    console.error('   --mock-ai: 用 mock AI 客户端演示（无需 API Key）')
    console.error('   --call:    调用某个后端 Mod 的处理器（需该 Mod 声明 targets 含 node）')
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
  const loader = await createNodeModLoader({ modsDir, log })
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
  // 宿主适配器（Mod 架构 v2）：加载声明了 node 目标的 Mod 的 server.js。
  const hostAdapter = await createNodeHost({ modsDir, mods: loader.mods, log })
  // 宿主桥（浏览器侧 code.js 拿到的就是它；这里用它演示调用）。
  const hostBridge = createHostBridge(hostAdapter)
  // 打印宿主信息。
  console.log(`\n=== 宿主（Node 侧 Mod）===`)
  // 无宿主 Mod。
  if (hostAdapter.available.length === 0) {
    // 提示（说明怎么让它出现）。
    console.log('  （没有 Mod 声明 targets 含 node）')
  } else {
    // 逐个 Mod 打印其处理器。
    for (const hostName of hostAdapter.available) {
      // 打印。
      console.log(`  ${hostName} → 处理器: [${hostAdapter.handlersOf(hostName).join(', ')}]`)
    }
  }
  // 宿主加载错误（路径/解析/注册失败，逐 Mod 隔离）。
  if (hostAdapter.errors.length > 0) {
    // 逐个打印。
    hostAdapter.errors.forEach(e => console.log(`  ✗ ${e}`))
  }
  // 共享钩子总线（loader 的 code.js 与演示共用同一总线，AI 钩子才能互相触发）。
  const bus = createHookBus()
  // 加载数据并执行各 Mod 的 code.js（注入 gameAPI + AI 客户端 + AI Mod 工厂 + 共享总线 + 宿主桥）。
  const { data, codeList } = await loader.loadAll({
    createAPI: (name, mergedData) => createGameAPI({ data: mergedData, hooks: bus, ai: aiConfig, aiModFactory: createAIMod, host: hostBridge, log }),
  })
  // 数据统计。
  console.log(`\n=== 合并数据 ===`)
  // 各数据集数量。
  for (const key in data) {
    // 打印数量。
    console.log(`  ${key}: ${Object.keys(data[key]).length} 项`)
  }
  // gameAPI 演示（复用共享总线 + 宿主桥，AI 钩子与 Mod 钩子都会被触发）。
  const api = createGameAPI({ data, hooks: bus, ai: aiConfig, aiModFactory: createAIMod, host: hostBridge, log })
  // 触发 onYearAdvance（AI 注入事件 + Mod 注入条目）。
  const payload = { age: 1, content: [], isEnd: false }
  // await：让输出顺序确定（原先用 .then 会与后面的打印交错）。
  await api.emit('onYearAdvance', payload)
  // 打印注入结果（AI 与普通 Mod 共用这一条通道）。
  if (payload.content.length > 0) {
    // 标题。
    console.log(`\n=== onYearAdvance 注入 ===`)
    // 逐条。
    payload.content.forEach(c => console.log(`  [${c.type ?? '?'}] ${c.description}`))
  } else {
    // 无注入。
    console.log(`\n=== onYearAdvance 无注入（code.js 未注册或 ai 不可用）===`)
  }
  // 触发 onTalentPoolGenerate（AI 注入天赋）。
  const pool = { pool: [] }
  // await 同上。
  await api.emit('onTalentPoolGenerate', pool)
  // 打印天赋注入。
  if (pool.pool.length > 0) {
    // 标题。
    console.log(`\n=== onTalentPoolGenerate 注入 ===`)
    // 逐个。
    pool.pool.forEach(t => console.log(`  ${t.name} (${t.id})`))
  } else {
    // 无注入。
    console.log(`\n=== onTalentPoolGenerate 无注入 ===`)
  }
  // 打印钩子列表。
  console.log(`\n=== 钩子 ===`)
  // 钩子。
  console.log(JSON.stringify(api.hooks()))

  // #--call：直接调用某个后端 Mod 的处理器（"后端 Mod 调用后端 Node"的可观测入口）。
  const callIdx = argv.indexOf('--call')
  // 有 --call 才执行。
  if (callIdx !== -1) {
    // 取值（形如 mod:handler 或 mod:handler:{json}）。
    const spec = argv[callIdx + 1] || ''
    // 拆分：用前两个冒号定位（JSON 参数里可能含冒号）。
    const i1 = spec.indexOf(':')
    const i2 = i1 === -1 ? -1 : spec.indexOf(':', i1 + 1)
    // Mod 名。
    const callMod = i1 === -1 ? spec : spec.slice(0, i1)
    // 处理器名。
    const callHandler = i1 === -1 ? '' : i2 === -1 ? spec.slice(i1 + 1) : spec.slice(i1 + 1, i2)
    // JSON 参数文本（可选）。
    const callJson = i2 === -1 ? null : spec.slice(i2 + 1)
    // 解析参数。
    let callArgs
    // 有文本就解析。
    if (callJson !== null) {
      // 解析（失败给出可读提示）。
      try {
        // 解析。
        callArgs = JSON.parse(callJson)
      } catch (e) {
        // 提示。
        console.error(`✗ --call 的参数不是合法 JSON: ${e.message}`)
        // 退出。
        process.exit(1)
      }
    }
    // 打印标题。
    console.log(`\n=== 宿主调用（--call）===`)
    // 调用（错误归一化由宿主桥负责）。
    try {
      // 调。
      const result = await hostBridge.call(callMod, callHandler, callArgs)
      // 打印结果（JSON 化，便于观察）。
      console.log(`  ${callMod}:${callHandler} → ${JSON.stringify(result)}`)
    } catch (e) {
      // 打印错误。
      console.log(`  ✗ ${e.message}`)
      // 非零退出（便于脚本判断）。
      process.exitCode = 1
    }
  }
}
