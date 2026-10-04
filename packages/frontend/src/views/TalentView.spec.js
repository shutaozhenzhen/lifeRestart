// @vitest-environment happy-dom
/**
 * TalentView 页面测试 —— 天赋选择页
 *
 * 覆盖：
 *   1. 抽卡前不渲染卡片；抽卡后卡片数 = 天赋池大小
 *   2. 点卡片选中/取消（store 同步 + 选中样式）
 *   3. 选满上限后点第 4 张 → 提示"最多选择 N 个天赋"
 *   4. 互斥失败 → 显示引擎返回的原因（用替身驱动分支，避免依赖 fixture 里恰好有互斥对）
 *   5. 未选满时「下一步」禁用；选满后可用
 *   6. 选满后「下一步」→ 调用 confirmTalents（remake）并跳属性页
 *   7. 无内容 Mod（所有 Mod 关闭）：抽卡前就提示无可用天赋
 *
 * 回归点：以前「所有 Mod 关闭」时降级到引擎测试 fixture，天赋池里是
 * 「填充天赋1/2/3」这类占位数据，而且界面上没有任何解释。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import TalentView from './TalentView.vue'
import { useGameStore } from '../stores/game.js'
import { resetApp, mountView, stubFetchOk, buildFixtureData } from '../test-utils/setup.js'
import { buildEmptyData } from '../utils/game-data.js'

// 每个用例前重置。
beforeEach(() => {
  // 重置 pinia/localStorage/fetch。
  resetApp()
  stubFetchOk()
})

// #readyStore
// 初始化引擎（天赋页需要 life 才能抽卡）。
//
// @returns {Promise<object>} store
async function readyStore() {
  // store。
  const store = useGameStore()
  // 初始化。
  await store.init(buildFixtureData())
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

// #selectEnough
// 依次点卡片直到选满（跳过互斥失败的）。
//
// @param {object} wrapper - 挂载结果
// @param {object} store - store
// @returns {Promise<void>}
async function selectEnough(wrapper, store) {
  // 上限。
  const limit = store.life.talentSelectLimit
  // 逐张点。
  for (let i = 0; i < store.talentPool.length && store.selectedTalents.length < limit; i++) {
    // 点第 i 张。
    await wrapper.findAll('.card')[i].trigger('click')
  }
}

describe('TalentView', () => {
  test('抽卡前无卡片、抽卡后卡片数 = 天赋池大小', async () => {
    // 准备。
    await readyStore()
    // 挂载。
    const { wrapper } = mountView(TalentView)
    // 抽卡前。
    expect(wrapper.findAll('.card').length).toBe(0)
    // 抽卡。
    await findButton(wrapper, '十连抽').trigger('click')
    // store 池非空。
    const store = useGameStore()
    expect(store.talentPool.length).toBeGreaterThan(0)
    // 卡片渲染。
    expect(wrapper.findAll('.card').length).toBe(store.talentPool.length)
    // 显示已选 X/3。
    expect(wrapper.find('.subtitle').text()).toContain(`0/${store.life.talentSelectLimit}`)
  })

  test('点卡片选中/取消（store 同步 + 选中样式）', async () => {
    // 准备 + 抽卡。
    const store = await readyStore()
    const { wrapper } = mountView(TalentView)
    await findButton(wrapper, '十连抽').trigger('click')
    // 第一张卡片。
    const first = wrapper.findAll('.card')[0]
    // 点击 → 选中。
    await first.trigger('click')
    expect(store.selectedTalents).toEqual([store.talentPool[0].id])
    expect(wrapper.findAll('.card')[0].classes()).toContain('selected')
    // 再点 → 取消。
    await wrapper.findAll('.card')[0].trigger('click')
    expect(store.selectedTalents).toEqual([])
    expect(wrapper.findAll('.card')[0].classes()).not.toContain('selected')
  })

  test('选满上限后点第 4 张：提示最多选择 N 个', async () => {
    // 准备 + 抽卡。
    const store = await readyStore()
    const { wrapper } = mountView(TalentView)
    await findButton(wrapper, '十连抽').trigger('click')
    // 选满。
    await selectEnough(wrapper, store)
    const limit = store.life.talentSelectLimit
    expect(store.selectedTalents.length).toBe(limit)
    // 找一张未选中的卡片点击。
    const candidates = wrapper.findAll('.card')
    const spare = candidates.find((c) => !c.classes().includes('selected'))
    await spare.trigger('click')
    // 提示上限。
    expect(wrapper.find('.message').text()).toContain(`最多选择 ${limit} 个天赋`)
    // 选择数不变。
    expect(store.selectedTalents.length).toBe(limit)
  })

  test('互斥失败：显示引擎给出的原因', async () => {
    // 准备 + 抽卡。
    const store = await readyStore()
    const { wrapper } = mountView(TalentView)
    await findButton(wrapper, '十连抽').trigger('click')
    // 让引擎的互斥判定返回冲突（避免依赖 fixture 里恰好存在互斥对）。
    vi.spyOn(store, 'selectTalent').mockReturnValue({ ok: false, message: '与 talent_x 互斥' })
    // 点卡片。
    await wrapper.findAll('.card')[0].trigger('click')
    // 提示渲染出来。
    expect(wrapper.find('.message').text()).toBe('与 talent_x 互斥')
    // 没有被选中。
    expect(store.selectedTalents).toEqual([])
  })

  test('未选满时「下一步」禁用；选满后可用', async () => {
    // 准备 + 抽卡。
    const store = await readyStore()
    const { wrapper } = mountView(TalentView)
    await findButton(wrapper, '十连抽').trigger('click')
    // 未选满：禁用。
    expect(findButton(wrapper, '下一步').attributes('disabled')).toBeDefined()
    // 选满。
    await selectEnough(wrapper, store)
    // 可用。
    expect(findButton(wrapper, '下一步').attributes('disabled')).toBeUndefined()
  })

  test('选满后「下一步」：确认天赋（remake）并跳属性页', async () => {
    // 准备 + 抽卡。
    const store = await readyStore()
    const { wrapper, router } = mountView(TalentView)
    await findButton(wrapper, '十连抽').trigger('click')
    await selectEnough(wrapper, store)
    // 监视确认动作（属性页读数依赖它先执行）。
    const confirmSpy = vi.spyOn(store, 'confirmTalents')
    // 下一步。
    await findButton(wrapper, '下一步').trigger('click')
    await flushPromises()
    // 已确认天赋。
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    // 跳转属性页。
    expect(router.currentRoute.value.path).toBe('/property')
  })

  test('没有内容 Mod：抽卡前就提示无可用天赋（不会凭空造出天赋）', async () => {
    // 空内容数据 —— 这就是「所有 Mod 关闭」时的真实形态。
    const store = useGameStore()
    await store.init(buildEmptyData())
    // 数据源（页面把它一起显示，便于判断为什么是空的）。
    store.dataSource = '空内容（lifeRestart-data 已禁用）'
    // 挂载（**不抽卡**）。
    const { wrapper } = mountView(TalentView)
    // 抽卡前就有提示。
    expect(wrapper.find('.message').text()).toContain('无可用天赋')
    expect(wrapper.find('.message').text()).toContain('lifeRestart-data')
    expect(wrapper.find('.message').text()).toContain('空内容')
    // 抽卡后仍是空池（引擎不内置内容，也没有"填充天赋"兜底）。
    await findButton(wrapper, '十连抽').trigger('click')
    expect(store.talentPool).toEqual([])
    expect(wrapper.findAll('.card').length).toBe(0)
  })
})
