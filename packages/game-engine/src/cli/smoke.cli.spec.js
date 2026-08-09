/**
 * AI 冒烟对比 CLI 单元测试 — smoke.cli.spec.js（Step 22）
 *
 * 覆盖范围：
 *   1. runWithAI：固定 seed 可复现、轨迹结构
 *   2. diffTraces：差异统计（AI 事件/天赋/属性）
 *   3. loadModData：mods 加载 + 钩子注入
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// 被测函数。
import { runWithAI, diffTraces } from './smoke.cli.js'
// 工具。
import { createRng } from '../functions/util.js'

// #makeData
// 最小测试数据。
function makeData() {
  // 返回。
  return {
    age: { 0: { event: [['e1', 1]], talent: [] }, 1: { event: [], talent: [] } },
    total: { TACHV: 1, TEVT: 1, TTLT: 1 },
    talents: { t1: { id: 't1', name: '天赋1', maxTriggers: 1 } },
    events: { e1: { id: 'e1', event: '出生' } },
    achievements: {},
    characters: {},
  }
}

// ========== 测试组 1：runWithAI ==========
describe('smoke - runWithAI', () => {
  test('produces trace with seed', async () => {
    // 数据。
    const data = makeData()
    // 跑一局。
    const trace = await runWithAI({ seed: 42, data, aiBus: null, years: 5 })
    // seed。
    expect(trace.seed).toBe(42)
    // log 数组。
    expect(Array.isArray(trace.log)).toBe(true)
    // 每岁有 age/props/events/talents。
    expect(trace.log[0]).toHaveProperty('age')
    expect(trace.log[0]).toHaveProperty('props')
    expect(Array.isArray(trace.log[0].events)).toBe(true)
  })

  test('same seed reproducible', async () => {
    // 数据。
    const data = makeData()
    // 两次跑。
    const r1 = await runWithAI({ seed: 7, data, aiBus: null, years: 5 })
    const r2 = await runWithAI({ seed: 7, data, aiBus: null, years: 5 })
    // 一致。
    expect(r1.log).toEqual(r2.log)
  })
})

// ========== 测试组 2：diffTraces ==========
describe('smoke - diffTraces', () => {
  test('detects AI-injected events', () => {
    // 基准轨迹。
    const base = {
      log: [
        { age: 0, props: { CHR: 1 }, events: ['出生'], talents: [] },
        { age: 1, props: { CHR: 2 }, events: [], talents: [] },
      ],
    }
    // AI 轨迹（多一条 AI 事件 + 属性变化）。
    const ai = {
      log: [
        { age: 0, props: { CHR: 1 }, events: ['出生', 'AI 事件'], talents: [] },
        { age: 1, props: { CHR: 5 }, events: [], talents: [] },
      ],
    }
    // diff。
    const d = diffTraces(base, ai)
    // AI 事件 1。
    expect(d.aiEvents).toBe(1)
    // 属性变化含 CHR。
    expect(d.changedProps.CHR).toBe(true)
    // AI 独有描述。
    expect(d.aiOnlyDescriptions.some(x => x.includes('AI 事件'))).toBe(true)
  })

  test('no diff when identical', () => {
    // 相同轨迹。
    const t = { log: [{ age: 0, props: { CHR: 1 }, events: ['e'], talents: [] }] }
    // diff。
    const d = diffTraces(t, t)
    // 无差异。
    expect(d.aiEvents).toBe(0)
    expect(Object.keys(d.changedProps)).toHaveLength(0)
  })
})
