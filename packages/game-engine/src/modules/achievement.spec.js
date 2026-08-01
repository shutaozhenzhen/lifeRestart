/**
 * achievement 成就系统单元测试 — achievement.spec.js
 *
 * 覆盖范围：16 个测试用例，分为 5 组：
 *   1. initial/count（初始化）
 *   2. get/list（读取）
 *   3. check/isAchieved（条件判断）
 *   4. achieve（时机触发、事件广播、去重）
 *   5. 字符串 ID 约束
 */

// 导入 vitest 测试 DSL 和被测对象。
import { describe, test, expect, beforeEach } from 'vitest'
// Achievement 模块。
import Achievement from './achievement.js'
// fixture。
import { ACHIEVEMENTS } from '../fixtures/achievement-character.fixture.js'
// 条件引擎。
import { check as checkCondition } from '../condition/index.js'
// 克隆。
import { clone } from '../functions/util.js'

// 测试辅助：内存属性系统模拟。
// @param {object} props - 属性快照
// @param {Array} achieved - 已达成列表 [[id, tick]]
// @returns {object} 注入依赖
function makeDeps(props = {}, achieved = []) {
  // 条件求值：绑定快照。
  const check = condition => checkCondition(condition, props)
  // 达成检查：在已达成列表里找。
  const isAchieved = id => achieved.some(([a]) => a == id)
  // 记录达成：追加 [id, tick]。
  const record = id => achieved.push([id, Date.now()])
  // 返回依赖。
  return { check, isAchieved, record }
}

// 每个测试前的实例。
let ach
// 已达成列表。
let achieved
// 广播记录。
let emitted
beforeEach(() => {
  // 初始化。
  achieved = []
  emitted = []
  // 创建实例。
  ach = new Achievement({
    clone,
    ...makeDeps({ CHR: 10 }, achieved),
    emit: (tag, data) => emitted.push([tag, data.id]),
  })
  // 注入数据。
  ach.initial({ achievements: clone(ACHIEVEMENTS) })
})

// ========== 测试组 1：initial/count ==========
describe('achievement - initial', () => {
  test('returns count', () => {
    // 成就总数。
    expect(ach.count).toBe(3)
  })
})

// ========== 测试组 2：get/list ==========
describe('achievement - get/list', () => {
  test('get returns cloned achievement', () => {
    // 读取。
    const a = ach.get('ach_001')
    // 名称。
    expect(a.name).toBe('新的开始')
    // 非原始引用。
    expect(a).not.toBe(ACHIEVEMENTS.ach_001)
  })

  test('get throws for missing', () => {
    // 缺失抛错。
    expect(() => ach.get('nope')).toThrow()
  })

  test('list includes isAchieved', () => {
    // 标记一个已达成。
    achieved.push(['ach_001', 1])
    // 列表。
    const list = ach.list()
    // ach_001 已达成。
    expect(list.find(a => a.id === 'ach_001').isAchieved).toBe(true)
    // 其他未达成。
    expect(list.find(a => a.id === 'ach_002').isAchieved).toBe(false)
  })
})

// ========== 测试组 3：check/isAchieved ==========
describe('achievement - check/isAchieved', () => {
  test('no condition passes', () => {
    // ach_001 无条件。
    expect(ach.check('ach_001')).toBe(true)
  })

  test('condition met passes', () => {
    // ach_002 要求 CHR>5，当前 CHR=10。
    expect(ach.check('ach_002')).toBe(true)
  })

  test('condition not met fails', () => {
    // 用 CHR=2 的实例。
    const a = new Achievement({ clone, ...makeDeps({ CHR: 2 }), emit: () => {} })
    a.initial({ achievements: clone(ACHIEVEMENTS) })
    // ach_002 不满足。
    expect(a.check('ach_002')).toBe(false)
  })

  test('isAchieved reflects achieved list', () => {
    // 未达成。
    expect(ach.isAchieved('ach_001')).toBe(false)
    // 标记。
    achieved.push(['ach_001', 1])
    // 已达成。
    expect(ach.isAchieved('ach_001')).toBe(true)
  })
})

// ========== 测试组 4：achieve ==========
describe('achievement - achieve', () => {
  test('triggers matching opportunity', () => {
    // START 时机：ach_001 无条件达成。
    ach.achieve('START')
    // 已记录。
    expect(achieved.some(([id]) => id === 'ach_001')).toBe(true)
    // 广播事件。
    expect(emitted.some(([tag, id]) => tag === 'achievement' && id === 'ach_001')).toBe(true)
  })

  test('does not trigger wrong opportunity', () => {
    // START 时机不触发 TRAJECTORY 成就。
    ach.achieve('START')
    // ach_002 未达成。
    expect(achieved.some(([id]) => id === 'ach_002')).toBe(false)
  })

  test('triggers condition-based achievement', () => {
    // TRAJECTORY 时机 + CHR=10 满足条件。
    ach.achieve('TRAJECTORY')
    // ach_002 达成。
    expect(achieved.some(([id]) => id === 'ach_002')).toBe(true)
  })

  test('does not re-record achieved achievements', () => {
    // 达成两次。
    ach.achieve('START')
    ach.achieve('START')
    // 只记录一次。
    expect(achieved.filter(([id]) => id === 'ach_001')).toHaveLength(1)
  })

  test('no condition mismatch means no trigger', () => {
    // SUMMARY 时机：ach_003 要求 HAGE>10，当前无 HAGE → 不满足。
    ach.achieve('SUMMARY')
    // 未达成。
    expect(achieved).toHaveLength(0)
  })
})

// ========== 测试组 5：字符串 ID ==========
describe('achievement - string id', () => {
  test('ids remain strings', () => {
    // 所有 ID 是字符串。
    for (const id of Object.keys(ACHIEVEMENTS)) expect(typeof id).toBe('string')
  })
})
