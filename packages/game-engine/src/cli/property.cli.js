/**
 * property 属性系统 — 交互原型 CLI
 *
 * 用法：
 *   node src/cli/property.cli.js [--seed <n>]
 *
 * 交互命令：
 *   restart [CHR=x INT=x ...]   开始新一局（可选初始属性）
 *   set <prop> <value>          覆盖设置属性
 *   change <prop> <delta>       增量修改属性
 *   get <prop>                  读取单个属性
 *   all                         读取全部属性
 *   effect <json>               应用效果，如 effect {"CHR":1,"INT":2}
 *   judge <prop>                属性分档评价
 *   next                        年龄+1（推进一年）
 *   end                         是否结束（LIF<1）
 *   help                        帮助
 *   exit                        退出
 *
 * 核心逻辑集中在 createHandler()，便于测试。
 */

// 导入模块与工具。
import Property from '../modules/property.js'
import { createRng, clone } from '../functions/util.js'
// 共享交互辅助。
import { runInteractive, makeRng, parseCommand } from './cli-util.js'

// #HELP
// 帮助文本。
const HELP = `property 原型命令：
  restart [CHR=x INT=x ...]   开始新一局
  set <prop> <value>          覆盖设置
  change <prop> <delta>       增量修改
  get <prop>                  读取属性
  all                         全部属性
  effect <json>               应用效果
  judge <prop>                分档评价
  next                        推进一年
  end                         是否结束
  help                        帮助
  exit                        退出`

// #createHandler
// 创建命令处理函数（纯逻辑，供 CLI 与测试共用）。
// @param {Property} property - Property 实例
// @returns {(args: string[]) => {text: string, exit?: boolean}}
export function createHandler(property) {
  // 返回处理函数。
  return (args) => {
    // 取命令与参数。
    const [cmd, ...rest] = args
    // 按命令分发。
    switch (cmd) {
      case 'restart': {
        // 解析 "KEY=value" 形式的初始属性。
        const data = { TLT: [] }
        // 遍历参数。
        for (const pair of rest) {
          // 拆键值。
          const [k, v] = pair.split('=')
          // 数字值转数字，否则字符串。
          data[k] = isNaN(Number(v)) ? v : Number(v)
        }
        // 重启。
        property.restart(data)
        // 记录开局基准。
        property.restartLastStep()
        // 输出。
        return { text: `已开局: ${JSON.stringify(property.getAll())}` }
      }
      case 'set': {
        // 需要两个参数。
        if (rest.length < 2) return { text: '用法: set <prop> <value>' }
        // 覆盖设置。
        property.set(rest[0], rest[1])
        // 输出新值。
        return { text: `${rest[0]} = ${JSON.stringify(property.get(rest[0]))}` }
      }
      case 'change': {
        // 需要两个参数。
        if (rest.length < 2) return { text: '用法: change <prop> <delta>' }
        // 增量修改。
        property.change(rest[0], Number(rest[1]))
        // 输出新值。
        return { text: `${rest[0]} = ${JSON.stringify(property.get(rest[0]))}` }
      }
      case 'get': {
        // 需要一个参数。
        if (rest.length < 1) return { text: '用法: get <prop>' }
        // 读取属性。
        return { text: `${rest[0]} = ${JSON.stringify(property.get(rest[0]))}` }
      }
      case 'all':
        // 输出全部属性。
        return { text: JSON.stringify(property.getAll()) }
      case 'effect': {
        // 需要一个 JSON 参数。
        if (rest.length < 1) return { text: '用法: effect <json>' }
        // 解析 JSON。
        try {
          // 应用效果。
          property.effect(JSON.parse(rest[0]))
          // 输出结果。
          return { text: `效果已应用: ${JSON.stringify(property.getAll())}` }
        } catch (e) {
          // JSON 解析失败。
          return { text: `JSON 解析失败: ${e.message}` }
        }
      }
      case 'judge': {
        // 需要一个参数。
        if (rest.length < 1) return { text: '用法: judge <prop>' }
        // 分档评价。
        const r = property.judge(rest[0])
        // 无配置。
        if (!r) return { text: `${rest[0]} 未配置评价` }
        // 输出评价。
        return { text: `${r.prop} = ${r.value} → ${r.judge} (等级 ${r.grade}, 进度 ${r.progress.toFixed(2)})` }
      }
      case 'next': {
        // 推进一年。
        const r = property.ageNext()
        // 输出年龄与数据。
        return { text: `年龄 ${r.age}: 事件 ${JSON.stringify(r.event)}, 天赋 ${JSON.stringify(r.talent)}` }
      }
      case 'end':
        // 是否结束。
        return { text: `结束: ${property.isEnd()}` }
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
  // 创建 Property（注入随机源，RDM 可用）。
  const property = new Property({ clone, random })
  // 注入基础 age 数据（空，原型演示属性操作为主）。
  property.initial({ age: {}, total: {} })
  // 交互循环。
  runInteractive('property> ', createHandler(property))
}
