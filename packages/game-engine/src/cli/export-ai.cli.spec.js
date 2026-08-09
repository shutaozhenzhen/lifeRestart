/**
 * AI 生成结果导出 CLI 单元测试 — export-ai.cli.spec.js（Step 21）
 *
 * 覆盖范围：
 *   1. buildAIMod：从 journal 提取 AI 条目构建 Mod
 *   2. 非 AI 条目过滤
 *   3. 落盘结构
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// 被测函数。
import { buildAIMod } from './export-ai.cli.js'

// #makeEntries
// 构造 journal 条目（混合 AI 与非 AI）。
function makeEntries() {
  // 返回。
  return [
    // 原版事件（不应导出）。
    { age: 0, type: 'EVT', description: '你出生了' },
    // AI 天赋。
    { age: 0, type: 'TLT', description: 'AI 天赋：洞察', id: 'ai_t_1' },
    // AI 事件。
    { age: 3, type: 'EVT', description: 'AI 事件：奇遇', id: 'ai_e_1' },
    // 原版天赋（不应导出）。
    { age: 4, type: 'TLT', description: '原版天赋' },
  ]
}

// ========== 测试组 1：buildAIMod ==========
describe('export-ai - buildAIMod', () => {
  test('extracts AI entries into mod', () => {
    // 构建。
    const mod = buildAIMod(makeEntries(), 'ai-test')
    // manifest。
    expect(mod.manifest.name).toBe('ai-test')
    // AI 天赋。
    expect(mod.talents.ai_t_1.name).toContain('洞察')
    // AI 事件。
    expect(mod.events.ai_e_1.event).toContain('奇遇')
  })

  test('filters out non-AI entries', () => {
    // 构建。
    const mod = buildAIMod(makeEntries())
    // 只含 AI 条目。
    expect(Object.keys(mod.talents)).toHaveLength(1)
    expect(Object.keys(mod.events)).toHaveLength(1)
    // 原版事件未导出。
    expect(Object.values(mod.events).some(e => e.event === '你出生了')).toBe(false)
  })

  test('handles empty journal', () => {
    // 空。
    const mod = buildAIMod([])
    // 空 Mod。
    expect(Object.keys(mod.talents)).toHaveLength(0)
    expect(Object.keys(mod.events)).toHaveLength(0)
    // manifest 存在。
    expect(mod.manifest.name).toBe('ai-result')
  })

  test('AI detection by description prefix too', () => {
    // 无 id 但描述以 AI 开头。
    const mod = buildAIMod([{ age: 1, type: 'EVT', description: 'AI 生成的事件' }])
    // 被识别。
    expect(Object.keys(mod.events)).toHaveLength(1)
  })
})
