import test from 'node:test'
import assert from 'node:assert/strict'
import { createRng, rngFromState } from '../src/rng.js'

test('同一 seed 产生同一序列', () => {
  const a = createRng('life')
  const b = createRng('life')
  const seqA = Array.from({ length: 20 }, () => a.next())
  const seqB = Array.from({ length: 20 }, () => b.next())
  assert.deepEqual(seqA, seqB)
})

test('不同 seed 产生不同序列', () => {
  const a = Array.from({ length: 20 }, (_, i) => createRng('x').next())
  assert.equal(a[0], createRng('x').next())
  assert.notEqual(createRng('x').next(), 0)
  const first = createRng('x').next()
  const other = createRng('y').next()
  assert.notEqual(first, other)
})

test('state() 可序列化并续跑', () => {
  const rng = createRng('continue')
  const head = [rng.next(), rng.next()]
  const saved = rng.state()
  const tail = [rng.next(), rng.next()]
  const revived = rngFromState(saved)
  assert.deepEqual([revived.next(), revived.next()], tail)
  assert.equal(head.length, 2)
})

test('int(n) 落在 [0,n)', () => {
  const rng = createRng('range')
  for (let i = 0; i < 500; i++) {
    const v = rng.int(10)
    assert.ok(Number.isInteger(v) && v >= 0 && v < 10, `越界: ${v}`)
  }
})

test('pick 空数组抛错', () => {
  assert.throws(() => createRng('p').pick([]), RangeError)
})

test('weighted 只返回权重不为零的项', () => {
  const rng = createRng('w')
  for (let i = 0; i < 200; i++) {
    assert.equal(rng.weighted([['a', 0], ['b', 1]]), 'b')
  }
})
