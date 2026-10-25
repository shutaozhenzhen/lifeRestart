// 种子化 RNG：sfc32 + cyrb128 展开 seed。
// 状态是 4 个 32 位整数，可 JSON 序列化 → 存档即续跑。

function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0]
}

function makeRng(a0, b0, c0, d0) {
  let a = a0 >>> 0, b = b0 >>> 0, c = c0 >>> 0, d = d0 >>> 0

  function next() {
    const t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    const out = (t + d) | 0
    c = (c + out) | 0
    return (out >>> 0) / 4294967296
  }

  function int(n) {
    if (!Number.isInteger(n) || n <= 0) throw new RangeError('int(n) 需要正整数')
    return Math.floor(next() * n)
  }

  function pick(xs) {
    if (!Array.isArray(xs) || xs.length === 0) throw new RangeError('pick 需要非空数组')
    return xs[int(xs.length)]
  }

  function weighted(entries) {
    const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0)
    if (!(total > 0)) throw new RangeError('weighted 权重和必须大于 0')
    let r = next() * total
    for (const [value, w] of entries) {
      r -= Math.max(0, w)
      if (r < 0) return value
    }
    return entries[entries.length - 1][0]
  }

  return { next, int, pick, weighted, state: () => [a, b, c, d] }
}

export function createRng(seed) {
  const [a, b, c, d] = cyrb128(String(seed))
  return makeRng(a, b, c, d)
}

export function rngFromState(state) {
  if (!Array.isArray(state) || state.length !== 4 || !state.every(Number.isInteger)) {
    throw new TypeError('rng state 必须是 4 个整数')
  }
  return makeRng(...state.map((n) => n >>> 0))
}
