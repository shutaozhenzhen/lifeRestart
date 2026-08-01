/**
 * talent 天赋系统 — 交互原型 CLI
 *
 * 用法：
 *   node src/cli/talent.cli.js [--seed <n>]
 *
 * 交互命令：
 *   pool [count]              抽取天赋池（默认 10）
 *   random <count>            随机抽 count 个天赋 ID
 *   get <id>                  读取天赋
 *   check <id>                检查天赋条件
 *   do <id>                   触发天赋
 *   replace <id1> <id2> ...   替换链演示
 *   exclude <id> <候选...>    互斥检查
 *   count                     天赋总数
 *   help                      帮助
 *   exit                      退出
 *
 * 核心逻辑集中在 createHandler()，便于测试。
 */

// 导入模块与工具。
import Talent from '../modules/talent.js'
import { clone } from '../functions/util.js'
// 条件引擎（talent 条件用新语法）。
import { check } from '../condition/index.js'
// 共享交互辅助。
import { runInteractive, makeRng, makeCliLogger } from './cli-util.js'

// #HELP
// 帮助文本。
const HELP = `talent 原型命令：
  pool [count]              抽取天赋池
  random <count>            随机抽天赋 ID
  get <id>                  读取天赋
  check <id>                检查条件
  do <id>                   触发天赋
  replace <id...>           替换链演示
  exclude <id> <候选...>    互斥检查
  count                     天赋总数
  help                      帮助
  exit                      退出`

// #DEMO_PROPS
// 演示属性快照（条件引擎的 params）。
const DEMO_PROPS = { CHR: 10, INT: 8, STR: 5, MNY: 1000, SPR: 60, LIF: 1, AGE: 25, TLT: [], EVT: [] }

// #createHandler
// 创建命令处理函数（纯逻辑，供 CLI 与测试共用）。
// @param {Talent} talent - Talent 实例
// @param {object} [log] - 日志器
// @returns {(args: string[]) => {text: string, exit?: boolean}}
export function createHandler(talent, log) {
  // 日志器（缺省 info）。
  const logger = log || makeCliLogger([], 'talent')
  // 返回处理函数。
  return (args) => {
    // 取命令与参数。
    const [cmd, ...rest] = args
    // 记录命令。
    logger.debug(`命令: ${cmd} ${rest.join(' ')}`)
    // 按命令分发。
    switch (cmd) {
      case 'pool': {
        // 池大小：缺省 10。
        const count = rest[0] ? Number(rest[0]) : 10
        // 抽取天赋池（trace 级追踪）。
        const pool = logger.traceFn('talentRandom', () => talent.talentRandom(null, {}))
        // 格式化展示（索引 + ID 前置，过滤空占位）。
        const lines = pool.filter(Boolean).map((t, i) => `  [${i}] ${t.id}  ${t.name} (${t.grade}级)`)
        // 输出。
        return { text: `天赋池(${count}):\n${lines.join('\n')}` }
      }
      case 'random': {
        // 需要一个数量参数。
        if (rest.length < 1) return { text: '用法: random <count>' }
        // 随机抽取。
        const ids = talent.random(Number(rest[0]))
        // 输出。
        return { text: `抽中: ${ids.join(', ')}` }
      }
      case 'get': {
        // 需要一个 ID。
        if (rest.length < 1) return { text: '用法: get <id>' }
        // 读取。
        try {
          const t = talent.get(rest[0])
          return { text: `${t.id}: ${t.name} (${t.grade}级) - ${t.description}` }
        } catch (e) {
          return { text: e.message }
        }
      }
      case 'check': {
        // 需要一个 ID。
        if (rest.length < 1) return { text: '用法: check <id>' }
        // 检查条件。
        return { text: `${rest[0]} 条件满足: ${talent.check(rest[0])}` }
      }
      case 'do': {
        // 需要一个 ID。
        if (rest.length < 1) return { text: '用法: do <id>' }
        // 触发。
        const r = talent.do(rest[0])
        // 未触发。
        if (!r) return { text: `${rest[0]} 未触发（条件不满足）` }
        // 触发结果。
        return { text: `${r.name} 触发: ${JSON.stringify(r.effect)}` }
      }
      case 'replace': {
        // 需要至少一个 ID。
        if (rest.length < 1) return { text: '用法: replace <id...>' }
        // 替换链。
        const result = talent.replace(rest)
        // 无替换。
        if (Object.keys(result).length === 0) return { text: '无替换发生' }
        // 输出映射。
        return { text: `替换: ${JSON.stringify(result)}` }
      }
      case 'exclude': {
        // 需要 ID + 至少一个候选。
        if (rest.length < 2) return { text: '用法: exclude <id> <候选...>' }
        // 候选列表。
        const candidates = rest.slice(1)
        // 互斥检查。
        const conflict = talent.exclude(candidates, rest[0])
        // 输出。
        return { text: conflict ? `冲突: ${conflict}` : '无冲突' }
      }
      case 'count':
        // 总数。
        return { text: `天赋总数: ${talent.count}` }
      case 'help':
        // 帮助。
        return { text: HELP }
      case 'exit':
        // 退出。
        return { text: '再见', exit: true }
      default:
        // 未知命令。
        return { text: `未知命令: ${cmd}（输入 help 查看）` }
    }
  }
}

// #entryPoint
// 仅直接运行时执行。
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  // 解析随机源。
  const { random } = makeRng(process.argv.slice(2))
  // 创建 Talent（注入条件引擎 + 随机源）。
  const talent = new Talent({
    clone,
    check: cond => check(cond, DEMO_PROPS),
    random,
  })
  // 加载演示数据。
  const { TALENTS } = await import('../fixtures/talent-event.fixture.js')
  // 初始化。
  talent.initial({ talents: clone(TALENTS) })
  // 配置。
  talent.config()
  // 交互循环。
  runInteractive('> talent ', createHandler(talent, makeCliLogger(process.argv.slice(2), 'talent')))
}
