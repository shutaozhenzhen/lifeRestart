// @vitest-environment happy-dom
/**
 * ModManageView 页面测试 —— Mod 管理页
 *
 * 覆盖：
 *   1. 渲染 Mod 列表；系统 Mod 无删除按钮（显示"系统内置"），非系统 Mod 有删除按钮
 *   2. 启停：状态写入 localStorage（modsState），刷新后保留
 *   3. 权限弹窗：启用带权限的 Mod → 弹窗 → 「允许」关闭并记录
 *   4. 完全移除：确认后移除并记入 removed（**预装/系统 Mod 一视同仁**）；确认框取消则不移除；
 *      「已移除的 Mod」面板可单条恢复 / 全部恢复（服务器文件从未被删）
 *   5. AI 配置：切服务商填充 baseUrl/model；Key 写入 localStorage；未配 Key 启用时提示
 *   6. 连接测试：成功/失败两条分支都在界面上给出结果
 *   7. 「查看数据」进 Mod 数据详情页（用**目录名**寻址）
 *   8. 返回按钮回主页
 *   9. 「下载 zip」导出：成功时触发浏览器下载并给出文件名/文件数；失败时显示原因
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
  test('渲染 Mod 列表：每张卡片都能「完全移除」（预装/系统 Mod 一视同仁）', () => {
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    // 四个 Mod。
    expect(wrapper.findAll('.mod').length).toBe(4)
    // 每张卡片都有「完全移除」（2026-10 起系统 Mod 也能整个移除，不再只有"禁用"）。
    for (const name of ['lifeRestart-data', 'ai-mod', 'base-mod', 'fun-mod']) {
      const row = modRow(wrapper, name)
      expect(row.findAll('button').some((b) => b.text().includes('完全移除')), name).toBe(true)
    }
    // 系统 Mod 标出「系统内置」。
    expect(modRow(wrapper, 'lifeRestart-data').find('.sys-hint').text()).toContain('系统内置')
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

  test('完全移除：系统预装 Mod 也能移除，并可从「已移除」面板恢复', async () => {
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    // 打桩 confirm 为同意。
    globalThis.confirm = vi.fn(() => true)
    // 完全移除 content Mod（以前这里被 `if (mod.system) return` 挡住）。
    const btn = modRow(wrapper, 'lifeRestart-data').findAll('button').find((b) => b.text().includes('完全移除'))
    await btn.trigger('click')
    await flushPromises()
    // 卡片消失。
    expect(wrapper.findAll('.mod-name').some((n) => n.text().includes('lifeRestart-data'))).toBe(false)
    // 「已移除」面板出现并列出它（服务器文件没删，所以能恢复）。
    expect(wrapper.find('.removed-panel').exists()).toBe(true)
    expect(wrapper.find('.removed-panel').text()).toContain('lifeRestart-data')
    // 已持久化（游戏路径据此"不加载"）。
    expect(savedState().removed).toContain('lifeRestart-data')
    // 点该行的「恢复」。
    await wrapper.find('.removed-row .btn.restore').trigger('click')
    await flushPromises()
    // 回来了。
    expect(modRow(wrapper, 'lifeRestart-data')).toBeTruthy()
    // 标记清掉、面板消失。
    expect(savedState().removed).toEqual([])
    expect(wrapper.find('.removed-panel').exists()).toBe(false)
  })

  test('完全移除：确认框取消则不移除（也不会记进 removed）', async () => {
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    // 打桩 confirm 为拒绝。
    globalThis.confirm = vi.fn(() => false)
    // 点完全移除。
    const delBtn = modRow(wrapper, 'base-mod').findAll('button').find((b) => b.text().includes('完全移除'))
    await delBtn.trigger('click')
    await flushPromises()
    // 仍在列表里，且没有「已移除」面板。
    expect(wrapper.findAll('.mod').length).toBe(4)
    expect(wrapper.find('.removed-panel').exists()).toBe(false)
    expect(savedState().removed || []).toEqual([])
  })

  test('已移除面板：全部恢复一次清空', async () => {
    // 预置两个被移除的 Mod。
    globalThis.localStorage.setItem('modsState', JSON.stringify({ enabled: {}, removed: ['lifeRestart-data', 'fun-mod'] }))
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    await flushPromises()
    // 两个都不在目录里，面板列出它们。
    expect(wrapper.findAll('.mod').length).toBe(2)
    expect(wrapper.findAll('.removed-row').length).toBe(2)
    // 全部恢复。
    globalThis.confirm = vi.fn(() => true)
    await wrapper.find('.removed-head .btn.restore').trigger('click')
    await flushPromises()
    // 都回来了，面板消失。
    expect(wrapper.findAll('.mod').length).toBe(4)
    expect(wrapper.find('.removed-panel').exists()).toBe(false)
    expect(savedState().removed).toEqual([])
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

  test('下载：打包成 zip 触发浏览器下载，并给出文件名/文件数', async () => {
    // 只给 base-mod 的真实文件（其余一律 404 → 目录退回内置清单，界面仍有卡片）。
    globalThis.fetch = async (url) => {
      // 归一化（Mod 根 = /mods/）。
      const key = String(url).replace(/^\/?mods\//, '')
      // 文件表。
      const files = {
        'base-mod/manifest.json': JSON.stringify({ name: 'base-mod', version: '1.0.0', permissions: [] }),
        'base-mod/files.json': JSON.stringify(['manifest.json', 'talents.json']),
        'base-mod/talents.json': JSON.stringify({ t1: { id: 't1', name: '天赋一', grade: 1 } }),
      }
      // 命中。
      if (key in files) return { ok: true, status: 200, text: async () => files[key] }
      // 404。
      return { ok: false, status: 404, text: async () => '' }
    }
    // 浏览器下载 API 打桩（happy-dom 有 URL/Blob，但我们要断言"确实触发了下载"）。
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mod')
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    await flushPromises()
    // 每张卡片都有「下载」按钮。
    expect(modRow(wrapper, 'base-mod').find('.btn.download').exists()).toBe(true)
    // 点它。
    await modRow(wrapper, 'base-mod').find('.btn.download').trigger('click')
    await flushPromises()
    // 触发了下载（Blob + 对象 URL）。
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    // 反馈：文件名 + 文件数（用户要能确认"下到的是什么"）。
    const ok = wrapper.find('.download-ok').text()
    expect(ok).toContain('liferestart-mod-base-mod-1.0.0.zip')
    expect(ok).toContain('2 个文件')
    // 没有错误块。
    expect(wrapper.find('.download-error').exists()).toBe(false)
    // 忙状态已解除（按钮可再点）。
    expect(modRow(wrapper, 'base-mod').find('.btn.download').attributes('disabled')).toBeUndefined()
    // 清理。
    createObjectURL.mockRestore()
  })

  test('下载失败：把原因显示出来（不静默失败）', async () => {
    // 全 404：这个 Mod 在服务器上没有、本地也没装。
    globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '' })
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    await flushPromises()
    // 点下载。
    await modRow(wrapper, 'lifeRestart-data').find('.btn.download').trigger('click')
    await flushPromises()
    // 错误可见，且说明了原因。
    expect(wrapper.find('.download-error').text()).toContain('找不到 Mod')
    // 没有成功提示。
    expect(wrapper.find('.download-ok').exists()).toBe(false)
  })
})
