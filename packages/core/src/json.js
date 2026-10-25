// 只接受 JSON 可序列化的值。state 存的东西必须能直接 JSON.stringify 进存档。

export function assertJson(value, label = 'value') {
  walk(value, label, new Set())
}

function walk(v, label, seen) {
  if (v === null) return
  const t = typeof v
  if (t === 'string' || t === 'boolean') return
  if (t === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`${label} 不是合法 JSON 数字（${v}）`)
    return
  }
  if (t !== 'object') throw new TypeError(`${label} 不是 JSON 值（类型 ${t}）`)
  if (seen.has(v)) throw new TypeError(`${label} 含循环引用`)
  seen.add(v)
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) walk(v[i], `${label}[${i}]`, seen)
  } else {
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`${label} 必须是普通对象（收到 ${proto?.constructor?.name ?? 'null 原型'}）`)
    }
    for (const [k, val] of Object.entries(v)) walk(val, `${label}.${k}`, seen)
  }
  seen.delete(v)
}
