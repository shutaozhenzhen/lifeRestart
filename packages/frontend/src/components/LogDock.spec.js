// @vitest-environment happy-dom
/**
 * LogDock 组件测试 —— 全局日志悬浮窗
 *
 * 这一层是"问题可带出"的关键交互，覆盖：
 *   1. 默认折叠：只有悬浮按钮，无面板；角标显示错误/警告数
 *   2. 收放：点按钮展开、点 ✕ 收起；Ctrl+Shift+L 快捷键收放
 *   3. 出现 error 级日志自动展开（用户遇到问题的当下就能导出）
 *   4. 级别过滤：全部 / 错误 / 警告 / 信息
 *   5. 复制：成功给反馈；剪贴板不可用时提示改用下载
 *   6. 下载：触发文件下载并给反馈
 *   7. 清空：缓冲清空并留下一条清空记录
 *   8. 报告内容：复制出去的文本含环境信息与全部日志
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import LogDock from './LogDock.vue'
import { useGameStore } from '../stores/game.js'
import { resetApp, mountView } from '../test-utils/setup.js'

// 每个用例前重置。
beforeEach(() => {
  // 重置 pinia + localStorage。
  resetApp()
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

describe('LogDock', () => {
  test('默认折叠：只有悬浮按钮；角标显示错误/警告数', async () => {
    // store 写日志。
    const store = useGameStore()
    store.pushLog('info', '普通信息')
    store.pushLog('warn', '一个警告')
    store.pushLog('error', '一个错误')
    // 挂载。
    const { wrapper } = mountView(LogDock)
    // 折叠：无面板、有按钮。
    expect(wrapper.find('.panel').exists()).toBe(false)
    expect(wrapper.find('.fab').exists()).toBe(true)
    // 角标：有错误时优先显示错误数。
    expect(wrapper.find('.fab-badge').text()).toBe('1')
    // 按钮高亮为告警态。
    expect(wrapper.find('.fab').classes()).toContain('alert')
  })

  test('点按钮展开、点 ✕ 收起', async () => {
    // 挂载。
    const { wrapper } = mountView(LogDock)
    // 展开。
    await wrapper.find('.fab').trigger('click')
    await nextTick()
    expect(wrapper.find('.panel').exists()).toBe(true)
    // 面板里显示条数统计。
    expect(wrapper.find('.badge.total').text()).toContain('条')
    // 收起。
    await wrapper.find('.icon-btn').trigger('click')
    await nextTick()
    expect(wrapper.find('.panel').exists()).toBe(false)
  })

  test('快捷键 Ctrl+Shift+L 收放', async () => {
    // 挂载。
    const { wrapper } = mountView(LogDock)
    // 按下快捷键。
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'l', ctrlKey: true, shiftKey: true }))
    await nextTick()
    // 展开。
    expect(wrapper.find('.panel').exists()).toBe(true)
    // 再按一次。
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'L', ctrlKey: true, shiftKey: true }))
    await nextTick()
    // 收起。
    expect(wrapper.find('.panel').exists()).toBe(false)
  })

  test('出现 error 级日志：自动展开', async () => {
    // 挂载（初始折叠）。
    const { wrapper } = mountView(LogDock)
    expect(wrapper.find('.panel').exists()).toBe(false)
    // 引擎/页面写入一条错误（模拟异常捕获）。
    useGameStore().pushLog('error', '[异常] 未捕获错误: boom')
    // 等 watch 生效。
    await nextTick()
    await flushPromises()
    // 自动展开，用户当下就能导出。
    expect(wrapper.find('.panel').exists()).toBe(true)
  })

  test('级别过滤：全部 / 错误 / 警告 / 信息', async () => {
    // 写三类日志。
    const store = useGameStore()
    store.pushLog('info', '信息一')
    store.pushLog('warn', '警告一')
    store.pushLog('error', '错误一')
    // 挂载并展开。
    const { wrapper } = mountView(LogDock)
    await wrapper.find('.fab').trigger('click')
    await nextTick()
    // 全部。
    expect(wrapper.findAll('.line').length).toBe(3)
    // 只看错误。
    await findButton(wrapper, '错误').trigger('click')
    await nextTick()
    expect(wrapper.findAll('.line').length).toBe(1)
    expect(wrapper.find('.line').text()).toContain('错误一')
    // 只看警告。
    await findButton(wrapper, '警告').trigger('click')
    await nextTick()
    expect(wrapper.findAll('.line').length).toBe(1)
    expect(wrapper.find('.line').text()).toContain('警告一')
    // 信息（含 debug/trace）。
    await findButton(wrapper, '信息').trigger('click')
    await nextTick()
    expect(wrapper.findAll('.line').length).toBe(1)
    expect(wrapper.find('.line').text()).toContain('信息一')
  })

  test('复制：成功给反馈；不可用时提示改用下载', async () => {
    // 写一条日志，便于断言复制内容。
    const store = useGameStore()
    store.pushLog('info', '[UI][home] 开始新人生')
    // 挂载并展开。
    const { wrapper } = mountView(LogDock)
    await wrapper.find('.fab').trigger('click')
    await nextTick()
    // 成功路径：注入剪贴板。
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText }, userAgent: 'test-agent' })
    await findButton(wrapper, '复制').trigger('click')
    await flushPromises()
    // 反馈成功。
    expect(wrapper.find('.feedback').text()).toContain('已复制')
    // 复制内容 = 完整报告（含头部与日志）。
    const text = writeText.mock.calls[0][0]
    expect(text).toContain('===== 人生重开模拟器 日志报告 =====')
    expect(text).toContain('[UI][home] 开始新人生')
    // 失败路径：没有剪贴板也没有 execCommand 回退。
    vi.stubGlobal('navigator', {})
    const doc = { body: {}, execCommand: undefined }
    vi.spyOn(globalThis, 'document', 'get').mockReturnValue(doc)
    await findButton(wrapper, '复制').trigger('click')
    await flushPromises()
    expect(wrapper.find('.feedback').text()).toContain('复制失败')
    // 还原 document。
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('下载：触发 Blob 下载并给反馈', async () => {
    // 写日志。
    useGameStore().pushLog('info', '待下载日志')
    // 挂载并展开。
    const { wrapper } = mountView(LogDock)
    await wrapper.find('.fab').trigger('click')
    await nextTick()
    // 打桩 URL 与锚点点击。
    const revoke = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:log')
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke)
    const clickSpy = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    // 点下载。
    await findButton(wrapper, '下载').trigger('click')
    await flushPromises()
    // 反馈。
    expect(wrapper.find('.feedback').text()).toContain('已开始下载')
    // 真正生成了对象 URL 并触发了点击。
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    // 还原。
    vi.restoreAllMocks()
  })

  test('清空：缓冲清空并留下一条清空记录', async () => {
    // 写两条。
    const store = useGameStore()
    store.pushLog('info', 'a')
    store.pushLog('error', 'b')
    // 挂载并展开。
    const { wrapper } = mountView(LogDock)
    await wrapper.find('.fab').trigger('click')
    await nextTick()
    // 清空。
    await findButton(wrapper, '清空').trigger('click')
    await nextTick()
    // 只剩清空记录。
    expect(store.logBuffer.length).toBe(1)
    expect(store.logBuffer[0]).toContain('日志已清空')
    // 角标消失（没有错误了）。
    expect(wrapper.find('.fab-badge').exists()).toBe(false)
  })
})
