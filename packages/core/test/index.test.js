import test from 'node:test'
import assert from 'node:assert/strict'
import * as core from '../src/index.js'

test('index 导出全部公共能力', () => {
  for (const name of ['createRuntime', 'resolveOrder', 'createRng', 'createState', 'createBus', 'createCtx', 'createClock', 'assertJson']) {
    assert.equal(typeof core[name], 'function', `缺少导出 ${name}`)
  }
})
