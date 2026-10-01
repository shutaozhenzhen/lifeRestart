/**
 * error-capture 单元测试 — 全局异常捕获
 *
 * 覆盖：
 *   1. formatErrorLog：Error / 字符串 / 无详情 / 堆栈截断 / 位置与附加信息
 *   2. installErrorCapture：error 事件、unhandledrejection 事件写入日志；卸载后不再写入
 *   3. 依赖缺失时安全降级（不抛错，返回空操作卸载函数）
 */

// 导入 vitest DSL。
import { describe, test, expect, vi } from 'vitest'
// 被测模块。
import { formatErrorLog, installErrorCapture } from './error-capture.js'

// #makeTarget
// 造一个最小事件源替身（记录监听并支持手动派发）。
function makeTarget() {
  // 监听表。
  const handlers = {}
  // 替身。
  return {
    handlers,
    // 注册。
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn) },
    // 移除。
    removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn) },
    // 派发（测试用）。
    dispatch(type, event) { (handlers[type] || []).forEach(fn => fn(event)) },
    // 某类型的监听数。
    count(type) { return (handlers[type] || []).length },
  }
}

describe('error-capture - formatErrorLog', () => {
  test('formats Error with location and extra', () => {
    // Error 对象。
    const err = new TypeError("Cannot read properties of undefined (reading 'TLT')")
    // 文本。
    const text = formatErrorLog({ kind: 'Vue 错误', error: err, location: 'app.js:31:3407', extra: 'render' })
    // 前缀 + 消息 + 位置 + 附加信息。
    expect(text.startsWith("[异常] Vue 错误: Cannot read properties of undefined (reading 'TLT')")).toBe(true)
    expect(text).toContain('@ app.js:31:3407')
    expect(text).toContain('（render）')
  })

  test('accepts plain strings and empty values', () => {
    // 字符串抛出物。
    expect(formatErrorLog({ kind: '未处理的 Promise 拒绝', error: 'oops' })).toContain('oops')
    // 无详情。
    expect(formatErrorLog({ kind: '未捕获错误' })).toContain('（无异常详情）')
  })

  test('truncates long stacks to 5 lines', () => {
    // 造 10 行堆栈。
    const err = new Error('boom')
    err.stack = ['boom', ...Array.from({ length: 9 }, (_, i) => `at frame${i}`)].join('\n')
    // 文本。
    const text = formatErrorLog({ error: err })
    // 堆栈被截断（含 frame0，不含 frame5）。
    expect(text).toContain('frame0')
    expect(text).not.toContain('frame5')
  })

  test('survives circular objects', () => {
    // 循环引用（JSON.stringify 会抛）。
    const circular = {}
    circular.self = circular
    // 不抛。
    expect(() => formatErrorLog({ error: circular })).not.toThrow()
  })
})

describe('error-capture - installErrorCapture', () => {
  test('logs window error events with location', () => {
    // 事件源 + 日志收集器。
    const target = makeTarget()
    const pushLog = vi.fn()
    // 安装。
    installErrorCapture({ target, pushLog })
    // 派发未捕获错误。
    target.dispatch('error', { error: new TypeError('boom'), filename: 'index-abc.js', lineno: 31, colno: 3407 })
    // 写入一条 error 日志。
    expect(pushLog).toHaveBeenCalledTimes(1)
    // 级别与内容。
    const [level, msg] = pushLog.mock.calls[0]
    expect(level).toBe('error')
    expect(msg).toContain('未捕获错误')
    expect(msg).toContain('boom')
    expect(msg).toContain('index-abc.js:31:3407')
  })

  test('logs unhandled rejections (Error and non-Error)', () => {
    // 事件源 + 收集器。
    const target = makeTarget()
    const pushLog = vi.fn()
    // 安装。
    installErrorCapture({ target, pushLog })
    // Error 型拒绝。
    target.dispatch('unhandledrejection', { reason: new Error('rejected') })
    // 非 Error 型拒绝。
    target.dispatch('unhandledrejection', { reason: 'plain-string' })
    // 两条日志。
    expect(pushLog).toHaveBeenCalledTimes(2)
    // 内容。
    expect(pushLog.mock.calls[0][1]).toContain('rejected')
    expect(pushLog.mock.calls[1][1]).toContain('plain-string')
  })

  test('uninstall removes listeners', () => {
    // 事件源 + 收集器。
    const target = makeTarget()
    const pushLog = vi.fn()
    // 安装。
    const uninstall = installErrorCapture({ target, pushLog })
    // 两个监听。
    expect(target.count('error')).toBe(1)
    expect(target.count('unhandledrejection')).toBe(1)
    // 卸载。
    uninstall()
    // 监听已移除。
    expect(target.count('error')).toBe(0)
    expect(target.count('unhandledrejection')).toBe(0)
    // 再派发不再写入。
    target.dispatch('error', { message: 'after-uninstall' })
    expect(pushLog).not.toHaveBeenCalled()
  })

  test('degrades safely without a usable target', () => {
    // 无 target：返回空操作卸载函数。
    const uninstall = installErrorCapture({ target: null, pushLog: vi.fn() })
    expect(typeof uninstall).toBe('function')
    expect(() => uninstall()).not.toThrow()
    // 有 target 但无 pushLog：同样安全。
    expect(() => installErrorCapture({ target: makeTarget(), pushLog: null })()).not.toThrow()
  })
})
