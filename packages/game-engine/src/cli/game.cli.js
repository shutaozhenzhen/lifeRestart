/**
 * 人生重开模拟器 — 可玩版 CLI 原型
 *
 * 用法：
 *   node src/cli/game.cli.js [--seed <n>]
 *
 * 整合 property + talent + event 三模块，跑完整一局：
 *   draw          抽取天赋池（10 个）
 *   select <id...> 选中天赋（限制 3 个，互斥校验，触发替换链）
 *   alloc <json>  分配属性点，如 alloc {"CHR":5,"INT":3}
 *   start         开局（进入人生循环）
 *   next          推进一年（触发天赋/随机事件）
 *   summary       人生总结（属性/事件/天赋汇总）
 *   status        当前状态
 *   help          帮助
 *   exit          退出
 *
 * 核心逻辑集中在 createGame()（一个可测试的状态机）。
 */

// 导入模块与工具。
import Property from '../modules/property.js'
import Talent from '../modules/talent.js'
import Event from '../modules/event.js'
import { clone, createRng, weightRandom } from '../functions/util.js'
// 条件引擎。
import { check } from '../condition/index.js'
// 共享交互辅助。
import { runInteractive, makeRng } from './cli-util.js'

// #HELP
// 帮助文本。
const HELP = `可玩版命令：
  draw               抽取天赋池
  select <id...>     选中天赋（限3个）
  alloc <json>       分配属性点
  start              开局
  next               推进一年
  summary            人生总结
  status             当前状态
  help               帮助
  exit               退出`

// #createGame
// 创建游戏状态机：整合三模块，返回 { state, handlers }。
// handlers 是命令处理函数，供 CLI 与测试共用。
//
// @param {object} deps
// @param {object} deps.data - 数据 { age, talents, events }
// @param {() => number} [deps.random] - 随机源
// @returns {{ state: object, handlers: (args: string[]) => {text: string, exit?: boolean} }}
export function createGame({ data, random = Math.random }) {
  // 属性实例。
  const property = new Property({ clone, random })
  // 天赋实例。
  const talent = new Talent({ clone, check: c => check(c, state.props), random })
  // 事件实例。
  const event = new Event({ clone, check: c => check(c, state.props) })

  // 游戏状态。
  const state = {
    phase: 'init',      // init → select → play → end
    props: null,        // 当前属性快照（条件引擎用）
    pool: [],           // 天赋池
    selected: [],       // 已选天赋
    allocation: {},     // 属性分配
    content: [],        // 本局事件/天赋流水
    over: false,        // 是否结束
  }

  // 初始化数据。
  property.initial({ age: data.age, total: data.total })
  talent.initial({ talents: data.talents })
  event.initial({ events: data.events })
  // 天赋配置（池大小 10，各等级概率）。
  talent.config({ talentPullCount: 10, talentRate: { 1: 100, 2: 10, 3: 1, total: 1000 } })

  // #refreshProps
  // 刷新条件引擎的属性快照。
  const refreshProps = () => { state.props = property.getAll() }

  // #doTalent
  // 触发天赋：对每个已选天赋，条件满足则触发效果。
  const doTalent = (talents) => {
    // 触发的天赋列表（含 maxTriggers 过滤，原型简化为总是可触发）。
    const contents = []
    // 遍历已选天赋。
    for (const id of talents) {
      // 触发。
      const r = talent.do(id)
      // 未触发跳过。
      if (!r) continue
      // 记录。
      contents.push({ type: 'talent', name: r.name, effect: r.effect })
      // 应用效果。
      if (r.effect) property.effect(r.effect)
    }
    // 刷新属性。
    refreshProps()
    // 返回流水。
    return contents
  }

  // #doEvent
  // 触发随机事件：从该年龄的事件里按条件过滤后随机抽一个。
  const doEvent = (eventList) => {
    // 过滤可触发事件（带权重），跳过不存在的事件 ID。
    const candidates = eventList.filter(([id]) => {
      // 事件不存在时跳过（原型数据可能不一致）。
      try { return event.check(id) } catch { return false }
    })
    // 无可触发事件。
    if (candidates.length === 0) return []
    // 按权重随机抽一个。
    const [id] = weightRandom(candidates, random)
    // 执行事件（递归处理分支）。
    const result = event.do(id)
    // 记录事件。
    const contents = [{ type: 'event', id, description: result.description }]
    // 应用效果。
    if (result.effect) property.effect(result.effect)
    // 有分支目标：递归执行（同样容忍缺失事件）。
    if (result.next) {
      // 分支目标存在才递归。
      try { if (event.get(result.next)) contents.push(...doEvent([[result.next, 1]])) } catch { /* 目标缺失跳过 */ }
    }
    // 刷新属性。
    refreshProps()
    // 返回流水。
    return contents
  }

  // 返回命令处理器。
  const handlers = (args) => {
    // 取命令与参数。
    const [cmd, ...rest] = args
    // 按命令分发。
    switch (cmd) {
      case 'draw': {
        // 抽取天赋池。
        state.pool = talent.talentRandom(null, {})
        // 格式化。
        const lines = state.pool.filter(Boolean).map((t, i) => `  [${i}] ${t.name} (${t.grade}级)`)
        // 输出。
        return { text: `天赋池:\n${lines.join('\n')}` }
      }
      case 'select': {
        // 需要至少一个 ID。
        if (rest.length < 1) return { text: '用法: select <id...>' }
        // 限制 3 个。
        if (rest.length > 3) return { text: '最多选择 3 个天赋' }
        // 组合候选：已有选中 + 新选。
        const combined = [...state.selected, ...rest]
        // 互斥校验：任意两个之间检查冲突。
        for (const id of combined) {
          // 该天赋与其余候选冲突。
          const conflict = talent.exclude(combined.filter(x => x !== id), id)
          // 有冲突。
          if (conflict) return { text: `${id} 与 ${conflict} 互斥` }
        }
        // 记录选中。
        state.selected = rest
        // 触发替换链。
        const replaced = talent.replace(rest)
        // 有替换。
        if (Object.keys(replaced).length > 0) {
          return { text: `已选: ${rest.join(', ')}\n替换: ${JSON.stringify(replaced)}` }
        }
        // 无替换。
        return { text: `已选: ${rest.join(', ')}` }
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
        // 初始化属性。
        const data = { ...state.allocation, TLT: state.selected }
        // 开局。
        property.restart(data)
        property.restartLastStep()
        // 刷新属性。
        refreshProps()
        // 阶段切换。
        state.phase = 'play'
        // 输出。
        return { text: `开局! 属性: ${JSON.stringify(state.props)}` }
      }
      case 'next': {
        // 未开局。
        if (state.phase !== 'play') return { text: '请先 start 开局' }
        // 推进一年。
        const { age, event: eventList, talent: talentList } = property.ageNext()
        // 触发该年龄的天赋。
        const talentContent = doTalent(talentList)
        // 触发随机事件。
        const eventContent = doEvent(eventList)
        // 是否结束。
        state.over = property.isEnd()
        // 汇总流水。
        const lines = [...talentContent, ...eventContent].map(c => `  ${c.type === 'talent' ? `[天赋] ${c.name}` : `[事件] ${c.description}`}`)
        // 输出。
        return { text: `—— ${age} 岁 ——\n${lines.length ? lines.join('\n') : '  (无事发生)'}\n状态: ${JSON.stringify(state.props)}` }
      }
      case 'summary': {
        // 汇总信息。
        const text = [
          `最终年龄: ${property.get('AGE')}`,
          `属性: ${JSON.stringify(property.getAll())}`,
          `已选天赋: ${state.selected.join(', ')}`,
          `生命结束: ${state.over}`,
        ].join('\n')
        return { text: text }
      }
      case 'status':
        // 状态。
        return { text: `阶段: ${state.phase}, 已选: ${state.selected.join(', ') || '无'}, 结束: ${state.over}` }
      case 'help':
        return { text: HELP }
      case 'exit':
        return { text: '再见', exit: true }
      default:
        return { text: `未知命令: ${cmd}（输入 help 查看）` }
    }
  }

  // 返回状态机。
  return { state, handlers }
}

// #entryPoint
// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 解析随机源。
  const { random } = makeRng(process.argv.slice(2))
  // 加载 fixture 数据。
  const { AGE_DATA, TOTAL } = await import('../fixtures/property.fixture.js')
  const { TALENTS, EVENTS } = await import('../fixtures/talent-event.fixture.js')
  // 创建游戏。
  const { handlers } = createGame({
    data: { age: clone(AGE_DATA), total: TOTAL, talents: clone(TALENTS), events: clone(EVENTS) },
    random,
  })
  // 交互循环。
  runInteractive('人生> ', handlers)
}
