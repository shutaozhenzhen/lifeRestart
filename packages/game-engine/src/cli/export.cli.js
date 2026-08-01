/**
 * 人生轨迹导出 CLI（Step 11：冒烟对比基础）
 *
 * 用法：
 *   node src/cli/export.cli.js --seed <n> [--years <n>] [--talents t_001,t_002]
 *
 * 功能：
 *   1. 用固定 seed 跑完整一局，导出每岁的属性/事件/天赋流水为 JSON。
 *   2. 同 seed 两次运行输出必须完全一致（可复现性验证）。
 *   3. 为 Step 26 跨平台一致性对比提供标准输出格式。
 *
 * 输出格式：
 *   { seed, mode, years: [{ age, props, events, talents }], end: { age, reason } }
 */

// 导入模块。
import Life from '../modules/life.js'
import { clone, createRng } from '../functions/util.js'
// 共享辅助。
import { makeRng, makeCliLogger } from './cli-util.js'
// fixture 数据（静态导入，避免顶层 await）。
import { AGE_DATA, TOTAL } from '../fixtures/property.fixture.js'
import { TALENTS, EVENTS } from '../fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from '../fixtures/achievement-character.fixture.js'

// #buildData
// 组装演示数据（与 game.cli 一致）。
// @returns {object} 数据
function buildData() {
  // 返回完整数据。
  return {
    age: clone(AGE_DATA),
    total: TOTAL,
    talents: clone(TALENTS),
    events: clone(EVENTS),
    achievements: clone(ACHIEVEMENTS),
    characters: {},
  }
}

// #runLife
// 用给定 seed 跑完整一局，返回可复现的轨迹 JSON。
//
// @param {object} params
// @param {number} params.seed - 随机种子
// @param {number} [params.years] - 最大推进年数
// @param {Array<string>} [params.talents] - 已选天赋
// @param {object} [params.allocation] - 属性分配
// @param {number} [params.startLif] - 起始生命（默认 1，设大便于长轨迹对比）
// @param {object} [params.log] - 日志器
// @returns {Promise<object>} 轨迹 JSON
export async function runLife({ seed, years = 100, talents = [], allocation = {}, startLif = 1, log }) {
  // 日志器。
  const logger = log || makeCliLogger([], 'export')
  // 创建 Life（固定种子 RNG）。
  const life = new Life({ data: buildData(), random: createRng(seed) })
  // 初始化。
  await life.initial()
  // 配置（含 judge）。
  life.config({ propertyConfig: { judge: makeJudgeConfig() } })
  // 重开（触发替换链）。
  life.remake(talents)
  // 开局。
  life.start(allocation)
  // 调整起始生命（对比长轨迹时避免 0 岁即死）。
  if (startLif !== 1) {
    // 覆盖生命。
    life.request('PROPERTY').set('LIF', startLif)
  }
  // 每岁记录。
  const yearLogs = []
  // 结束原因。
  let endReason = null
  // 逐岁推进。
  for (let i = 0; i < years; i++) {
    // 推进一年。
    const { age, content, isEnd } = life.next()
    // 分离事件与天赋。
    const events = content.filter(c => c.type === 'EVT').map(c => c.description)
    const talentsList = content.filter(c => c.type === 'TLT').map(c => c.name)
    // 记录本岁。
    yearLogs.push({
      age,
      props: { ...life.propertys },
      events,
      talents: talentsList,
    })
    // 结束。
    if (isEnd) {
      // 记录原因。
      endReason = `LIF=${life.request('PROPERTY').get('LIF')}`
      // 停止。
      break
    }
  }
  // 返回轨迹。
  return {
    seed,
    years: yearLogs.length,
    log: yearLogs,
    end: { age: yearLogs.length ? yearLogs[yearLogs.length - 1].age : -1, reason: endReason || 'reach_max' },
  }
}

// #makeJudgeConfig
// 生成评价分档（与 game.cli 一致）。
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
  // 异步主函数。
  ;(async () => {
    // 解析参数。
    const argv = process.argv.slice(2)
    // 随机源（取 seed）。
    const { seed } = makeRng(argv)
    // 无 seed 报错。
    if (seed === null) {
      // 提示。
      console.error('用法: node export.cli.js --seed <n> [--years <n>] [--start-lif <n>]')
      // 退出。
      process.exit(1)
    }
    // 推进年数。
    const yearsIdx = argv.indexOf('--years')
    const years = yearsIdx !== -1 ? Number(argv[yearsIdx + 1]) : 100
    // 已选天赋。
    const talentsIdx = argv.indexOf('--talents')
    const talents = talentsIdx !== -1 ? argv[talentsIdx + 1].split(',').filter(Boolean) : []
    // 起始生命。
    const lifIdx = argv.indexOf('--start-lif')
    const startLif = lifIdx !== -1 ? Number(argv[lifIdx + 1]) : 1
    // 运行。
    const result = await runLife({ seed, years, talents, startLif })
    // 输出 JSON。
    console.log(JSON.stringify(result, null, 2))
  })()
}
