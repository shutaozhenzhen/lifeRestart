import test from 'node:test'
import assert from 'node:assert/strict'
import { createClock } from '../src/clock.js'
import { createState } from '../src/state.js'
import { createBus } from '../src/bus.js'
import { createRng } from '../src/rng.js'

const mod = (id, hooks = {}) => ({ manifest: { id, version: '0.0.1' }, ...hooks })

function make(mods, opts = {}) {
  const state = createState()
  const bus = createBus()
  const rng = createRng('clock')
  const clock = createClock({ mods, state, bus, rng, ...opts })
  return { clock, state, bus, rng }
}

test('三段钩子按 before → on → after 顺序、逐 mod 执行', async () => {
  const seq = []
  const a = mod('a', {
    onYearBefore: () => seq.push('a:before'),
    onYear: () => seq.push('a:on'),
    onYearAfter: () => seq.push('a:after'),
  })
  const b = mod('b', {
    onYearBefore: () => seq.push('b:before'),
    onYear: () => seq.push('b:on'),
    onYearAfter: () => seq.push('b:after'),
  })
  const { clock } = make([a, b])
  await clock.advance()
  assert.deepEqual(seq, ['a:before', 'b:before', 'a:on', 'b:on', 'a:after', 'b:after'])
})

test('异步钩子被串行 await', async () => {
  const seq = []
  const slow = (name, ms) => async () => {
    await new Promise((r) => setTimeout(r, ms))
    seq.push(name)
  }
  const { clock } = make([
    mod('a', { onYear: slow('a', 20) }),
    mod('b', { onYear: slow('b', 1) }),
  ])
  await clock.advance()
  assert.deepEqual(seq, ['a', 'b'])
})

test('单个 mod 抛错不影响其它钩子，并发出 core:error', async () => {
  const seq = []
  const { clock, bus } = make([
    mod('a', { onYear: () => seq.push('a:on'), onYearAfter: () => seq.push('a:after') }),
    mod('b', {
      onYear: () => {
        throw new Error('boom')
      },
      onYearAfter: () => seq.push('b:after'),
    }),
  ])
  const r = await clock.advance()
  assert.equal(r.ended, false)
  assert.deepEqual(seq, ['a:on', 'a:after', 'b:after'])
  const err = bus.events.find((e) => e.kind === 'core:error')
  assert.equal(err.modId, 'b')
  assert.match(err.payload.message, /boom/)
})

test('ctx.end 结束这一局：停掉当年余下钩子并发 summary', async () => {
  const seq = []
  const { clock, bus } = make([
    mod('a', {
      onYear: (ctx) => {
        ctx.end('death', { why: 'test' })
        seq.push('a:end')
      },
      onYearAfter: () => seq.push('a:after'),
    }),
    mod('b', { onYear: () => seq.push('b:on') }),
  ])
  const r = await clock.advance()
  assert.deepEqual(seq, ['a:end'])
  assert.equal(r.ended, true)
  assert.equal(r.reason, 'death')
  const summary = bus.events.find((e) => e.kind === 'summary')
  assert.deepEqual(summary.payload, { reason: 'death', detail: { why: 'test' }, years: 1 })
  assert.equal(bus.events.filter((e) => e.kind === 'year:end').length, 1)
})

test('结束后 advance 幂等：年份不变、不再发事件', async () => {
  const { clock, bus } = make([mod('a', { onYear: (ctx) => ctx.end('death') })])
  await clock.advance()
  const before = bus.events.length
  const r = await clock.advance()
  assert.equal(r.ended, true)
  assert.equal(clock.year, 1)
  assert.equal(bus.events.length, before)
})

test('空 mod 列表连跑 100 年不崩', async () => {
  const { clock, bus } = make([])
  for (let i = 0; i < 100; i++) await clock.advance()
  assert.equal(clock.year, 100)
  assert.equal(bus.events.filter((e) => e.kind === 'year:end').length, 100)
})
