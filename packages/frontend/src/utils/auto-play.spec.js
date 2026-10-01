/**
 * auto-play 单元测试 — 自动播放器
 *
 * 覆盖：
 *   1. start：按（默认/指定）间隔起定时器；重复 start 不叠加
 *   2. tick：onTick 返回 false 时自动停止（人生结束场景）
 *   3. stop / toggle：幂等收放
 *   4. setDelay：播放中切换速度会重排定时器
 *   5. speedDelay：未知档位回退默认档
 */

// 导入 vitest DSL。
import { describe, test, expect, vi } from 'vitest'
// 被测模块。
import { createAutoPlayer, speedDelay, PLAY_SPEEDS, DEFAULT_SPEED } from './auto-play.js'

// #makeTimer
// 造一个可手动触发的定时器替身。
function makeTimer() {
  // 状态。
  const state = { fn: null, delays: [], cleared: 0, setCount: 0 }
  // 替身。
  const timer = {
    // 记录回调与间隔。
    setInterval(fn, ms) { state.fn = fn; state.delays.push(ms); state.setCount++; return state.setCount },
    // 记录清除次数。
    clearInterval() { state.cleared++ },
  }
  // 返回替身 + 触发 + 读状态。
  return { timer, state, fire: () => state.fn && state.fn() }
}

describe('auto-play - speedDelay', () => {
  test('returns delay for known speed and falls back to default', () => {
    // 已知档位。
    expect(speedDelay('fast')).toBe(PLAY_SPEEDS.find(s => s.key === 'fast').delayMs)
    // 未知档位回退默认（正常）。
    expect(speedDelay('nope')).toBe(PLAY_SPEEDS.find(s => s.key === DEFAULT_SPEED).delayMs)
    // 缺省也走默认。
    expect(speedDelay()).toBe(800)
  })
})

describe('auto-play - createAutoPlayer', () => {
  test('start schedules with default delay and does not double-schedule', () => {
    // 定时器替身。
    const { timer, state } = makeTimer()
    // 播放器（onTick 永远继续）。
    const player = createAutoPlayer({ onTick: () => true, timer })
    // 起。
    player.start()
    // 已运行。
    expect(player.running).toBe(true)
    // 只起了一次，间隔为默认档（正常 800ms）。
    expect(state.setCount).toBe(1)
    expect(state.delays[0]).toBe(800)
    // 重复 start 不叠加。
    player.start()
    expect(state.setCount).toBe(1)
  })

  test('honours explicit delay', () => {
    // 定时器替身。
    const { timer, state } = makeTimer()
    // 指定 300ms。
    const player = createAutoPlayer({ onTick: () => true, delayMs: 300, timer })
    // 起。
    player.start()
    // 间隔正确。
    expect(state.delays[0]).toBe(300)
  })

  test('stops automatically when onTick returns false', () => {
    // 定时器替身。
    const { timer, state, fire } = makeTimer()
    // 第 2 次 tick 返回 false（模拟人生结束）。
    let calls = 0
    const player = createAutoPlayer({ onTick: () => { calls++; return calls < 2 }, timer })
    // 起。
    player.start()
    // 第一次推进：继续。
    fire()
    expect(player.running).toBe(true)
    // 第二次推进：回调返回 false → 自动停止并清定时器。
    fire()
    expect(player.running).toBe(false)
    expect(state.cleared).toBe(1)
  })

  test('stop and toggle are idempotent', () => {
    // 定时器替身。
    const { timer, state } = makeTimer()
    // 播放器。
    const player = createAutoPlayer({ onTick: () => true, timer })
    // 未开始时 stop 不做任何事。
    player.stop()
    expect(state.cleared).toBe(0)
    // toggle → 起。
    player.toggle()
    expect(player.running).toBe(true)
    // toggle → 停。
    player.toggle()
    expect(player.running).toBe(false)
    expect(state.cleared).toBe(1)
    // 再 stop 不再重复清理。
    player.stop()
    expect(state.cleared).toBe(1)
  })

  test('setDelay while running reschedules with the new interval', () => {
    // 定时器替身。
    const { timer, state } = makeTimer()
    // 播放器。
    const player = createAutoPlayer({ onTick: () => true, delayMs: 800, timer })
    // 未播放时改间隔：只记录，不起定时器。
    player.setDelay(300)
    expect(state.setCount).toBe(0)
    // 起（用新间隔）。
    player.start()
    expect(state.delays[0]).toBe(300)
    // 播放中改间隔：重排（清 1 次 + 再起 1 次）。
    player.setDelay(1600)
    expect(state.cleared).toBe(1)
    expect(state.setCount).toBe(2)
    expect(state.delays[1]).toBe(1600)
    // 仍是运行态。
    expect(player.running).toBe(true)
  })

  test('works without onTick (defensive)', () => {
    // 定时器替身。
    const { timer } = makeTimer()
    // 不传 onTick。
    const player = createAutoPlayer({ timer })
    // 起。
    player.start()
    // 不抛。
    expect(player.running).toBe(true)
  })
})
