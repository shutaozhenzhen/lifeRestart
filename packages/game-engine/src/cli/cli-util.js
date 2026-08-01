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
//
// @param {string} prompt - 命令行提示符
// @param {(args: string[]) => {text?: string, exit?: boolean}|Promise<{text?: string, exit?: boolean}>} handler - 命令处理函数
// @returns {Promise<void>}
export async function runInteractive(prompt, handler) {
  // 创建 readline 接口。
  const rl = createInterface({ input, output })
  // 循环读取。
  for await (const line of rl) {
    // 解析命令。
    const args = parseCommand(line)
    // 空命令跳过。
    if (args.length === 0) continue
    // 调用处理器（await 支持 async handler）。
    const result = await handler(args)
    // 打印输出（如有）。
    if (result.text) console.log(result.text)
    // 请求退出。
    if (result.exit) break
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
//
// @param {string[]} argv - CLI 参数
// @param {string} [prefix] - 日志前缀（模块名）
// @returns {object} 日志器实例
export function makeCliLogger(argv, prefix = '') {
  // 解析级别。
  const level = parseLogLevel(argv)
  // 创建日志器。
  return createLogger({ level, prefix })
}
