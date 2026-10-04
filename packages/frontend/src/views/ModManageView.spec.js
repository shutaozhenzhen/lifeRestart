// @vitest-environment happy-dom
/**
 * ModManageView 页面测试 —— Mod 管理页
 *
 * 覆盖：
 *   1. 渲染 Mod 列表；系统 Mod 无删除按钮（显示"系统内置"），非系统 Mod 有删除按钮
 *   2. 启停：状态写入 localStorage（modsState），刷新后保留
 *   3. 权限弹窗：启用带权限的 Mod → 弹窗 → 「允许」关闭并记录
 *   4. 删除：confirm 确认后移除并记入 removed（持久化）；系统 Mod 不可删
 *   5. AI 配置：切服务商填充 baseUrl/model；Key 写入 localStorage；未配 Key 启用时提示
 *   6. 连接测试：成功/失败两条分支都在界面上给出结果
 *   7. 「查看数据」进 Mod 数据详情页（用**目录名**寻址）
 *   8. 返回按钮回主页
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ModManageView from './ModManageView.vue'
import { resetApp, mountView, stubFetchOk } from '../test-utils/setup.js'

// 每个用例前重置。
beforeEach(() => {
  // 重置 pinia/localStorage/fetch。
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

// #modRow
// 取某个 Mod 所在的卡片。
//
// @param {object} wrapper - 挂载结果
// @param {string} name - Mod 名
// @returns {object} 卡片 wrapper
function modRow(wrapper, name) {
  // 查找。
  const row = wrapper.findAll('.mod').find((m) => m.find('.mod-name').text().includes(name))
  // 未找到直接失败。
  if (!row) throw new Error(`未找到 Mod：${name}`)
  // 返回。
  return row
}

// #savedState
// 读取持久化的 Mod 状态。
function savedState() {
  // 解析。
  return JSON.parse(globalThis.localStorage.getItem('modsState') || '{}')
}

describe('ModManageView', () => {
  test('渲染 Mod 列表：系统 Mod 无删除按钮，非系统有', () => {
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    // 四个 Mod。
    expect(wrapper.findAll('.mod').length).toBe(4)
    // 系统 Mod（lifeRestart-data / ai-mod）显示"系统内置"且无删除按钮。
    for (const name of ['lifeRestart-data', 'ai-mod']) {
      const row = modRow(wrapper, name)
      expect(row.find('.sys-hint').exists()).toBe(true)
      expect(row.findAll('button').some((b) => b.text().includes('删除'))).toBe(false)
    }
    // 非系统 Mod 有删除按钮。
    expect(modRow(wrapper, 'base-mod').findAll('button').some((b) => b.text().includes('删除'))).toBe(true)
    // 权限标签渲染（base-mod 声明 hooks）。
    expect(modRow(wrapper, 'base-mod').find('.perm').exists()).toBe(true)
  })

  test('启停：写入 localStorage 且刷新后保留（applyModsState）', async () => {
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    // fun-mod 默认禁用（按钮文案 = 状态）。
    const row = modRow(wrapper, 'fun-mod')
    expect(row.find('.btn.toggle').text()).toContain('已禁用')
    // 打开它（带权限 → 会弹授权窗）。
    await row.find('.btn.toggle').trigger('click')
    await flushPromises()
    // 状态已写入。
    expect(savedState().enabled['fun-mod']).toBe(true)
    // 授权窗出现（fun-mod 声明 hooks+storage）。
    expect(wrapper.find('.modal').exists()).toBe(true)
    // 允许。
    await findButton(wrapper, '允许').trigger('click')
    await flushPromises()
    // 弹窗关闭。
    expect(wrapper.find('.modal').exists()).toBe(false)
    // 重新挂载（模拟刷新）：状态保留。
    const second = mountView(ModManageView, { route: '/mods' })
    await flushPromises()
    expect(modRow(second.wrapper, 'fun-mod').find('.btn.toggle').text()).toContain('已启用')
  })

  test('删除：确认后移除并记入 removed（系统 Mod 不可删）', async () => {
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    // 打桩 confirm 为同意。
    globalThis.confirm = vi.fn(() => true)
    // 删除 base-mod。
    const delBtn = modRow(wrapper, 'base-mod').findAll('button').find((b) => b.text().includes('删除'))
    await delBtn.trigger('click')
    await flushPromises()
    // 列表少了一个。
    expect(wrapper.findAll('.mod').length).toBe(3)
    expect(wrapper.findAll('.mod-name').some((n) => n.text().includes('base-mod'))).toBe(false)
    // 已记入 removed（刷新后不再出现）。
    expect(savedState().removed).toContain('base-mod')
  })

  test('删除：确认框取消则不移除', async () => {
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    // 打桩 confirm 为拒绝。
    globalThis.confirm = vi.fn(() => false)
    // 点删除。
    const delBtn = modRow(wrapper, 'base-mod').findAll('button').find((b) => b.text().includes('删除'))
    await delBtn.trigger('click')
    await flushPromises()
    // 仍在列表里。
    expect(wrapper.findAll('.mod').length).toBe(4)
  })

  test('AI 配置：切服务商填充预设；Key 写入 localStorage；未配 Key 启用时提示', async () => {
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    // 打桩 alert。
    const alertSpy = vi.fn()
    globalThis.alert = alertSpy
    // 展开 ai-mod 的配置面板。
    await modRow(wrapper, 'ai-mod').find('.btn.config').trigger('click')
    await flushPromises()
    expect(wrapper.find('.ai-config').exists()).toBe(true)
    // 切到 DeepSeek：baseUrl/model 自动填充。
    await findButton(wrapper, 'DeepSeek').trigger('click')
    await flushPromises()
    const inputs = wrapper.findAll('.ai-config input')
    // 模型与 baseUrl 已按预设填充（inputs 顺序：Key / 模型 / Base URL）。
    expect(inputs[1].element.value).toBe('deepseek-chat')
    expect(inputs[2].element.value).toBe('https://api.deepseek.com/v1')
    // 填 Key 并触发 change → 写入 localStorage。
    await inputs[0].setValue('sk-test-123')
    await inputs[0].trigger('change')
    await flushPromises()
    expect(JSON.parse(globalThis.localStorage.getItem('aiConfig')).apiKey).toBe('sk-test-123')
    // 状态文案变为已配置。
    expect(wrapper.find('.ai-status').text()).toContain('已配置 Key')
    // 未配置 Key 的场景：清空后再启用 ai-mod 会 alert 提示。
    await inputs[0].setValue('')
    await inputs[0].trigger('change')
    await modRow(wrapper, 'ai-mod').find('.btn.toggle').trigger('click')
    await flushPromises()
    expect(alertSpy).toHaveBeenCalled()
  })

  test('连接测试：成功与失败两条分支都渲染结果', async () => {
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    // 展开配置面板。
    await modRow(wrapper, 'ai-mod').find('.btn.config').trigger('click')
    await flushPromises()
    // 成功：桩返回标准 OpenAI 响应。
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '我是测试模型' } }] }),
    })
    await findButton(wrapper, '测试连接').trigger('click')
    await flushPromises()
    expect(wrapper.find('.ai-test .ok').text()).toContain('我是测试模型')
    // 失败：桩抛错（代理未启动的典型情况）。
    globalThis.fetch = async () => {
      throw new Error('proxy unreachable')
    }
    await findButton(wrapper, '测试连接').trigger('click')
    await flushPromises()
    expect(wrapper.find('.ai-test .err').text()).toContain('proxy unreachable')
  })

  test('查看数据：进 /mods/<目录名> 的详情页', async () => {
    // 挂载。
    const { wrapper, router } = mountView(ModManageView)
    await flushPromises()
    // 每条卡片都有「查看数据」按钮。
    expect(modRow(wrapper, 'lifeRestart-data').find('.btn.detail').exists()).toBe(true)
    // 点它。
    await modRow(wrapper, 'lifeRestart-data').find('.btn.detail').trigger('click')
    await flushPromises()
    // 跳到详情页（路由参数 = 目录名）。
    expect(router.currentRoute.value.path).toBe('/mods/lifeRestart-data')
    expect(router.currentRoute.value.params.name).toBe('lifeRestart-data')
  })

  test('返回按钮回主页', async () => {
    // 挂载。
    const { wrapper, router } = mountView(ModManageView)
    // 返回。
    await findButton(wrapper, '返回').trigger('click')
    await flushPromises()
    // 跳转。
    expect(router.currentRoute.value.path).toBe('/')
  })
})
