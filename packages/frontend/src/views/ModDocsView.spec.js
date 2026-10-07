// @vitest-environment happy-dom
/**
 * Mod 文档页测试 —— 制作文档（/mods/docs）与 gameAPI 参考（/mods/api）
 *
 * 覆盖：
 *   1. 两个页面都能渲染：标题、目录（节数）、章节标题
 *   2. **路由顺序回归**：`/mods/docs`、`/mods/api` 必须命中文档路由，
 *      而不是被 `/mods/:name` 当成"某个 Mod 的目录名"吃掉（那样会渲染成"未找到 Mod"）
 *   3. API 条目渲染出了 path / 签名 / 参数表
 *   4. 代码块"复制"按钮真的调用了剪贴板（并给出"已复制"反馈）
 *   5. 点目录会滚动到对应章节（用 scrollIntoView，**不是** href="#…"）
 *   6. 未知块类型会显式渲染出警告（内容写错时页面上一眼能看出来）
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ModDocsView from './ModDocsView.vue'
import ModApiView from './ModApiView.vue'
import DocPage from '../components/DocPage.vue'
import { MOD_GUIDE } from '../utils/mod-doc-guide.js'
import { MOD_API } from '../utils/mod-doc-api.js'
import { resetApp, mountView, stubFetchOk, createTestRouter } from '../test-utils/setup.js'

// 每个用例前重置（内存 localStorage / pinia / fetch）。
beforeEach(() => {
  // 重置。
  resetApp()
  // 页面挂载时会发现 Mod（相对请求），统一给个替身。
  stubFetchOk()
  // happy-dom 没有 scrollIntoView 实现 → 打桩（也便于断言"确实滚动到了哪一节"）。
  Element.prototype.scrollIntoView = vi.fn()
})

describe('Mod 文档页', () => {
  test('制作文档：渲染标题、目录与全部章节', async () => {
    // 挂载。
    const { wrapper } = mountView(ModDocsView, { route: '/mods/docs' })
    // 等 onMounted 里的日志写入。
    await flushPromises()
    // 标题与副标题。
    expect(wrapper.find('.title').text()).toBe(MOD_GUIDE.title)
    expect(wrapper.find('.subtitle').text()).toContain('从零做一个 Mod')
    // 目录列出每一节（按钮，不是 <a> —— Hash 路由下点锚点会跳路由）。
    expect(wrapper.findAll('.toc-item').length).toBe(MOD_GUIDE.sections.length)
    expect(wrapper.find('.toc').text()).toContain(`${MOD_GUIDE.sections.length} 节`)
    // 章节标题都渲染出来了。
    for (const s of MOD_GUIDE.sections) expect(wrapper.text()).toContain(s.title)
    // 每一节都有锚点 id（供 scrollTo 用）。
    for (const s of MOD_GUIDE.sections) expect(wrapper.find(`#${MOD_GUIDE.id}-${s.id}`).exists()).toBe(true)
    // 目录里没有 href="#…" 的锚点（那会触发路由跳转）。
    expect(wrapper.find('.toc a').exists()).toBe(false)
  })

  test('API 参考：渲染 API 条目的 path、签名与参数表', async () => {
    // 挂载。
    const { wrapper } = mountView(ModApiView, { route: '/mods/api' })
    await flushPromises()
    // 标题。
    expect(wrapper.find('.title').text()).toBe(MOD_API.title)
    // API 条目数量 = 文档里的 api 块数量。
    const apiBlocks = MOD_API.sections.flatMap((s) => s.blocks).filter((b) => b.t === 'api')
    expect(wrapper.findAll('.api').length).toBe(apiBlocks.length)
    // 抽查两个关键条目。
    const text = wrapper.text()
    expect(text).toContain('gameAPI.param.define')
    expect(text).toContain('gameAPI.ai.chat')
    // 有参数表（表头是 参数/类型/说明）。
    expect(wrapper.find('.api .table').exists()).toBe(true)
    expect(wrapper.find('.api .table').text()).toContain('参数')
  })

  test('代码块可以复制（调用剪贴板并给出反馈）', async () => {
    // 剪贴板替身。
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText }, userAgent: 'test-agent' })
    // 挂载。
    const { wrapper } = mountView(ModDocsView, { route: '/mods/docs' })
    await flushPromises()
    // 第一个代码块的复制按钮。
    const btn = wrapper.find('.code-wrap .copy')
    expect(btn.exists()).toBe(true)
    // 点它。
    await btn.trigger('click')
    await flushPromises()
    // 调了剪贴板。
    expect(writeText).toHaveBeenCalled()
    // 反馈：按钮文案变成"已复制"。
    expect(wrapper.find('.code-wrap .copy').text()).toBe('已复制')
  })

  test('点目录会滚动到对应章节（scrollIntoView）', async () => {
    // 挂载（**真挂到 body**：scrollTo 用的是 document.getElementById）。
    const { wrapper } = mountView(ModDocsView, { route: '/mods/docs', attachToBody: true })
    await flushPromises()
    // 点第三节。
    await wrapper.findAll('.toc-item')[2].trigger('click')
    // 滚动了。
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    // 目标元素就是那一节的锚点。
    const target = Element.prototype.scrollIntoView.mock.instances[0]
    expect(target.id).toBe(`${MOD_GUIDE.id}-${MOD_GUIDE.sections[2].id}`)
    // 清理（不挂到 body 会影响后续用例的 getElementById）。
    wrapper.unmount()
  })

  test('未知块类型会显式报出来（内容写错不该静默少一段）', async () => {
    // 直接挂渲染组件，喂一份带错误块的文档（DocPage 的 doc 是必填 prop）。
    const bad = { id: 'x', title: '坏文档', sections: [{ id: 's1', title: '第一章', blocks: [{ t: 'bogus', text: '?' }] }] }
    // 挂载。
    const w = mount(DocPage, { props: { doc: bad } })
    // 渲染出警告而不是静默消失。
    expect(w.find('.note.warn').text()).toContain('未知内容块类型')
  })
})

describe('Mod 文档路由（顺序回归）', () => {
  test('/mods/docs 与 /mods/api 命中文档路由，而不是 Mod 详情页', async () => {
    // 用线上路由表建内存路由（与真实跳转同一份表）。
    const r1 = createTestRouter('/mods/docs')
    // 等首次导航完成（createTestRouter 里的 push 是异步的）。
    await r1.isReady()
    expect(r1.currentRoute.value.name).toBe('mod-docs')
    // API 页。
    const r2 = createTestRouter('/mods/api')
    await r2.isReady()
    expect(r2.currentRoute.value.name).toBe('mod-api')
  })

  test('/mods/page/:id 命中 Mod 自定义页面（**也必须排在 /mods/:name 之前**）', async () => {
    // 2026-10 能力补齐 ③：Mod 注册的页面走这条路由。
    const r = createTestRouter('/mods/page/my-guide')
    // 等导航完成。
    await r.isReady()
    // 命中 mod-page（不是 mod-detail）。
    expect(r.currentRoute.value.name).toBe('mod-page')
    // 参数还在（页面 id）。
    expect(r.currentRoute.value.params.id).toBe('my-guide')
  })

  test('四条 /mods/* 路由各归各位（顺序回归：docs / api / page 都不会被 :name 吃掉）', async () => {
    // 逐条核对（这一组是"路由顺序"这个坑的完整回归）。
    const cases = [
      ['/mods/docs', 'mod-docs'],
      ['/mods/api', 'mod-api'],
      ['/mods/page/abc', 'mod-page'],
      ['/mods/lifeRestart-data', 'mod-detail'],
      // 只写到 /mods 也仍然是管理页。
      ['/mods', 'mods'],
    ]
    // 逐个。
    for (const [path, name] of cases) {
      // 建路由。
      const r = createTestRouter(path)
      // 等导航完成。
      await r.isReady()
      // 断言。
      expect(r.currentRoute.value.name, `${path} 应命中 ${name}`).toBe(name)
    }
  })

  test('/mods/<目录名> 仍然命中 Mod 详情页（文档路由没有把它挤掉）', async () => {
    // Mod 详情。
    const r = createTestRouter('/mods/lifeRestart-data')
    await r.isReady()
    expect(r.currentRoute.value.name).toBe('mod-detail')
    // 参数还在。
    expect(r.currentRoute.value.params.name).toBe('lifeRestart-data')
  })
})

// 源码守卫：用了 `class="btn…"` 的组件必须自己定义 `.btn`。
//
// 为什么需要它（2026-10 真踩过）：本项目的 `.btn` **不是全局样式**，每个页面/组件都在自己的
// `<style scoped>` 里各定义一份。给文档页写新组件时漏了这 8 行，页面本身照常"能跑"、测试也全绿，
// 只有肉眼看界面（或对着线框稿核对）才会发现「← 返回」变成了浏览器默认按钮 —— 是那种
// "测试挡不住、只能靠人眼"的缺陷。这条守卫把它变成机器能挡的。
describe('Mod 文档页 - 样式守卫', () => {
  test('用了 class="btn" 的组件都必须定义 .btn（scoped 样式不是全局的）', async () => {
    // 需要读文件（node 环境能力，vitest 里可用）。
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    // 组件目录（相对本 spec）。
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'components')
    // 违规文件。
    const bad = []
    // 用到了 btn 的文件数（**防呆**：判据写错时这条守卫会"空过"，所以要断言它真的检查到了东西）。
    let using = 0
    // 逐个 .vue。
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.vue'))) {
      // 源码。
      const text = readFileSync(join(dir, f), 'utf8')
      // 用了 btn 类。
      const usesBtn = /class="btn(\s|"|\b)/.test(text)
      // 计数。
      if (usesBtn) using++
      // 没定义 .btn（允许 `.btn,` 这种组合选择器写法）。
      const definesBtn = /^\.btn\s*[,{]/m.test(text)
      // 记录违规。
      if (usesBtn && !definesBtn) bad.push(f)
    }
    // 至少要有两个（DocPage 与 LogDock）—— 否则说明这条守卫根本没在看东西。
    expect(using, '这条守卫没检查到任何用了 .btn 的组件，判据疑似失效').toBeGreaterThanOrEqual(2)
    // 一个都不许有。
    expect(bad, `这些组件用了 class="btn" 却没定义 .btn（会退化成浏览器默认按钮样式）：${bad.join(', ')}`).toEqual([])
  })
})
