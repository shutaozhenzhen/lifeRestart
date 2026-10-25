// Mod 门面：Mod 只能通过这里碰状态、随机数与输出。
// 内部对象（state/bus/rng）一律不暴露；ctx 与 ctx.rng 都冻结。

import { assertJson } from './json.js'

export function createCtx({ id, state, rng, bus, getYear, end, isActive = () => true }) {
  let ended = false

  function guard(what) {
    if (!isActive()) {
      throw new Error(`mod ${id} 在钩子之外调用 ${what}（会破坏确定性）`)
    }
  }

  const rngFacade = Object.freeze({
    int(n) {
      guard('rng.int')
      return rng.int(n)
    },
    float() {
      guard('rng.float')
      return rng.next()
    },
    pick(xs) {
      guard('rng.pick')
      return rng.pick(xs)
    },
    weighted(entries) {
      guard('rng.weighted')
      return rng.weighted(entries)
    },
  })

  const ctx = {
    get year() {
      return getYear()
    },
    get(path) {
      return state.get(path)
    },
    set(path, value) {
      guard('ctx.set')
      state.set(path, value, { year: getYear(), modId: id })
    },
    update(path, fn) {
      guard('ctx.update')
      state.update(path, fn, { year: getYear(), modId: id })
    },
    keys(prefix) {
      return state.keys(prefix)
    },
    rng: rngFacade,
    emit(kind, payload) {
      guard('ctx.emit')
      const entry = { kind, year: getYear(), modId: id }
      if (payload !== undefined) entry.payload = payload
      bus.emit(entry)
    },
    log(text) {
      guard('ctx.log')
      bus.emit({ kind: 'log', year: getYear(), modId: id, text })
    },
    end(reason, detail) {
      guard('ctx.end')
      if (ended) return false
      // 先校验再落闸：非法 detail 不能把一局杀死在半路（那样连 summary 都没有）。
      if (typeof reason !== 'string' || reason === '') throw new TypeError('end(reason) 需要非空字符串')
      if (detail !== undefined) assertJson(detail, 'end detail')
      ended = true
      end(reason, detail)
      return true
    },
  }

  return Object.freeze(ctx)
}
