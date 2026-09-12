/**
 * logger 日志系统单元测试 — logger.spec.js
 *
 * 覆盖范围：27 个测试用例，分为 6 组：
 *   1. 级别过滤（低于当前级别不输出）
 *   2. traceFn（记录函数参数与返回）
 *   3. traceFn 异步支持
 *   4. setLevel/getLevel（动态切换）
 *   5. parseLogLevel（CLI 解析）
 *   6. sink null 静默 + child 子日志器（引擎内核注入用）
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect, vi } from 'vitest'
// logger 模块。
import { createLogger, LOG_LEVELS, parseLogLevel, SILENT_LOGGER } from './logger.js'

// #makeCapturedLogger
// 创建捕获输出的 logger（sink 记录到数组）。
// @param {string} level - 级别
// @param {string} [prefix] - 前缀
// @returns {{logger: object, lines: Array}} 日志器与捕获数组
function makeCapturedLogger(level = 'trace', prefix = '') {
  // 捕获数组。
  const lines = []
  // sink：各级别都 push。
  const sink = {
    trace: (m) => lines.push(m),
    debug: (m) => lines.push(m),
    info: (m) => lines.push(m),
    warn: (m) => lines.push(m),
    error: (m) => lines.push(m),
  }
  // 创建 logger。
  const logger = createLogger({ level, sink, prefix })
  // 返回。
  return { logger, lines }
}

// ========== 测试组 1：级别过滤 ==========
describe('logger - level filtering', () => {
  test('trace level emits everything', () => {
    // trace 级 logger。
    const { logger, lines } = makeCapturedLogger('trace')
    // 各级别日志。
    logger.trace('t'); logger.debug('d'); logger.info('i'); logger.warn('w'); logger.error('e')
    // 全部输出。
    expect(lines).toHaveLength(5)
  })

  test('info level filters trace/debug', () => {
    // info 级 logger。
    const { logger, lines } = makeCapturedLogger('info')
    // 各级别日志。
    logger.trace('t'); logger.debug('d'); logger.info('i'); logger.warn('w'); logger.error('e')
    // 只输出 >= info。
    expect(lines).toHaveLength(3)
    // 内容是 i/w/e。
    expect(lines.join('')).toContain('i')
    expect(lines.join('')).not.toContain('t')
  })

  test('error level only emits error', () => {
    // error 级 logger。
    const { logger, lines } = makeCapturedLogger('error')
    // 各级别日志。
    logger.trace('t'); logger.info('i'); logger.error('e')
    // 只输出 error。
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('e')
  })

  test('formats with level tag', () => {
    // info 级。
    const { logger, lines } = makeCapturedLogger('info')
    // 信息日志。
    logger.info('hello')
    // 格式含 [INFO]。
    expect(lines[0]).toContain('[INFO]')
  })

  test('formats with prefix', () => {
    // 带前缀。
    const { logger, lines } = makeCapturedLogger('info', 'game')
    // 信息日志。
    logger.info('hi')
    // 格式含前缀。
    expect(lines[0]).toContain('[game]')
  })
})

// ========== 测试组 2：traceFn ==========
describe('logger - traceFn', () => {
  test('records function call with args', () => {
    // trace 级。
    const { logger, lines } = makeCapturedLogger('trace')
    // 被追踪函数。
    const fn = (a, b) => a + b
    // 调用。
    const result = logger.traceFn('add', fn, 1, 2)
    // 返回值透传。
    expect(result).toBe(3)
    // 记录调用行（含参数）。
    expect(lines[0]).toContain('add')
    expect(lines[0]).toContain('1')
    expect(lines[0]).toContain('2')
  })

  test('records return value', () => {
    // trace 级。
    const { logger, lines } = makeCapturedLogger('trace')
    // 调用。
    logger.traceFn('add', (a, b) => a + b, 1, 2)
    // 返回记录。
    expect(lines[1]).toContain('3')
  })

  test('traceFn invisible below trace level', () => {
    // info 级（trace 被过滤）。
    const { logger, lines } = makeCapturedLogger('info')
    // 调用。
    logger.traceFn('add', (a, b) => a + b, 1, 2)
    // 无输出。
    expect(lines).toHaveLength(0)
  })

  test('serializes object args', () => {
    // trace 级。
    const { logger, lines } = makeCapturedLogger('trace')
    // 对象参数。
    logger.traceFn('fn', (o) => o.x, { x: 1 })
    // JSON 序列化。
    expect(lines[0]).toContain('"x"')
  })

  test('marks function args', () => {
    // trace 级。
    const { logger, lines } = makeCapturedLogger('trace')
    // 函数参数。
    logger.traceFn('fn', (cb) => cb(), () => 1)
    // 显示 [Function]。
    expect(lines[0]).toContain('[Function]')
  })

  test('truncates long args by default', () => {
    // trace 级（默认 maxArgLength 200）。
    const { logger, lines } = makeCapturedLogger('trace')
    // 长对象参数。
    const big = Array.from({ length: 50 }, (_, i) => ({ i }))
    // 调用。
    logger.traceFn('fn', (x) => x.length, big)
    // 被截断。
    expect(lines[0]).toContain('...')
  })

  test('maxArgLength Infinity shows full args', () => {
    // trace 级 + 完整显示。
    const lines = []
    // 自定义 sink。
    const sink = { trace: (m) => lines.push(m), debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    // 完整显示 logger。
    const logger = createLogger({ level: 'trace', sink, maxArgLength: Infinity })
    // 长对象参数。
    const big = Array.from({ length: 50 }, (_, i) => ({ i }))
    // 调用。
    logger.traceFn('fn', (x) => x.length, big)
    // 完整显示无省略号。
    expect(lines[0]).not.toContain('...')
  })

  test('propagates sync exceptions', () => {
    // trace 级。
    const { logger, lines } = makeCapturedLogger('trace')
    // 抛错函数。
    const fn = () => { throw new Error('boom') }
    // 异常透传。
    expect(() => logger.traceFn('fn', fn)).toThrow('boom')
  })
})

// ========== 测试组 3：traceFn 异步 ==========
describe('logger - traceFn async', () => {
  test('records async return value', async () => {
    // trace 级。
    const { logger, lines } = makeCapturedLogger('trace')
    // 异步函数。
    const fn = async (x) => x * 2
    // 调用。
    const result = await logger.traceFn('mul', fn, 4)
    // 结果透传。
    expect(result).toBe(8)
    // 记录返回。
    expect(lines.some(l => l.includes('8'))).toBe(true)
  })

  test('propagates async rejection', async () => {
    // trace 级。
    const { logger, lines } = makeCapturedLogger('trace')
    // 拒绝的异步函数。
    const fn = async () => { throw new Error('async-boom') }
    // 异常透传。
    await expect(logger.traceFn('fn', fn)).rejects.toThrow('async-boom')
  })
})

// ========== 测试组 4：setLevel/getLevel ==========
describe('logger - setLevel/getLevel', () => {
  test('getLevel returns current level', () => {
    // 创建 info 级。
    const { logger } = makeCapturedLogger('info')
    // 读取。
    expect(logger.getLevel()).toBe('info')
  })

  test('setLevel changes filtering', () => {
    // 创建 info 级。
    const { logger, lines } = makeCapturedLogger('info')
    // 切到 trace。
    logger.setLevel('trace')
    // trace 现在输出。
    logger.trace('now-seen')
    // 有输出。
    expect(lines.length).toBe(1)
  })

  test('setLevel to error hides info', () => {
    // 创建 info 级。
    const { logger, lines } = makeCapturedLogger('info')
    // 切到 error。
    logger.setLevel('error')
    // info 被过滤。
    logger.info('hidden')
    // 无输出。
    expect(lines).toHaveLength(0)
  })

  test('invalid setLevel falls back to info', () => {
    // 创建。
    const { logger } = makeCapturedLogger('trace')
    // 非法级别。
    logger.setLevel('bogus')
    // 回退 info。
    expect(logger.getLevel()).toBe('info')
  })
})

// ========== 测试组 5：parseLogLevel ==========
describe('logger - parseLogLevel', () => {
  test('parses valid level', () => {
    // 参数。
    expect(parseLogLevel(['--log-level', 'trace'])).toBe('trace')
  })

  test('defaults to info', () => {
    // 无参数。
    expect(parseLogLevel([])).toBe('info')
  })

  test('invalid level falls back to info', () => {
    // 非法级别。
    expect(parseLogLevel(['--log-level', 'verbose'])).toBe('info')
  })

  test('LOG_LEVELS weights ordered', () => {
    // trace 最低。
    expect(LOG_LEVELS.trace).toBeLessThan(LOG_LEVELS.debug)
    // debug < info。
    expect(LOG_LEVELS.debug).toBeLessThan(LOG_LEVELS.info)
    // info < warn。
    expect(LOG_LEVELS.info).toBeLessThan(LOG_LEVELS.warn)
    // warn < error。
    expect(LOG_LEVELS.warn).toBeLessThan(LOG_LEVELS.error)
  })
})

// ========== 测试组 6：sink null（静默）与 child（子日志器） ==========
// 引擎内核注入用：Life 构造给每个子模块发 child 日志器，缺省（不传 logger）全静默。
describe('logger - silent & child', () => {
  test('sink null: 全静默（trace 级也不输出）', () => {
    // 静默日志器。
    const logger = createLogger({ level: 'trace', sink: null })
    // 捕获 console。
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      // 各级别调用。
      logger.trace('t')
      logger.debug('d')
      logger.info('i')
      logger.warn('w')
      logger.error('e')
      // 无输出。
      expect(console.log).not.toHaveBeenCalled()
    } finally {
      // 还原。
      spy.mockRestore()
    }
  })

  test('SILENT_LOGGER: 引擎缺省可用，traceFn 也不输出', () => {
    // 捕获 console。
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      // 静默日志器包装函数。
      const value = SILENT_LOGGER.traceFn('fn', (a) => a + 1, 1)
      // 透传结果。
      expect(value).toBe(2)
      // 无输出。
      expect(console.log).not.toHaveBeenCalled()
    } finally {
      // 还原。
      spy.mockRestore()
    }
  })

  test('child: 继承级别/输出目标，追加前缀', () => {
    // 捕获数组。
    const lines = []
    // 自定义 sink。
    const sink = { trace: m => lines.push(m), debug: m => lines.push(m), info: m => lines.push(m), warn: m => lines.push(m), error: m => lines.push(m) }
    // 父日志器（debug 级 + 前缀）。
    const parent = createLogger({ level: 'debug', prefix: 'game', sink })
    // 子日志器。
    const child = parent.child('property')
    // 输出。
    child.debug('消息')
    // 前缀追加（game:property）。
    expect(lines[0]).toBe('[DEBUG][game:property] 消息')
    // trace 不输出（级别继承 debug）。
    child.trace('太细')
    // 仍 1 条。
    expect(lines.length).toBe(1)
  })

  test('child: 独立切换级别（父不受影响）', () => {
    // 捕获数组。
    const lines = []
    // 自定义 sink。
    const sink = { trace: m => lines.push(m), debug: m => lines.push(m), info: m => lines.push(m), warn: m => lines.push(m), error: m => lines.push(m) }
    // 父 trace 级。
    const parent = createLogger({ level: 'trace', sink })
    // 子日志器。
    const child = parent.child('x')
    // 父切 warn（子不受影响）。
    parent.setLevel('warn')
    // 子仍是 trace。
    expect(child.getLevel()).toBe('trace')
    // 子 trace 仍输出。
    child.trace('c')
    // 包含子日志。
    expect(lines).toContain('[TRACE][x] c')
  })
})
