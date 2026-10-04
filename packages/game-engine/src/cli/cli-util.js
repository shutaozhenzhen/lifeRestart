/**
 * CLI 共享交互辅助
 *
 * 为各原型 CLI 提供统一的：
 *   1. 命令分发器（parseCommand 把字符串拆成 [cmd, ...args]）
 *   2. 交互主循环（startRepl 用 readline 逐行读命令）
 *   3. 确定性随机源辅助（复用 util.createRng）
 *
 * 不依赖任何模块，纯工具。
 */

// Node 内置：readline 接口（逐行交互）。
import { createInterface } from 'node:readline'
// Node 内置：把 stdin/stdout 转为 promise 版本。
import { stdin as input, stdout as output } from 'node:process'
// 种子随机源（CLI 可注入固定 seed 复现）。
import { createRng } from '../functions/util.js'
// 日志系统。
import { createLogger, parseLogLevel } from '../functions/logger.js'

// #parseCommand
// 把用户输入的行拆成 [命令, 参数...]。
// 支持双引号包裹带空格的参数。
//
// @param {string} line - 用户输入
// @returns {string[]} [命令, ...参数]
export function parseCommand(line) {
  // 空行返回空数组。
  if (!line.trim()) return []
  // 用正则匹配：双引号串 或 非空白段。
  const tokens = line.match(/"[^"]*"|\S+/g) || []
  // 去掉双引号边界，返回 token 数组。
  return tokens.map(t => (t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t))
}

// #runInteractive
// 交互主循环：读取一行命令 → 传给 handler → 打印输出 → 直到 handler 返回 {exit:true}。
// handler 可以是同步或异步（async 时 await 其结果）。
// prompt 通过 setPrompt 设置，并在每次循环后手动 rl.prompt() 重绘（TTY 下显示）。
//
// @param {string} prompt - 命令行提示符（建议以 "> " 开头）
// @param {(args: string[]) => {text?: string, exit?: boolean}|Promise<{text?: string, exit?: boolean}>} handler - 命令处理函数
// @returns {Promise<void>}
export async function runInteractive(prompt, handler) {
  // 创建 readline 接口。
  const rl = createInterface({ input, output })
  // 设置提示符文本。
  rl.setPrompt(prompt)
  // 显示首个提示符（TTY 下立即绘制）。
  rl.prompt()
  // 循环读取。
  for await (const line of rl) {
    // 解析命令。
    const args = parseCommand(line)
    // 空命令跳过（仅重绘提示符）。
    if (args.length === 0) {
      // 重新显示提示符。
      rl.prompt()
      continue
    }
    // 调用处理器（await 支持 async handler）。
    const result = await handler(args)
    // 打印输出（如有）。
    if (result.text) console.log(result.text)
    // 请求退出。
    if (result.exit) break
    // 重新显示提示符。
    rl.prompt()
  }
  // 关闭接口。
  rl.close()
}

// #makeRng
// 创建 CLI 随机源：--seed <n> 时用种子 RNG（可复现），否则 Math.random。
//
// @param {string[]} argv - CLI 参数
// @returns {{random: () => number, seed: number|null}} 随机源与种子
export function makeRng(argv) {
  // 找 --seed 参数。
  const seedIndex = argv.indexOf('--seed')
  // 有 seed。
  if (seedIndex !== -1 && argv[seedIndex + 1] !== undefined) {
    // 解析种子数字。
    const seed = Number(argv[seedIndex + 1])
    // 返回种子 RNG。
    return { random: createRng(seed), seed }
  }
  // 无 seed：用真随机。
  return { random: Math.random, seed: null }
}

// #makeCliLogger
// 创建 CLI 日志器：从 argv 解析 --log-level。
// trace 级默认完整显示函数参数（maxArgLength=Infinity），其他级别默认 200 截断。
//
// @param {string[]} argv - CLI 参数
// @param {string} [prefix] - 日志前缀（模块名）
// @returns {object} 日志器实例
export function makeCliLogger(argv, prefix = '') {
  // 解析级别。
  const level = parseLogLevel(argv)
  // trace 级完整显示参数，其他级别默认 200 截断。
  const maxArgLength = level === 'trace' ? Infinity : 200
  // 创建日志器。
  return createLogger({ level, prefix, maxArgLength })
}

// #NO_CONTENT_HINT
// 「引擎不内置任何游戏内容」这句话只写一处：所有需要内容的 CLI 共用同一说法。
//
// 背景：引擎曾在 CLI 里把**测试 fixture**（含「填充天赋1/2/3」「填充池容量」）
// 当兜底数据，于是"没给数据源"也能跑出看着正常的输出 —— 既是内容泄漏，
// 也把"你没有指定内容来源"这个真实原因藏了起来。现在改为**明确报错**。
export const NO_CONTENT_HINT = '引擎不内置任何游戏内容（天赋/事件/成就/名人只能来自 Mod 或数据目录）'

// #noContentError
// 组装「没有内容来源」的错误（把该 CLI 支持的参数与可运行示例写清楚）。
//
// @param {string} usage - 用法提示（含示例命令）
// @returns {Error} 错误（调用方负责打印 + 置 exitCode=1）
export function noContentError(usage) {
  // 一句话原因 + 具体怎么给数据源。
  return new Error(`${NO_CONTENT_HINT}。${usage}`)
}

// #parseOption
// 从 argv 读 `--name value` 形式的选项（未给出返回 undefined）。
//
// @param {string[]} argv - CLI 参数
// @param {string} name - 选项名（含 `--`）
// @returns {string|undefined} 值
export function parseOption(argv, name) {
  // 选项位置。
  const index = argv.indexOf(name)
  // 未给出。
  if (index === -1) return undefined
  // 取紧随其后的值。
  return argv[index + 1]
}
