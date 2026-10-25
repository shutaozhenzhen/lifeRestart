import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/runtime.js'
import * as base from '../../mods/base/index.js'

const playToEnd = async (seed) => {
  const rt = createRuntime({ mods: [base], seed })
  for (let i = 0; i < 500 && !rt.ended; i++) await rt.advance()
  return rt
}

test('base 能跑到结束，事件流里有「无事发生」与 summary', async () => {
  const rt = await playToEnd('s1')
  assert.equal(rt.ended, true)
  const texts = rt.events.filter((e) => e.kind === 'log').map((e) => e.text)
  assert.ok(texts.includes('这一年无事发生'), `实际事件: ${texts.slice(0, 3)}`)
  const summary = rt.events.find((e) => e.kind === 'summary')
  assert.ok(summary)
  assert.equal(summary.payload.reason, 'death')
  assert.ok(summary.payload.years >= 1)
})

test('同一 seed 两次运行事件流完全一致', async () => {
  const a = await playToEnd('same')
  const b = await playToEnd('same')
  assert.deepEqual(a.events, b.events)
})

test('不同 seed 的分叉点不同', async () => {
  const lifetimes = new Set()
  for (const seed of ['x1', 'x2', 'x3', 'x4', 'x5']) {
    const rt = await playToEnd(seed)
    lifetimes.add(rt.year)
  }
  assert.ok(lifetimes.size > 1, `寿命应随 seed 变化，实际: ${[...lifetimes]}`)
})

test('manifest 形状符合宿主要求', () => {
  assert.equal(base.manifest.id, 'base')
  assert.equal(typeof base.manifest.version, 'string')
  assert.equal(base.manifest.order, 0)
})
