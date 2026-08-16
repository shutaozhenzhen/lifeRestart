/**
 * 跨平台一致性单元测试 — consistency.cli.spec.js（Step 26）
 *
 * 覆盖范围：
 *   1. runOnce：同 seed 确定性（两次调用输出一致），不同 seed 输出不同
 *   2. runConsistency：进程内多次 + node 子进程全部一致（ok=true）
 *   3. 带 mods + mock-ai 的一致性（确定性 AI 注入）
 */

// 导入 vitest。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { runOnce, runConsistency } from './consistency.cli.js'

// ========== 测试组 1：runOnce 确定性 ==========
describe('consistency - runOnce 确定性', () => {
  test('同 seed 两次输出一致（fixture 数据）', async () => {
    // 两次运行。
    const a = await runOnce({ seed: 42, years: 10 })
    // 第二次。
    const b = await runOnce({ seed: 42, years: 10 })
    // 完全一致。
    expect(a).toBe(b)
    // 非空。
    expect(a.length).toBeGreaterThan(100)
  })

  test('不同 seed 输出不同', async () => {
    // 两次运行。
    const a = await runOnce({ seed: 1, years: 10 })
    // 不同 seed。
    const b = await runOnce({ seed: 2, years: 10 })
    // 不同。
    expect(a).not.toBe(b)
  })

  test('带 mods + mock-ai 同 seed 一致', async () => {
    // 两次运行。
    const a = await runOnce({ seed: 7, years: 15, modsDir: '../../mods', mockAi: true })
    // 第二次。
    const b = await runOnce({ seed: 7, years: 15, modsDir: '../../mods', mockAi: true })
    // 一致。
    expect(a).toBe(b)
    // 包含 AI 注入内容（AI 事件）。
    expect(a).toContain('AI')
  })
})

// ========== 测试组 2：runConsistency 全链路 ==========
describe('consistency - runConsistency', () => {
  test('进程内多次 + node 子进程全部一致（ok=true）', async () => {
    // 运行（runs 少一点，子进程有启动开销）。
    const result = await runConsistency({ seed: 42, runs: 2, years: 8, log: { info: () => {}, warn: () => {}, error: () => {} } })
    // 全部一致。
    expect(result.ok).toBe(true)
    // 输出数量：runs + 1 子进程。
    expect(result.outputs.length).toBe(3)
    // 检查项含 node 子进程。
    expect(result.checked).toContain('node 子进程')
  })

  test('带 mods + mock-ai 跨进程一致', async () => {
    // 运行。
    const result = await runConsistency({
      seed: 7,
      runs: 1,
      years: 8,
      modsDir: '../../mods',
      mockAi: true,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    })
    // 一致。
    expect(result.ok).toBe(true)
    // 子进程输出与进程内相同。
    expect(result.outputs[0]).toBe(result.outputs[1])
  })
})
