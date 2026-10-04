// @vitest-environment happy-dom
/**
 * TalentDetailList 组件测试 —— 天赋详情列表（名人模式两处共用）
 *
 * 覆盖：
 *   1. 空数组 → 不渲染任何东西（名人可以不带天赋）
 *   2. 逐条渲染：星级（含配色类）/ 名称 / 描述 / 效果 / 额外点数 / 标记
 *   3. 标题里的个数与额外点数合计（名人模式的"额外点数"就是从这些 status 来的）
 *   4. 缺失描述时不编内容（不显示占位废话）
 */
import { describe, test, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TalentDetailList from './TalentDetailList.vue'

// #mountList
// 挂载组件。
//
// @param {Array} talents - 天赋
// @param {object} [props] - 额外 props
// @returns {object} wrapper
function mountList(talents, props = {}) {
  // 挂载。
  return mount(TalentDetailList, { props: { talents, ...props } })
}

describe('TalentDetailList', () => {
  test('空数组：什么都不渲染', () => {
    // 挂载。
    const wrapper = mountList([])
    // 没有容器。
    expect(wrapper.find('.talent-list').exists()).toBe(false)
    // 纯空文本。
    expect(wrapper.text()).toBe('')
  })

  test('逐条渲染：星级 / 名称 / 描述 / 效果 / 点数 / 标记', () => {
    // 三条（覆盖 3 星 / 有条件 / 点数 / 无效果）。
    const wrapper = mountList([
      { id: 'a', name: '半神', description: '所有属性+2', grade: 3, effect: { CHR: 2, RDM: -1 } },
      { id: 'b', name: '需要智力', description: '智力大于3才触发', grade: 1, condition: 'params.INT > 3' },
      { id: 'c', name: '天赋点', description: '多给你点数', grade: 0, status: 2, exclusive: true },
    ], { heading: '曹操的天赋' })
    // 标题：名称 + 个数 + 额外点数合计（+2）。
    const heading = wrapper.find('.heading').text()
    expect(heading).toContain('曹操的天赋')
    expect(heading).toContain('3 个')
    expect(heading).toContain('额外点数 +2')
    // 行数 = 条数。
    const rows = wrapper.findAll('.row')
    expect(rows).toHaveLength(3)
    // 第一条：3 星（金色类）+ 名称 + 描述 + 效果文案（标签来自引擎参数定义）+ 标记。
    expect(rows[0].find('.grade').text()).toBe('3 星')
    expect(rows[0].find('.grade').classes()).toContain('g3')
    expect(rows[0].text()).toContain('半神')
    expect(rows[0].text()).toContain('所有属性+2')
    expect(rows[0].find('.badge.effect').text()).toBe('效果：颜值 +2 · 随机属性 -1')
    // 第二条：有条件标记、无效果徽章。
    expect(rows[1].text()).toContain('有条件')
    expect(rows[1].find('.badge.effect').exists()).toBe(false)
    // 第三条：点数徽章 + 专属标记。
    expect(rows[2].find('.badge.points').text()).toContain('+2')
    expect(rows[2].text()).toContain('专属')
  })

  test('描述缺失：不编内容（该行只有名称与星级）', () => {
    // 一条无描述的。
    const wrapper = mountList([{ id: 'x', name: '无名', grade: 2 }])
    // 描述元素为空。
    expect(wrapper.find('.desc').text()).toBe('')
    // 名称与星级还在。
    expect(wrapper.find('.name').text()).toBe('无名')
    expect(wrapper.find('.grade').text()).toBe('2 星')
  })
})
