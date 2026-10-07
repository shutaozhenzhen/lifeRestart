/**
 * simulate.cli.js — 批量模拟 CLI 原型（「模拟系统」的可观测入口）
 *
 * 用法：
 *   node src/cli/simulate.cli.js --mods ../../mods [--runs 200] [--seed 42] [--json] [--log-level trace]
 *
 * 说明：
 *   - 每局流程：随机抽天赋（10 选 3，带互斥校验）→ 随机分配属性（默认点数 + 天赋加成）
 *     → 推进到人生结束 → 采集快照；多局聚合出寿命分布 / 总评分档 / 属性均值 / 收集率。
 *   - `--seed` 时**游戏内随机与策略随机共用同一 RNG**（见 createSimulation），结果可完整复现。
 *   - `--mods <dir>` 用 Mod 加载器取数据（通常指向 `mods/`，Data Mod 提供原版真实数据）；
 *     **数据源是必需的** —— 引擎不内置任何内容，没给 `--mods` 时直接报错退出
 *     （以前缺省会用测试 fixture 演示数据，那既是内容泄漏、也掩盖了"没给数据源"）。
 *   - 前端「模拟统计」页复用同一个内核（src/sim/simulator.js），不存在两套实现。
 */

// 参数与日志工具（--seed / --log-level 统一解析）。
import { makeRng, makeCliLogger, noContentError } from './cli-util.js'
// 日志器（未显式指定级别时用静默级别，避免引擎 INFO 日志污染报告输出）。
import { createLogger } from '../functions/logger.js'
// 导出器（CSV/JSON/Markdown 与策略文案，与前端页共用同一实现）。
import { exportSimulation, formatStrategy } from '../sim/exporters.js'
// 文件写入（--out 时）。
import { writeFileSync } from 'node:fs'
// 模拟内核（推荐入口）。
import { createSimulation, skipPolicyWarning } from '../sim/simulator.js'
// 批量场景的跳过策略（`async: true` / `deterministic: false` 的 Mod 见 mod/manifest.js）。
import { modsToSkip } from '../mod/manifest.js'
// Mod 加载（可选：真实数据 + 钩子）。
import { createNodeModLoader } from '../mod/loader-node.js'
import { createGameAPI, createHookBus } from '../mod/gameapi.js'

// #memoryStorage
// 模拟专用内存存储：不能让批量模拟污染玩家存档（重开次数/成就等）。
export function memoryStorage() {
  // 内存数据。
  const data = {}
  // 适配器。
  return {
    // 读。
    getItem(k) { return k in data ? data[k] : null },
    // 写。
    setItem(k, v) { data[k] = String(v) },
  }
}

// #loadModData
// 用 Mod 加载器取数据（Data Mod → 原版真实数据；其它 Mod 的钩子也会挂上，但模拟不注入 AI）。
//
// **跳过策略**（2026-10 能力补齐 ④）：批量模拟要"同 seed 同输入 → 逐位复现"，而
// `async: true`（异步逐岁钩子等外部世界）与 `deterministic: false` 的 Mod 天然不满足这一点
// → 先用一次**只扫描**（不加载）算出跳过名单，再把这些名字传给加载器（`skip`），
// 理由一路带到 `stats.warnings` / 报告（**不许静默丢**）。
//
// @param {object} params
// @param {string} params.modsDir - mods 目录
// @param {object} params.log - 日志器
// @returns {Promise<{data: object, skipped: Array<{name: string, reasons: string[]}>}>} 数据 + 跳过清单
export async function loadModData({ modsDir, log }) {
  // 只扫描（拿 manifest；不加载数据、不执行 code.js）—— 跳过判定只需要 manifest。
  const probe = await createNodeModLoader({ modsDir, log })
  // 策略（纯函数，有单测）。
  const policy = modsToSkip(probe.mods)
  // 加载器（跳过名单生效）。
  const loader = await createNodeModLoader({ modsDir, log, skip: policy.skipped })
  // 共享钩子总线。
  const bus = createHookBus()
  // 加载 + 执行 code.js（未配置 AI → ai-mod 只注册不调用）。
  const { data } = await loader.loadAll({
    // 注入 gameAPI（无 AI 配置）。
    createAPI: (name, mergedData) => createGameAPI({ data: mergedData, hooks: bus, log }),
  })
  // 返回数据 + 跳过清单。
  return { data, skipped: policy.notReproducible }
}

// #formatReport
// 把聚合结果渲染成终端报告（可测试的纯函数）。
//
// @param {object} stats - summarize() 的结果
// @param {object} [meta] - { elapsedMs, talentName }
// @returns {string} 报告文本
export function formatReport(stats, { elapsedMs, talentName } = {}) {
  // 行缓冲。
  const lines = []
  // 百分比展示（0~1 → 一位小数）。
  const pct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`
  // 属性均值行。
  const avgLine = (obj) =>
    ['CHR', 'INT', 'STR', 'MNY', 'SPR']
      .map((k) => `${({ CHR: '颜值', INT: '智力', STR: '体质', MNY: '家境', SPR: '快乐' })[k]} ${obj?.[k] ?? 0}`)
      .join(' / ')
  // 标题与概览。
  lines.push('===== 批量模拟结果 =====')
  lines.push(`局数      : ${stats.runs}${stats.seed === null || stats.seed === undefined ? '（随机种子，不可复现）' : `（seed=${stats.seed}）`}`)
  // 策略（特性/属性各是随机还是固定，固定时列出名称）。
  lines.push(`策略      : ${formatStrategy(stats.strategy, { talentName })}`)
  // 耗时与吞吐。
  if (elapsedMs) {
    // 每秒局数。
    const perSecond = stats.runs > 0 ? Math.round(stats.runs / (elapsedMs / 1000)) : 0
    lines.push(`耗时      : ${(elapsedMs / 1000).toFixed(2)}s（约 ${perSecond} 局/秒）`)
  }
  // 寿命统计。
  lines.push(`寿命      : 平均 ${stats.age.avg} / 中位 ${stats.age.median} / 最短 ${stats.age.min} / 最长 ${stats.age.max}`)
  // 总评统计。
  lines.push(`总评      : 平均 ${stats.sum.avg} / 最高 ${stats.sum.max} / 最低 ${stats.sum.min}`)
  // 分档分布。
  const grades = stats.sum.grades || {}
  lines.push(`总评分档  : 普通 ${grades.J_Normal || 0} / 优秀 ${grades.J_Good || 0} / 极佳 ${grades.J_Great || 0}`)
  // 属性均值。
  lines.push(`属性均值  : ${avgLine(stats.propertys)}`)
  // 历史最高均值。
  lines.push(`最高均值  : ${avgLine(stats.maxPropertys)}`)
  // 收集率。
  const c = stats.collection || {}
  lines.push(`收集      : 成就 ${c.achievements || 0} 个（${pct(c.achievementRate)}）/ 天赋 ${pct(c.talentRate)} / 事件 ${pct(c.eventRate)}`)
  // 平均每局成就。
  lines.push(`每局成就  : 平均 ${stats.achievementsPerRun}`)
  // 寿命分布直方图。
  lines.push('寿命分布  :')
  // 取最大计数用于条形缩放。
  const maxCount = Math.max(1, ...stats.age.histogram.map((b) => b.count))
  // 逐档渲染（20 字符宽条形）。
  for (const bucket of stats.age.histogram) {
    // 条形长度。
    const bar = '#'.repeat(Math.round((bucket.count / maxCount) * 20))
    // 行。
    lines.push(`  ${bucket.label.padStart(6)} | ${bar} ${bucket.count}`)
  }
  // 最佳一局。
  if (stats.best) {
    // 天赋与分配摘要。
    const talents = (stats.best.talentDetails || []).map((d) => d.name).join(', ') || '（无）'
    const alloc = Object.entries(stats.best.allocation || {}).map(([k, v]) => `${k} ${v}`).join(' ')
    // 行。
    lines.push(`最佳一局  : 寿命 ${stats.best.age} / 总评 ${stats.best.sum}（${stats.best.grade}）/ 天赋 ${talents} / 分配 ${alloc}`)
  }
  // 警告（固定特性无效、固定属性超预算等，必须让用户看到）。
  for (const warning of stats.warnings || []) {
    // 逐条。
    lines.push(`⚠ ${warning}`)
  }
  // 收尾。
  lines.push('')
  // 拼接。
  return lines.join('\n')
}

// #simulateCli
// 跑一次批量模拟（供测试与 main 复用）。
//
// 性能说明（实测，真实数据 mods/lifeRestart-data）：
//   单局 0.3~1.5 秒 —— 老年阶段每年要判几百个事件条件，寿命越长越慢（超线性）。
//   因此这里分批跑并在每批回调 onProgress，前端即用同一机制做进度条与取消。
//
// @param {object} params
// @param {number} [params.runs] - 局数
// @param {number|null} [params.seed] - 种子
// @param {string|null} [params.modsDir] - mods 目录（取真实数据）
// @param {object} [params.data] - 直接给数据（调用方自备，如测试里的 fixture）
// @param {object} [params.strategy] - 策略（随机/固定特性与属性）
// @param {number} [params.chunk] - 每批局数（用于进度回调）
// @param {Function} [params.onProgress] - 进度回调 (done, total, lastResult) => void
// @param {object} [params.log] - 日志器
// @returns {Promise<{stats: object, results: Array, elapsedMs: number, data: object}>} 结果
// @throws {Error} 既没给 data 也没给 modsDir 时抛「没有内容来源」错误
export async function simulateCli({ runs = 50, seed = null, modsDir = null, data = null, strategy, chunk = 10, onProgress, log } = {}) {
  // 数据源：调用方直给 / Mod 加载器；两者都没有 → 明确报错（引擎不内置内容）。
  let gameData = data
  // 跳过策略的理由（`--mods` 路径才有；**一路带到 stats.warnings**）。
  let skipped = []
  // 走 Mod 加载器。
  if (!gameData && modsDir) {
    // 加载（内部已按跳过策略剔除不可复现的 Mod）。
    const loaded = await loadModData({ modsDir, log })
    // 取数据与跳过清单。
    gameData = loaded.data
    skipped = loaded.skipped
  }
  // 没有内容来源。
  if (!gameData) {
    throw noContentError('请用 --mods <dir> 指定 Mod 目录（例如 --mods ../../mods），或给 simulateCli 传 data')
  }
  // 开始计时。
  const startedAt = Date.now()
  // 创建模拟环境（同一个 RNG 注入 Life 与策略层 → 可复现）。
  const { simulator } = await createSimulation({ data: gameData, seed, storage: memoryStorage(), logger: log, strategy })
  // 分批跑：每批结束后回调进度（前端靠它渲染进度条 / 判断取消）。
  for (let done = 0; done < runs; done += chunk) {
    // 本批局数（最后一批可能不足）。
    const size = Math.min(chunk, runs - done)
    // 跑一批。
    simulator.run(size)
    // 进度回调。
    if (typeof onProgress === 'function') onProgress(simulator.progress(), runs, simulator.results[simulator.results.length - 1])
  }
  // 把跳过理由并进每一局（summarize 会去重汇总到 stats.warnings）。
  skipPolicyWarning({ skipped, simulator, log })
  // 聚合。
  const stats = simulator.summarize({ seed })
  // 返回（带上 data：报告里要把固定特性 ID 渲染成名称）。
  return { stats, results: simulator.results, elapsedMs: Date.now() - startedAt, data: gameData, skipped }
}

// #parseStrategy
// 解析命令行策略参数：
//   --talents <id,id,...|random>   固定特性
//   --alloc <CHR=3,INT=4,...|random>  固定属性
//
// @param {string[]} argv - 参数
// @returns {{strategy: object, warnings: string[]}} 策略与解析警告
export function parseStrategy(argv = []) {
  // 缺省两条轴随机。
  const strategy = { talents: { mode: 'random', fixed: [] }, allocation: { mode: 'random', fixed: {} } }
  // 警告。
  const warnings = []
  // 固定特性。
  const talentsIndex = argv.indexOf('--talents')
  // 有该参数。
  if (talentsIndex !== -1) {
    // 取值。
    const raw = argv[talentsIndex + 1]
    // 非随机且非空。
    if (raw && raw !== 'random') {
      // 拆分。
      const ids = String(raw).split(',').map((s) => s.trim()).filter(Boolean)
      // 有效则固定。
      if (ids.length > 0) strategy.talents = { mode: 'fixed', fixed: ids }
      // 否则警告。
      else warnings.push('--talents 为空，按随机处理')
    }
  }
  // 固定属性。
  const allocIndex = argv.indexOf('--alloc')
  // 有该参数。
  if (allocIndex !== -1) {
    // 取值。
    const raw = argv[allocIndex + 1]
    // 非随机且非空。
    if (raw && raw !== 'random') {
      // 解析 k=v 片段。
      const fixed = {}
      // 逐段。
      for (const part of String(raw).split(',')) {
        // 拆键值。
        const [key, value] = part.split('=')
        // 非法片段。
        if (!key || value === undefined) {
          // 警告。
          warnings.push(`--alloc 片段无法解析：${part}`)
          // 跳过。
          continue
        }
        // 记录。
        fixed[key.trim()] = Number(value)
      }
      // 有效则固定。
      if (Object.keys(fixed).length > 0) strategy.allocation = { mode: 'fixed', fixed }
      // 否则警告。
      else warnings.push('--alloc 无有效项，按随机处理')
    }
  }
  // 返回。
  return { strategy, warnings }
}

// #runCli
// CLI 主流程（参数解析 → 模拟 → 输出/导出），依赖可注入以便测试。
//
// @param {object} params
// @param {string[]} [params.argv] - 参数
// @param {object} [params.data] - 直接给数据（调用方自备，如测试里的 fixture）
// @param {Function} [params.stdout] - 输出函数（整段文本）
// @param {Function} [params.progress] - 进度文本函数（原地刷新）
// @param {Function} [params.writeFile] - 写文件函数（--out）
// @returns {Promise<{stats: object, text: string, fileName: string, outFile: string|null}>} 产物
export async function runCli({
  argv = [],
  data = null,
  stdout = (text) => console.log(text),
  progress,
  writeFile = (file, text) => writeFileSync(file, text),
} = {}) {
  // 局数（非法值回退 50；真实数据下单局可达 1s，默认不宜过大）。
  const runsIndex = argv.indexOf('--runs')
  const runs = runsIndex !== -1 ? Math.max(1, Number(argv[runsIndex + 1]) || 50) : 50
  // 导出格式：--format 优先，--json 等价于 format=json。
  const formatIndex = argv.indexOf('--format')
  const format = formatIndex !== -1 ? argv[formatIndex + 1] : argv.includes('--json') ? 'json' : null
  // 输出文件。
  const outIndex = argv.indexOf('--out')
  const outFile = outIndex !== -1 ? argv[outIndex + 1] : null
  // mods 目录。
  const modsIndex = argv.indexOf('--mods')
  const modsDir = modsIndex !== -1 ? argv[modsIndex + 1] : null
  // 种子。
  const { seed } = makeRng(argv)
  // 策略。
  const { strategy, warnings: strategyWarnings } = parseStrategy(argv)
  // 日志器：显式给了 --log-level 才按它输出，否则只报错——
  // 这个 CLI 的 stdout 是"报告"，引擎 INFO 日志混进去会破坏可读性。
  const log = argv.includes('--log-level') ? makeCliLogger(argv, 'sim') : createLogger({ level: 'error', prefix: 'sim' })
  // 人类可读模式：没有导出格式、也没有写文件（此时才打印进度，避免污染 CSV/JSON）。
  const humanMode = !format && !outFile
  // 计时起点（进度行用）。
  const startedAt = Date.now()
  // 跑。
  const { stats, results, elapsedMs, data: loadedData } = await simulateCli({
    // 局数。
    runs,
    // 种子。
    seed,
    // 数据源：调用方直给（测试）或 --mods 目录；都没有 → simulateCli 明确报错。
    data,
    // 数据源（目录）。
    modsDir,
    // 策略。
    strategy,
    // 日志。
    log,
    // 进度回调。
    onProgress: humanMode && typeof progress === 'function'
      ? (done, total, last) => {
          // 每 10 局或最后一局刷新（避免刷屏）。
          if (done % 10 === 0 || done === total) {
            // 已用时间（秒）。
            const used = ((Date.now() - startedAt) / 1000).toFixed(1)
            // 进度行。
            progress(`已模拟 ${done}/${total} 局（${used}s，最近一局 ${last?.age ?? '?'} 岁）`)
          }
        }
      : undefined,
  })
  // 天赋 ID → 名称（报告与 md 导出都要用）。
  const talents = loadedData?.talents || {}
  // 取名函数。
  const talentName = (id) => talents[id]?.name || id
  // 策略解析警告与模拟警告合并展示。
  const mergedWarnings = [...strategyWarnings, ...(stats.warnings || [])]
  // 带警告的统计（导出报告里也要能看到）。
  const statsWithWarnings = { ...stats, warnings: mergedWarnings }
  // 生成文本与文件名。
  const output = format
    ? exportSimulation({ format, stats: statsWithWarnings, results, meta: { strategy: stats.strategy, talentName } })
    : {
        text: formatReport(statsWithWarnings, { elapsedMs, talentName }),
        fileName: '',
      }
  // 输出：写文件或打印。
  if (outFile) writeFile(outFile, output.text)
  else stdout(output.text)
  // 返回。
  return { stats: statsWithWarnings, text: output.text, fileName: output.fileName, outFile }
}

// #main
// CLI 入口。
async function main() {
  // 参数。
  const argv = process.argv.slice(2)
  // 帮助。
  if (argv.includes('--help') || argv.includes('-h')) {
    // 用法说明。
    console.log(
      [
        '用法: node src/cli/simulate.cli.js [选项]',
        '  --runs <n>      模拟局数（默认 50）',
        '  --seed <n>      随机种子（给定时结果可复现）',
        '  --talents <ids> 固定特性（逗号分隔天赋 ID；random=随机，默认）',
        '  --alloc <spec>  固定属性（如 CHR=3,INT=4,STR=5,MNY=8；random=随机，默认）',
        '  --mods <dir>    【必需】Mod 目录（通常指向 mods/，Data Mod 提供原版数据）',
        '  --format <fmt>  导出 csv | json | md',
        '  --out <file>    导出到文件（缺省打印到 stdout）',
        '  --json          等价于 --format json',
        '  --log-level <trace|debug|info|warn|error>',
      ].join('\n')
    )
    // 结束。
    return
  }
  // 执行（进度原地刷新到 stdout）。
  await runCli({
    // 参数。
    argv,
    // 整段输出（换行由 formatReport/导出文本自带）。
    stdout: (text) => process.stdout.write(text),
    // 进度：原地刷新并清行。
    progress: (text) => process.stdout.write(`\r${text}   `),
    // 写文件。
    writeFile: (file, text) => {
      // 写。
      writeFileSync(file, text)
      // 提示。
      process.stdout.write(`已写入 ${file}\n`)
    },
  })
}

// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 执行（缺少数据源等错误统一打印 + 置失败退出码，不抛原始堆栈）。
  main().catch((e) => {
    // 报错。
    console.error(`[sim] ${e.message}`)
    // 失败退出码。
    process.exitCode = 1
  })
}
