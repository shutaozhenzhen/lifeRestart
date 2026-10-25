import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime, resolveOrder } from '../src/runtime.js'

const mod = (id, extra = {}) => {
  const { manifest = {}, ...rest } = extra
  return { manifest: { id, version: '0.0.1', ...manifest }, ...rest }
}

test('order 小的先跑，同 order 按 id', () => {
  const mods = [mod('c', { manifest: { order: 2 } }), mod('a', { manifest: { order: 1 } }), mod('b', { manifest: { order: 1 } })]
  assert.deepEqual(resolveOrder(mods).map((m) => m.manifest.id), ['a', 'b', 'c'])
})

test('requires 决定先后（无视 order）', () => {
  const mods = [mod('a', { manifest: { order: 0 } }), mod('b', { manifest: { order: 99, requires: ['a'] } })]
  assert.deepEqual(resolveOrder(mods).map((m) => m.manifest.id), ['a', 'b'])
})

test('依赖成环抛错', () => {
  const mods = [mod('a', { manifest: { requires: ['b'] } }), mod('b', { manifest: { requires: ['a'] } })]
  assert.throws(() => resolveOrder(mods), /成环/)
})

test('快照往返后继续推进结果一致', async () => {
  const a = mod('a', {
    onYear: (ctx) => ctx.update('a.n', (v) => (v ?? 0) + ctx.rng.int(5)),
  })
  const r1 = createRuntime({ mods: [a], seed: 'snap' })
  for (let i = 0; i < 3; i++) await r1.advance()
  const snap = r1.snapshot()
  const r2 = createRuntime({ mods: [a], seed: 'snap' })
  r2.load(snap)

  const e1 = []
  const e2 = []
  for (let i = 0; i < 3; i++) {
    e1.push(await r1.advance())
    e2.push(await r2.advance())
  }
  assert.deepEqual(e1, e2)
  assert.deepEqual(r1.snapshot().state, r2.snapshot().state)
  assert.deepEqual(r1.snapshot().rng, r2.snapshot().rng)
})

test('同年同路径被两个 mod 写入时报 conflict', async () => {
  const a = mod('a', { onYear: (ctx) => ctx.set('shared.x', 1) })
  const b = mod('b', { onYear: (ctx) => ctx.set('shared.x', 2) })
  const rt = createRuntime({ mods: [a, b], seed: 'c' })
  await rt.advance()
  const conflict = rt.events.find((e) => e.kind === 'core:conflict')
  assert.ok(conflict, '应发出 core:conflict')
  assert.equal(conflict.payload.path, 'shared.x')
  assert.deepEqual(conflict.payload.mods, ['a', 'b'])
})

test('events 是副本，改它不影响内部', async () => {
  const rt = createRuntime({ mods: [], seed: 'e' })
  await rt.advance()
  const ev = rt.events
  ev.length = 0
  assert.equal(rt.events.length, 1)
})
