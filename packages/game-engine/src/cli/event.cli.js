/**
 * event 事件系统 — 交互原型 CLI
 *
 * 用法：
 *   node src/cli/event.cli.js [--seed <n>]
 *
 * 交互命令：
 *   get <id>            读取事件
 *   check <id>          检查事件是否可随机触发
 *   do <id>             执行事件（含分支判断）
 *   props <json>        更新属性快照（如 props {"CHR":10}）
 *   count               事件总数
 *   help                帮助
 *   exit                退出
 *
 * 核心逻辑集中在 createHandler()，便于测试。
 */

// 导入模块与工具。
import Event from '../modules/event.js'
import { clone } from '../functions/util.js'
// 条件引擎。
import { check } from '../condition/index.js'
// 共享交互辅助。
import { runInteractive } from './cli-util.js'

// #HELP
// 帮助文本。
const HELP = `event 原型命令：
  get <id>            读取事件
  check <id>          检查是否可触发
  do <id>             执行事件（含分支）
  props <json>        更新属性快照
  count               事件总数
  help                帮助
  exit                退出`

// #createHandler
// 创建命令处理函数（纯逻辑，供 CLI 与测试共用）。
// @param {Event} event - Event 实例
// @param {() => object} getProps - 获取当前属性快照
// @param {(p: object) => void} setProps - 更新属性快照
// @returns {(args: string[]) => {text: string, exit?: boolean}}
export function createHandler(event, getProps, setProps) {
  // 返回处理函数。
  return (args) => {
    // 取命令与参数。
    const [cmd, ...rest] = args
    // 按命令分发。
    switch (cmd) {
      case 'get': {
        // 需要一个 ID。
        if (rest.length < 1) return { text: '用法: get <id>' }
        // 读取事件。
        try {
          const e = event.get(rest[0])
          // 展示摘要。
          const branch = e.branch ? `, 分支: ${e.branch.length}条` : ''
          return { text: `${e.id}: ${e.event}${e.effect ? `, 效果: ${JSON.stringify(e.effect)}` : ''}${branch}` }
        } catch (err) {
          return { text: err.message }
        }
      }
      case 'check': {
        // 需要一个 ID。
        if (rest.length < 1) return { text: '用法: check <id>' }
        // 检查。
        return { text: `${rest[0]} 可随机触发: ${event.check(rest[0])}` }
      }
      case 'do': {
        // 需要一个 ID。
        if (rest.length < 1) return { text: '用法: do <id>' }
        // 执行。
        const r = event.do(rest[0])
        // 分支命中。
        if (r.next) return { text: `${r.description} → 走分支到 ${r.next}` }
        // 无分支。
        return { text: `${r.description}${r.postEvent ? `，后续: ${r.postEvent}` : ''}${r.effect ? `，效果: ${JSON.stringify(r.effect)}` : ''}` }
      }
      case 'props': {
        // 需要一个 JSON。
        if (rest.length < 1) return { text: '用法: props <json>' }
        // 解析并合并属性。
        try {
          // 合并新快照。
          setProps({ ...getProps(), ...JSON.parse(rest[0]) })
          // 输出。
          return { text: `属性: ${JSON.stringify(getProps())}` }
        } catch (e) {
          return { text: `JSON 解析失败: ${e.message}` }
        }
      }
      case 'count':
        // 总数。
        return { text: `事件总数: ${event.count}` }
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
  // 当前属性快照。
  let props = { CHR: 10, INT: 8, STR: 5, MNY: 1000, SPR: 60, LIF: 1, AGE: 25, TLT: [], EVT: [] }
  // 创建 Event。
  const event = new Event({
    clone,
    check: cond => check(cond, props),
  })
  // 加载演示数据。
  const { EVENTS } = await import('../fixtures/talent-event.fixture.js')
  // 初始化。
  event.initial({ events: clone(EVENTS) })
  // 交互循环。
  runInteractive('event> ', createHandler(
    event,
    () => props,
    p => { props = p },
  ))
}
