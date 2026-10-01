// @vitest-environment happy-dom
/**
 * SummaryView 页面测试 —— 人生总结页
 *
 * 这一页是"整列 —"与"重开次数恒 0"的发生地，因此用例直接断言**数据非空**：
 *   1. 未初始化就进入 → 重定向主页（不白屏）
 *   2. 属性评价 7 行都有值，且评价键被翻成中文（不出现 J_Good 原文）
 *   3. 收集统计区渲染（成就达成数 / 天赋选择率 / 事件收集率，比率带 %）
 *   4. 成就列表渲染计数与条目，列表可滚动（固定高度）
 *   5. 点「重开」→ 次数 +1（写入持久化存储）并回主页
 *   6. 点「回主页」→ 跳转主页
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import SummaryView from './SummaryView.vue'
import { useGameStore } from '../stores/game.js'
import { resetApp, mountView, stubFetchOk, buildFixtureData } from '../test-utils/setup.js'

// 每个用例前重置。
beforeEach(() => {
  // 重置。
  resetApp()
  stubFetchOk()
})

// #playedStore
// 造一局"已经推进过几年"的游戏（总结页需要 life + 有数据）。
//
// @param {number} [years] - 推进年数
// @returns {Promise<object>} { store, storage }
async function playedStore(years = 3) {
  // store。
  const store = useGameStore()
  // 初始化 + 确认天赋。
  await store.init(buildFixtureData())
  store.confirmTalents()
  // 开局。
  store.begin({ CHR: 5, INT: 5, STR: 5, MNY: 5 })
  // 拉满生命，避免 0 岁就死（本用例只关心总结页数据）。
  store.life.request('PROPERTY').set('LIF', 100)
  // 推进若干年。
  for (let i = 0; i < years; i++) {
    // 已结束就停。
    if (store.isEnd) break
    // 推进。
    store.next()
  }
  // 返回。
  return store
}

// #findButton
// 按文本找按钮。
function findButton(wrapper, text) {
  // 查找。
  const btn = wrapper.findAll('button').find((b) => b.text().includes(text))
  // 未找到直接失败。
  if (!btn) throw new Error(`未找到按钮：${text}`)
  // 返回。
  return btn
}

describe('SummaryView', () => {
  test('未初始化就进入：重定向主页（不白屏）', async () => {
    // 挂载（store.life 为 null）。
    const { wrapper, router } = mountView(SummaryView)
    await flushPromises()
    // 回主页。
    expect(router.currentRoute.value.path).toBe('/')
    // 界面给出"暂无数据"而不是崩掉（模板始终可渲染）。
    expect(wrapper.text()).toContain('暂无评价数据')
  })

  test('属性评价：七行都有值，评价键翻译为中文', async () => {
    // 造一局。
    await playedStore()
    // 挂载。
    const { wrapper } = mountView(SummaryView)
    await flushPromises()
    // 第一个 section 是属性评价。
    const sectionText = wrapper.findAll('.section')[0].text()
    // 七个中文标签。
    for (const label of ['总评', '最高年龄', '最高颜值', '最高智力', '最高体质', '最高家境', '最高快乐']) {
      expect(sectionText, `${label} 未渲染`).toContain(label)
    }
    // 没有任何一项是占位符（历史 bug：整列 —）。
    expect(sectionText).not.toContain('—')
    expect(sectionText).not.toContain('undefined')
    // 评价键被翻译（J_* 不该出现在界面上）。
    expect(sectionText).not.toContain('J_')
    expect(sectionText).toMatch(/普通|优秀|极佳/)
  })

  test('收集统计：成就达成数 + 比率带百分比', async () => {
    // 造一局。
    await playedStore()
    // 挂载。
    const { wrapper } = mountView(SummaryView)
    await flushPromises()
    // 第二个 section 是收集统计。
    const statsText = wrapper.findAll('.section')[1].text()
    // 三个统计项。
    expect(statsText).toContain('成就达成数')
    expect(statsText).toContain('天赋选择率')
    expect(statsText).toContain('事件收集率')
    // 比率格式化为百分比。
    expect(statsText).toMatch(/\d+\.\d%/)
    // 不出现空值占位。
    expect(statsText).not.toContain('undefined')
  })

  test('成就列表：渲染计数与条目，且为固定高度滚动区', async () => {
    // 造一局。
    await playedStore()
    // 挂载。
    const { wrapper } = mountView(SummaryView)
    await flushPromises()
    // 计数标题形如「成就（0/3）」。
    const achSection = wrapper.findAll('.section')[2]
    expect(achSection.find('h3').text()).toMatch(/成就（\d+\/\d+）/)
    // 条目数与引擎成立列表一致。
    const store = useGameStore()
    expect(achSection.findAll('.ach').length).toBe(store.life.achievements.length)
    // 滚动容器存在（165 条时不会把页面撑爆）。
    expect(achSection.find('.ach-list').exists()).toBe(true)
  })

  test('点「重开」：次数 +1（落盘）并回主页', async () => {
    // 造一局。
    const store = await playedStore()
    // 初始次数。
    expect(store.life.times).toBe(0)
    // 挂载。
    const { wrapper, router } = mountView(SummaryView)
    await flushPromises()
    // 点重开。
    await findButton(wrapper, '重开').trigger('click')
    await flushPromises()
    // 次数 +1。
    expect(store.life.times).toBe(1)
    // 写入持久化存储（跨局累积）。
    expect(globalThis.localStorage.getItem('lifeRestart:times')).toBe('1')
    // 回主页。
    expect(router.currentRoute.value.path).toBe('/')
  })

  test('点「回主页」：跳转主页', async () => {
    // 造一局。
    await playedStore()
    // 挂载。
    const { wrapper, router } = mountView(SummaryView)
    await flushPromises()
    // 点回主页。
    await findButton(wrapper, '回主页').trigger('click')
    await flushPromises()
    // 跳转。
    expect(router.currentRoute.value.path).toBe('/')
  })

  test('重开次数展示（跨局累积后显示历史值）', async () => {
    // 造一局并预设历史次数。
    const store = await playedStore()
    store.life.times = 3
    // 挂载。
    const { wrapper } = mountView(SummaryView)
    await flushPromises()
    // 页头显示次数。
    expect(wrapper.find('.subtitle').text()).toContain('重开次数：3')
  })
})
