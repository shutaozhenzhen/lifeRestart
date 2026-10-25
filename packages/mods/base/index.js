// 最小内容 mod：只有两个事件 —— 无事发生 / 死亡。
// 目的：证明推进核与事件流能跑完一局，不承担任何玩法复刻。

export const manifest = {
  id: 'base',
  name: '最小内容',
  version: '0.1.0',
  order: 0,
}

export function init() {}

export function onYear(ctx) {
  if (ctx.rng.int(10) === 0) {
    ctx.emit('stat', { text: '生命结束' })
    ctx.end('death', { year: ctx.year })
    return
  }
  ctx.log('这一年无事发生')
}

export function dispose() {}
