import test from 'node:test'
import assert from 'node:assert/strict'
import { createState, assertJson } from '../src/state.js'

test('点路径写入自动建中间节点', () => {
  const s = createState()
  s.set('a.b.c', 1)
  assert.deepEqual(s.get('a.b'), { c: 1 })
  assert.equal(s.get('a.b.c'), 1)
  assert.deepEqual(s.keys('a.'), ['a.b.c'])
})

test('get 返回副本，改它不影响内部', () => {
  const s = createState({ a: { b: 1 } })
  const v = s.get('a')
  v.b = 99
  assert.equal(s.get('a.b'), 1)
})

test('非 JSON 值写入抛 TypeError', () => {
  const s = createState()
  assert.throws(() => s.set('x', () => 1), TypeError)
  assert.throws(() => s.set('x', NaN), TypeError)
  assert.throws(() => s.set('x', undefined), TypeError)
  assert.throws(() => s.set('x', Infinity), TypeError)
  const cyc = {}
  cyc.self = cyc
  assert.throws(() => s.set('x', cyc), TypeError)
  assert.throws(() => assertJson(new Date(), 'd'), TypeError)
})

test('snapshot 是深拷贝，之后写入不影响它', () => {
  const s = createState({ n: 1 })
  const snap = s.snapshot()
  s.set('n', 2)
  s.set('m.x', 3)
  assert.deepEqual(snap, { n: 1 })
})

test('load 恢复快照', () => {
  const s = createState({ n: 1 })
  const snap = s.snapshot()
  s.set('n', 5)
  s.load(snap)
  assert.equal(s.get('n'), 1)
})

test('update 原子读改写并记录变更', () => {
  const s = createState({ n: 1 })
  s.update('n', (v) => v + 1, { year: 3, modId: 'base' })
  assert.equal(s.get('n'), 2)
  assert.deepEqual(s.changes.at(-1), { year: 3, path: 'n', modId: 'base', oldValue: 1 })
})

test('非法路径抛错', () => {
  const s = createState()
  assert.throws(() => s.set('', 1), TypeError)
  assert.throws(() => s.set('a..b', 1), TypeError)
})
