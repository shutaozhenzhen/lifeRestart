// @vitest-environment happy-dom
/**
 * GameView 页面测试 —— 人生轨迹页（紧凑状态栏 / 自动播放 / 完整轨迹 / 死亡停止）
 *
 * 覆盖（其中 3、5、6 直接对应修过的真实 bug）：
 *   1. 紧凑状态栏：年龄 / 生命 / 五维胶囊渲染
 *   2. 挂载即自动播放，按间隔逐年推进并渲染「N 岁」
 *   3. 暂停/继续生效（暂停后不再推进）
 *   4. 速度切换写入 localStorage 且立即生效
 *   5. 手动「下一年」：播放中禁用、暂停后可用
 *   6. 人生结束：自动播放停止、轨迹不再增长、「总结」变可用（历史 bug：死亡后还在继续）
 *   7. 轨迹条目渲染事件描述；向上翻出现「回到最新」
 *   8. 重开：清空选择并回主页
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import GameView from './GameView.vue'
import { useGameStore } from '../stores/game.js'
import { resetApp, mountView, stubFetchOk, buildFixtureData } from '../test-utils/setup.js'

// 每个用例前重置。
beforeEach(() => {
  // 重置。
  resetApp()
  stubFetchOk()
  // 只假造 interval：自动播放用 setInterval，保留真实 setTimeout（flushPromises 依赖它）。
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})

// 每个用例后恢复真实定时器。
afterEach(() => {
  // 恢复。
  vi.useRealTimers()
})

// #readyStore
// 初始化引擎 + 确认天赋（轨迹页挂载时会 begin）。
//
// @returns {Promise<object>} store
async function readyStore() {
  // store。
  const store = useGameStore()
  // 初始化。
  await store.init(buildFixtureData())
  // 天赋确认。
  store.confirmTalents()
  // 分配属性（保证 start 有数据）。
  store.allocation = { CHR: 5, INT: 5, STR: 5, MNY: 5 }
  // 返回。
  return store
}

// #keepAlive
// 拉满生命：fixture 数据里 0 岁就有致死事件，会立刻结束自动播放。
// 需要"连续推进多年"的用例先调用它；"死亡即停"由专门用例验证自然死亡。
//
// @param {object} store - store
// @returns {void}
function keepAlive(store) {
  // 生命拉满。
  store.life.request('PROPERTY').set('LIF', 100)
  // 同步镜像（isEnd/lif）。
  store.sync()
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

describe('GameView', () => {
  test('渲染紧凑状态栏（年龄 / 生命 / 五维胶囊）', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载（onMounted 会 begin 开局）。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 已开局。
    expect(store.started).toBe(true)
    // 状态栏存在。
    expect(wrapper.find('.hud').exists()).toBe(true)
    // 年龄 + 生命 + 五维 = 7 个胶囊。
    expect(wrapper.findAll('.hud .pill').length).toBe(7)
    // 年龄胶囊文案。
    expect(wrapper.find('.hud .pill.age').text()).toContain('岁')
    // 生命胶囊显示 store 镜像值。
    expect(wrapper.find('.hud .pill.lif').text()).toContain(String(store.lif))
  })

  test('挂载即自动播放：按间隔逐年推进并渲染轨迹', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 拉满生命（否则 fixture 的 0 岁致死事件会让播放立刻停止）。
    keepAlive(store)
    // 初始没有轨迹。
    expect(store.history.length).toBe(0)
    // 播放按钮显示"暂停"（说明在播）。
    expect(findButton(wrapper, '暂停').exists()).toBe(true)
    // 推进两个间隔（默认 800ms）。
    await vi.advanceTimersByTimeAsync(1700)
    await flushPromises()
    // 至少两年。
    expect(store.history.length).toBeGreaterThanOrEqual(2)
    // 轨迹逐年渲染。
    expect(wrapper.findAll('.year').length).toBe(store.history.length)
    // 年份标题渲染（0 岁 / 1 岁 …）。
    expect(wrapper.find('.year .year-age').text()).toMatch(/\d+ 岁/)
  })

  test('暂停后不再推进；继续后又开始推进', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 拉满生命。
    keepAlive(store)
    // 先推进一年。
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()
    const afterPlay = store.history.length
    expect(afterPlay).toBeGreaterThanOrEqual(1)
    // 暂停。
    await findButton(wrapper, '暂停').trigger('click')
    await flushPromises()
    // 按钮变回"自动播放"。
    expect(findButton(wrapper, '自动播放').exists()).toBe(true)
    // 再推进多个间隔：轨迹不变。
    await vi.advanceTimersByTimeAsync(3000)
    await flushPromises()
    expect(store.history.length).toBe(afterPlay)
    // 继续播放。
    await findButton(wrapper, '自动播放').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()
    // 又推进了。
    expect(store.history.length).toBeGreaterThan(afterPlay)
  })

  test('速度切换：写入 localStorage 且立即生效', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 拉满生命。
    keepAlive(store)
    // 切到"快"（300ms）。
    await findButton(wrapper, '快').trigger('click')
    await flushPromises()
    // 持久化。
    expect(globalThis.localStorage.getItem('playSpeed')).toBe('fast')
    // 记录切换前的进度。
    const before = store.history.length
    // 推进 350ms：按新间隔应推进一年（旧间隔 800ms 则不会）。
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    expect(store.history.length).toBeGreaterThan(before)
  })

  test('手动「下一年」：播放中禁用、暂停后可用', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 拉满生命（本用例要手动推进，不能被 0 岁致死中断）。
    keepAlive(store)
    // 播放中：禁用。
    expect(findButton(wrapper, '下一年').attributes('disabled')).toBeDefined()
    // 暂停。
    await findButton(wrapper, '暂停').trigger('click')
    await flushPromises()
    // 可用。
    expect(findButton(wrapper, '下一年').attributes('disabled')).toBeUndefined()
    // 手动推进一年。
    const before = store.history.length
    await findButton(wrapper, '下一年').trigger('click')
    await flushPromises()
    expect(store.history.length).toBe(before + 1)
  })

  test('人生结束：自动播放停止、轨迹不再增长、总结可用', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 推进到结束（fixture 数据下死亡事件很早）。
    for (let i = 0; i < 40 && !store.isEnd; i++) {
      await vi.advanceTimersByTimeAsync(900)
    }
    await flushPromises()
    // 已结束。
    expect(store.isEnd).toBe(true)
    // 播放自动停止（按钮回到"自动播放"）。
    expect(findButton(wrapper, '自动播放').exists()).toBe(true)
    // 轨迹冻结。
    const frozen = store.history.length
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(store.history.length).toBe(frozen)
    // 手动推进也被守卫拦住。
    await findButton(wrapper, '下一年').trigger('click')
    await flushPromises()
    expect(store.history.length).toBe(frozen)
    // 「总结」可用。
    expect(findButton(wrapper, '总结').attributes('disabled')).toBeUndefined()
  })

  test('轨迹条目渲染事件文本；向上翻出现「回到最新」', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 拉满生命（本用例要连续推进两年）。
    keepAlive(store)
    // 推进两年（拿到真实事件文本）。
    await vi.advanceTimersByTimeAsync(1700)
    await flushPromises()
    // 至少渲染了一个条目。
    expect(wrapper.findAll('.entry').length).toBeGreaterThan(0)
    // 条目有类型标签（事件/天赋/替换/信息）。
    expect(wrapper.find('.entry .kind').text()).toMatch(/事件|天赋|替换|信息/)
    // 事件条目文本非空。
    const firstEntry = wrapper.find('.entry .text')
    expect(firstEntry.text().length).toBeGreaterThan(0)
    // 构造"用户往上翻"：撑大滚动区并停在顶部。
    const el = wrapper.find('.trace').element
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true })
    el.scrollTop = 0
    // 触发滚动事件。
    await wrapper.find('.trace').trigger('scroll')
    await nextTick()
    // 出现"回到最新"。
    expect(wrapper.find('.jump').exists()).toBe(true)
    // 点击后恢复跟随。
    await wrapper.find('.jump').trigger('click')
    await nextTick()
    expect(wrapper.find('.jump').exists()).toBe(false)
  })

  test('状态栏显示本局随机种子，点击可复制（用于复现）', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 显示的种子 = store 记录的种子。
    expect(wrapper.find('.seed').text()).toContain(String(store.seed))
    // 打桩剪贴板。
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText }, userAgent: 'test-agent' })
    // 点击复制。
    await wrapper.find('.seed').trigger('click')
    await flushPromises()
    // 复制内容就是种子。
    expect(writeText).toHaveBeenCalledWith(String(store.seed))
    // 有"已复制"反馈。
    expect(wrapper.find('.seed').text()).toContain('已复制')
    // 还原全局。
    vi.unstubAllGlobals()
  })

  test('重开：清空选择并回主页', async () => {    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper, router } = mountView(GameView)
    await flushPromises()
    // 点重开。
    await findButton(wrapper, '重开').trigger('click')
    await flushPromises()
    // 选择与分配被清空。
    expect(store.selectedTalents).toEqual([])
    expect(store.allocation).toEqual({ CHR: 0, INT: 0, STR: 0, MNY: 0 })
    // 回主页。
    expect(router.currentRoute.value.path).toBe('/')
  })
})
