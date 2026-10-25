import test from 'node:test'
import assert from 'node:assert/strict'
import { createBus } from '../src/bus.js'

const entry = (over = {}) => ({ kind: 'log', year: 1, modId: 'base', text: 'hi', ...over })

test('缺 kind / year / modId 抛错', () => {
  const bus = createBus()
  assert.throws(() => bus.emit({ year: 1, modId: 'base' }), TypeError)
  assert.throws(() => bus.emit({ kind: 'log', modId: 'base' }), TypeError)
  assert.throws(() => bus.emit({ kind: 'log', year: 1 }), TypeError)
})

test('payload 非 JSON 抛错', () => {
  const bus = createBus()
  assert.throws(() => bus.emit(entry({ payload: { f: () => 1 } })), TypeError)
  assert.throws(() => bus.emit(entry({ payload: { n: NaN } })), TypeError)
})

test('顺序保持且 events 是副本', () => {
  const bus = createBus()
  bus.emit(entry({ text: 'a' }))
  bus.emit(entry({ kind: 'year:end', text: undefined }))
  bus.emit(entry({ text: 'c' }))
  assert.deepEqual(bus.events.map((e) => e.kind), ['log', 'year:end', 'log'])
  bus.events.pop()
  assert.equal(bus.events.length, 3)
})

test('clear 清空', () => {
  const bus = createBus()
  bus.emit(entry())
  bus.clear()
  assert.equal(bus.events.length, 0)
})

test('entry 存的是归一化副本', () => {
  const bus = createBus()
  const raw = entry({ payload: { n: 1 } })
  bus.emit(raw)
  raw.payload.n = 99
  assert.equal(bus.events[0].payload.n, 1)
})
