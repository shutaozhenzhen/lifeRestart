/**
 * talent-view / property-labels 单元测试 —— 天赋展示文案
 *
 * 覆盖：
 *   1. 星级文案与样式类（含坏值兜底）
 *   2. 额外点数（引擎的 status 字段）
 *   3. 标记（有条件 / 专属 / 替换链）
 *   4. 属性效果文案（走 property-labels，键从**引擎参数定义**取标签）
 *   5. 悬浮提示拼装
 *   6. **真实数据守卫**：184 条天赋里出现的每个 effect 键都必须有中文标签，
 *      且每条都有描述与星级（否则界面上会出现裸英文键或空白行）
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { talentBonusPoints, talentDetail, talentGradeClass, talentGradeText, talentTags, talentTooltip } from './talent-view.js'
import { PROPERTY_LABELS, formatEffect, propertyLabel } from './property-labels.js'
// 真实数据（node 环境可用：该模块只依赖 node:fs 与引擎工具）。
import { loadRealData } from '../test-utils/real-data.js'

describe('talent-view - 星级', () => {
  test('文案与样式类', () => {
    // 正常值。
    expect(talentGradeText(3)).toBe('3 星')
    expect(talentGradeClass(3)).toBe('g3')
    expect(talentGradeClass(0)).toBe('g0')
    // 坏值：按 0 星（不像素级兜底的话会渲染出 gNaN 这种没有样式的类）。
    expect(talentGradeClass(undefined)).toBe('g0')
    expect(talentGradeClass('x')).toBe('g0')
    // 超范围夹到 0~3。
    expect(talentGradeClass(9)).toBe('g3')
    expect(talentGradeClass(-2)).toBe('g0')
  })
})

describe('talent-view - 点数与标记', () => {
  test('额外点数取引擎的 status 字段', () => {
    // 有加成。
    expect(talentBonusPoints({ status: 2 })).toBe(2)
    // 负加成（真实数据里确实有 -20 这种）。
    expect(talentBonusPoints({ status: -3 })).toBe(-3)
    // 缺失/非法 → 0。
    expect(talentBonusPoints({})).toBe(0)
    expect(talentBonusPoints({ status: 'x' })).toBe(0)
    expect(talentBonusPoints(null)).toBe(0)
  })

  test('标记：有条件 / 专属 / 替换链', () => {
    // 全有。
    expect(talentTags({ condition: 'params.CHR > 5', exclusive: true, replacement: { grade: {} } }))
      .toEqual(['有条件', '专属', '替换链'])
    // 都没有。
    expect(talentTags({})).toEqual([])
  })
})

describe('talent-view - 效果文案（标签来自引擎参数定义）', () => {
  test('propertyLabel 取引擎的 label，未登记的原样返回', () => {
    // 引擎 params.js 里的标签。
    expect(propertyLabel('CHR')).toBe('颜值')
    expect(propertyLabel('SPR')).toBe('快乐')
    expect(propertyLabel('RDM')).toBe('随机属性')
    // 未登记的键不猜。
    expect(propertyLabel('NOPE')).toBe('NOPE')
  })

  test('formatEffect：正数补 +、负数原样、非数字忽略', () => {
    // 混合。
    expect(formatEffect({ CHR: 1, RDM: -1 })).toBe('颜值 +1 · 随机属性 -1')
    // 空/非对象。
    expect(formatEffect(null)).toBe('')
    expect(formatEffect({})).toBe('')
    // 非数字项被忽略（不显示 NaN）。
    expect(formatEffect({ CHR: 2, BAD: 'x' })).toBe('颜值 +2')
  })

  test('talentDetail 组装展示信息（名称缺失兜底成 ID）', () => {
    // 完整。
    const d = talentDetail({ id: '1002', name: '红肚兜', description: '小时候死亡率降低', grade: 0, status: 1 })
    expect(d).toMatchObject({ id: '1002', name: '红肚兜', gradeText: '0 星', gradeClass: 'g0', points: 1 })
    expect(d.description).toBe('小时候死亡率降低')
    // 名称缺失。
    expect(talentDetail({ id: '999' }).name).toBe('999')
  })

  test('talentTooltip：多行提示含描述/效果/点数/标记', () => {
    // 组织一条。
    const text = talentTooltip({ id: 'x', name: '橙色转盘', description: '变成随机橙色天赋', grade: 2, status: 2, exclusive: true })
    // 逐项。
    expect(text.split('\n')[0]).toBe('2 星 橙色转盘')
    expect(text).toContain('变成随机橙色天赋')
    expect(text).toContain('额外点数：+2')
    expect(text).toContain('专属')
  })
})

describe('talent-view - 真实数据守卫', () => {
  test('每条天赋都有描述与星级；effect 的每个键都有中文标签', () => {
    // 真实数据。
    const data = loadRealData()
    // 天赋列表。
    const talents = Object.values(data.talents)
    // 规模（防止数据没加载到就"通过"）。
    expect(talents.length).toBeGreaterThan(100)
    // 缺标签的 effect 键（界面会显示裸英文键）。
    const missingLabels = new Set()
    // 缺描述的。
    const missingDesc = []
    // 缺星级的。
    const missingGrade = []
    // 逐条。
    for (const t of talents) {
      // 描述。
      if (!t.description) missingDesc.push(t.id)
      // 星级。
      if (t.grade === undefined || t.grade === null) missingGrade.push(t.id)
      // 效果键。
      for (const key of Object.keys(t.effect || {})) {
        // 不在标签表里。
        if (!(key in PROPERTY_LABELS)) missingLabels.add(key)
      }
    }
    // 断言（把缺的打出来，便于定位）。
    expect(missingDesc, `这些天赋没有描述：${missingDesc.slice(0, 5).join(', ')}`).toEqual([])
    expect(missingGrade, `这些天赋没有星级：${missingGrade.slice(0, 5).join(', ')}`).toEqual([])
    expect([...missingLabels], `这些效果键没有中文标签：${[...missingLabels].join(', ')}`).toEqual([])
  })
})
