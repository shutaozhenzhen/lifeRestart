/**
 * 人生重开模拟器 — 可玩版 CLI 原型（Step 5：Life 编排器版）
 *
 * 用法：
 *   node src/cli/game.cli.js [--seed <n>] [--locale zh-cn|en-us] [--data <json>]
 *
 * 相比旧版 game.cli.js，本次重构：
 *   1. 用 Life 编排器整合全部模块（property/talent/event/achievement）。
 *   2. 支持 i18n 切换（--locale）。
 *   3. times 重开次数递增。
 *   4. 支持 --data 传入 JSON 数据（Step 6 数据加载层对接点）。
 *
 * 交互命令：
 *   draw          抽取天赋池
 *   select <id|索引...> 选中天赋（限3个，索引对应 draw 的 [n]，互斥校验）
 *   alloc <json>  分配属性点
 *   start         开局
 *   next          推进一年
 *   summary       人生总结
 *   status        当前状态
 *   help          帮助
 *   exit          退出
 */

// 导入模块。
import Life from '../modules/life.js'
import { clone, createRng } from '../functions/util.js'
import { loadLocale, t } from '../i18n/index.js'
// 数据加载层。
import { prepareForEngine, convertConditions } from '../data-loader.js'
// 共享交互辅助。
import { runInteractive, makeRng, parseCommand, makeCliLogger } from './cli-util.js'

// #buildData
// 加载默认 fixture 数据（原型用）。
// @returns {object} 数据
function buildData() {
  // 引用 fixture（Node 运行时动态加载）。
  return { source: 'fixture' }
}

// #createGame
// 创建游戏状态机（基于 Life 编排器）。
//
// @param {object} deps
// @param {object} deps.data - 引擎数据 { age, talents, events, achievements, characters, total }
// @param {() => number} [deps.random] - 随机源
// @param {string} [deps.locale] - 语言名
// @param {object} [deps.storage] - storage 适配器
// @param {object} [deps.log] - 日志器
// @returns {{ state: object, handlers: (args: string[]) => {text: string, exit?: boolean} }}
export function createGame({ data, random = Math.random, locale = 'zh-cn', storage, log }) {
  // 日志器（缺省 info 级）。
  const logger = log || makeCliLogger([], 'game')
  // 当前语言。
  const localeObj = loadLocale(locale)
  // 事件总线：成就弹窗（原型直接打印）。
  const emit = (tag, payload) => {
    // 成就事件。
    if (tag === 'achievement') {
      // 打印成就。
      console.log(`🏆 成就达成: ${payload.name}`)
    }
  }
  // 创建 Life 实例。
  const life = new Life({ data, random, storage, emit })
  // 初始化（异步）。
  const ready = (async () => {
    // 初始化数据。
    await life.initial()
    // 配置（含属性 judge，供 summary）。
    life.config({ propertyConfig: { judge: makeJudgeConfig() } })
    // 记录初始化完成。
    logger.debug('Life 初始化完成')
  })()

  // 游戏状态。
  const state = {
    phase: 'init',      // init → select → play → end
    pool: [],           // 天赋池
    selected: [],       // 已选天赋
    allocation: {},     // 属性分配
    over: false,        // 是否结束
  }

  // #makeJudgeConfig
  // 生成各属性评价分档。
  // @returns {object} judge 配置
  function makeJudgeConfig() {
    // 五个基础属性 + 派生值。
    const base = ['CHR', 'INT', 'STR', 'MNY', 'SPR', 'HCHR', 'HINT', 'HSTR', 'HMNY', 'HSPR']
    // 每个属性分档。
    const judge = {}
    // 逐属性生成。
    for (const key of base) judge[key] = [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']]
    // 年龄与总分档。
    judge.HAGE = [[0, 1, 'J_Normal'], [10, 2, 'J_Good'], [20, 3, 'J_Great']]
    judge.SUM = [[0, 1, 'J_Normal'], [50, 2, 'J_Good'], [100, 3, 'J_Great']]
    judge.TMS = [[0, 1, 'J_Normal'], [1, 2, 'J_Good'], [5, 3, 'J_Great']]
    // 返回。
    return judge
  }

  // #resolveTalentId
  // 解析用户输入为天赋 ID：数字 → 天赋池索引；其他 → 原样当 ID。
  //
  // @param {string} input - 用户输入（索引或 ID）
  // @returns {string|null} 天赋 ID；池中无对应索引返回 null
  const resolveTalentId = (input) => {
    // 纯数字：按天赋池索引查找。
    if (/^\d+$/.test(input)) {
      // 取池中对应项。
      const item = state.pool[Number(input)]
      // 池中无该项。
      if (!item) return null
      // 返回其 ID。
      return item.id
    }
    // 非数字：原样当 ID。
    return input
  }

  // 命令处理器（返回 Promise，因为 Life 初始化是异步的）。
  const handlers = async (args) => {
    // 等待 Life 初始化完成。
    await ready
    // 取命令与参数。
    const [cmd, ...rest] = args
    // 记录命令调用。
    logger.debug(`命令: ${cmd} ${rest.join(' ')}`)
    // 按命令分发。
    switch (cmd) {
      case 'draw': {
        // 抽取天赋池（trace 级追踪函数参数）。
        state.pool = logger.traceFn('talentRandom', () => life.talentRandom())
        // 格式化（显示索引 + ID + 名称，便于 select 引用）。
        const lines = state.pool.filter(Boolean).map((x, i) => `  [${i}] ${x.name} (${x.grade}级, id=${x.id})`)
        // 输出。
        return { text: `天赋池:\n${lines.join('\n')}` }
      }
      case 'select': {
        // 需要至少一个 ID。
        if (rest.length < 1) return { text: '用法: select <id|索引...>' }
        // 限制 3 个。
        if (rest.length > 3) return { text: '最多选择 3 个天赋' }
        // 解析所有参数为天赋 ID（支持索引）。
        const ids = rest.map(resolveTalentId)
        // 无效索引。
        if (ids.some(id => id === null)) return { text: '无效的天赋索引（先 draw 抽取）' }
        // 组合候选。
        const combined = [...state.selected, ...ids]
        // 互斥校验。
        for (const id of combined) {
          // 冲突。
          const conflict = life.exclude(combined.filter(x => x !== id), id)
          // 有冲突。
          if (conflict) return { text: `${id} 与 ${conflict} 互斥` }
        }
        // 记录选中。
        state.selected = ids
        // 替换链。
        const replaced = life.talentReplace([...ids])
        // 有替换。
        if (replaced.length > 0) {
          return { text: `已选: ${ids.join(', ')}\n替换: ${replaced.map(r => `${r.source.name}→${r.target.name}`).join(', ')}` }
        }
        // 无替换。
        return { text: `已选: ${ids.join(', ')}` }
      }
      case 'alloc': {
        // 需要 JSON。
        if (rest.length < 1) return { text: '用法: alloc <json>' }
        // 解析。
        try {
          state.allocation = JSON.parse(rest[0])
          return { text: `分配: ${JSON.stringify(state.allocation)}` }
        } catch (e) {
          return { text: `JSON 解析失败: ${e.message}` }
        }
      }
      case 'start': {
        // 重开（保留已选天赋）。
        life.remake(state.selected)
        // 开局。
        life.start(state.allocation)
        // 阶段切换。
        state.phase = 'play'
        // 记录开局。
        logger.info(`开局: ${JSON.stringify(life.propertys)}`)
        // 输出。
        return { text: `${t(localeObj, 'GAME_Start')} 属性: ${JSON.stringify(life.propertys)}` }
      }
      case 'next': {
        // 未开局。
        if (state.phase !== 'play') return { text: '请先 start 开局' }
        // 推进一年（trace 级追踪）。
        const { age, content, isEnd } = logger.traceFn('next', () => life.next())
        // 结束。
        state.over = isEnd
        // 记录推进。
        logger.debug(`推进到 ${age} 岁，事件 ${content.length} 条`)
        // 格式化流水。
        const lines = content.map(c => {
          // 事件。
          if (c.type === 'EVT') return `  ${t(localeObj, 'GAME_Event')} ${c.description}`
          // 天赋。
          return `  ${t(localeObj, 'GAME_Talent')} ${c.name}`
        })
        // 输出。
        return { text: `—— ${t(localeObj, 'GAME_Year', age)} ——\n${lines.length ? lines.join('\n') : `  ${t(localeObj, 'GAME_Nothing')}`}\n状态: ${JSON.stringify(life.propertys)}` }
      }
      case 'summary': {
        // 未开局。
        if (state.phase !== 'play') return { text: '请先 start 开局' }
        // 总结。
        const summary = life.summary
        // 格式化。
        const lines = Object.entries(summary).map(([k, v]) => `  ${k}: ${v ? `${v.value} (${v.judge})` : '—'}`)
        // 重开次数。
        const times = life.times
        // 输出。
        return { text: `${t(localeObj, 'GAME_Summary')}:\n${lines.join('\n')}\n${t(localeObj, 'GAME_Times')}: ${times}` }
      }
      case 'again': {
        // 重开：次数 +1。
        life.times = life.times + 1
        // 重置状态。
        state.phase = 'init'
        state.selected = []
        state.allocation = {}
        state.over = false
        // 输出。
        return { text: `重开! ${t(localeObj, 'GAME_Times')}: ${life.times}` }
      }
      case 'status':
        return { text: `阶段: ${state.phase}, 已选: ${state.selected.join(', ') || '无'}, 结束: ${state.over}` }
      case 'help':
        return { text: HELP }
      case 'exit':
        return { text: '再见', exit: true }
      default:
        return { text: t(localeObj, 'CMD_Unknown', { cmd }) }
    }
  }

  // 返回。
  return { state, handlers }
}

// #HELP
// 帮助文本。
const HELP = `可玩版命令：
  draw               抽取天赋池
  select <id|索引...> 选中天赋（限3个）
  alloc <json>       分配属性点
  start              开局
  next               推进一年
  summary            人生总结
  again              重开（次数+1）
  status             当前状态
  help               帮助
  exit               退出`

// #entryPoint
// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 解析随机源。
  const { random } = makeRng(process.argv.slice(2))
  // 解析语言。
  const localeArg = process.argv.findIndex(a => a === '--locale')
  const locale = localeArg !== -1 ? process.argv[localeArg + 1] : 'zh-cn'
  // 加载 fixture 数据（与 Step 6 数据加载层对接）。
  const { AGE_DATA, TOTAL } = await import('../fixtures/property.fixture.js')
  const { TALENTS, EVENTS } = await import('../fixtures/talent-event.fixture.js')
  const { ACHIEVEMENTS } = await import('../fixtures/achievement-character.fixture.js')
  // 组装引擎数据。
  const data = {
    age: clone(AGE_DATA),
    total: TOTAL,
    talents: clone(TALENTS),
    events: clone(EVENTS),
    achievements: clone(ACHIEVEMENTS),
    characters: {},
  }
  // 创建游戏。
  const { handlers } = createGame({ data, random, locale, log: makeCliLogger(process.argv.slice(2), 'game') })
  // 交互循环（handler 是异步的，逐行处理）。
  runInteractive('> 人生 ', handlers)
}
