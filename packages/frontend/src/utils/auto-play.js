/**
 * auto-play — 人生轨迹自动播放器（注入式定时器，可测试）
 *
 * 背景：
 *   轨迹页此前只能一年一年手点「下一年」，原版的连续播放体验缺失。
 *   定时器逻辑若直接写进组件，Node 测试环境没法验证「结束自动停 / 切换速度 /
 *   重复点击不叠加定时器」这些边界，故抽成独立模块，定时器可注入。
 *
 * 约定：
 *   onTick() 返回 false 表示「不要再继续」（如人生已结束）→ 自动停止。
 */

// #PLAY_SPEEDS
// 可选播放速度（ui 直接渲染这三档）。
export const PLAY_SPEEDS = [
  // 慢：便于阅读长事件。
  { key: 'slow', label: '慢', delayMs: 1600 },
  // 正常：默认档。
  { key: 'normal', label: '正常', delayMs: 800 },
  // 快：快速看完一生。
  { key: 'fast', label: '快', delayMs: 300 },
]

// #DEFAULT_SPEED
// 默认速度档位 key。
export const DEFAULT_SPEED = 'normal'

// #speedDelay
// 取某档速度的间隔毫秒（未知档位回退默认档）。
//
// @param {string} key - 速度档位
// @returns {number} 间隔毫秒
export function speedDelay(key) {
  // 命中档位。
  const found = PLAY_SPEEDS.find((s) => s.key === key)
  // 回退默认档。
  return (found || PLAY_SPEEDS.find((s) => s.key === DEFAULT_SPEED)).delayMs
}

// #createAutoPlayer
// 创建自动播放器。
//
// @param {object} params
// @param {Function} params.onTick - 每次推进的回调；返回 false 表示停止
// @param {number} [params.delayMs] - 间隔毫秒（默认按 DEFAULT_SPEED）
// @param {object} [params.timer] - 定时器适配器 {setInterval, clearInterval}
// @returns {{start: Function, stop: Function, toggle: Function, setDelay: Function, readonly running: boolean}} 播放器
export function createAutoPlayer({ onTick, delayMs, timer } = {}) {
  // 定时器适配器（默认用全局；Node/浏览器都有）。
  const t = timer || {
    // 包装一层，避免直接引用全局导致注入失效。
    setInterval: (fn, ms) => setInterval(fn, ms),
    // 同上。
    clearInterval: (id) => clearInterval(id),
  }
  // 当前间隔。
  let delay = typeof delayMs === 'number' ? delayMs : speedDelay(DEFAULT_SPEED)
  // 定时器句柄。
  let handle = null
  // 运行标志。
  let running = false

  // #tick
  // 单次推进：回调返回 false 时自动停止。
  function tick() {
    // 回调（缺省视为继续）。
    const keepGoing = onTick ? onTick() : true
    // 明确返回 false → 停止（典型场景：人生结束）。
    if (keepGoing === false) stop()
  }

  // #start
  // 开始播放（重复调用不会叠加定时器）。
  function start() {
    // 已在运行：忽略。
    if (running) return
    // 置运行标志。
    running = true
    // 起定时器。
    handle = t.setInterval(tick, delay)
  }

  // #stop
  // 停止播放（幂等）。
  function stop() {
    // 未运行：忽略。
    if (!running) return
    // 清标志。
    running = false
    // 清定时器。
    if (handle !== null) {
      t.clearInterval(handle)
      handle = null
    }
  }

  // #toggle
  // 收放。
  function toggle() {
    // 依据当前状态切换。
    if (running) stop()
    else start()
  }

  // #setDelay
  // 修改间隔（播放中立即按新间隔重排定时器）。
  //
  // @param {number} ms - 新间隔毫秒
  // @returns {void}
  function setDelay(ms) {
    // 记录新值。
    delay = ms
    // 播放中：重排（先停后起，避免旧间隔继续生效）。
    if (running) {
      // 停。
      stop()
      // 起。
      start()
    }
  }

  // 对外接口（running 用 getter，读到的永远是最新状态）。
  return {
    start,
    stop,
    toggle,
    setDelay,
    get running() { return running },
  }
}
