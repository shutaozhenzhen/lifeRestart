// @vitest-environment happy-dom
/**
 * CharacterView 页面测试 —— 名人选择页（名人模式）
 *
 * 覆盖：
 *   1. 抽之前不渲染卡片；抽取后卡片数 = 候选名人数（fixture 3 位）
 *   2. 卡片显示姓名 / 四维 / 自带天赋
 *   3. 点选一位：高亮 + 顶部"已选"提示 + store 写入（基础属性 / 已选天赋 / 额外点数）
 *   4. 再点同一位 = 取消选择
 *   5. 未选就下一步 → 提示；选了 → 跳 /property
 *   6. 「换一批」重新抽
 *   7. 唯一「我」：连点若干次解锁后出现神秘卡，可选中
 *   8. 无内容 Mod（没有名人数据）：抽之前就提示，按钮禁用
 */
import { describe, test, expect, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import CharacterView from './CharacterView.vue'
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
// 初始化引擎（名人页需要 life 才能抽名人）。
//
// @param {object} [data] - 数据（缺省 fixture）
// @returns {Promise<object>} store
async function readyStore(data = buildFixtureData()) {
  // store。
  const store = useGameStore()
  // 名人模式。
  store.setMode('celebrity')
  // 初始化。
  await store.init(data)
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

describe('CharacterView', () => {
  test('抽之前不渲染卡片', async () => {
    // 准备。
    await readyStore()
    // 挂载。
    const { wrapper } = mountView(CharacterView)
    // 没有卡片。
    expect(wrapper.findAll('.card')).toHaveLength(0)
    // 标题与按钮。
    expect(wrapper.find('.title').text()).toBe('名人模式')
    expect(findButton(wrapper, '抽取名人').exists()).toBe(true)
  })

  test('抽取：3 张候选卡（姓名 / 四维 / 自带天赋）', async () => {
    // 准备。
    await readyStore()
    // 挂载。
    const { wrapper } = mountView(CharacterView)
    // 抽。
    await findButton(wrapper, '抽取名人').trigger('click')
    // 三张卡。
    expect(wrapper.findAll('.card')).toHaveLength(3)
    // 姓名。
    const text = wrapper.text()
    expect(text).toContain('秦始皇')
    expect(text).toContain('李白')
    // 四维与天赋。
    expect(wrapper.findAll('.props').length).toBe(3)
    expect(wrapper.findAll('.talent-chip').length).toBeGreaterThan(0)
  })

  test('点选一位：高亮 + 提示 + store 写入基础属性与天赋', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(CharacterView)
    // 抽。
    await findButton(wrapper, '抽取名人').trigger('click')
    // 点第一张。
    await wrapper.findAll('.card')[0].trigger('click')
    // 高亮。
    expect(wrapper.findAll('.card')[0].classes()).toContain('selected')
    // store 写入。
    expect(store.character).not.toBeNull()
    expect(store.selectedTalents.length).toBeGreaterThan(0)
    // 基础属性已解析成数字（fixture 里是数字，真实数据里是字符串 —— 见 store 用例）。
    expect(typeof store.characterBase.CHR).toBe('number')
    // 顶部已选提示。
    expect(wrapper.find('.picked').text()).toContain(store.character.name)
    // 额外点数已写进提示（文案含"额外可分配"）。
    expect(wrapper.find('.picked').text()).toContain('额外可分配')
  })

  test('再点同一位 = 取消选择', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(CharacterView)
    // 抽 + 选。
    await findButton(wrapper, '抽取名人').trigger('click')
    await wrapper.findAll('.card')[0].trigger('click')
    // 再点一次。
    await wrapper.findAll('.card')[0].trigger('click')
    // 已取消。
    expect(store.character).toBeNull()
    expect(wrapper.findAll('.card')[0].classes()).not.toContain('selected')
  })

  test('未选就下一步 → 提示；选了 → 跳 /property', async () => {
    // 准备。
    await readyStore()
    // 挂载。
    const { wrapper, router } = mountView(CharacterView)
    // 抽但不选。
    await findButton(wrapper, '抽取名人').trigger('click')
    // 未选也允许点（点了给提示，而不是给一个不会解释原因的禁用按钮）。
    expect(findButton(wrapper, '下一步').attributes('disabled')).toBeUndefined()
    await findButton(wrapper, '下一步').trigger('click')
    // 提示 + 没跳走。
    expect(wrapper.find('.message').text()).toContain('请先选一位名人')
    expect(router.currentRoute.value.path).toBe('/')
    // 选一位再走。
    await wrapper.findAll('.card')[0].trigger('click')
    await findButton(wrapper, '下一步').trigger('click')
    await flushPromises()
    // 到属性分配页。
    expect(router.currentRoute.value.path).toBe('/property')
  })

  test('「换一批」重新抽取（按钮文案变化 + 仍是候选数量）', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(CharacterView)
    // 第一次抽。
    await findButton(wrapper, '抽取名人').trigger('click')
    // 按钮变成「换一批」。
    expect(findButton(wrapper, '换一批').exists()).toBe(true)
    // 再抽。
    await findButton(wrapper, '换一批').trigger('click')
    // 仍是候选数量（fixture 只有 3 位名人 → 每批都是这 3 位）。
    expect(store.characters).toHaveLength(3)
    expect(wrapper.findAll('.card')).toHaveLength(3)
  })

  test('唯一「我」：连点解锁后出现神秘卡，可选中', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(CharacterView)
    // 连点 10 次（引擎侧：10 秒内连点 10 次解锁）。
    for (let i = 0; i < 10; i++) {
      // 抽一批（第一次按钮是"抽取名人"）。
      const label = i === 0 ? '抽取名人' : '换一批'
      await findButton(wrapper, label).trigger('click')
    }
    // 解锁。
    expect(store.uniqueUnlocked).toBe(true)
    // 神秘卡出现。
    const unique = wrapper.find('.card.unique')
    expect(unique.exists()).toBe(true)
    // 选中（属性/天赋随机生成）。
    await unique.trigger('click')
    expect(store.character.id).toBe('unique')
    expect(store.character.name).toBe('我')
  })

  test('选定名人后：显示 TA 的天赋详情（星级 / 描述 / 效果 / 标记）', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(CharacterView)
    // 抽 + 选第一位。
    await findButton(wrapper, '抽取名人').trigger('click')
    await wrapper.findAll('.card')[0].trigger('click')
    // 详情列表出现（公共组件 TalentDetailList）。
    const list = wrapper.find('.talent-list')
    expect(list.exists()).toBe(true)
    // 标题带名人名与个数。
    expect(list.find('.heading').text()).toContain(store.character.name)
    expect(list.find('.heading').text()).toContain(`${store.character.talent.length} 个`)
    // 逐条与 store 里的天赋一一对应，且显示的是**真实描述**（不是只显示名字）。
    const rows = list.findAll('.row')
    expect(rows.length).toBe(store.character.talent.length)
    for (let i = 0; i < rows.length; i++) {
      // 对应的天赋。
      const t = store.character.talent[i]
      // 名称。
      expect(rows[i].text()).toContain(t.name)
      // 星级文案（如 "1 星"）。
      expect(rows[i].text()).toContain(`${t.grade} 星`)
      // 描述。
      if (t.description) expect(rows[i].text()).toContain(t.description)
      // 效果（如 "效果：智力 +1"）。
      if (t.effect) expect(rows[i].text()).toContain('效果：')
      // 有条件的天赋要有标记。
      if (t.condition) expect(rows[i].text()).toContain('有条件')
    }
    // 卡片上的天赋胶囊：带星级，且悬浮提示里能读到描述。
    const chip = wrapper.findAll('.talent-chip')[0]
    expect(chip.text()).toContain('★')
    expect(chip.attributes('title')).toContain('星')
  })

  test('未选名人时不显示天赋详情列表', async () => {
    // 准备。
    await readyStore()
    // 挂载。
    const { wrapper } = mountView(CharacterView)
    // 抽但不选。
    await findButton(wrapper, '抽取名人').trigger('click')
    // 没有详情列表。
    expect(wrapper.find('.talent-list').exists()).toBe(false)
  })

  test('无内容：抽之前就提示"无可用名人"，抽取按钮禁用', async () => {
    // 准备：空内容（所有 Mod 关闭）。
    await readyStore(buildEmptyData())
    // 挂载。
    const { wrapper } = mountView(CharacterView)
    // 提示。
    expect(wrapper.text()).toContain('无可用名人')
    // 按钮禁用。
    expect(findButton(wrapper, '抽取名人').attributes('disabled')).toBeDefined()
    // 没有卡片。
    expect(wrapper.findAll('.card')).toHaveLength(0)
  })
})
