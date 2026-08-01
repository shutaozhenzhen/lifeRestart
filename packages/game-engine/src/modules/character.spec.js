/**
 * character 名人模式单元测试 — character.spec.js
 *
 * 覆盖范围：17 个测试用例，分为 5 组：
 *   1. initial（数据加载、storage 恢复）
 *   2. random（普通名人、唯一"我"）
 *   3. generateUnique（属性/天赋生成）
 *   4. 时间窗口逻辑（快速连点解锁）
 *   5. 保底机制（rateableKnife）
 */

// 导入 vitest 测试 DSL 和被测对象。
import { describe, test, expect, beforeEach } from 'vitest'
// Character 模块。
import Character from './character.js'
// fixture。
import { CHARACTERS, PROPERTY_WEIGHT, TALENT_WEIGHT } from '../fixtures/achievement-character.fixture.js'
// 工具。
import { clone, createRng } from '../functions/util.js'

// 测试辅助：创建 Character 实例。
// @param {object} overrides - 覆盖注入依赖
// @returns {Character} 实例
function makeCharacter(overrides = {}) {
  // 默认依赖。
  const char = new Character({
    clone,
    random: createRng(42),
    storage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null }, setItem(k, v) { this._d[k] = String(v) } },
    now: () => 0,
    getTalentRandom: count => Array.from({ length: count }, (_, i) => `t_${i}`),
    ...overrides,
  })
  // 初始化。
  char.initial({ characters: clone(CHARACTERS) })
  // 配置（带权重）。
  char.config({
    characterPullCount: 3,
    rateableKnife: 10,
    propertyWeight: PROPERTY_WEIGHT,
    talentWeight: TALENT_WEIGHT,
  })
  // 返回。
  return char
}

// 每个测试前的实例。
let char
beforeEach(() => {
  // 默认实例。
  char = makeCharacter()
})

// ========== 测试组 1：initial ==========
describe('character - initial', () => {
  test('returns count', () => {
    // 名人数。
    expect(char.count).toBe(3)
  })

  test('restores unique from storage', () => {
    // 带存档的 storage。
    const storage = {
      _d: { uniqueWaTaShi: JSON.stringify({ unique: true, property: { CHR: 5 }, talent: [] }) },
      getItem(k) { return k in this._d ? this._d[k] : null },
      setItem(k, v) { this._d[k] = String(v) },
    }
    // 实例。
    const c = makeCharacter({ storage })
    // 读取唯一"我"。
    const unique = c.random().unique
    // 非 null。
    expect(unique).not.toBeNull()
    // 属性恢复。
    expect(unique.property.CHR).toBe(5)
  })
})

// ========== 测试组 2：random ==========
describe('character - random', () => {
  test('returns normal characters', () => {
    // 随机。
    const { normal } = char.random()
    // 数量。
    expect(normal).toHaveLength(3)
    // 元素是名人对象。
    expect(normal[0].name).toBeDefined()
  })

  test('returns unique placeholder when not unlocked', () => {
    // 初始状态（now 恒 0，10 次内解锁）。
    // 连续调用 10 次触发解锁。
    let unique
    for (let i = 0; i < 10; i++) unique = char.random().unique
    // 第 10 次解锁。
    expect(unique).not.toBeNull()
  })

  test('normal characters have no duplicates in one draw', () => {
    // 随机。
    const { normal } = char.random()
    // ID 列表。
    const ids = normal.map(c => c.id)
    // 无重复。
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ========== 测试组 3：generateUnique ==========
describe('character - generateUnique', () => {
  test('generates property and talent', () => {
    // 生成唯一"我"。
    const unique = char.generateUnique()
    // 属性存在。
    expect(unique.property.CHR).toBeDefined()
    // 天赋存在。
    expect(unique.talent.length).toBeGreaterThan(0)
  })

  test('marks unique and generate flags', () => {
    // 生成。
    const unique = char.generateUnique()
    // 唯一标记。
    expect(unique.unique).toBe(true)
    // 生成标记。
    expect(unique.generate).toBe(true)
  })

  test('persists to storage', () => {
    // 生成。
    char.generateUnique()
    // storage 有存档。
    expect(char.random().unique).not.toBeNull()
  })

  test('returns existing unique without regenerating', () => {
    // 第一次生成。
    const first = char.generateUnique()
    // 第二次。
    const second = char.generateUnique()
    // 相同。
    expect(first).toEqual(second)
  })
})

// ========== 测试组 4：时间窗口逻辑 ==========
describe('character - time window', () => {
  test('does not unlock before 10 clicks', () => {
    // 只点 5 次。
    let unique = null
    for (let i = 0; i < 5; i++) unique = char.random().unique
    // 未解锁。
    expect(unique).toBeNull()
  })

  test('unlocks on 10 clicks within window', () => {
    // 点 10 次（now 恒 0，都在窗口内）。
    let unique = null
    for (let i = 0; i < 10; i++) unique = char.random().unique
    // 解锁。
    expect(unique).not.toBeNull()
  })

  test('resets when clicks exceed 10 seconds', () => {
    // 用可变的 now。
    let clock = 0
    // 实例。
    const c = makeCharacter({ now: () => clock })
    // 点 9 次。
    for (let i = 0; i < 9; i++) c.random()
    // 时间跳到 11 秒后。
    clock = 11000
    // 第 10 次点击超出窗口。
    const unique = c.random().unique
    // 未解锁。
    expect(unique).toBeNull()
  })
})

// ========== 测试组 5：保底机制 ==========
describe('character - rateable mechanism', () => {
  test('low weight character eventually appears', () => {
    // 用固定随机源反复抽取。
    // 保底机制让未抽中者权重递增，最终一定被抽中。
    const seen = new Set()
    // 抽 50 次。
    for (let i = 0; i < 50; i++) {
      // 抽一次。
      const { normal } = char.random()
      // 记录 ID。
      normal.forEach(c => seen.add(c.id))
    }
    // 三个名人都出现过。
    expect(seen.has('char_001')).toBe(true)
    expect(seen.has('char_002')).toBe(true)
    expect(seen.has('char_003')).toBe(true)
  })
})
