// @vitest-environment happy-dom
/**
 * AchievementToast 组件测试 — 成就达成提示
 *
 * 覆盖：
 *   1. 队列为空不渲染任何东西（不占位、不挡操作）
 *   2. 推入后渲染「成就达成 + 名称 + 描述 + 星级」
 *   3. 点击关闭
 *   4. **4 秒自动关闭**（假装定时器精确验证）
 *   5. 多条并存，关闭一条不影响其它
 *   6. 卸载时清掉挂起的定时器（避免测试/页面残留定时器）
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import AchievementToast from './AchievementToast.vue'
import { useGameStore } from '../stores/game.js'
import { resetApp, mountView } from '../test-utils/setup.js'

// 每个用例前重置。
beforeEach(() => {
  // 重置 pinia + localStorage。
  resetApp()
})

// 每个用例后恢复真实定时器。
afterEach(() => {
  // 恢复。
  vi.useRealTimers()
})

describe('AchievementToast', () => {
  test('队列为空：什么都不渲染', () => {
    // 挂载。
    const { wrapper } = mountView(AchievementToast)
    // 无浮层。
    expect(wrapper.find('.toast-host').exists()).toBe(false)
    expect(wrapper.findAll('.toast').length).toBe(0)
  })

  test('推入成就后渲染名称、描述与星级', async () => {
    // 挂载。
    const { wrapper } = mountView(AchievementToast)
    // 推一条（3 星）。
    useGameStore().pushAchievementToast({ id: 'ach_1', name: '长命百岁', description: '活到 100 岁', grade: 3 })
    // 等渲染。
    await nextTick()
    // 浮层出现。
    expect(wrapper.find('.toast-host').exists()).toBe(true)
    // 内容。
    expect(wrapper.find('.toast-title').text()).toBe('成就达成')
    expect(wrapper.find('.toast-name').text()).toBe('长命百岁')
    expect(wrapper.find('.toast-desc').text()).toBe('活到 100 岁')
    expect(wrapper.find('.toast-stars').text()).toBe('★★★')
  })

  test('点击关闭', async () => {
    // 挂载 + 推入。
    const { wrapper } = mountView(AchievementToast)
    const store = useGameStore()
    store.pushAchievementToast({ id: 'ach_1', name: 'A', grade: 1 })
    await nextTick()
    expect(wrapper.findAll('.toast').length).toBe(1)
    // 点击卡片。
    await wrapper.find('.toast').trigger('click')
    await nextTick()
    // store 与 DOM 都清掉了。
    expect(store.achievementToasts).toEqual([])
    expect(wrapper.find('.toast-host').exists()).toBe(false)
  })

  test('4 秒后自动关闭（假装定时器验证）', async () => {
    // 假装定时器（要先于挂载，watcher 才会用假定时器）。
    vi.useFakeTimers()
    // 挂载 + 推入。
    const { wrapper } = mountView(AchievementToast)
    const store = useGameStore()
    store.pushAchievementToast({ id: 'ach_1', name: 'A', grade: 1 })
    await nextTick()
    // 刚推入时在。
    expect(wrapper.findAll('.toast').length).toBe(1)
    // 差一点（3999ms）仍在。
    await vi.advanceTimersByTimeAsync(3999)
    await nextTick()
    expect(wrapper.findAll('.toast').length).toBe(1)
    // 到 4000ms 自动消失。
    await vi.advanceTimersByTimeAsync(1)
    await nextTick()
    expect(wrapper.findAll('.toast').length).toBe(0)
    expect(store.achievementToasts).toEqual([])
  })

  test('多条并存：关闭一条不影响其它', async () => {
    // 挂载 + 推两条。
    const { wrapper } = mountView(AchievementToast)
    const store = useGameStore()
    store.pushAchievementToast({ id: 'ach_1', name: 'A', grade: 1 })
    store.pushAchievementToast({ id: 'ach_2', name: 'B', grade: 2 })
    await nextTick()
    // 两条都渲染（各自一张卡）。
    expect(wrapper.findAll('.toast').length).toBe(2)
    expect(wrapper.text()).toContain('A')
    expect(wrapper.text()).toContain('B')
    // 关掉第一条。
    await wrapper.findAll('.toast')[0].trigger('click')
    await nextTick()
    // 只剩第二条。
    expect(wrapper.findAll('.toast').length).toBe(1)
    expect(wrapper.text()).toContain('B')
    expect(wrapper.text()).not.toContain('A')
  })

  test('卸载时清掉挂起的自动关闭定时器', async () => {
    // 假装定时器。
    vi.useFakeTimers()
    // 挂载 + 推入（会安排一个 4s 定时器）。
    const { wrapper } = mountView(AchievementToast)
    useGameStore().pushAchievementToast({ id: 'ach_1', name: 'A', grade: 0 })
    await nextTick()
    // 有 1 个挂起定时器。
    expect(vi.getTimerCount()).toBe(1)
    // 卸载组件。
    wrapper.unmount()
    // 定时器已清理（页面/测试不再残留）。
    expect(vi.getTimerCount()).toBe(0)
  })
})
