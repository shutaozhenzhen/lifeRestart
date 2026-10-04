// @vitest-environment happy-dom
/**
 * ModDetailView 页面测试 —— Mod 数据详情（可视化）
 *
 * 覆盖：
 *   1. 首屏：manifest 基本信息（版本 / 作者 / 系统标记 / 权限 / 入口 / 校验结果 / 代码行数）
 *   2. 数据概览：5 张表的计数
 *   3. 分布可视化：天赋星级条形、事件构成条形、成就时机、年龄覆盖与"候选事件最多的年龄"
 *   4. 条目浏览：页签切换、搜索过滤、截断渲染（>50 条时提示）
 *   5. 错误不静默：坏 JSON / manifest 非法都在页面上显示
 *   6. 未找到：给出可读说明，不白屏
 *   7. 交互：重新读取、返回 Mod 管理页
 *
 * fetch 桩注意：引擎的 HTTP 源只认 `text()`（见 game-engine/src/mod/source-fetch.js），
 * 返回 `{ok, json}` 的桩在这里**不管用**。
 */
import { describe, test, expect, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ModDetailView from './ModDetailView.vue'
import { resetApp, mountView, createTestRouter, waitFor } from '../test-utils/setup.js'

// #stubModsFetch
// 用"内存文件表"打桩 fetch（键形如 `<mod>/<file>` 或站点绝对路径 `data/<file>`）。
//
// @param {object} files - 文件表
// @returns {void}
function stubModsFetch(files) {
  // 注入。
  globalThis.fetch = async (url) => {
    // 两种归一：去掉 /mods/ 前缀（Mod 目录），或去掉前导斜杠（站点绝对路径，如 /data/...）。
    const raw = String(url)
    const key = raw.replace(/^\/?mods\//, '')
    const alt = raw.replace(/^\/+/, '')
    // 命中。
    if (key in files) return { ok: true, status: 200, text: async () => files[key] }
    if (alt in files) return { ok: true, status: 200, text: async () => files[alt] }
    // 404。
    return { ok: false, status: 404, text: async () => '' }
  }
}

// #demoFiles
// 一个"看起来像真 Mod"的文件表：天赋 / 事件 / 成就 / 名人 / 年龄表 + code.js。
//
// @param {object} [overrides] - 覆盖某些文件
// @returns {object} 文件表
function demoFiles(overrides = {}) {
  // 返回。
  return {
    'demo/manifest.json': JSON.stringify({
      name: 'demo',
      version: '2.1.0',
      author: '测试作者',
      description: '演示用 Mod',
      permissions: ['hooks', 'storage'],
      modules: { fflate: 'vendor/fflate.mjs' },
    }),
    'demo/talents.json': JSON.stringify({
      1: { id: '1', name: '半神', description: '所有属性+2', grade: 3, effect: { INT: 2 } },
      2: { id: '2', name: '天龙人', description: '北京户口', grade: 2 },
      3: { id: '3', name: '生而为男', description: '性别一定为男', grade: 1, exclusive: true },
      4: { id: '4', name: '随身玉佩', description: '护佑', grade: 0, condition: 'params.CHR > 5', replacement: { talent: ['9'] } },
    }),
    'demo/events.json': JSON.stringify({
      10000: { id: '10000', event: '你死了。', effect: { LIF: -1 }, NoRandom: 1 },
      10001: { id: '10001', event: '你变漂亮了。', include: 'params.CHR > 5' },
      10002: { id: '10002', event: '你遇到贵人。', branch: ['a:1', 'b:2'], postEvent: '补充文本' },
    }),
    'demo/achievements.json': JSON.stringify({
      101: { id: '101', name: '既视感', description: '重开10次', grade: 0, opportunity: 'END', condition: 'params.TMS > 9' },
      102: { id: '102', name: '孟婆愁', description: '重开50次', grade: 1, opportunity: 'START', hide: 1 },
    }),
    'demo/characters.json': JSON.stringify({
      10: { id: '10', name: '曹操', property: { CHR: '2', INT: '7' }, talent: ['1144'] },
    }),
    'demo/age.json': JSON.stringify({
      0: { age: '0', event: [['10000', 1]], talent: [] },
      1: { age: '1', event: [['10000', 1], ['10001', 1]], talent: ['1'] },
      2: { age: '2', event: [['10000', 1], ['10001', 1], ['10002', 1]], talent: [] },
    }),
    'demo/code.js': 'export default () => {}\n// 第二行\n// 第三行\n',
    ...overrides,
  }
}

// 每个用例前重置（干净 pinia / localStorage；fetch 由各用例自己打桩）。
beforeEach(() => {
  // 重置。
  resetApp()
})

// #mountDetail
// 挂载详情页并等首次加载完成（路由参数解析 + 读文件都是异步的）。
//
// @param {string} name - Mod 名（路由参数）
// @returns {Promise<{wrapper: object, router: object}>} 挂载结果
async function mountDetail(name = 'demo') {
  // 先建路由并**等导航完成**：路由参数解析是异步的，不等的话首帧 params 还是空的
  // （页面此时会停在"读取中"，用例就会超时 —— 这不是页面 bug，线上由 watch 兜住）。
  const router = createTestRouter()
  await router.push(`/mods/${name}`)
  // 挂载（注入同一个路由实例）。
  const mounted = mountView(ModDetailView, { router })
  // 等"读取中…"消失（成功 / 未找到 / 出错三种结局都算加载完成）。
  await waitFor(() => !mounted.wrapper.text().includes('读取中…'))
  // 返回。
  return mounted
}

describe('ModDetailView - 基本信息与概览', () => {
  test('渲染 manifest 字段、数据概览与文件清单', async () => {
    // 打桩。
    stubModsFetch(demoFiles())
    // 挂载。
    const { wrapper } = await mountDetail()
    // 标题带 Mod 名。
    expect(wrapper.find('.title').text()).toContain('demo')
    // 基本信息。
    const kv = wrapper.find('.kv').text()
    expect(kv).toContain('2.1.0')
    expect(kv).toContain('测试作者')
    expect(kv).toContain('演示用 Mod')
    expect(kv).toContain('hooks')
    // 入口（browser 默认 code.js）。
    expect(kv).toContain('code.js')
    // manifest 校验通过。
    expect(wrapper.find('.kv .ok').text()).toContain('通过')
    // 代码行数。
    expect(kv).toContain('3 行')
    // 五张表的计数（概览格）。
    const cells = wrapper.findAll('.overview .cell')
    expect(cells.length).toBe(5)
    expect(cells.map((c) => c.find('.num').text())).toEqual(['4', '3', '2', '1', '3'])
    // 文件清单按约定列出（含 manifest/data/code/modules 里的依赖）。
    const files = wrapper.find('.files').text()
    expect(files).toContain('talents.json')
    expect(files).toContain('vendor/fflate.mjs')
    // 没有错误块。
    expect(wrapper.find('.errors').exists()).toBe(false)
  })
})

describe('ModDetailView - 分布可视化', () => {
  test('天赋星级 / 事件构成 / 成就时机 / 年龄覆盖都渲染出来', async () => {
    // 打桩。
    stubModsFetch(demoFiles())
    // 挂载。
    const { wrapper } = await mountDetail()
    // 图表标题。
    const text = wrapper.text()
    expect(text).toContain('天赋星级分布')
    expect(text).toContain('事件构成')
    expect(text).toContain('成就达成时机')
    expect(text).toContain('年龄覆盖')
    // 天赋星级：4 个天赋 → 4 条（0/1/2/3 星各 1）。
    const talentChart = wrapper.findAll('.chart')[0]
    expect(talentChart.findAll('.bar-row').length).toBe(4)
    expect(talentChart.text()).toContain('3星')
    // 事件构成：6 条（关键剧情 / include / exclude / 分支 / 属性变化 / 补充文本）。
    const eventChart = wrapper.findAll('.chart')[1]
    expect(eventChart.findAll('.bar-row').length).toBe(6)
    // 关键剧情 1 条（NoRandom）。
    expect(eventChart.text()).toContain('关键剧情（不随机）')
    // 成就时机：END 1 + START 1。
    expect(wrapper.text()).toContain('START')
    // 年龄覆盖 0~2 岁 + 候选事件最多的年龄（2 岁 3 个）。
    expect(wrapper.text()).toContain('0 ~ 2 岁')
    expect(wrapper.text()).toContain('平均每岁 2.0 个')
    const ageChart = wrapper.findAll('.chart')[3]
    expect(ageChart.text()).toContain('2 岁')
  })

  test('没有数据（纯代码 Mod）时不渲染分布区，并说明原因', async () => {
    // 只有 manifest + 代码的 Mod。
    stubModsFetch({
      'hooky/manifest.json': JSON.stringify({ name: 'hooky', version: '1.0.0' }),
      'hooky/code.js': 'export default () => {}\n',
    })
    // 挂载。
    const { wrapper } = await mountDetail('hooky')
    // 概览全 0。
    expect(wrapper.findAll('.overview .cell').map((c) => c.find('.num').text())).toEqual(['0', '0', '0', '0', '0'])
    // 分布区不出现。
    expect(wrapper.text()).not.toContain('分布可视化')
    // 说明文字在。
    expect(wrapper.text()).toContain('只提供代码/钩子')
  })

  test('Data Mod：数据在站点 data/ 目录（页面按内置清单自行解析）', async () => {
    // mods/ 下只有 manifest + files.json；数据在 data/ 下（线上就是这么发的）。
    stubModsFetch({
      'lifeRestart-data/manifest.json': JSON.stringify({ name: 'lifeRestart-data', version: '1.0.0', system: true, permissions: [] }),
      'lifeRestart-data/files.json': JSON.stringify(['manifest.json']),
      'data/talents.json': JSON.stringify({ 1: { id: '1', name: '半神', grade: 3 } }),
      'data/events.json': JSON.stringify({ 10000: { id: '10000', event: '你死了。', NoRandom: 1 } }),
    })
    // 挂载（名字必须是内置清单里的那个，页面才知道去哪儿读数据）。
    const { wrapper } = await mountDetail('lifeRestart-data')
    // 读到了数据（而不是"这个 Mod 没有天赋数据"）。
    const cells = wrapper.findAll('.overview .cell')
    expect(cells[0].find('.num').text()).toBe('1')
    expect(cells[1].find('.num').text()).toBe('1')
    // 页面说明了数据来源目录。
    expect(wrapper.text()).toContain('数据目录')
    expect(wrapper.text()).toContain('/data/')
    // 条目也能看到。
    expect(wrapper.find('.row').text()).toContain('半神')
  })
})

describe('ModDetailView - 条目浏览', () => {
  test('页签切换 + 搜索过滤', async () => {
    // 打桩。
    stubModsFetch(demoFiles())
    // 挂载。
    const { wrapper } = await mountDetail()
    // 默认落在第一个非空数据集（天赋）→ 4 行。
    expect(wrapper.findAll('.row').length).toBe(4)
    expect(wrapper.find('.row').text()).toContain('半神')
    // 切到事件页签 → 3 行 + 关键剧情标记。
    const eventTab = wrapper.findAll('.chip.tab').find((t) => t.text().includes('事件'))
    await eventTab.trigger('click')
    expect(wrapper.findAll('.row').length).toBe(3)
    expect(wrapper.text()).toContain('关键剧情')
    // 切到年龄表 → 标题是「N 岁」。
    const ageTab = wrapper.findAll('.chip.tab').find((t) => t.text().includes('年龄表'))
    await ageTab.trigger('click')
    expect(wrapper.find('.row-title').text()).toBe('0 岁')
    // 回天赋页签并搜索。
    const talentTab = wrapper.findAll('.chip.tab').find((t) => t.text().includes('天赋'))
    await talentTab.trigger('click')
    await wrapper.find('input.search').setValue('天龙')
    await flushPromises()
    expect(wrapper.findAll('.row').length).toBe(1)
    expect(wrapper.find('.row').text()).toContain('天龙人')
    // 搜不存在的关键字 → 0 行。
    await wrapper.find('input.search').setValue('绝不可能匹配')
    await flushPromises()
    expect(wrapper.findAll('.row').length).toBe(0)
  })

  test('超过渲染上限时截断并提示', async () => {
    // 造 60 个天赋（> RENDER_LIMIT 50）。
    const many = {}
    // 生成。
    for (let i = 0; i < 60; i++) many[String(i)] = { id: String(i), name: `天赋${i}`, grade: i % 4 }
    // 打桩。
    stubModsFetch(demoFiles({ 'demo/talents.json': JSON.stringify(many) }))
    // 挂载。
    const { wrapper } = await mountDetail()
    // 只渲染 50 条。
    expect(wrapper.findAll('.row').length).toBe(50)
    // 提示截断。
    expect(wrapper.text()).toContain('只显示前 50 条')
  })
})

describe('ModDetailView - 容错', () => {
  test('未找到：给出说明而不是白屏', async () => {
    // 空文件表 → 一律 404。
    stubModsFetch({})
    // 挂载。
    const { wrapper } = await mountDetail('nope')
    // 说明 + 错误。
    expect(wrapper.text()).toContain('没有这个 Mod')
    expect(wrapper.find('.errors').text()).toContain('找不到 Mod')
  })

  test('数据文件坏 JSON：页面不崩，错误显示出来，好数据照常展示', async () => {
    // events.json 坏掉。
    stubModsFetch(demoFiles({ 'demo/events.json': '{oops' }))
    // 挂载。
    const { wrapper } = await mountDetail()
    // 错误块。
    expect(wrapper.find('.errors').text()).toContain('events.json')
    // 天赋照常。
    expect(wrapper.findAll('.overview .cell')[0].find('.num').text()).toBe('4')
    // 事件计数为 0。
    expect(wrapper.findAll('.overview .cell')[1].find('.num').text()).toBe('0')
  })

  test('manifest 非法：仍展示，但校验未通过', async () => {
    // 缺 name。
    stubModsFetch(demoFiles({ 'demo/manifest.json': JSON.stringify({ version: '1.0.0' }) }))
    // 挂载。
    const { wrapper } = await mountDetail()
    // 校验未通过 + 错误列表。
    expect(wrapper.find('.kv .err').text()).toContain('未通过')
    expect(wrapper.find('.errors').text()).toContain('manifest 校验失败')
  })
})

describe('ModDetailView - 交互', () => {
  test('返回 Mod 管理页', async () => {
    // 打桩。
    stubModsFetch(demoFiles())
    // 挂载。
    const { wrapper, router } = await mountDetail()
    // 返回。
    const back = wrapper.findAll('button').find((b) => b.text().includes('返回 Mod 管理'))
    await back.trigger('click')
    await flushPromises()
    // 路由。
    expect(router.currentRoute.value.path).toBe('/mods')
  })

  test('重新读取按钮会再次拉取（文件改了 → 页面跟着变）', async () => {
    // 打桩。
    const files = demoFiles()
    stubModsFetch(files)
    // 挂载。
    const { wrapper } = await mountDetail()
    expect(wrapper.findAll('.overview .cell')[0].find('.num').text()).toBe('4')
    // 改文件（新增一个天赋）。
    files['demo/talents.json'] = JSON.stringify({
      1: { id: '1', name: '半神', grade: 3 },
      2: { id: '2', name: '新加的', grade: 1 },
    })
    // 点重新读取。
    const reload = wrapper.findAll('button').find((b) => b.text().includes('重新读取'))
    await reload.trigger('click')
    // 等计数更新（读文件是异步的；点击后有一瞬间是"读取中"，选择器要防空）。
    await waitFor(() => wrapper.findAll('.overview .cell')[0]?.find('.num')?.text() === '2')
    // 计数更新。
    expect(wrapper.findAll('.overview .cell')[0].find('.num').text()).toBe('2')
  })
})
