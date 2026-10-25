// Mod 宿主：解析顺序、装配推进核、快照/读档、冲突检测。

import { createBus } from './bus.js'
import { createClock } from './clock.js'
import { createRng, rngFromState } from './rng.js'
import { createState } from './state.js'

const orderOf = (m) => m.manifest.order ?? Number.POSITIVE_INFINITY

function compareMods(x, y) {
  if (orderOf(x) !== orderOf(y)) return orderOf(x) - orderOf(y)
  return x.manifest.id < y.manifest.id ? -1 : x.manifest.id > y.manifest.id ? 1 : 0
}

// 显式 order → requires 拓扑 → id 字典序；成环抛错。
export function resolveOrder(mods) {
  const byId = new Map()
  for (const m of mods) {
    const id = m && m.manifest && m.manifest.id
    if (typeof id !== 'string' || id === '') throw new TypeError('mod 必须有非空 manifest.id')
    if (byId.has(id)) throw new Error(`mod id 重复: ${id}`)
    byId.set(id, m)
  }

  const deps = new Map()
  for (const m of mods) {
    const list = m.manifest.requires ?? []
    if (!Array.isArray(list)) throw new TypeError(`mod ${m.manifest.id} 的 requires 必须是数组`)
    for (const d of list) {
      if (!byId.has(d)) throw new Error(`mod ${m.manifest.id} 依赖不存在的 ${d}`)
    }
    deps.set(m.manifest.id, new Set(list))
  }

  const ready = mods.filter((m) => deps.get(m.manifest.id).size === 0).sort(compareMods)
  const out = []
  const done = new Set()

  while (ready.length > 0) {
    const next = ready.shift()
    out.push(next)
    done.add(next.manifest.id)
    for (const m of mods) {
      const set = deps.get(m.manifest.id)
      if (done.has(m.manifest.id) || !set.has(next.manifest.id)) continue
      set.delete(next.manifest.id)
      if (set.size === 0) {
        ready.push(m)
        ready.sort(compareMods)
      }
    }
  }

  if (out.length !== mods.length) {
    const stuck = mods.filter((m) => !done.has(m.manifest.id)).map((m) => m.manifest.id)
    throw new Error(`mod 依赖成环: ${stuck.join(', ')}`)
  }
  return out
}

export function createRuntime({ mods = [], seed = 'default', initial = {}, failFast = false } = {}) {
  const ordered = resolveOrder(mods)
  const state = createState(initial)
  const bus = createBus()
  let rng = createRng(seed)
  let clock

  const build = (startYear, startEnded = false, startReason = undefined) =>
    createClock({ mods: ordered, state, bus, rng, failFast, startYear, startEnded, startReason })

  // 冲突检测：同 (year, path) 被不同 mod 写入 → core:conflict。
  const rawSet = state.set
  state.set = (path, value, meta = {}) => {
    if (meta && meta.modId) {
      for (let i = state.changes.length - 1; i >= 0; i--) {
        const c = state.changes[i]
        if (c.path === path && c.year === meta.year && c.modId && c.modId !== meta.modId) {
          bus.emit({
            kind: 'core:conflict',
            year: meta.year,
            modId: 'core',
            payload: { path, mods: [c.modId, meta.modId] },
          })
          break
        }
      }
    }
    rawSet(path, value, meta)
  }

  clock = build(0)

  return {
    advance: () => clock.advance(),
    snapshot: () => ({
      version: 1,
      seed,
      rng: rng.state(),
      year: clock.year,
      ended: clock.ended,
      reason: clock.endedReason,
      state: state.snapshot(),
      mods: ordered.map((m) => ({ id: m.manifest.id, version: m.manifest.version })),
    }),
    // 所有校验都做完才动内部状态：读档失败必须让运行时保持原样。
    load(snap) {
      if (!snap || snap.version !== 1) throw new TypeError('不支持快照版本')
      if (snap.seed !== seed) throw new Error('快照 seed 与运行时不一致')
      if (!Number.isInteger(snap.year) || snap.year < 0) throw new TypeError('快照 year 必须是非负整数')
      const nextRng = rngFromState(snap.rng)
      const expected = ordered.map((m) => `${m.manifest.id}@${m.manifest.version}`)
      const actual = (snap.mods ?? []).map((m) => `${m.id}@${m.version}`)
      if (expected.join(',') !== actual.join(',')) {
        throw new Error(`快照的 mod 集合与当前不一致：${actual.join(',')} ≠ ${expected.join(',')}`)
      }
      state.load(snap.state)
      rng = nextRng
      bus.clear()
      clock = build(snap.year, Boolean(snap.ended), snap.reason)
    },
    dispose: () => clock.dispose(),
    get events() {
      return bus.events
    },
    get year() {
      return clock.year
    },
    get ended() {
      return clock.ended
    },
  }
}
