// @vitest-environment happy-dom
/**
 * SettingsView 页面测试 —— 设置页（日志等级切换 + 实时日志面板）
 *
 * 覆盖：
 *   1. 五个等级按钮渲染，当前级别高亮
 *   2. 切换等级：store 状态 + localStorage 持久化 + 引擎全链路同步（setLogLevel 被调用）
 *   3. 日志面板显示条数；清空后面板只剩"清空"这一条记录
 *   4. 返回按钮回主页
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import SettingsView from './SettingsView.vue'
import { useGameStore } from '../stores/game.js'
import { resetApp, mountView, stubFetchOk, buildFixtureData } from '../test-utils/setup.js'

// 每个用例前重置。
beforeEach(() => {
  // 重置。
  resetApp()
  stubFetchOk()
})

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

describe('SettingsView', () => {
  test('渲染五个等级按钮，当前级别高亮（默认 info）', () => {
    // 挂载。
    const { wrapper } = mountView(SettingsView)
    // store 默认级别。
    const store = useGameStore()
    expect(store.logLevel).toBe('info')
    // 五个等级按钮。
    const levels = wrapper.findAll('.btn.level')
    expect(levels.length).toBe(5)
    // info 高亮。
    const active = wrapper.find('.btn.level.active')
    expect(active.text()).toBe('info')
  })

  test('切换 trace：状态 + 持久化 + 引擎同步', async () => {
    // 先初始化引擎（setLogLevel 才有对象可同步）。
    const store = useGameStore()
    await store.init(buildFixtureData())
    // 监视引擎同步。
    const syncSpy = vi.spyOn(store.life, 'setLogLevel')
    // 挂载。
    const { wrapper } = mountView(SettingsView)
    // 点 trace。
    await findButton(wrapper, 'trace').trigger('click')
    await flushPromises()
    // store 状态。
    expect(store.logLevel).toBe('trace')
    // 持久化。
    expect(globalThis.localStorage.getItem('logLevel')).toBe('trace')
    // 引擎全链路同步。
    expect(syncSpy).toHaveBeenCalledWith('trace')
    // 高亮切换。
    expect(wrapper.find('.btn.level.active').text()).toBe('trace')
  })

  test('日志面板：显示条数，清空后只剩清空记录', async () => {
    // 准备：写两条日志。
    const store = useGameStore()
    store.pushLog('info', '第一条')
    store.pushLog('warn', '第二条')
    // 挂载。
    const { wrapper } = mountView(SettingsView)
    // 等 onMounted 里的"进入设置页"日志渲染完（挂载后才 push，需要一次 tick）。
    await nextTick()
    // 条数展示（2 条 + 进入设置页那一条 = 3）。
    expect(wrapper.find('.log-count').text()).toContain('条')
    expect(wrapper.findAll('.log-line').length).toBe(store.logBuffer.length)
    expect(store.logBuffer.length).toBe(3)
    // 清空。
    await findButton(wrapper, '清空').trigger('click')
    await flushPromises()
    // 只剩"日志已清空"这条记录。
    expect(store.logBuffer.length).toBe(1)
    expect(store.logBuffer[0]).toContain('清空日志面板')
  })

  test('返回按钮回主页', async () => {
    // 挂载。
    const { wrapper, router } = mountView(SettingsView)
    // 点返回。
    await findButton(wrapper, '返回').trigger('click')
    await flushPromises()
    // 跳转。
    expect(router.currentRoute.value.path).toBe('/')
  })
})
