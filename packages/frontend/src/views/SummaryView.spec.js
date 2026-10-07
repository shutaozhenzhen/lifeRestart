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
import { useExtensionsStore } from '../stores/extensions.js'
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
    // 收集统计区。
    const statsText = wrapper.find('.statistics').text()
    // 四个条目（TMS 隐藏：页头已显示重开次数）。
    expect(statsText).toContain('成就达成数')
    expect(statsText).toContain('成就达成率')
    expect(statsText).toContain('天赋选择率')
    expect(statsText).toContain('事件收集率')
    // 比率格式化为百分比。
    expect(statsText).toMatch(/\d+\.\d%/)
    // 成就达成数带分母（n / 总数）。
    expect(statsText).toMatch(/\d+ \/ \d+/)
    // 不出现空值占位。
    expect(statsText).not.toContain('undefined')
  })

  test('收集统计：不泄漏引擎内部键名（RACHV 曾裸展示成 0.00606…）', async () => {
    // 造一局。
    await playedStore()
    // 挂载。
    const { wrapper } = mountView(SummaryView)
    await flushPromises()
    // 统计区文本。
    const statsText = wrapper.find('.statistics').text()
    // 不得出现纯大写内部键（TMS / CACHV / RACHV / RTLT / REVT）。
    expect(statsText).not.toMatch(/\b[A-Z]{3,}\b/)
    // 也不得出现长浮点小数（未格式化的比率）。
    expect(statsText).not.toMatch(/0\.\d{5,}/)
    // 而成就达成率必须以百分比出现。
    const rateRow = wrapper.findAll('.statistics .row').find((r) => r.text().includes('成就达成率'))
    expect(rateRow.text()).toMatch(/\d+\.\d%/)
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

  test('显示本局随机种子，可复制（复现入口）', async () => {
    // 造一局。
    const store = await playedStore()
    // 记录种子。
    const seed = store.seed
    // 挂载。
    const { wrapper } = mountView(SummaryView)
    await flushPromises()
    // 页面显示种子。
    expect(wrapper.find('.seed-value').text()).toBe(String(seed))
    // 打桩剪贴板。
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText }, userAgent: 'test-agent' })
    // 点复制。
    await findButton(wrapper, '复制').trigger('click')
    await flushPromises()
    // 复制内容 = 种子。
    expect(writeText).toHaveBeenCalledWith(String(seed))
    // 反馈。
    expect(wrapper.find('.seed-msg').text()).toContain('已复制')
    // 还原。
    vi.unstubAllGlobals()
  })

  test('用此种子再来一局：种子不变、状态重置、跳天赋页', async () => {
    // 造一局。
    const store = await playedStore()
    // 记录种子与旧局痕迹。
    const seed = store.seed
    expect(store.started).toBe(true)
    // 挂载。
    const { wrapper, router } = mountView(SummaryView)
    await flushPromises()
    // 点「用此种子再来一局」。
    await findButton(wrapper, '用此种子再来一局').trigger('click')
    await flushPromises()
    // 同一颗种子。
    expect(store.seed).toBe(seed)
    // 已重置为新一局（未开局、轨迹清空）。
    expect(store.started).toBe(false)
    expect(store.history).toEqual([])
    // 回到天赋页（同种子下抽卡顺序与上一局一致）。
    expect(router.currentRoute.value.path).toBe('/talent')
  })
})

describe('SummaryView - Mod 声明的统计项（2026-10 能力补齐 ③）', () => {
  // 每个用例前清掉外部统计登记（模块级状态，避免用例之间串味）。
  beforeEach(async () => {
    // 动态导入（保持文件顶部 import 最小）。
    const mod = await import('../utils/statistics-view.js')
    // 清。
    mod.clearExternalStatistics()
  })

  test('key 在 life.statistics 里真实存在 → 多出一项（用 Mod 给的标签与 kind）', async () => {
    // 造一局。
    const store = await playedStore()
    // 引擎侧**真的产生**两个统计键（Mod 走 `gameAPI.ui.addStatistic` → `Life.addStatistic`）。
    store.life.addStatistic('MCOUNT', 3, 'J_Normal')
    store.life.addStatistic('MRATIO', 0.5, 'J_Normal')
    // Mod 声明两项（count + ratio）。
    const ext = useExtensionsStore()
    ext.base = {
      pages: [],
      panels: [],
      properties: [],
      stats: [
        { key: 'MCOUNT', label: '我的计数', kind: 'count', mod: 'my-mod' },
        { key: 'MRATIO', label: '我的比率', kind: 'ratio', mod: 'my-mod' },
      ],
    }
    ext.rebuild()
    // 挂载。
    const { wrapper } = mountView(SummaryView)
    await flushPromises()
    // 统计区。
    const statsText = wrapper.find('.statistics').text()
    // 两项都渲染，且用 Mod 的标签。
    expect(statsText).toContain('我的计数')
    expect(statsText).toContain('我的比率')
    // 3 原样；0.5 → 50.0%。
    expect(statsText).toContain('3')
    expect(statsText).toContain('50.0%')
    // 没有 warn。
    expect(store.logBuffer.join('\n')).not.toContain('不在 life.statistics 里')
  })

  test('key 不在 life.statistics 里 → 跳过并记 warn（不留一行永远显示 —）', async () => {
    // 造一局。
    const store = await playedStore()
    // Mod 声明一个引擎不会产生的键。
    const ext = useExtensionsStore()
    ext.base = { pages: [], panels: [], properties: [], stats: [{ key: 'GHOST', label: '幽灵统计', kind: 'count', mod: 'my-mod' }] }
    ext.rebuild()
    // 挂载。
    const { wrapper } = mountView(SummaryView)
    await flushPromises()
    // 没渲染。
    expect(wrapper.find('.statistics').text()).not.toContain('幽灵统计')
    // 有 warn（点名了键与 Mod）。
    const logs = store.logBuffer.join('\n')
    expect(logs).toContain('GHOST')
    expect(logs).toContain('my-mod')
  })

  test('没有 Mod 声明时统计区不变，且不渲染 summary slot 的空壳', async () => {
    // 造一局。
    await playedStore()
    // 挂载。
    const { wrapper } = mountView(SummaryView)
    await flushPromises()
    // 原有四项还在。
    const statsText = wrapper.find('.statistics').text()
    expect(statsText).toContain('成就达成数')
    expect(statsText).toContain('事件收集率')
    // 没有 Mod 面板容器。
    expect(wrapper.find('.mod-panels').exists()).toBe(false)
  })
})
