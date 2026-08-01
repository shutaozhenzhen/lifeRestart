/**
 * logger 日志系统
 *
 * 统一日志接口，支持：
 *   1. 五个级别：trace（最低，函数级追踪）/ debug / info / warn / error。
 *   2. 级别过滤：输出 >= 当前级别的日志。
 *   3. traceFn：包装任意函数，记录每次调用的函数名 + 全部参数（最低级追踪）。
 *   4. 注入式输出：默认 console，可注入自定义 sink（测试/文件）。
 *
 * 用法：
 *   import { createLogger, LOG_LEVELS } from './logger.js'
 *   const log = createLogger({ level: 'debug' })
 *   log.info('游戏开始')
 *   log.traceFn('talentRandom', () => talent.talentRandom(...), arg1, arg2)  // 记录调用
 */

// #LOG_LEVELS
// 级别常量与顺序权重。
// trace 最低（记录每个函数参数），error 最高。
export const LOG_LEVELS = {
  trace: 10,  // 函数级追踪：每个函数每次调用的全部参数
  debug: 20,  // 调试信息：详细流程
  info: 30,   // 一般信息：关键节点
  warn: 40,   // 警告：异常但可恢复
  error: 50,  // 错误：导致失败
}

// #DEFAULT_SINK
// 默认输出目标：console。
const DEFAULT_SINK = {
  // 各级别输出函数。
  trace: (msg) => console.log(msg),
  debug: (msg) => console.log(msg),
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
}

// #serializeArg
// 把函数参数序列化为可读文本。
// 大对象截断，避免日志刷屏。
//
// @param {*} arg - 任意参数
// @returns {string} 序列化结果
function serializeArg(arg) {
  // 字符串直接返回（加引号）。
  if (typeof arg === 'string') return `"${arg}"`
  // 函数显示为 [Function]。
  if (typeof arg === 'function') return '[Function]'
  // 其他类型转 JSON。
  try {
    // JSON 序列化。
    const str = JSON.stringify(arg)
    // 超长截断。
    return str && str.length > 200 ? `${str.slice(0, 200)}...` : str
  } catch {
    // 无法序列化。
    return String(arg)
  }
}

// #createLogger
// 创建日志器实例。
//
// @param {object} params
// @param {string} [params.level] - 最低输出级别（trace/debug/info/warn/error）
// @param {object} [params.sink] - 输出目标，默认 console
// @param {string} [params.prefix] - 日志前缀（如模块名）
// @returns {object} 日志器 { trace, debug, info, warn, error, traceFn, setLevel, getLevel }
export function createLogger({ level = 'info', sink = DEFAULT_SINK, prefix = '' } = {}) {
  // 当前级别权重。
  let currentLevel = LOG_LEVELS[level] !== undefined ? LOG_LEVELS[level] : LOG_LEVELS.info

  // #format
  // 格式化日志行：级别 + 前缀 + 消息。
  //
  // @param {string} lv - 级别名
  // @param {string} msg - 消息
  // @returns {string} 格式化行
  const format = (lv, msg) => {
    // 级别大写。
    const tag = `[${lv.toUpperCase()}]`
    // 前缀存在则加。
    return prefix ? `${tag}[${prefix}] ${msg}` : `${tag} ${msg}`
  }

  // #emit
  // 发射日志：级别达标则调用对应 sink。
  //
  // @param {string} lv - 级别名
  // @param {string} msg - 消息
  // @returns {void}
  const emit = (lv, msg) => {
    // 级别过滤。
    if (LOG_LEVELS[lv] < currentLevel) return
    // 调用 sink 输出。
    sink[lv](format(lv, msg))
  }

  // 返回日志器对象。
  return {
    // #trace
    // 最低级日志。
    trace: (msg) => emit('trace', msg),

    // #debug
    // 调试日志。
    debug: (msg) => emit('debug', msg),

    // #info
    // 信息日志。
    info: (msg) => emit('info', msg),

    // #warn
    // 警告日志。
    warn: (msg) => emit('warn', msg),

    // #error
    // 错误日志。
    error: (msg) => emit('error', msg),

    // #traceFn
    // 包装函数并记录每次调用：函数名 + 全部参数（最低级追踪）。
    // 返回原函数的结果（同步/异步均支持）。
    //
    // @param {string} name - 被追踪的函数名
    // @param {Function} fn - 原函数
    // @param {...*} args - 调用参数
    // @returns {*} 原函数返回结果
    traceFn: (name, fn, ...args) => {
      // 记录调用（参数序列化）。
      emit('trace', `→ ${name}(${args.map(serializeArg).join(', ')})`)
      // 调用原函数。
      const result = fn(...args)
      // 异步函数：追加返回日志。
      if (result && typeof result.then === 'function') {
        // 返回 Promise。
        return result.then(
          // 成功：记录返回。
          (value) => {
            // 记录返回。
            emit('trace', `← ${name} → ${serializeArg(value)}`)
            // 透传。
            return value
          },
          // 失败：记录错误。
          (err) => {
            // 记录异常。
            emit('trace', `← ${name} 抛出: ${err?.message || err}`)
            // 透传。
            throw err
          }
        )
      }
      // 同步函数：记录返回。
      emit('trace', `← ${name} → ${serializeArg(result)}`)
      // 透传。
      return result
    },

    // #setLevel
    // 动态调整日志级别。
    //
    // @param {string} lv - 新级别
    // @returns {void}
    setLevel: (lv) => {
      // 更新级别权重。
      currentLevel = LOG_LEVELS[lv] !== undefined ? LOG_LEVELS[lv] : LOG_LEVELS.info
    },

    // #getLevel
    // 读取当前级别名。
    //
    // @returns {string} 级别名
    getLevel: () => {
      // 反查级别名。
      for (const [name, weight] of Object.entries(LOG_LEVELS)) {
        // 匹配当前权重。
        if (weight === currentLevel) return name
      }
      // 默认。
      return 'info'
    },
  }
}

// #parseLogLevel
// 解析 CLI 参数中的 --log-level。
//
// @param {string[]} argv - CLI 参数数组
// @returns {string} 日志级别（缺省 info）
export function parseLogLevel(argv) {
  // 找 --log-level 参数。
  const idx = argv.indexOf('--log-level')
  // 有值则返回。
  if (idx !== -1 && argv[idx + 1] !== undefined) {
    // 校验合法级别。
    return LOG_LEVELS[argv[idx + 1]] !== undefined ? argv[idx + 1] : 'info'
  }
  // 缺省 info。
  return 'info'
}
