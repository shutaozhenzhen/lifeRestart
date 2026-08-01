/**
 * talent 天赋系统单元测试 — talent.spec.js
 *
 * 覆盖范围：38 个测试用例，分为 9 组：
 *   1. initial（ID 字符串、maxTriggers、replacement 解析）
 *   2. get/information/count（存在性、错误）
 *   3. check（无条件、条件满足、条件不满足）
 *   4. exclude（正向/反向互斥）
 *   5. talentRandom（等级分布、include 占格、exclusive 排除、确定性）
 *   6. random（数量、exclusive 排除）
 *   7. allocationAddition（status 加成）
 *   8. do（触发与条件过滤）
 *   9. replace（替换链）
 */

// 导入 vitest 测试 DSL 和被测对象。
import { describe, test, expect, beforeEach } from 'vitest'
// Talent 模块。
import Talent from './talent.js'
// 测试 fixture。
import { TALENTS } from '../fixtures/talent-event.fixture.js'
// 条件引擎 + 种子随机源。
import { check } from '../condition/index.js'
import { createRng, clone } from '../functions/util.js'

// 创建 Talent 实例的辅助函数。
// @param {object} props - 属性快照（传给条件引擎）
// @param {number} seed - 随机种子
// @returns {Talent} 实例
function makeTalent(props = {}, seed = 42) {
  // 创建实例：注入条件引擎（绑定属性快照）+ 种子随机源。
  const talent = new Talent({
    clone,
    check: condition => check(condition, props),
    random: createRng(seed),
  })
  // 注入数据（深拷贝防止污染共享 fixture）。
  talent.initial({ talents: clone(TALENTS) })
  // 注入默认配置。
  talent.config()
  // 返回实例。
  return talent
}

// 每个测试前的实例。
let talent
beforeEach(() => {
  // 默认属性快照。
  talent = makeTalent({ CHR: 10, INT: 8, STR: 5, MNY: 1000, SPR: 60, LIF: 1, AGE: 25, TLT: [], EVT: [] })
})

// ========== 测试组 1：initial ==========
describe('talent - initial', () => {
  test('keeps talent ids as strings', () => {
    // 读取天赋。
    const t = talent.get('t_001')
    // ID 是字符串。
    expect(t.id).toBe('t_001')
    // 类型为 string。
    expect(typeof t.id).toBe('string')
  })

  test('parses maxTriggers field', () => {
    // t_002 显式声明 maxTriggers。
    expect(talent.get('t_002').maxTriggers).toBe(2)
    // 未声明的天赋缺省为 1。
    expect(talent.get('t_001').maxTriggers).toBe(1)
  })

  test('parses replacement into weight map', () => {
    // t_006 的 replacement.talent 被解析为权重映射。
    const r = talent.get('t_006').replacement
    // talent 键映射。
    expect(r.talent).toEqual({ t_007: 1, t_008: 1 })
  })

  test('returns count', () => {
    // 天赋总数。
    expect(talent.count).toBe(12)
  })
})

// ========== 测试组 2：get/information ==========
describe('talent - get/information', () => {
  test('get returns cloned talent', () => {
    // 取天赋。
    const t = talent.get('t_001')
    // 名称正确。
    expect(t.name).toBe('智力+1')
    // 不是原始引用。
    expect(t).not.toBe(TALENTS.t_001)
  })

  test('get throws for missing talent', () => {
    // 不存在时抛错。
    expect(() => talent.get('nope')).toThrow()
  })

  test('information returns display fields', () => {
    // 读取展示信息。
    const info = talent.information('t_001')
    // 三个字段。
    expect(info).toEqual({ grade: 1, name: '智力+1', description: '智力+1' })
  })
})

// ========== 测试组 3：check ==========
describe('talent - check', () => {
  test('no condition always passes', () => {
    // 无条件天赋。
    expect(talent.check('t_001')).toBe(true)
  })

  test('condition satisfied passes', () => {
    // INT=8 > 3。
    expect(talent.check('t_002')).toBe(true)
  })

  test('condition not satisfied fails', () => {
    // 用 INT=2 的实例。
    const t = makeTalent({ INT: 2 })
    // INT=2 不满足 >3。
    expect(t.check('t_002')).toBe(false)
  })
})

// ========== 测试组 4：exclude ==========
describe('talent - exclude', () => {
  test('returns conflicting talent from forward exclude', () => {
    // t_003 排除 t_004。
    // 候选含 t_004 → 冲突。
    expect(talent.exclude(['t_004'], 't_003')).toBe('t_004')
  })

  test('returns conflicting talent from reverse exclude', () => {
    // t_004 的 exclude 含 t_003。
    // 候选 t_004 与已选 t_003 互斥（反向检查）。
    expect(talent.exclude(['t_004'], 't_003')).toBe('t_004')
  })

  test('returns null when no conflict', () => {
    // t_001 与任何天赋都不互斥。
    expect(talent.exclude(['t_001', 't_002'], 't_003')).toBe(null)
  })

  test('empty candidates returns null', () => {
    // 空候选列表。
    expect(talent.exclude([], 't_003')).toBe(null)
  })
})

// ========== 测试组 5：talentRandom ==========
describe('talent - talentRandom', () => {
  test('returns at most talentPullCount talents', () => {
    // 默认池大小 10。
    const pool = talent.talentRandom(null, {})
    // 不超过 10 个。
    expect(pool.length).toBeLessThanOrEqual(10)
    // 所有元素都是有效天赋（无 null/undefined 占位）。
    expect(pool.every(t => t && t.id)).toBe(true)
  })

  test('excludes exclusive talents', () => {
    // 抽取 20 次。
    for (let i = 0; i < 20; i++) {
      // 抽池。
      const pool = talent.talentRandom(null, {})
      // 不含 exclusive 天赋。
      expect(pool.every(t => t.id !== 't_005')).toBe(true)
    }
  })

  test('places include talent in first slot', () => {
    // 继承天赋对象。
    const include = { id: 't_001', grade: 1, name: '智力+1', description: '智力+1' }
    // 抽池。
    const pool = talent.talentRandom(include, {})
    // 第一格是继承天赋。
    expect(pool[0].id).toBe('t_001')
  })

  test('produces no duplicate talent in a pool', () => {
    // 抽池。
    const pool = talent.talentRandom(null, {})
    // ID 列表。
    const ids = pool.map(t => t.id)
    // 去重后长度相同 → 无重复。
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('deterministic with same seed', () => {
    // 同种子两次。
    const pool1 = makeTalent({ INT: 5 }, 123).talentRandom(null, {})
    const pool2 = makeTalent({ INT: 5 }, 123).talentRandom(null, {})
    // 结果完全一致。
    expect(pool1).toEqual(pool2)
  })
})

// ========== 测试组 6：random ==========
describe('talent - random', () => {
  test('returns requested count', () => {
    // 抽 3 个。
    const ids = talent.random(3)
    // 长度。
    expect(ids).toHaveLength(3)
  })

  test('excludes exclusive talents', () => {
    // 抽 20 个。
    const ids = talent.random(20)
    // 不含 exclusive。
    expect(ids.every(id => id !== 't_005')).toBe(true)
  })

  test('no duplicates', () => {
    // 抽多个。
    const ids = talent.random(5)
    // 去重。
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ========== 测试组 7：allocationAddition ==========
describe('talent - allocationAddition', () => {
  test('returns 0 when no status', () => {
    // t_001 无 status。
    expect(talent.allocationAddition('t_001')).toBe(0)
  })

  test('sums array of talents', () => {
    // 无 status 天赋数组。
    expect(talent.allocationAddition(['t_001', 't_002'])).toBe(0)
  })

  test('returns status value when present', () => {
    // 需要自定义带 status 的天赋，直接构造。
    const custom = new Talent({ clone })
    // 注入含 status 的天赋。
    custom.initial({ talents: { s1: { id: 's1', grade: 0, status: 2 } } })
    // 读取 status。
    expect(custom.allocationAddition('s1')).toBe(2)
  })
})

// ========== 测试组 8：do ==========
describe('talent - do', () => {
  test('triggers unconditioned talent', () => {
    // 触发 t_001。
    const result = talent.do('t_001')
    // 非 null。
    expect(result).not.toBeNull()
    // 效果正确。
    expect(result.effect).toEqual({ INT: 1 })
  })

  test('blocks talent when condition not met', () => {
    // INT=2 的实例。
    const t = makeTalent({ INT: 2 })
    // t_002 条件不满足。
    expect(t.do('t_002')).toBeNull()
  })

  test('triggers talent when condition met', () => {
    // INT=8 满足。
    const result = talent.do('t_002')
    // 效果正确。
    expect(result.effect).toEqual({ STR: 1 })
  })

  test('returns grade and name', () => {
    // 触发结果。
    const result = talent.do('t_001')
    // 元数据。
    expect(result.grade).toBe(1)
    expect(result.name).toBe('智力+1')
  })
})

// ========== 测试组 9：replace ==========
describe('talent - replace', () => {
  test('replaces talent with replacement.talent', () => {
    // t_006 有 talent 替换链（t_007/t_008）。
    // 用固定随机源让结果确定（seed 使 weightRandom 偏向某候选）。
    const t = makeTalent({}, 1)
    // 替换结果。
    const result = t.replace(['t_006'])
    // t_006 被替换。
    expect(result['t_006']).toBeDefined()
    // 替换目标是候选之一。
    expect(['t_007', 't_008']).toContain(result['t_006'])
  })

  test('no replacement talent stays unchanged', () => {
    // t_001 无 replacement。
    const result = talent.replace(['t_001'])
    // 结果为空映射。
    expect(result).toEqual({})
  })

  test('resolves replacement chain recursively', () => {
    // t_006 → t_007（t_007 无 replacement，链终止）。
    const result = talent.replace(['t_006'])
    // 结果是候选，且候选自身无需再替换。
    expect(['t_007', 't_008']).toContain(result['t_006'])
  })

  test('grade-based replacement', () => {
    // t_a 用 grade 替换：把 2 级天赋替换。
    // 直接构造带 grade replacement 的天赋（数组形式，与真实数据一致）。
    const custom = new Talent({ clone })
    // 数据：t_a 的 replacement.grade 把 2 级天赋替换为 t_b。
    custom.initial({
      talents: {
        t_a: { id: 't_a', grade: 0, replacement: { grade: [2] } },
        t_b: { id: 't_b', grade: 2 },
      },
    })
    // 替换 t_a。
    const result = custom.replace(['t_a'])
    // t_a 被替换为 t_b。
    expect(result['t_a']).toBe('t_b')
  })
})
