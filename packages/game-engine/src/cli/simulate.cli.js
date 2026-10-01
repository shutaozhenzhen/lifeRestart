/**
 * simulate.cli.js — 批量模拟 CLI 原型（「模拟系统」的可观测入口）
 *
 * 用法：
 *   node src/cli/simulate.cli.js [--runs 200] [--seed 42] [--mods <dir>] [--json] [--log-level trace]
 *
 * 说明：
 *   - 每局流程：随机抽天赋（10 选 3，带互斥校验）→ 随机分配属性（默认点数 + 天赋加成）
 *     → 推进到人生结束 → 采集快照；多局聚合出寿命分布 / 总评分档 / 属性均值 / 收集率。
 *   - `--seed` 时**游戏内随机与策略随机共用同一 RNG**（见 createSimulation），结果可完整复现。
 *   - `--mods <dir>` 用 Mod 加载器取数据（通常指向 `mods/`，Data Mod 提供原版真实数据）；
 *     缺省用内置 fixture 数据（跑得快，适合冒烟）。
 *   - 前端「模拟统计」页复用同一个内核（src/sim/simulator.js），不存在两套实现。
 */

// 参数与日志工具（--seed / --log-level 统一解析）。
import { makeRng, makeCliLogger } from './cli-util.js'
// 日志器（未显式指定级别时用静默级别，避免引擎 INFO 日志污染报告输出）。
import { createLogger } from '../functions/logger.js'
// 模拟内核（推荐入口）。
import { createSimulation } from '../sim/simulator.js'
// Mod 加载（可选：真实数据 + 钩子）。
import { createModLoader } from '../mod/loader.js'
import { createGameAPI, createHookBus } from '../mod/gameapi.js'
// fixture 数据（无 --mods 时的默认数据源）。
import { clone } from '../functions/util.js'
import { AGE_DATA, TOTAL } from '../fixtures/property.fixture.js'
import { TALENTS, EVENTS } from '../fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from '../fixtures/achievement-character.fixture.js'

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

// #buildFixtureData
// 内置 fixture 数据（结构与 Data Mod 产物一致）。
//
// @returns {object} 游戏数据
export function buildFixtureData() {
  // 返回深拷贝，避免多次调用互相污染。
  return {
    age: clone(AGE_DATA),
    total: TOTAL,
    talents: clone(TALENTS),
    events: clone(EVENTS),
    achievements: clone(ACHIEVEMENTS),
    characters: {},
  }
}

// #loadModData
// 用 Mod 加载器取数据（Data Mod → 原版真实数据；其它 Mod 的钩子也会挂上，但模拟不注入 AI）。
//
// @param {object} params
// @param {string} params.modsDir - mods 目录
// @param {object} params.log - 日志器
// @returns {object} 合并后的数据
export function loadModData({ modsDir, log }) {
  // 加载器。
  const loader = createModLoader({ modsDir, log })
  // 共享钩子总线。
  const bus = createHookBus()
  // 加载 + 执行 code.js（未配置 AI → ai-mod 只注册不调用）。
  const { data } = loader.loadAll({
    // 注入 gameAPI（无 AI 配置）。
    createAPI: (name, mergedData) => createGameAPI({ data: mergedData, hooks: bus, log }),
  })
  // 返回数据。
  return data
}

// #formatReport
// 把聚合结果渲染成终端报告（可测试的纯函数）。
//
// @param {object} stats - summarize() 的结果
// @param {object} [meta] - { elapsedMs }
// @returns {string} 报告文本
export function formatReport(stats, { elapsedMs } = {}) {
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
    const talents = (stats.best.talents || []).join(', ') || '（无）'
    const alloc = Object.entries(stats.best.allocation || {}).map(([k, v]) => `${k} ${v}`).join(' ')
    // 行。
    lines.push(`最佳一局  : 寿命 ${stats.best.age} / 总评 ${stats.best.sum}（${stats.best.grade}）/ 天赋 ${talents} / 分配 ${alloc}`)
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
// @param {number} [params.chunk] - 每批局数（用于进度回调）
// @param {Function} [params.onProgress] - 进度回调 (done, total, lastResult) => void
// @param {object} [params.log] - 日志器
// @returns {Promise<{stats: object, results: Array, elapsedMs: number}>} 结果
export async function simulateCli({ runs = 50, seed = null, modsDir = null, chunk = 10, onProgress, log } = {}) {
  // 数据源：Mod（真实数据）或 fixture。
  const data = modsDir ? loadModData({ modsDir, log }) : buildFixtureData()
  // 开始计时。
  const startedAt = Date.now()
  // 创建模拟环境（同一个 RNG 注入 Life 与策略层 → 可复现）。
  const { simulator } = await createSimulation({ data, seed, storage: memoryStorage(), logger: log })
  // 分批跑：每批结束后回调进度（前端靠它渲染进度条 / 判断取消）。
  for (let done = 0; done < runs; done += chunk) {
    // 本批局数（最后一批可能不足）。
    const size = Math.min(chunk, runs - done)
    // 跑一批。
    simulator.run(size)
    // 进度回调。
    if (typeof onProgress === 'function') onProgress(simulator.progress(), runs, simulator.results[simulator.results.length - 1])
  }
  // 聚合。
  const stats = simulator.summarize({ seed })
  // 返回。
  return { stats, results: simulator.results, elapsedMs: Date.now() - startedAt }
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
        '  --runs <n>     模拟局数（默认 100）',
        '  --seed <n>     随机种子（给定时结果可复现）',
        '  --mods <dir>   用 Mod 数据（通常指向 mods/，Data Mod 提供原版数据）',
        '  --json         以 JSON 输出聚合结果',
        '  --log-level <trace|debug|info|warn|error>',
      ].join('\n')
    )
    // 结束。
    return
  }
  // 解析局数。
  const runsIndex = argv.indexOf('--runs')
  // 局数（非法值回退 50；真实数据下单局可达 1s，默认不宜过大）。
  const runs = runsIndex !== -1 ? Math.max(1, Number(argv[runsIndex + 1]) || 50) : 50
  // 是否 JSON 输出（进度行只在人类可读模式下打印）。
  const asJson = argv.includes('--json')
  // 解析 mods 目录。
  const modsIndex = argv.indexOf('--mods')
  // 目录。
  const modsDir = modsIndex !== -1 ? argv[modsIndex + 1] : null
  // 随机源与种子（--seed 由 makeRng 解析；这里只用 seed 值，RNG 交给 createSimulation 统一注入）。
  const { seed } = makeRng(argv)
  // 日志器：显式给了 --log-level 才按它输出，否则只报错——
  // 这个 CLI 的 stdout 是"报告"，引擎 INFO 日志混进去会破坏可读性（也不利于 --json 之外的工具消费）。
  const log = argv.includes('--log-level') ? makeCliLogger(argv, 'sim') : createLogger({ level: 'error', prefix: 'sim' })
  // 计时起点（进度行用）。
  const startedAt = Date.now()
  // 跑（人类可读模式打印进度，每 10 局一行）。
  const { stats, elapsedMs } = await simulateCli({
    // 局数。
    runs,
    // 种子。
    seed,
    // 数据源。
    modsDir,
    // 日志。
    log,
    // 进度回调。
    onProgress: asJson
      ? undefined
      : (done, total, last) => {
          // 每 10 局或最后一局打印一次（避免刷屏）。
          if (done % 10 === 0 || done === total) {
            // 已用时间（秒）。
            const used = ((Date.now() - startedAt) / 1000).toFixed(1)
            // 进度行（原地刷新）。
            process.stdout.write(`\r已模拟 ${done}/${total} 局（${used}s，最近一局 ${last?.age ?? '?'} 岁）   `)
          }
        },
  })
  // 清掉进度行。
  if (!asJson) process.stdout.write('\r' + ' '.repeat(60) + '\r')
  // 输出：JSON 或报告。
  if (asJson) console.log(JSON.stringify(stats, null, 2))
  else console.log(formatReport(stats, { elapsedMs }))
}

// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 执行。
  main()
}
