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
import { buildFixtureData, formatReport, loadModData, memoryStorage, parseStrategy, runCli, simulateCli } from './simulate.cli.js'

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

describe('simulate.cli - 策略参数（固定特性 / 固定属性）', () => {
  test('parseStrategy：缺省两条轴随机', () => {
    // 空参数。
    const { strategy, warnings } = parseStrategy([])
    // 缺省。
    expect(strategy.talents).toEqual({ mode: 'random', fixed: [] })
    expect(strategy.allocation).toEqual({ mode: 'random', fixed: {} })
    expect(warnings).toEqual([])
    // 显式 random 也视为随机。
    expect(parseStrategy(['--talents', 'random', '--alloc', 'random']).strategy.talents.mode).toBe('random')
  })

  test('parseStrategy：--talents 与 --alloc 解析', () => {
    // 固定特性 + 固定属性。
    const { strategy, warnings } = parseStrategy(['--talents', 't1, t2', '--alloc', 'CHR=3,INT=4,STR=5,MNY=8'])
    // 特性。
    expect(strategy.talents).toEqual({ mode: 'fixed', fixed: ['t1', 't2'] })
    // 属性。
    expect(strategy.allocation.mode).toBe('fixed')
    expect(strategy.allocation.fixed).toEqual({ CHR: 3, INT: 4, STR: 5, MNY: 8 })
    // 无警告。
    expect(warnings).toEqual([])
  })

  test('parseStrategy：非法片段给出警告并回退随机', () => {
    // --alloc 全是非法片段。
    const bad = parseStrategy(['--alloc', 'CHR'])
    expect(bad.warnings[0]).toContain('无法解析')
    expect(bad.strategy.allocation.mode).toBe('random')
    // --talents 只有逗号 → 空 → 警告。
    const empty = parseStrategy(['--talents', ',,'])
    expect(empty.warnings[0]).toContain('按随机处理')
    expect(empty.strategy.talents.mode).toBe('random')
  })
})

describe('simulate.cli - runCli（输出与导出）', () => {
  test('人类可读模式：输出报告文本，含策略行与进度回调', async () => {
    // 收集输出。
    const printed = []
    const progress = []
    // 固定特性 + 随机属性。
    const { text, stats } = await runCli({
      // 参数（fixture 数据，快）。
      argv: ['--runs', '4', '--seed', '8', '--talents', 'random'],
      // 输出。
      stdout: (t) => printed.push(t),
      // 进度。
      progress: (t) => progress.push(t),
    })
    // 报告里有策略行。
    expect(text).toContain('策略      : 特性：随机；属性：随机')
    // 打印了一次完整报告。
    expect(printed.length).toBe(1)
    // 进度回调被调用（4 局：第 4 局是最后一局）。
    expect(progress.length).toBeGreaterThanOrEqual(1)
    // 返回的统计可用。
    expect(stats.runs).toBe(4)
  })

  test('--format csv：stdout 只有 CSV（进度不再打印）', async () => {
    // 收集输出。
    const printed = []
    const progress = []
    // 跑。
    const { text, fileName } = await runCli({
      // 参数。
      argv: ['--runs', '3', '--seed', '1', '--format', 'csv'],
      // 输出。
      stdout: (t) => printed.push(t),
      // 进度。
      progress: (t) => progress.push(t),
    })
    // CSV 表头。
    expect(text.startsWith('序号,寿命,总评,评价')).toBe(true)
    // 文件名带扩展名。
    expect(fileName.endsWith('.csv')).toBe(true)
    // 导出模式下不打印进度（否则会污染 CSV）。
    expect(progress).toEqual([])
    // stdout 收到的是纯 CSV。
    expect(printed[0]).toBe(text)
  })

  test('--format md --out <file>：写入文件而不是 stdout', async () => {
    // 记录写入。
    const written = []
    // 跑。
    const { outFile, text } = await runCli({
      // 参数。
      argv: ['--runs', '2', '--seed', '2', '--format', 'md', '--out', 'out.md'],
      // 输出函数：不应该被调用。
      stdout: () => {
        throw new Error('不应写 stdout')
      },
      // 写文件替身。
      writeFile: (file, content) => written.push([file, content]),
    })
    // 文件名透传。
    expect(outFile).toBe('out.md')
    // 写了一次。
    expect(written.length).toBe(1)
    expect(written[0][0]).toBe('out.md')
    // 内容 = 返回文本。
    expect(written[0][1]).toBe(text)
    // Markdown 报告。
    expect(text).toContain('# 人生重开模拟器 · 批量模拟报告')
  })

  test('--json 等价于 --format json', async () => {
    // 收集。
    const printed = []
    // 跑。
    const { text } = await runCli({ argv: ['--runs', '2', '--seed', '3', '--json'], stdout: (t) => printed.push(t) })
    // 可解析。
    const payload = JSON.parse(text)
    expect(payload.meta.runs).toBe(2)
    expect(payload.meta.seed).toBe(3)
    // 逐局结果在内。
    expect(payload.results.length).toBe(2)
  })

  test('固定特性导出：md 报告里出现天赋名称与策略', async () => {
    // 取 fixture 里的两个天赋 ID 与名称。
    const data = buildFixtureData()
    const ids = Object.keys(data.talents).slice(0, 2)
    // 跑（固定特性）。
    const { text, stats } = await runCli({
      // 参数。
      argv: ['--runs', '2', '--seed', '4', '--format', 'md', '--talents', ids.join(',')],
      // 输出。
      stdout: () => {},
    })
    // 策略里记录固定特性。
    expect(stats.strategy.talents).toEqual({ mode: 'fixed', fixed: ids })
    // 报告里渲染出天赋名（不是裸 ID）。
    expect(text).toContain(data.talents[ids[0]].name)
    // 固定特性 → 策略行。
    expect(text).toContain('特性：固定（')
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

  test('真实数据：同种子两次导出逐局完全一致（复现，不依赖前端）', async () => {
    // 同参数跑两次（真实数据 + 同一颗种子）。
    const first = await runCli({ argv: ['--runs', '1', '--seed', '42', '--mods', MODS_DIR, '--format', 'json'], stdout: () => {} })
    const second = await runCli({ argv: ['--runs', '1', '--seed', '42', '--mods', MODS_DIR, '--format', 'json'], stdout: () => {} })
    // 解析（meta.generatedAt 是导出时间戳，不参与比较）。
    const a = JSON.parse(first.text)
    const b = JSON.parse(second.text)
    // 逐局结果完全一致：寿命、天赋、分配、总评、流水条数。
    expect(a.results).toEqual(b.results)
    // 聚合也一致。
    expect(a.stats.age).toEqual(b.stats.age)
    expect(a.stats.best).toEqual(b.stats.best)
    // 种子如实记录。
    expect(a.meta.seed).toBe(42)
    // 这一局确实是有内容的真实人生（不是 0 岁空局）。
    expect(a.results[0].age).toBeGreaterThan(1)
  }, 120000)

  test('真实数据：不同种子 → 不同人生（种子驱动天赋抽取与事件选择）', async () => {
    // 两颗种子各跑一局。
    const a = JSON.parse((await runCli({ argv: ['--runs', '1', '--seed', '1', '--mods', MODS_DIR, '--format', 'json'], stdout: () => {} })).text)
    const b = JSON.parse((await runCli({ argv: ['--runs', '1', '--seed', '2', '--mods', MODS_DIR, '--format', 'json'], stdout: () => {} })).text)
    // 人生指纹：寿命 + 天赋 + 事件数 + 总评（真实数据下必然不同）。
    const fingerprint = (p) => p.results.map((r) => `${r.age}:${r.talents.join('-')}:${r.events}:${r.sum}`)
    expect(fingerprint(a)).not.toEqual(fingerprint(b))
  }, 120000)

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
