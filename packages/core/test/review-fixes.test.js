import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/runtime.js'
import { createRng, rngFromState } from '../src/rng.js'
import { createCtx } from '../src/ctx.js'
import { createState } from '../src/state.js'
import { createBus } from '../src/bus.js'

const mod = (id, hooks = {}, manifest = {}) => ({ manifest: { id, version: '0.0.1', ...manifest }, ...hooks })

// C1: update 也必须参与冲突检测
test('C1 两个 mod 用 ctx.update 写同一路径也会报 conflict', async () => {
  const a = mod('a', { onYear: (c) => c.update('x.n', (v) => (v ?? 0) + 1) })
  const b = mod('b', { onYear: (c) => c.update('x.n', (v) => (v ?? 0) + 1) })
  const rt = createRuntime({ mods: [a, b], seed: 'c1' })
  await rt.advance()
  const conflict = rt.events.find((e) => e.kind === 'core:conflict')
  assert.ok(conflict, 'update 写入也必须报冲突')
  assert.equal(conflict.payload.path, 'x.n')
})

// C2: init / dispose 生命周期
test('C2 init 按顺序在首个钩子前执行，dispose 逆序执行', async () => {
  const seq = []
  const a = mod('a', { init: () => seq.push('a:init'), onYear: () => seq.push('a:year'), dispose: () => seq.push('a:dispose') })
  const b = mod('b', { init: () => seq.push('b:init'), onYear: () => seq.push('b:year'), dispose: () => seq.push('b:dispose') })
  const rt = createRuntime({ mods: [b, a], seed: 'c2' })
  await rt.advance()
  await rt.dispose()
  assert.deepEqual(seq, ['a:init', 'b:init', 'a:year', 'b:year', 'b:dispose', 'a:dispose'])
})

// I1: 快照的 mod 集合必须匹配
test('I1 用不同 mod 集合读档直接抛错', async () => {
  const a = mod('a', { onYear: () => {} })
  const b = mod('b', { onYear: () => {} })
  const r1 = createRuntime({ mods: [a], seed: 'i1' })
  await r1.advance()
  const snap = r1.snapshot()
  const r2 = createRuntime({ mods: [a, b], seed: 'i1' })
  assert.throws(() => r2.load(snap), /mod/i)
})

// I2: load 原子性 + year 校验
test('I2 坏 rng / 坏 year 时抛错且运行时状态不变', async () => {
  const a = mod('a', { onYear: (c) => c.set('a.n', 1) })
  const rt = createRuntime({ mods: [a], seed: 'i2' })
  await rt.advance()
  const before = rt.snapshot()
  assert.throws(() => rt.load({ ...before, rng: [1, 2, 3] }))
  assert.deepEqual(rt.snapshot(), before)
  assert.throws(() => rt.load({ ...before, year: 1.5 }))
  assert.deepEqual(rt.snapshot(), before)
})

// I3: 快照带上结束状态
test('I3 已结束的快照读档后仍是结束状态', async () => {
  const a = mod('a', { onYear: (c) => c.end('death') })
  const rt = createRuntime({ mods: [a], seed: 'i3' })
  await rt.advance()
  const snap = rt.snapshot()
  assert.equal(snap.ended, true)
  const rt2 = createRuntime({ mods: [a], seed: 'i3' })
  rt2.load(snap)
  assert.equal(rt2.ended, true)
  const r = await rt2.advance()
  assert.equal(r.ended, true)
  assert.equal(rt2.year, snap.year)
})

// I4: load 清空旧事件流
test('I4 load 之后事件流只有新产生的事件', async () => {
  const a = mod('a', { onYear: () => {} })
  const rt = createRuntime({ mods: [a], seed: 'i4' })
  await rt.advance()
  const snap = rt.snapshot()
  await rt.advance()
  rt.load(snap)
  assert.equal(rt.events.length, 0)
  await rt.advance()
  assert.equal(rt.events.length, 1)
})

// I5: core:error 不带 stack（保证跨机器 hash 一致）
test('I5 core:error 的 payload 不含 stack', async () => {
  const a = mod('a', { onYear: () => { throw new Error('boom') } })
  const rt = createRuntime({ mods: [a], seed: 'i5' })
  await rt.advance()
  const err = rt.events.find((e) => e.kind === 'core:error')
  assert.equal(err.payload.stack, undefined)
  assert.match(err.payload.message, /boom/)
})

// I6: end 的 detail 先校验，非法时不结束这一局
test('I6 ctx.end 传非 JSON detail 会抛错且不结束这一局', async () => {
  let captured
  const a = mod('a', {
    onYear: (c) => {
      captured = c
      if (c.year === 1) c.end('death', { when: new Date() })
      if (c.year === 2) c.end('death', { ok: true })
    },
  })
  const rt = createRuntime({ mods: [a], seed: 'i6' })
  const r1 = await rt.advance()
  assert.equal(r1.ended, false, '首次非法 end 不应结束这一局')
  assert.ok(rt.events.some((e) => e.kind === 'core:error'))
  const r2 = await rt.advance()
  assert.equal(r2.ended, true)
  const summary = rt.events.find((e) => e.kind === 'summary')
  assert.deepEqual(summary.payload.detail, { ok: true })
  assert.ok(captured)
})

// I7: 钩子窗口之外写入必须抛错
test('I7 钩子返回后（异步定时器里）再写状态会抛错', async () => {
  let leaked
  const a = mod('a', { onYear: (c) => { leaked = c } })
  const rt = createRuntime({ mods: [a], seed: 'i7' })
  await rt.advance()
  assert.throws(() => leaked.set('x', 1), /钩子|hook/i)
  assert.throws(() => leaked.log('late'), /钩子|hook/i)
  assert.equal(rt.snapshot().state.x, undefined)
})

// M1: 路径不能碰原型
test('M1 原型链上的名字既读不到也写不进', async () => {
  const a = mod('a', {
    onYear: (c) => {
      c.set('a.b', 1)
      assert.equal(c.get('a.constructor'), undefined)
      assert.throws(() => c.set('a.__proto__.polluted', 1))
      assert.throws(() => c.set('a.constructor.prototype.x', 1))
    },
  })
  const rt = createRuntime({ mods: [a], seed: 'm1' })
  await rt.advance()
  assert.equal({}.polluted, undefined)
})

// M4 / M5: 输出只读
test('M4 事件对象被冻结，改不动', async () => {
  const a = mod('a', { onYear: (c) => c.log('x') })
  const rt = createRuntime({ mods: [a], seed: 'm4' })
  await rt.advance()
  const e = rt.events.find((x) => x.kind === 'log')
  assert.throws(() => { 'use strict'; e.text = 'y' }, TypeError)
  assert.equal(rt.events.find((x) => x.kind === 'log').text, 'x')
})

test('M5 ctx.rng 也是冻结的', () => {
  const ctx = createCtx({
    id: 'm',
    state: createState(),
    rng: createRng('s'),
    bus: createBus(),
    getYear: () => 1,
    end: () => {},
  })
  assert.equal(Object.isFrozen(ctx.rng), true)
})

// M11: 边界输入
test('M11 坏 rng state 一律抛错', () => {
  for (const bad of [[1, 2, 3], [1, 2, 3, 1.5], ['a', 0, 0, 0], null, 'x']) {
    assert.throws(() => rngFromState(bad), TypeError, `应拒绝 ${JSON.stringify(bad)}`)
  }
})

test('M11 重复 mod id 与缺失依赖抛错', () => {
  assert.throws(() => createRuntime({ mods: [mod('a'), mod('a')] }), /重复/)
  assert.throws(() => createRuntime({ mods: [mod('a', {}, { requires: ['nope'] })] }), /不存在/)
})

test('M11 空 seed 可用且 5000 年不炸', async () => {
  assert.equal(typeof createRng('').next(), 'number')
  const rt = createRuntime({ mods: [], seed: '' })
  for (let i = 0; i < 5000; i++) await rt.advance()
  assert.equal(rt.year, 5000)
})
