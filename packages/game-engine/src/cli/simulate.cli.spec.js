/**
 * simulate.cli 测试 — 批量模拟 CLI 原型
 *
 * 覆盖：
 *   1. fixture 数据下跑多局：统计结构完整、进度回调按批触发、可复现
 *   2. formatReport：终端报告含关键指标 / 直方图 / 最佳一局 / 吞吐
 *   3. 真实数据路径：用 Mod 加载器取 Data Mod（mods/）后能跑
 *   4. 内存存储：模拟不写外部存储（不污染玩家存档）
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// node 路径工具（定位 mods 目录）。
import { fileURLToPath } from 'node:url'
// 被测模块。
import { buildFixtureData, formatReport, loadModData, memoryStorage, simulateCli } from './simulate.cli.js'

// mods 目录（lifeRestart/mods，相对本文件向上 4 层）。
const MODS_DIR = fileURLToPath(new URL('../../../../mods/', import.meta.url))

describe('simulate.cli - simulateCli', () => {
  test('fixture 数据跑 5 局：结果条数、统计结构、进度回调', async () => {
    // 记录进度。
    const progress = []
    // 跑（每批 2 局）。
    const { stats, results, elapsedMs } = await simulateCli({
      // 局数。
      runs: 5,
      // 种子（可复现）。
      seed: 3,
      // 每批局数。
      chunk: 2,
      // 进度回调。
      onProgress: (done, total) => progress.push([done, total]),
    })
    // 结果条数与统计一致。
    expect(results.length).toBe(5)
    expect(stats.runs).toBe(5)
    // 种子透传。
    expect(stats.seed).toBe(3)
    // 关键字段都在。
    expect(typeof stats.age.avg).toBe('number')
    expect(stats.age.histogram.length).toBe(11)
    expect(stats.best).not.toBeNull()
    // 进度按批触发：2 → 4 → 5。
    expect(progress).toEqual([[2, 5], [4, 5], [5, 5]])
    // 计时可用。
    expect(elapsedMs).toBeGreaterThanOrEqual(0)
  })

  test('同种子两次结果一致（逐局可比对）', async () => {
    // 两次相同种子。
    const a = await simulateCli({ runs: 3, seed: 11 })
    const b = await simulateCli({ runs: 3, seed: 11 })
    // 逐局一致。
    expect(a.results.map((r) => [r.age, r.talents, r.sum])).toEqual(b.results.map((r) => [r.age, r.talents, r.sum]))
    // 统计一致。
    expect(a.stats.age).toEqual(b.stats.age)
  })

  test('模拟使用内存存储：不触碰外部 storage', async () => {
    // 内存适配器（确认写入都落在它自己身上）。
    const storage = memoryStorage()
    // 写读往返。
    storage.setItem('k', 'v')
    expect(storage.getItem('k')).toBe('v')
    // 未写过的键返回 null（与 localStorage 语义一致）。
    expect(storage.getItem('nope')).toBeNull()
    // 跑一局不抛。
    await expect(simulateCli({ runs: 1, seed: 1 })).resolves.toBeTruthy()
  })
})

describe('simulate.cli - formatReport', () => {
  test('报告包含关键指标、直方图与最佳一局', async () => {
    // 跑几局（fixture，快）。
    const { stats } = await simulateCli({ runs: 4, seed: 5 })
    // 渲染。
    const text = formatReport(stats, { elapsedMs: 1234 })
    // 关键行。
    expect(text).toContain('批量模拟结果')
    expect(text).toContain('局数      : 4（seed=5）')
    expect(text).toContain('寿命      : 平均')
    expect(text).toContain('总评      : 平均')
    expect(text).toContain('总评分档  : 普通')
    expect(text).toContain('属性均值  :')
    expect(text).toContain('收集      :')
    expect(text).toContain('寿命分布  :')
    // 直方图含 100+ 档。
    expect(text).toContain('100+')
    // 最佳一局明细。
    expect(text).toContain('最佳一局  :')
    // 吞吐（1234ms / 4 局）。
    expect(text).toContain('局/秒')
  })

  test('无种子时标注不可复现', async () => {
    // 跑一局（不传种子）。
    const { stats } = await simulateCli({ runs: 1 })
    // 报告。
    const text = formatReport({ ...stats, seed: null })
    // 标注。
    expect(text).toContain('不可复现')
  })

  test('空统计也能渲染（不崩）', () => {
    // 空结果聚合。
    const empty = {
      runs: 0, seed: null,
      age: { min: 0, max: 0, avg: 0, median: 0, histogram: [] },
      sum: { min: 0, max: 0, avg: 0, grades: {} },
      propertys: {}, maxPropertys: {}, collection: {}, achievementsPerRun: 0, best: null,
    }
    // 不抛。
    expect(() => formatReport(empty)).not.toThrow()
    // 仍有标题。
    expect(formatReport(empty)).toContain('批量模拟结果')
  })
})

describe('simulate.cli - 真实数据路径', () => {
  test('loadModData：加载 mods/ 得到真实规模数据', () => {
    // 加载。
    const data = loadModData({ modsDir: MODS_DIR })
    // 规模与 README 描述一致（Data Mod：age 501 / talents 184 / events 1720）。
    expect(Object.keys(data.age).length).toBeGreaterThan(400)
    expect(Object.keys(data.talents).length).toBeGreaterThan(150)
    expect(Object.keys(data.events).length).toBeGreaterThan(1000)
  })

  test('真实数据跑 2 局：能结束且寿命合理', async () => {
    // 跑（真实数据单局较慢，只跑 2 局）。
    const { stats, results } = await simulateCli({ runs: 2, seed: 42, modsDir: MODS_DIR })
    // 两局都有寿命。
    expect(results.length).toBe(2)
    for (const r of results) {
      expect(r.age).toBeGreaterThanOrEqual(0)
      expect(r.age).toBeLessThanOrEqual(1000)
      // 天赋数量受引擎上限约束。
      expect(r.talents.length).toBeLessThanOrEqual(3)
    }
    // 聚合可用。
    expect(stats.runs).toBe(2)
    expect(stats.age.max).toBeGreaterThanOrEqual(stats.age.min)
  }, 60000)

  test('fixture 数据规模较小（用于快速冒烟）', () => {
    // 构造。
    const data = buildFixtureData()
    // 与真实数据区分开。
    expect(Object.keys(data.age).length).toBeLessThan(100)
    // 两次调用互不污染（深拷贝）。
    const again = buildFixtureData()
    expect(again.age).not.toBe(data.age)
  })
})
