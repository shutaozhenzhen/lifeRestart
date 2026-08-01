/**
 * 轨迹导出 CLI 单元测试 — export.cli.spec.js（Step 11 冒烟对比）
 *
 * 覆盖范围：9 个测试用例，分为 3 组：
 *   1. 可复现性（同 seed 两次输出一致）
 *   2. 输出结构（years/log/end）
 *   3. 参数影响（不同 seed 不同结果、不同天赋不同结果）
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// runLife 函数。
import { runLife } from './export.cli.js'

// ========== 测试组 1：可复现性 ==========
describe('export - reproducibility', () => {
  test('same seed produces identical output', async () => {
    // 第一次运行。
    const r1 = await runLife({ seed: 42 })
    // 第二次运行。
    const r2 = await runLife({ seed: 42 })
    // 完全一致。
    expect(r1).toEqual(r2)
  })

  test('same seed identical over 10 years', async () => {
    // 第一次。
    const r1 = await runLife({ seed: 7, years: 10 })
    // 第二次。
    const r2 = await runLife({ seed: 7, years: 10 })
    // 一致。
    expect(r1.log).toEqual(r2.log)
  })
})

// ========== 测试组 2：输出结构 ==========
describe('export - structure', () => {
  test('returns seed field', async () => {
    // 运行。
    const r = await runLife({ seed: 1 })
    // 种子。
    expect(r.seed).toBe(1)
  })

  test('returns years count', async () => {
    // 运行。
    const r = await runLife({ seed: 1, years: 5 })
    // 最多 5 年。
    expect(r.years).toBeLessThanOrEqual(5)
    // 至少 1 年。
    expect(r.years).toBeGreaterThanOrEqual(1)
  })

  test('each year has age/props/events/talents', async () => {
    // 运行。
    const r = await runLife({ seed: 3 })
    // 第一年。
    const first = r.log[0]
    // 字段齐全。
    expect(typeof first.age).toBe('number')
    expect(first.props).toHaveProperty('CHR')
    expect(Array.isArray(first.events)).toBe(true)
    expect(Array.isArray(first.talents)).toBe(true)
  })

  test('end has age and reason', async () => {
    // 运行。
    const r = await runLife({ seed: 5 })
    // 结束信息。
    expect(r.end.age).toBeGreaterThanOrEqual(-1)
    // 有原因。
    expect(typeof r.end.reason).toBe('string')
  })
})

// ========== 测试组 3：参数影响 ==========
describe('export - parameter effects', () => {
  test('different seeds produce different outputs', async () => {
    // 两个种子（高属性让多事件可选，暴露随机差异；startLif 拉高避免早死）。
    const r1 = await runLife({ seed: 1, years: 20, startLif: 50, allocation: { CHR: 9, INT: 9 } })
    const r2 = await runLife({ seed: 2, years: 20, startLif: 50, allocation: { CHR: 9, INT: 9 } })
    // 轨迹不同（随机性生效）。
    expect(JSON.stringify(r1.log)).not.toBe(JSON.stringify(r2.log))
  })

  test('different talents affect output', async () => {
    // 无天赋。
    const r1 = await runLife({ seed: 42, years: 10, talents: [] })
    // 有天赋（t_001 智力+1）。
    const r2 = await runLife({ seed: 42, years: 10, talents: ['t_001'] })
    // 天赋影响属性。
    const hasInt1 = r1.log.some(y => y.props.INT > 0)
    const hasInt2 = r2.log.some(y => y.props.INT > 0)
    // 有天赋时 INT 更可能增长。
    expect(hasInt2).toBe(true)
    // 断言输出不同（天赋生效）。
    expect(JSON.stringify(r1.log)).not.toBe(JSON.stringify(r2.log))
  })

  test('allocation affects output', async () => {
    // 无分配。
    const r1 = await runLife({ seed: 42, years: 10, allocation: {} })
    // 高颜值分配。
    const r2 = await runLife({ seed: 42, years: 10, allocation: { CHR: 9 } })
    // 第一年 CHR 不同。
    expect(r2.log[0].props.CHR).toBe(9)
    expect(r1.log[0].props.CHR).not.toBe(9)
  })
})
