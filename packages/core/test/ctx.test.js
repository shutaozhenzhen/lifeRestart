import test from 'node:test'
import assert from 'node:assert/strict'
import { createCtx } from '../src/ctx.js'
import { createState } from '../src/state.js'
import { createBus } from '../src/bus.js'
import { createRng } from '../src/rng.js'

function make() {
  const state = createState()
  const bus = createBus()
  const rng = createRng('s')
  const ends = []
  let year = 1
  const ctx = createCtx({
    id: 'm',
    state,
    rng,
    bus,
    getYear: () => year,
    end: (reason, detail) => ends.push([reason, detail]),
  })
  return { ctx, state, bus, ends, setYear: (y) => (year = y) }
}

test('set/get 走 state，get 返回副本', () => {
  const { ctx, state } = make()
  ctx.set('a.b', 1)
  assert.equal(state.get('a.b'), 1)
  const v = ctx.get('a')
  v.b = 99
  assert.equal(state.get('a.b'), 1)
})

test('不暴露内部引用', () => {
  const { ctx } = make()
  assert.equal(ctx.state, undefined)
  assert.equal(ctx.bus, undefined)
  assert.equal('_state' in ctx, false)
  assert.equal(Object.isFrozen(ctx), true)
})

test('log 生成规范 entry', () => {
  const { ctx, bus, setYear } = make()
  setYear(7)
  ctx.log('x')
  assert.deepEqual(bus.events[0], { kind: 'log', year: 7, modId: 'm', text: 'x' })
})

test('emit 带 payload', () => {
  const { ctx, bus } = make()
  ctx.emit('stat', { delta: 2 })
  assert.deepEqual(bus.events[0], { kind: 'stat', year: 1, modId: 'm', payload: { delta: 2 } })
})

test('end 只生效一次', () => {
  const { ctx, ends } = make()
  assert.equal(ctx.end('death', { y: 3 }), true)
  assert.equal(ctx.end('again'), false)
  assert.deepEqual(ends, [['death', { y: 3 }]])
})

test('set 在变更日志里带上 modId 与年份', () => {
  const { ctx, state, setYear } = make()
  setYear(4)
  ctx.set('n', 1)
  assert.deepEqual(state.changes[0], { year: 4, path: 'n', modId: 'm', oldValue: undefined })
})

test('rng 只暴露四个方法', () => {
  const { ctx } = make()
  assert.deepEqual(Object.keys(ctx.rng).sort(), ['float', 'int', 'pick', 'weighted'])
  assert.ok(ctx.rng.int(5) < 5)
})
