// Mod 门面：Mod 只能通过这里碰状态、随机数与输出。
// 内部对象（state/bus/rng）一律不暴露；ctx 本身冻结。

export function createCtx({ id, state, rng, bus, getYear, end }) {
  let ended = false

  const ctx = {
    get year() {
      return getYear()
    },
    get(path) {
      return state.get(path)
    },
    set(path, value) {
      state.set(path, value, { year: getYear(), modId: id })
    },
    update(path, fn) {
      state.update(path, fn, { year: getYear(), modId: id })
    },
    keys(prefix) {
      return state.keys(prefix)
    },
    rng: {
      int(n) {
        return rng.int(n)
      },
      float() {
        return rng.next()
      },
      pick(xs) {
        return rng.pick(xs)
      },
      weighted(entries) {
        return rng.weighted(entries)
      },
    },
    emit(kind, payload) {
      const entry = { kind, year: getYear(), modId: id }
      if (payload !== undefined) entry.payload = payload
      bus.emit(entry)
    },
    log(text) {
      bus.emit({ kind: 'log', year: getYear(), modId: id, text })
    },
    end(reason, detail) {
      if (ended) return false
      ended = true
      end(reason, detail)
      return true
    },
  }

  return Object.freeze(ctx)
}
