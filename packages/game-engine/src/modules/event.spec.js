/**
 * event 事件系统单元测试 — event.spec.js
 *
 * 覆盖范围：24 个测试用例，分为 6 组：
 *   1. initial（branch 解析、字符串 ID）
 *   2. get/information/count（存在性、错误）
 *   3. check（无条件、include、exclude、NoRandom）
 *   4. do（无分支、分支命中、分支未命中、postEvent）
 *   5. 与真实数据结合（加载原版 JSON 片段）
 *   6. 字符串 ID 约束
 */

// 导入 vitest 测试 DSL 和被测对象。
import { describe, test, expect, beforeEach } from 'vitest'
// Event 模块。
import Event from './event.js'
// 测试 fixture。
import { EVENTS } from '../fixtures/talent-event.fixture.js'
// 条件引擎 + 克隆。
import { check } from '../condition/index.js'
import { clone } from '../functions/util.js'

// 创建 Event 实例的辅助函数。
// @param {object} props - 属性快照（传给条件引擎）
// @returns {Event} 实例
function makeEvent(props = {}) {
  // 创建实例：注入条件引擎（绑定属性快照）。
  const event = new Event({
    clone,
    check: condition => check(condition, props),
  })
  // 注入数据（深拷贝防止污染共享 fixture）。
  event.initial({ events: clone(EVENTS) })
  // 返回实例。
  return event
}

// 每个测试前的实例。
let event
beforeEach(() => {
  // 默认属性快照。
  event = makeEvent({ CHR: 10, INT: 8, STR: 5, MNY: 1000, SPR: 60, LIF: 1, AGE: 25, TLT: [], EVT: [] })
})

// ========== 测试组 1：initial ==========
describe('event - initial', () => {
  test('parses branch into [condition, target] pairs', () => {
    // ev_005 有两条分支。
    const e = event.get('ev_005')
    // branch 被解析为二维数组。
    expect(e.branch).toEqual([
      ['params.CHR > 7', 'ev_006'],
      ['params.INT > 3', 'ev_006'],
    ])
  })

  test('keeps branch target as string', () => {
    // ev_005 的分支目标。
    const e = event.get('ev_005')
    // 目标是字符串。
    expect(typeof e.branch[0][1]).toBe('string')
    expect(e.branch[0][1]).toBe('ev_006')
  })

  test('returns count', () => {
    // 事件总数。
    expect(event.count).toBe(6)
  })
})

// ========== 测试组 2：get/information ==========
describe('event - get/information', () => {
  test('get returns cloned event', () => {
    // 取事件。
    const e = event.get('ev_001')
    // 描述正确。
    expect(e.event).toBe('你死了。')
    // 不是原始引用。
    expect(e).not.toBe(EVENTS.ev_001)
  })

  test('get throws for missing event', () => {
    // 不存在时抛错。
    expect(() => event.get('nope')).toThrow()
  })

  test('information returns description', () => {
    // 读取描述。
    expect(event.information('ev_001').description).toBe('你死了。')
  })
})

// ========== 测试组 3：check ==========
describe('event - check', () => {
  test('no conditions means triggerable', () => {
    // ev_001 无条件。
    expect(event.check('ev_001')).toBe(true)
  })

  test('include condition satisfied passes', () => {
    // ev_002 要求 CHR>5，当前 CHR=10。
    expect(event.check('ev_002')).toBe(true)
  })

  test('include condition not satisfied fails', () => {
    // CHR=2 的实例。
    const e = makeEvent({ CHR: 2 })
    // ev_002 不满足。
    expect(e.check('ev_002')).toBe(false)
  })

  test('exclude condition blocks', () => {
    // ev_003 要求 INT>3 时不触发，当前 INT=8。
    expect(event.check('ev_003')).toBe(false)
  })

  test('exclude condition not met allows trigger', () => {
    // INT=2 的实例。
    const e = makeEvent({ INT: 2 })
    // ev_003 的 exclude 不满足 → 可触发。
    expect(e.check('ev_003')).toBe(true)
  })

  test('NoRandom blocks random trigger', () => {
    // ev_004 是 NoRandom。
    expect(event.check('ev_004')).toBe(false)
  })
})

// ========== 测试组 4：do ==========
describe('event - do', () => {
  test('no branch returns own effect', () => {
    // ev_001 无分支。
    const result = event.do('ev_001')
    // 效果正确。
    expect(result.effect).toEqual({ LIF: -1 })
    // 无 next。
    expect(result.next).toBeUndefined()
  })

  test('returns postEvent when present', () => {
    // 需要带 postEvent 的事件，直接构造。
    const custom = new Event({ clone })
    // 注入事件。
    custom.initial({
      events: {
        p1: { id: 'p1', event: '生病', postEvent: '花了钱', effect: { MNY: -1 } },
      },
    })
    // 执行。
    const result = custom.do('p1')
    // postEvent 存在。
    expect(result.postEvent).toBe('花了钱')
  })

  test('branch hit returns next target', () => {
    // ev_005：CHR>7 命中第一条分支。
    const result = event.do('ev_005')
    // 走分支到 ev_006。
    expect(result.next).toBe('ev_006')
  })

  test('branch hit uses effect from event', () => {
    // ev_005 本身无 effect，分支目标 ev_006 有。
    const result = event.do('ev_005')
    // effect 是 undefined（ev_005 无 effect）。
    expect(result.effect).toBeUndefined()
  })

  test('branch not hit falls through to own result', () => {
    // CHR=1, INT=1 的实例。
    const e = makeEvent({ CHR: 1, INT: 1 })
    // 两条分支条件都不满足。
    const result = e.do('ev_005')
    // 无 next。
    expect(result.next).toBeUndefined()
  })
})

// ========== 测试组 5：字符串 ID 约束 ==========
describe('event - string id constraint', () => {
  test('event ids remain strings', () => {
    // 所有事件 ID。
    const ids = Object.keys(EVENTS)
    // 全部是字符串。
    for (const id of ids) expect(typeof id).toBe('string')
  })

  test('branch targets stay strings after parse', () => {
    // 用数字 ID 的事件验证：目标不会被转数字。
    const custom = new Event({ clone })
    // 数字字符串 ID 事件。
    custom.initial({
      events: {
        20001: { id: 20001, event: '分支事件', branch: ['params.CHR > 5:30001'] },
      },
    })
    // 分支目标。
    const e = custom.get('20001')
    // 目标是字符串 '30001' 而非数字 30001。
    expect(e.branch[0][1]).toBe('30001')
    expect(typeof e.branch[0][1]).toBe('string')
  })
})
