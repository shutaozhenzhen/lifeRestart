import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRuntime } from '../src/runtime.js'
import * as base from '../../mods/base/index.js'

const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]))
  }
  return v
}

export const hashOf = (snapshot, events) =>
  createHash('sha256').update(JSON.stringify(canonical({ snapshot, events }))).digest('hex')

async function play(seed, years = 30) {
  const rt = createRuntime({ mods: [base], seed })
  for (let i = 0; i < years && !rt.ended; i++) await rt.advance()
  return { snapshot: rt.snapshot(), events: rt.events }
}

test('同 seed 两次运行的 hash 相同', async () => {
  const a = await play('golden')
  const b = await play('golden')
  assert.equal(hashOf(a.snapshot, a.events), hashOf(b.snapshot, b.events))
})

test('不同 seed 的 hash 不同', async () => {
  const a = await play('golden')
  const b = await play('other')
  assert.notEqual(hashOf(a.snapshot, a.events), hashOf(b.snapshot, b.events))
})

test('事件流进入 hash：改一个字就变', async () => {
  const a = await play('golden')
  const events = a.events.map((e) => (e.text ? { ...e, text: `${e.text}!` } : e))
  assert.notEqual(hashOf(a.snapshot, a.events), hashOf(a.snapshot, events))
})
