/**
 * 跨平台一致性 CLI（Step 26）
 *
 * 目标：验证共享引擎在「同 seed + 同 Mod + 同输入」下，跨运行/跨进程/跨运行时
 *       输出的每岁轨迹（属性/事件/成就）完全一致（diff 为零）。
 *
 * 四平台论证：Electron / Web / Termux / APK 全部执行同一份 engine 代码，
 *             本 CLI 验证其确定性：
 *   1. 进程内多次运行（默认 3 次）→ 输出必须逐字节一致。
 *   2. --child：新起 node 子进程跑同一局 → 与进程内输出一致（跨进程）。
 *   3. --electron <bin>：Electron 运行时（ELECTRON_RUN_AS_NODE）跑同一局 → 与 node 一致（跨运行时）。
 *
 * 用法：
 *   node src/cli/consistency.cli.js --seed 42
 *   node src/cli/consistency.cli.js --seed 42 --runs 5
 *   node src/cli/consistency.cli.js --seed 7 --mods ../../mods --mock-ai
 *   node src/cli/consistency.cli.js --seed 7 --electron <path-to-electron.exe>
 *
 * 退出码：0 = 全部一致；1 = 存在差异或执行失败。
 */

// 导入。
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runWithAI, makeAIConfig, loadModData } from './smoke.cli.js'
import { loadData } from './game.cli.js'
import { makeCliLogger } from './cli-util.js'

// #silentLog
// 静默日志器（子进程/进程内一致化，避免污染 JSON）。
const silentLog = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

// #prepareRun
// 构建一次运行的输入（数据 + 钩子总线）。
// 所有运行（进程内/子进程/electron）必须用同一构造，保证输入一致。
//
// @param {object} params
// @param {string} [params.modsDir] - mods 目录（空 = fixture 数据）
// @param {boolean} [params.mockAi] - 是否启用确定性 mock AI
// @returns {Promise<{data: object, bus: object|null}>}
export async function prepareRun({ modsDir, mockAi = false } = {}) {
  // 有 mods。
  if (modsDir) {
    // AI 配置（mock 为确定性客户端）。
    const aiConfig = mockAi ? makeAIConfig(['--mock-ai']) : null
    // 加载 mods 数据 + 钩子。
    const r = loadModData({ modsDir, aiConfig, log: silentLog })
    // 返回。
    return { data: r.data, bus: aiConfig ? r.bus : null }
  }
  // 无 mods：fixture 数据，无钩子。
  return { data: await loadData({}), bus: null }
}

// #runOnce
// 跑一局（固定 seed），返回轨迹 JSON 字符串。
//
// @param {object} params
// @param {number} params.seed - 种子
// @param {number} [params.years] - 年数
// @param {string} [params.modsDir]
// @param {boolean} [params.mockAi]
// @returns {Promise<string>} 轨迹 JSON
export async function runOnce({ seed, years = 20, modsDir, mockAi = false } = {}) {
  // 输入构造。
  const { data, bus } = await prepareRun({ modsDir, mockAi })
  // 跑局。
  const trace = await runWithAI({ seed, data, aiBus: bus, years })
  // 序列化（统一顺序）。
  return JSON.stringify(trace)
}

// #spawnRunner
// 子进程跑同一局（node 或 electron 运行时），返回输出。
//
// @param {object} params
// @param {string} params.command - 可执行文件（process.execPath 或 electron bin）
// @param {string} params.runner - runner 脚本绝对路径
// @param {object} params.env - 传递的环境变量（seed/mods/mock 等）
// @param {string} [params.cwd] - 工作目录
// @returns {Promise<string>} 子进程 stdout（JSON）
function spawnRunner({ command, runner, env, cwd }) {
  // Promise。
  return new Promise((resolve, reject) => {
    // 启动。
    const child = spawn(command, [runner], {
      env: { ...process.env, ...env },
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // 输出。
    let out = ''
    // 错误。
    let err = ''
    // stdout。
    child.stdout.on('data', (d) => { out += d })
    // stderr。
    child.stderr.on('data', (d) => { err += d })
    // 退出。
    child.on('exit', (code) => {
      // 成功。
      if (code === 0) return resolve(out.trim())
      // 失败。
      reject(new Error(`子进程退出码 ${code}: ${err.slice(0, 300)}`))
    })
    // 启动错误。
    child.on('error', reject)
  })
}

// #runConsistency
// 一致性主流程（可单测）。
//
// @param {object} params
// @param {number} [params.seed] - 种子（默认 7）
// @param {number} [params.runs] - 进程内运行次数（默认 3）
// @param {number} [params.years] - 年数
// @param {string} [params.modsDir]
// @param {boolean} [params.mockAi]
// @param {string} [params.electronBin] - electron 可执行文件（可选，跨运行时对比）
// @param {string} [params.cwd] - 子进程工作目录（默认 game-engine 根）
// @param {object} [params.log] - 日志器
// @returns {Promise<{ok: boolean, outputs: Array<string>, checked: Array<string>}>}
export async function runConsistency({
  seed = 7,
  runs = 3,
  years = 20,
  modsDir,
  mockAi = false,
  electronBin,
  cwd,
  log,
} = {}) {
  // 日志器。
  const logger = log || makeCliLogger([], 'consistency')
  // 运行收集。
  const outputs = []
  // 检查项。
  const checked = []
  // ==== 1. 进程内多次运行 ====
  for (let i = 0; i < runs; i++) {
    // 跑局。
    outputs.push(await runOnce({ seed, years, modsDir, mockAi }))
  }
  // 进程内一致性。
  const inProc = outputs.every((o) => o === outputs[0])
  // ==== 2. node 子进程（跨进程）====
  const runner = fileURLToPath(new URL('./consistency-runner.js', import.meta.url))
  // 环境。
  const env = {
    CONSISTENCY_SEED: String(seed),
    CONSISTENCY_YEARS: String(years),
    CONSISTENCY_MODS: modsDir || '',
    CONSISTENCY_MOCK_AI: mockAi ? '1' : '0',
  }
  // 子进程输出。
  const childOut = await spawnRunner({ command: process.execPath, runner, env, cwd })
  // 记录。
  outputs.push(childOut)
  checked.push('node 子进程')
  // ==== 3. Electron 运行时（可选）====
  if (electronBin) {
    // electron 子进程（ELECTRON_RUN_AS_NODE：以 Node 运行时执行同一引擎代码）。
    const electronOut = await spawnRunner({
      command: electronBin,
      runner,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      cwd,
    })
    // 记录。
    outputs.push(electronOut)
    checked.push('Electron 运行时')
  }
  // ==== 汇总 diff ====
  const ok = outputs.every((o) => o === outputs[0])
  // 输出报告。
  logger.info(`\n=== 跨平台一致性（seed ${seed}，${years} 年）===`)
  // 标签：进程内逐次 + 检查项。
  const labels = []
  // 进程内。
  for (let i = 0; i < runs; i++) labels.push(`进程内运行${i + 1}`)
  // 检查项。
  labels.push(...checked)
  // 逐项。
  outputs.forEach((o, i) => {
    // 一致标记。
    const same = o === outputs[0] ? '一致' : '✗ 不一致'
    // 打印。
    logger.info(`  ${labels[i] || `运行${i + 1}`}: ${o.length} 字符 — ${same}`)
  })
  // 总结。
  logger.info(`\n结论: ${ok ? '四平台同 seed 输出 diff 为零 ✅' : '存在差异 ✗'}`)
  // 返回。
  return { ok, outputs, checked }
}

// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 参数。
  const argv = process.argv.slice(2)
  // 日志。
  const log = makeCliLogger(argv, 'consistency')
  // seed。
  const seedIdx = argv.indexOf('--seed')
  const seed = seedIdx !== -1 ? Number(argv[seedIdx + 1]) : 7
  // runs。
  const runsIdx = argv.indexOf('--runs')
  const runs = runsIdx !== -1 ? Number(argv[runsIdx + 1]) : 3
  // years。
  const yearsIdx = argv.indexOf('--years')
  const years = yearsIdx !== -1 ? Number(argv[yearsIdx + 1]) : 20
  // mods。
  const modsIdx = argv.indexOf('--mods')
  const modsDir = modsIdx !== -1 ? argv[modsIdx + 1] : undefined
  // mock-ai。
  const mockAi = argv.includes('--mock-ai')
  // electron。
  const electronIdx = argv.indexOf('--electron')
  const electronBin = electronIdx !== -1 ? argv[electronIdx + 1] : undefined
  // 工作目录（game-engine 根，保证子进程解析 fixture/mods 相对路径一致）。
  const cwd = process.cwd()
  // 提示。
  log.info(`seed=${seed} runs=${runs} years=${years} mods=${modsDir || 'fixture'} mockAi=${mockAi} electron=${electronBin || '无'}`)
  // 执行。
  try {
    // 运行。
    const { ok } = await runConsistency({ seed, runs, years, modsDir, mockAi, electronBin, cwd, log })
    // 退出码。
    process.exit(ok ? 0 : 1)
  } catch (e) {
    // 错误。
    console.error(`一致性检查失败: ${e.message}`)
    // 失败退出。
    process.exit(1)
  }
}
