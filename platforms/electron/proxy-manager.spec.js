/**
 * AI 代理进程管理器单元测试 — proxy-manager.spec.js（Step 23）
 *
 * 覆盖范围：
 *   1. start：spawn 参数正确、/health 就绪判定、超时报错并 kill
 *   2. stop：已退出进程幂等、正常进程 kill
 *   3. 注入式依赖（mock spawn / mock fetch）无需真实子进程
 */

// 导入 vitest。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { createProxyManager } from './proxy-manager.js'

// #makeFakeChild
// 构造 mock 子进程（EventEmitter 风格：on/once/kill/exitCode）。
function makeFakeChild() {
  // 子进程对象。
  const child = {
    // 事件表。
    _handlers: {},
    // 退出码。
    exitCode: null,
    // stdout/stderr（EventEmitter 风格）。
    stdout: { on() {} },
    stderr: { on() {} },
    // 订阅事件。
    on(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn) },
    once(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn) },
    // 终止。
    kill(sig) {
      // 记录。
      this.killed = sig || 'SIGTERM'
      // 模拟退出。
      this.exitCode = 0
      // 触发退出。
      ;(this._handlers.exit || []).forEach((fn) => fn(0))
    },
    // 测试辅助：触发事件。
    emit(ev) { (this._handlers[ev] || []).forEach((fn) => fn()) },
  }
  // 返回。
  return child
}

// #makeManager
// 构造带注入依赖的管理器。
//
// @param {object} opts
// @param {number} [opts.healthStatus] - /health 返回状态（默认 200）
// @param {number} [opts.healthDelay] - 健康检查成功前失败次数（模拟未就绪）
// @returns {object} { manager, spawned }
function makeManager({ healthStatus = 200, healthDelay = 0 } = {}) {
  // 捕获 spawn 调用。
  const spawned = []
  // mock spawn。
  const spawnFn = (cmd, args, opts) => {
    // 记录。
    spawned.push({ cmd, args, opts })
    // 返回假子进程。
    return makeFakeChild()
  }
  // mock fetch（前 healthDelay 次失败，之后按 healthStatus 返回）。
  let calls = 0
  const fetchFn = async () => {
    // 计数。
    calls++
    // 未就绪阶段。
    if (calls <= healthDelay) return { ok: false }
    // 就绪。
    return { ok: healthStatus < 400 }
  }
  // 管理器。
  const manager = createProxyManager({ spawnFn, fetchFn })
  // 返回。
  return { manager, spawned }
}

// ========== 测试组 1：start ==========
describe('proxy-manager - start', () => {
  test('spawn node server.js 并等待 /health 就绪', async () => {
    // 管理器。
    const { manager, spawned } = makeManager()
    // 启动。
    const handle = await manager.start({ script: '/abs/server.js', port: 8787 })
    // spawn 参数。
    expect(spawned[0].cmd).toBe(process.execPath)
    expect(spawned[0].args).toEqual(['/abs/server.js', '--port', '8787'])
    // 代理地址。
    expect(handle.url).toBe('http://127.0.0.1:8787')
    // stop 函数存在。
    expect(typeof handle.stop).toBe('function')
  })

  test('未就绪重试后成功（healthDelay 模拟）', async () => {
    // 管理器（前 2 次失败）。
    const { manager } = makeManager({ healthDelay: 2 })
    // 启动。
    const handle = await manager.start({ script: '/s.js', port: 9000 })
    // 就绪。
    expect(handle.url).toContain('9000')
  })

  test('超时未就绪：抛错并 kill 子进程', async () => {
    // 捕获 kill。
    let killed = false
    // mock spawn。
    const spawnFn = () => {
      // 返回假子进程（kill 记录）。
      return {
        exitCode: null,
        stdout: { on() {} },
        stderr: { on() {} },
        on() {},
        once() {},
        kill() { killed = true },
      }
    }
    // mock fetch（永远失败）。
    const fetchFn = async () => ({ ok: false })
    // 管理器（超时 100ms，间隔 30ms）。
    const manager = createProxyManager({ spawnFn, fetchFn })
    // 启动（应抛错）。
    let err = null
    // 尝试。
    try {
      await manager.start({ script: '/s.js', port: 8787, timeout: 100, interval: 30 })
    } catch (e) {
      // 记录。
      err = e
    }
    // 断言。
    expect(err).toBeTruthy()
    expect(err.message).toContain('超时')
    // 子进程被 kill。
    expect(killed).toBe(true)
  })
})

// ========== 测试组 2：stop ==========
describe('proxy-manager - stop', () => {
  test('stop 终止运行中的子进程', async () => {
    // 管理器。
    const { manager } = makeManager()
    // 启动。
    const handle = await manager.start({ script: '/s.js', port: 8787 })
    // 停止（应正常 resolve，不抛错）。
    await expect(handle.stop()).resolves.toBeUndefined()
  })

  test('已退出的子进程 stop 幂等（不抛错）', async () => {
    // 管理器。
    const { manager } = makeManager()
    // 已退出子进程。
    const dead = {
      exitCode: 0,
      stdout: { on() {} },
      stderr: { on() {} },
      on() {},
      once() {},
      kill() { throw new Error('不应调用 kill') },
    }
    // 停止。
    await manager.stop(dead)
  })
})
