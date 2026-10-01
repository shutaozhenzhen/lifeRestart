/**
 * exporters 单元测试 — CSV / JSON / Markdown 导出
 *
 * 覆盖：
 *   1. csvCell 转义（逗号/引号/换行）——不转义会直接破坏列结构
 *   2. toCSV：表头 + 逐局行、列数一致、天赋名中的分隔符被正确转义
 *   3. toMarkdown：各章节表格齐全、逐局明细行数、策略行、无种子时标注
 *   4. toJSON：可 JSON.parse 回来，meta/stats/results 齐全
 *   5. buildFileName / exportSimulation：扩展名、MIME、未知格式报错
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import {
  FORMAT_LIST,
  buildFileName,
  csvCell,
  exportSimulation,
  formatStamp,
  formatStrategy,
  toCSV,
  toJSON,
  toMarkdown,
} from './exporters.js'

// 手工构造的逐局结果（便于精确断言）。
const RESULTS = [
  {
    age: 10, sum: 30, grade: 'J_Normal', maxAge: 12,
    maxPropertys: { CHR: 2, INT: 3, STR: 4, MNY: 5, SPR: 6 },
    propertys: { CHR: 1, INT: 2, STR: 3, MNY: 4, SPR: 5, AGE: 10 },
    talents: ['t1'], talentDetails: [{ id: 't1', name: '含,逗号的天赋', grade: 1 }],
    allocation: { CHR: 1, INT: 2, STR: 3, MNY: 4 },
    events: 5, talentsTriggered: 1, achievements: 0,
  },
  {
    age: 90, sum: 120, grade: 'J_Great', maxAge: 95,
    maxPropertys: { CHR: 6, INT: 7, STR: 8, MNY: 9, SPR: 10 },
    propertys: { CHR: 5, INT: 6, STR: 7, MNY: 8, SPR: 9, AGE: 90 },
    talents: ['t2', 't3'], talentDetails: [{ id: 't2', name: '引号"天赋', grade: 2 }, { id: 't3', name: '普通天赋', grade: 3 }],
    allocation: { CHR: 5, INT: 5, STR: 5, MNY: 5 },
    events: 30, talentsTriggered: 4, achievements: 2,
  },
]

// 聚合结果（手工，覆盖表格各行）。
const STATS = {
  runs: 2, seed: 42,
  age: { min: 10, max: 90, avg: 50, median: 50, histogram: [{ label: '10-19', count: 1 }, { label: '90-99', count: 1 }] },
  sum: { min: 30, max: 120, avg: 75, grades: { J_Great: 1, J_Good: 0, J_Normal: 1 } },
  propertys: { CHR: 3, INT: 4, STR: 5, MNY: 6, SPR: 7 },
  maxPropertys: { CHR: 4, INT: 5, STR: 6, MNY: 7, SPR: 8 },
  collection: { achievements: 2, achievementRate: 0.0121, talentRate: 0.014, eventRate: 0.0174 },
  achievementsPerRun: 1,
  strategy: { talents: { mode: 'fixed', fixed: ['t2', 't3'] }, allocation: { mode: 'random', fixed: {} } },
  warnings: [],
  best: RESULTS[1],
  longest: RESULTS[1],
}

describe('exporters - csvCell', () => {
  test('普通值不加引号；含逗号/引号/换行时加引号并翻倍内部引号', () => {
    // 普通。
    expect(csvCell('abc')).toBe('abc')
    expect(csvCell(12)).toBe('12')
    // null/undefined → 空。
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    // 逗号。
    expect(csvCell('a,b')).toBe('"a,b"')
    // 引号。
    expect(csvCell('说"话"')).toBe('"说""话"""')
    // 换行。
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })
})

describe('exporters - toCSV', () => {
  test('表头 + 每局一行，列数一致', () => {
    // 生成。
    const csv = toCSV(STATS, RESULTS)
    // 行。
    const lines = csv.trim().split('\n')
    // 表头 + 2 行。
    expect(lines.length).toBe(3)
    // 列数一致（表头 24 列）。
    const headerCols = lines[0].split(',').length
    expect(headerCols).toBe(24)
    // 含逗号的天赋名被引号包住（保证列不被拆开）。
    expect(lines[1]).toContain('"含,逗号的天赋"')
    // 解析式校验：把引号内的内容换掉再数列数。
    const stripQuoted = (row) => row.replace(/"[^"]*"/g, 'Q')
    expect(stripQuoted(lines[1]).split(',').length).toBe(headerCols)
    expect(stripQuoted(lines[2]).split(',').length).toBe(headerCols)
  })

  test('关键字段落在正确列上（寿命/总评/天赋名）', () => {
    // 生成。
    const lines = toCSV(STATS, RESULTS).trim().split('\n')
    // 第一局行。
    const row = lines[1]
    // 序号 1、寿命 10、总评 30。
    expect(row.startsWith('1,10,30,J_Normal,')).toBe(true)
    // 天赋名（含逗号）被转义。
    expect(row).toContain('"含,逗号的天赋"')
    // 第二局：两个天赋用分号连接。
    expect(lines[2]).toContain('"引号""天赋;普通天赋"')
  })

  test('空结果仍输出表头', () => {
    // 空。
    const csv = toCSV({ runs: 0 }, [])
    // 只有表头 + 末尾换行。
    expect(csv.trim().split('\n').length).toBe(1)
    expect(csv).toContain('序号,寿命,总评,评价')
  })
})

describe('exporters - toMarkdown', () => {
  test('包含全部章节与表格', () => {
    // 生成。
    const md = toMarkdown(STATS, RESULTS, { strategy: STATS.strategy, date: new Date('2026-10-01T10:00:00') })
    // 章节。
    for (const heading of ['# 人生重开模拟器 · 批量模拟报告', '## 概览', '## 寿命分布', '## 总评分档', '## 属性均值', '## 收集', '## 最佳一局（总评最高）', '## 逐局明细']) {
      expect(md, heading).toContain(heading)
    }
    // 概览数据。
    expect(md).toContain('| 平均寿命 | 50 |')
    expect(md).toContain('| 最短 / 最长寿命 | 10 / 90 |')
    // 种子标注可复现。
    expect(md).toContain('`42`（可复现）')
    // 策略行（固定特性带名称）。
    expect(md).toContain('固定（t2、t3）')
    // 收集百分比。
    expect(md).toContain('1.2%')
    // 最佳一局明细。
    expect(md).toContain('- 寿命：**90** 岁')
    // 逐局明细两行数据。
    const detailRows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l))
    expect(detailRows.length).toBe(2)
  })

  test('无种子时标注不可复现', () => {
    // 生成。
    const md = toMarkdown({ ...STATS, seed: null }, RESULTS)
    // 标注。
    expect(md).toContain('未指定（不可复现）')
  })

  test('talentName 映射可把固定特性 ID 换成人名', () => {
    // 生成（带映射）。
    const md = toMarkdown(STATS, RESULTS, { strategy: STATS.strategy, talentName: (id) => `名字-${id}` })
    // 渲染出映射结果。
    expect(md).toContain('名字-t2')
  })
})

describe('exporters - toJSON', () => {
  test('可解析回来，meta/stats/results 齐全', () => {
    // 生成。
    const text = toJSON(STATS, RESULTS, { strategy: STATS.strategy, extra: { dataSource: 'test' }, date: new Date('2026-10-01T10:00:00Z') })
    // 解析。
    const payload = JSON.parse(text)
    // 元信息。
    expect(payload.meta.runs).toBe(2)
    expect(payload.meta.seed).toBe(42)
    expect(payload.meta.dataSource).toBe('test')
    expect(payload.meta.generatedAt).toBe('2026-10-01T10:00:00.000Z')
    // 聚合与逐局。
    expect(payload.stats.age.avg).toBe(50)
    expect(payload.results.length).toBe(2)
    // 末尾换行（便于追加）。
    expect(text.endsWith('\n')).toBe(true)
  })
})

describe('exporters - 文件名与分发', () => {
  test('formatStamp 形如 YYYYMMDD-HHmmss', () => {
    // 固定时间。
    expect(formatStamp(new Date(2026, 9, 1, 8, 5, 3))).toBe('20261001-080503')
  })

  test('buildFileName：扩展名随格式，种子可选，全 ASCII', () => {
    // 带种子。
    expect(buildFileName({ format: 'csv', runs: 30, seed: 42, date: new Date(2026, 9, 1, 8, 5, 3) }))
      .toBe('liferestart-sim-runs30-seed42-20261001-080503.csv')
    // 无种子。
    expect(buildFileName({ format: 'md', runs: 5, seed: null, date: new Date(2026, 9, 1, 8, 5, 3) }))
      .toBe('liferestart-sim-runs5-20261001-080503.md')
    // ASCII。
    expect(/^[\x20-\x7e]+$/.test(buildFileName({ format: 'json', runs: 1 }))).toBe(true)
  })

  test('formatStrategy：随机/固定两条轴', () => {
    // 缺省。
    expect(formatStrategy()).toContain('特性：随机；属性：随机')
    // 固定特性 + 随机属性。
    expect(formatStrategy({ talents: { mode: 'fixed', fixed: ['a', 'b'] }, allocation: { mode: 'random' } }, { talentName: (id) => id.toUpperCase() }))
      .toBe('特性：固定（A、B）；属性：随机')
    // 固定属性。
    expect(formatStrategy({ talents: { mode: 'random' }, allocation: { mode: 'fixed', fixed: { CHR: 3, MNY: 5 } } }))
      .toBe('特性：随机；属性：固定（颜值 3 / 家境 5）')
  })

  test('exportSimulation：按格式分发并给出文件名与 MIME', () => {
    // 三种格式。
    const csv = exportSimulation({ format: 'csv', stats: STATS, results: RESULTS, date: new Date(2026, 9, 1, 8, 5, 3) })
    const json = exportSimulation({ format: 'json', stats: STATS, results: RESULTS })
    const md = exportSimulation({ format: 'md', stats: STATS, results: RESULTS, meta: { strategy: STATS.strategy } })
    // CSV。
    expect(csv.fileName).toBe('liferestart-sim-runs2-seed42-20261001-080503.csv')
    expect(csv.mime).toContain('text/csv')
    expect(csv.text).toContain('序号,寿命')
    // JSON。
    expect(json.mime).toContain('application/json')
    expect(() => JSON.parse(json.text)).not.toThrow()
    // Markdown。
    expect(md.mime).toContain('text/markdown')
    expect(md.text).toContain('# 人生重开模拟器 · 批量模拟报告')
    // 格式列表。
    expect(FORMAT_LIST).toEqual(['csv', 'json', 'md'])
  })

  test('未知格式报错（不静默产出空文件）', () => {
    // 报错信息含可选值。
    expect(() => exportSimulation({ format: 'xml', stats: STATS, results: [] })).toThrow(/不支持的导出格式：xml/)
    // 空 stats 也能导出（容错）。
    expect(() => exportSimulation({ format: 'json', stats: undefined, results: [] })).not.toThrow()
  })
})
