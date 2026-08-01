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
import { createGameAPI } from '../mod/gameapi.js'
import { makeCliLogger } from './cli-util.js'

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
    console.error('用法: node src/cli/mod.cli.js <modsDir>')
    // 退出。
    process.exit(1)
  }
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
  // 加载数据。
  const { data, codeList } = loader.loadAll()
  // 数据统计。
  console.log(`\n=== 合并数据 ===`)
  // 各数据集数量。
  for (const key in data) {
    // 打印数量。
    console.log(`  ${key}: ${Object.keys(data[key]).length} 项`)
  }
  // gameAPI 演示。
  const api = createGameAPI({ data, log })
  // 注册钩子。
  api.on('onYearAdvance', (payload) => log.info(`[hook] onYearAdvance: ${JSON.stringify(payload)}`))
  // 触发钩子。
  api.emit('onYearAdvance', { age: 1 })
  // 打印钩子列表。
  console.log(`\n=== 钩子 ===`)
  // 钩子。
  console.log(JSON.stringify(api.hooks()))
}
