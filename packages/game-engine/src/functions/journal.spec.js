/**
 * journal 流水记录单元测试 — journal.spec.js
 *
 * 覆盖范围：
 *   1. push/all（追加与读取）
 *   2. last（最近 N 条）
 *   3. limit（超限截断）
 *   4. storage（持久化恢复）
 *   5. recordYear（按年记录）
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// journal。
import { createJournal, recordYear } from './journal.js'

// #makeStorage
// 构造内存 storage。
// @returns {object} storage
function makeStorage() {
  // 存储。
  return { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null }, setItem(k, v) { this._d[k] = String(v) } }
}

// ========== 测试组 1：push/all ==========
describe('journal - push/all', () => {
  test('pushes and reads entries', () => {
    // journal。
    const j = createJournal()
    // 追加。
    j.push({ age: 0, type: 'EVT', description: '出生' })
    j.push({ age: 1, type: 'TLT', description: '天赋' })
    // 全部。
    expect(j.all()).toHaveLength(2)
    expect(j.all()[0].description).toBe('出生')
  })
})

// ========== 测试组 2：last ==========
describe('journal - last', () => {
  test('returns recent N entries', () => {
    // journal。
    const j = createJournal()
    // 追加 5 条。
    for (let i = 0; i < 5; i++) j.push({ age: i, description: `d${i}` })
    // 最近 2 条。
    const last = j.last(2)
    // 条数。
    expect(last).toHaveLength(2)
    // 最新的在末尾。
    expect(last[1].description).toBe('d4')
  })
})

// ========== 测试组 3：limit ==========
describe('journal - limit', () => {
  test('truncates over limit keeping latest', () => {
    // limit 3。
    const j = createJournal({ limit: 3 })
    // 追加 5 条。
    for (let i = 0; i < 5; i++) j.push({ age: i, description: `d${i}` })
    // 只留 3 条。
    expect(j.all()).toHaveLength(3)
    // 保留最新的。
    expect(j.all()[0].description).toBe('d2')
  })
})

// ========== 测试组 4：storage ==========
describe('journal - storage', () => {
  test('persists and restores', () => {
    // storage。
    const storage = makeStorage()
    // journal 1。
    const j1 = createJournal({ storage })
    // 追加。
    j1.push({ age: 0, description: 'a' })
    // journal 2（同一 storage）。
    const j2 = createJournal({ storage })
    // 恢复。
    expect(j2.restore()).toBe(1)
    // 内容。
    expect(j2.all()[0].description).toBe('a')
  })

  test('clear empties', () => {
    // storage。
    const storage = makeStorage()
    // journal。
    const j = createJournal({ storage })
    // 追加。
    j.push({ description: 'x' })
    // 清空。
    j.clear()
    // 空。
    expect(j.all()).toHaveLength(0)
  })
})

// ========== 测试组 5：recordYear ==========
describe('journal - recordYear', () => {
  test('records each content entry with age', () => {
    // journal。
    const j = createJournal()
    // 一年内容。
    const year = { age: 5, content: [{ type: 'EVT', description: 'e1' }, { type: 'TLT', name: 't1' }] }
    // 记录。
    recordYear(j, year)
    // 两条。
    expect(j.all()).toHaveLength(2)
    // 第一条含 age。
    expect(j.all()[0].age).toBe(5)
    // name 字段映射为 description。
    expect(j.all()[1].description).toBe('t1')
  })
})
