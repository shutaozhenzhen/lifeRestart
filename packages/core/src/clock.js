// 推进核：一年 = before → on → after 三段钩子，逐 mod、严格串行。
// 引擎只懂一件事：ctx.end() 表示这一局结束了。

import { createCtx } from './ctx.js'

const PHASES = ['onYearBefore', 'onYear', 'onYearAfter']

export function createClock({
  mods,
  state,
  bus,
  rng,
  failFast = false,
  startYear = 0,
  startEnded = false,
  startReason = undefined,
}) {
  let year = startYear
  let ended = startEnded
  let endedReason = startReason
  let activeId = null
  let booted = false

  const ctxs = mods.map((m) =>
    createCtx({
      id: m.manifest.id,
      state,
      rng,
      bus,
      getYear: () => year,
      isActive: () => activeId === m.manifest.id,
      end: (reason, detail) => {
        if (ended) return
        ended = true
        endedReason = reason
        bus.emit({
          kind: 'summary',
          year,
          modId: 'core',
          payload: { reason, detail, years: year },
        })
      },
    }),
  )

  // 只有"某个 mod 正在自己的钩子里"时才允许写状态 / 输出 / 用随机数。
  async function runAs(index, fn) {
    activeId = mods[index].manifest.id
    try {
      await fn()
    } finally {
      activeId = null
    }
  }

  async function boot() {
    if (booted) return
    booted = true
    for (let i = 0; i < mods.length; i++) {
      const init = mods[i].init
      if (typeof init === 'function') await runAs(i, () => init(ctxs[i]))
    }
  }

  async function callHook(index, phase) {
    const hook = mods[index][phase]
    if (typeof hook !== 'function') return
    try {
      await runAs(index, () => hook(ctxs[index]))
    } catch (error) {
      // 只留 message：stack 含绝对路径，会让同 seed 的 hash 跨机器不一致。
      bus.emit({
        kind: 'core:error',
        year,
        modId: mods[index].manifest.id,
        payload: { phase, message: String((error && error.message) ?? error) },
      })
      if (failFast) throw error
    }
  }

  async function advance() {
    if (ended) return { year, ended: true, reason: endedReason }
    await boot()
    year += 1
    for (const phase of PHASES) {
      for (let i = 0; i < mods.length; i++) {
        if (ended) break
        await callHook(i, phase)
      }
      if (ended) break
    }
    bus.emit({ kind: 'year:end', year, modId: 'core' })
    return ended ? { year, ended: true, reason: endedReason } : { year, ended: false }
  }

  async function dispose() {
    for (let i = mods.length - 1; i >= 0; i--) {
      const hook = mods[i].dispose
      if (typeof hook === 'function') await runAs(i, () => hook(ctxs[i]))
    }
  }

  return {
    advance,
    dispose,
    get year() {
      return year
    },
    get ended() {
      return ended
    },
    get endedReason() {
      return endedReason
    },
  }
}
