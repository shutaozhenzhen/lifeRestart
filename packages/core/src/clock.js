// 推进核：一年 = before → on → after 三段钩子，逐 mod、严格串行。
// 引擎只懂一件事：ctx.end() 表示这一局结束了。

import { createCtx } from './ctx.js'

const PHASES = ['onYearBefore', 'onYear', 'onYearAfter']

export function createClock({ mods, state, bus, rng, failFast = false }) {
  let year = 0
  let ended = false
  let endedReason = undefined

  const ctxs = mods.map((m) =>
    createCtx({
      id: m.manifest.id,
      state,
      rng,
      bus,
      getYear: () => year,
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

  async function callHook(mod, ctx, phase) {
    const hook = mod[phase]
    if (typeof hook !== 'function') return
    try {
      await hook(ctx)
    } catch (error) {
      bus.emit({
        kind: 'core:error',
        year,
        modId: mod.manifest.id,
        payload: { phase, message: String(error && error.message), stack: String(error && error.stack) },
      })
      if (failFast) throw error
    }
  }

  async function advance() {
    if (ended) return { year, ended: true, reason: endedReason }
    year += 1
    for (const phase of PHASES) {
      for (let i = 0; i < mods.length; i++) {
        if (ended) break
        await callHook(mods[i], ctxs[i], phase)
      }
      if (ended) break
    }
    bus.emit({ kind: 'year:end', year, modId: 'core' })
    return ended ? { year, ended: true, reason: endedReason } : { year, ended: false }
  }

  return {
    advance,
    get year() {
      return year
    },
    get ended() {
      return ended
    },
  }
}
