// @vitest-environment happy-dom
/**
 * simulation-runner 测试 — 前端批量模拟驱动器
 *
 * 覆盖：
 *   1. 分批执行：进度按批回调、批间让出主线程（yield 次数正确）
 *   2. 取消：shouldStop 为真时停止，且保留已完成部分的聚合
 *   3. 可复现：同种子两次结果一致
 *   4. 不污染玩家存档：模拟用内存存储，localStorage 保持为空
 *   5. 边界：runs=0 / chunk 大于总局数
 */

// vitest DSL。
import { describe, test, expect, beforeEach } from 'vitest'
// 被测模块。
import { runSimulation } from './simulation-runner.js'
// 数据（fixture：毫秒级一局，测试快）。
import { buildFixtureData } from '../test-utils/fixture-data.js'
// 测试装置（内存 localStorage）。
import { installLocalStorage } from '../test-utils/setup.js'

// 每个用例前装好内存 localStorage（用于验证"不被写脏"）。
beforeEach(() => {
  // 安装。
  installLocalStorage()
})

describe('simulation-runner', () => {
  test('分批执行：进度回调与 let-yield 次数正确', async () => {
    // 进度记录。
    const progress = []
    // 让出次数。
    let yields = 0
    // 跑 5 局、每批 2 局。
    const result = await runSimulation({
      // 数据。
      data: buildFixtureData(),
      // 局数。
      runs: 5,
      // 种子（可复现）。
      seed: 1,
      // 每批。
      chunk: 2,
      // 进度。
      onProgress: (done, total) => progress.push([done, total]),
      // 注入让出实现（并计数）。
      yieldTo: async () => { yields++ },
    })
    // 结果条数。
    expect(result.results.length).toBe(5)
    // 未取消。
    expect(result.cancelled).toBe(false)
    // 进度：2 → 4 → 5（最后一批不足 chunk）。
    expect(progress).toEqual([[2, 5], [4, 5], [5, 5]])
    // 让出次数 = 批数 - 1（最后一批后不再让出）。
    expect(yields).toBe(2)
    // 聚合可用。
    expect(result.stats.runs).toBe(5)
    expect(result.stats.seed).toBe(1)
  })

  test('取消：停止后续批次并保留已完成部分', async () => {
    // 取消开关。
    let stop = false
    // 进度。
    const progress = []
    // 跑 10 局、每批 1 局，第 3 局后取消。
    const result = await runSimulation({
      // 数据。
      data: buildFixtureData(),
      // 局数。
      runs: 10,
      // 种子。
      seed: 2,
      // 每批 1 局。
      chunk: 1,
      // 取消判定。
      shouldStop: () => stop,
      // 进度回调里触发取消。
      onProgress: (done) => {
        // 记录。
        progress.push(done)
        // 第 3 局后请求停止。
        if (done >= 3) stop = true
      },
      // 让出。
      yieldTo: async () => {},
    })
    // 已标记取消。
    expect(result.cancelled).toBe(true)
    // 只跑了 3 局。
    expect(result.results.length).toBe(3)
    // 聚合反映已完成的部分（不是 0）。
    expect(result.stats.runs).toBe(3)
    expect(result.stats.age.histogram.length).toBe(11)
  })

  test('可复现：同种子两次聚合一一致', async () => {
    // 同一份数据 + 同种子跑两次。
    const a = await runSimulation({ data: buildFixtureData(), runs: 3, seed: 99, yieldTo: async () => {} })
    const b = await runSimulation({ data: buildFixtureData(), runs: 3, seed: 99, yieldTo: async () => {} })
    // 逐局一致。
    expect(a.results.map((r) => [r.age, r.talents, r.sum])).toEqual(b.results.map((r) => [r.age, r.talents, r.sum]))
    // 聚合一致。
    expect(a.stats.age).toEqual(b.stats.age)
  })

  test('不污染玩家存档：localStorage 保持为空', async () => {
    // 跑几局（引擎的 TMS/ACHV/AEVT 都会写存储，但用的是内存实现）。
    await runSimulation({ data: buildFixtureData(), runs: 3, seed: 5, yieldTo: async () => {} })
    // 玩家 localStorage 里不应出现任何模拟产生的键。
    expect(globalThis.localStorage.getItem('lifeRestart:times')).toBeNull()
    expect(globalThis.localStorage.getItem('lifeRestart:ACHV')).toBeNull()
    expect(globalThis.localStorage.getItem('lifeRestart:AEVT')).toBeNull()
  })

  test('边界：runs=0 返回空聚合；chunk 大于总局数也能跑完', async () => {
    // 0 局。
    const zero = await runSimulation({ data: buildFixtureData(), runs: 0, seed: 1, yieldTo: async () => {} })
    // 空聚合。
    expect(zero.results.length).toBe(0)
    expect(zero.stats.runs).toBe(0)
    expect(zero.stats.best).toBeNull()
    // chunk 大于总局数。
    const one = await runSimulation({ data: buildFixtureData(), runs: 2, seed: 1, chunk: 50, yieldTo: async () => {} })
    // 一次跑完。
    expect(one.results.length).toBe(2)
  })

  test('结果包含可展示的天赋明细与收集统计', async () => {
    // 跑一局。
    const { results, stats } = await runSimulation({ data: buildFixtureData(), runs: 1, seed: 7, yieldTo: async () => {} })
    // 天赋明细。
    expect(Array.isArray(results[0].talentDetails)).toBe(true)
    // 收集统计字段（供页面渲染百分比）。
    expect(typeof stats.collection.talentRate).toBe('number')
    expect(typeof stats.collection.eventRate).toBe('number')
    expect(typeof stats.collection.achievementRate).toBe('number')
    // 最佳一局存在。
    expect(stats.best).not.toBeNull()
  })

  test('策略透传：固定特性 → 每局特性一致；固定属性 → 分配严格等于给定值', async () => {
    // 数据（取两个真实存在的天赋 ID）。
    const data = buildFixtureData()
    const fixed = Object.keys(data.talents).slice(0, 2)
    // 跑 3 局：特性固定、属性固定。
    const { results, stats } = await runSimulation({
      // 数据。
      data,
      // 局数。
      runs: 3,
      // 种子。
      seed: 11,
      // 策略。
      strategy: {
        talents: { mode: 'fixed', fixed },
        allocation: { mode: 'fixed', fixed: { CHR: 5, INT: 5, STR: 5, MNY: 5 } },
      },
      // 让出。
      yieldTo: async () => {},
    })
    // 每局特性与分配都一致。
    for (const r of results) {
      expect(r.talents).toEqual(fixed)
      expect(r.allocation).toEqual({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
      // 名称来自全量天赋表。
      expect(r.talentDetails[0].name).toBe(data.talents[fixed[0]].name)
    }
    // 聚合里记录了策略（导出报告要用）。
    expect(stats.strategy.talents.fixed).toEqual(fixed)
    expect(stats.strategy.allocation.mode).toBe('fixed')
  })

  test('策略缺省 → 两条轴随机（与旧行为一致）', async () => {
    // 不传策略。
    const { results, stats } = await runSimulation({ data: buildFixtureData(), runs: 2, seed: 12, yieldTo: async () => {} })
    // 随机模式。
    expect(stats.strategy.talents.mode).toBe('random')
    expect(stats.strategy.allocation.mode).toBe('random')
    // 每局都有特性。
    for (const r of results) expect(r.talents.length).toBeGreaterThan(0)
  })
})
