/**
 * statistics-view 单元测试 — 统计项展示定义
 *
 * 覆盖（含真实缺陷复盘）：
 *   1. 比率 → 百分比、计数 → 原样、成就数带分母
 *   2. TMS 隐藏（页头已显示"重开次数"）
 *   3. 未登记的键原样返回但标记 known=false
 *   4. **覆盖性**：拿引擎真实的 life.statistics 键逐一核对 ——
 *      引擎新增统计项而界面没跟上（RACHV 就是这样漏成裸键 + 裸浮点）会直接红
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { STATISTICS_VIEW, formatStatistic, isKnownStatistic, statisticsLabel, visibleStatistics } from './statistics-view.js'
// 引擎（用真实 statistics 的键做覆盖性核对）。
import Life from 'game-engine/src/modules/life.js'
import { clone } from 'game-engine/src/functions/util.js'
// fixture 数据。
import { AGE_DATA, TOTAL } from 'game-engine/src/fixtures/property.fixture.js'
import { TALENTS, EVENTS } from 'game-engine/src/fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from 'game-engine/src/fixtures/achievement-character.fixture.js'

describe('statistics-view - 标签与格式化', () => {
  test('每个登记项都有中文标签与非空 kind', () => {
    // 逐项。
    for (const [key, def] of Object.entries(STATISTICS_VIEW)) {
      // 标签必须是中文（不能是内部键名）。
      expect(def.label, key).toMatch(/[\u4e00-\u9fa5]/)
      // kind 合法。
      expect(['count', 'ratio'], key).toContain(def.kind)
    }
  })

  test('比率显示成百分比（一位小数）', () => {
    // 1/165 ≈ 0.00606 → 0.6%（用户看到"RACHV 0.006060606060606061"的那个值）。
    expect(formatStatistic('RACHV', { value: 0.006060606060606061 })).toBe('0.6%')
    // 100% / 0%。
    expect(formatStatistic('RTLT', { value: 1 })).toBe('100.0%')
    expect(formatStatistic('REVT', { value: 0 })).toBe('0.0%')
    // 缺值按 0 处理。
    expect(formatStatistic('RACHV', {})).toBe('0.0%')
  })

  test('计数原样；成就达成数可带分母', () => {
    // 无分母。
    expect(formatStatistic('CACHV', { value: 3 })).toBe('3')
    // 带分母（总结页传成就总数）。
    expect(formatStatistic('CACHV', { value: 1 }, { totalAchievements: 165 })).toBe('1 / 165')
  })

  test('缺项显示占位符', () => {
    // null/undefined。
    expect(formatStatistic('CACHV', null)).toBe('—')
    expect(formatStatistic('CACHV', undefined)).toBe('—')
  })

  test('标签与登记判断', () => {
    // 已登记。
    expect(statisticsLabel('RACHV')).toBe('成就达成率')
    expect(isKnownStatistic('RACHV')).toBe(true)
    // 未登记：原样返回 + false（不会静默吞掉，覆盖性测试会拦住）。
    expect(statisticsLabel('RNEW')).toBe('RNEW')
    expect(isKnownStatistic('RNEW')).toBe(false)
  })
})

describe('statistics-view - visibleStatistics', () => {
  test('隐藏 TMS，其余按引擎顺序输出且格式正确', () => {
    // 引擎形状的统计。
    const statistics = {
      TMS: { value: 7, judge: 'J_Good' },
      CACHV: { value: 1, judge: 'J_Good' },
      RACHV: { value: 0.006060606060606061, judge: 'J_Normal' },
      RTLT: { value: 0.016, judge: 'J_Normal' },
      REVT: { value: 0.009, judge: 'J_Normal' },
    }
    // 转换。
    const rows = visibleStatistics(statistics, { totalAchievements: 165 })
    // TMS 被隐藏。
    expect(rows.map((r) => r.key)).toEqual(['CACHV', 'RACHV', 'RTLT', 'REVT'])
    // 标签。
    expect(rows.map((r) => r.label)).toEqual(['成就达成数', '成就达成率', '天赋选择率', '事件收集率'])
    // 文本。
    expect(rows[0].text).toBe('1 / 165')
    expect(rows[1].text).toBe('0.6%')
    expect(rows[2].text).toBe('1.6%')
    // 评价键带出来（页面翻中文）。
    expect(rows[1].judge).toBe('J_Normal')
    // 全部已登记。
    expect(rows.every((r) => r.known)).toBe(true)
  })

  test('空统计返回空数组（页面显示"暂无统计数据"）', () => {
    // 空。
    expect(visibleStatistics()).toEqual([])
    expect(visibleStatistics({})).toEqual([])
  })
})

describe('statistics-view - 覆盖性（引擎 ↔ 界面一致性）', () => {
  test('引擎 life.statistics 的每个键都必须在展示表里登记', async () => {
    // 造一个真实引擎实例（fixture 数据足够枚举 statistics 的键）。
    const life = new Life({
      // 数据。
      data: {
        age: clone(AGE_DATA),
        total: TOTAL,
        talents: clone(TALENTS),
        events: clone(EVENTS),
        achievements: clone(ACHIEVEMENTS),
        characters: {},
      },
      // 内存存储。
      storage: { getItem: () => null, setItem: () => {} },
    })
    // 初始化 + 配置。
    await life.initial()
    life.config()
    // 引擎暴露的统计键。
    const keys = Object.keys(life.statistics)
    // 至少有内容。
    expect(keys.length).toBeGreaterThan(0)
    // 逐个核对：未登记的键就是"页面会显示内部键名 + 裸值"的那种 bug。
    const missing = keys.filter((key) => !isKnownStatistic(key))
    expect(missing, `以下统计键未在 statistics-view 里登记：${missing.join(', ')}`).toEqual([])
  })
})
