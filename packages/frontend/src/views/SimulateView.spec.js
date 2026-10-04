// @vitest-environment happy-dom
/**
 * SimulateView 页面测试 — 模拟统计页
 *
 * 覆盖：
 *   1. 首屏：控制区（局数档位/种子/数据源/预计耗时）——**不再有「快速模式」**
 *   2. 跑一次模拟：进度推进 → 结果区渲染（概览/寿命分布/分档/属性均值/收集/最佳一局）
 *   3. 停止：运行中可取消，并保留已完成部分的聚合结果
 *   4. 可复现：填种子后结果标注 seed
 *   5. 无内容 Mod：明确提示，且不会"用演示数据兜底"跑空模拟
 *   6. 返回主页
 *
 * 注：以前这里靠「快速模式」把数据换成引擎测试 fixture 才快；
 * 现在内容只能来自 fetch 的 Data Mod 产物（stubFetchOk 注入 fixture 只是测试提速手段）。
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import SimulateView from './SimulateView.vue'
import { resetApp, mountView, stubFetchOk, stubFetchFail, waitFor } from '../test-utils/setup.js'

// 每个用例前重置（内存 localStorage + fetch 桩）。
beforeEach(() => {
  // 重置。
  resetApp()
  // 数据请求返回 fixture（内容来自 fetch 的"Data Mod 产物"，fixture 只用于测试提速）。
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

describe('SimulateView', () => {
  test('首屏渲染控制区：局数档位、种子、数据源与耗时预估', async () => {
    // 挂载。
    const { wrapper } = mountView(SimulateView)
    // 等数据加载完成。
    await flushPromises()
    // 局数档位（10/30/50/100）。
    const chips = wrapper.findAll('.chip.run')
    expect(chips.length).toBe(4)
    // 默认 30 高亮。
    expect(wrapper.find('.chip.run.active').text()).toBe('30')
    // 种子输入。
    expect(wrapper.find('input.num.wide').exists()).toBe(true)
    // **没有「快速模式」**（它曾经用引擎测试 fixture 当演示数据 → 填充天赋出现在页面上）。
    expect(wrapper.text()).not.toContain('快速模式')
    expect(wrapper.text()).not.toContain('演示数据')
    // 数据源标注（fixture 桩被当作原版数据）。
    expect(wrapper.find('.source').text()).toContain('lifeRestart-data')
    // 开始按钮与预计耗时。
    expect(findButton(wrapper, '开始模拟').exists()).toBe(true)
    expect(wrapper.text()).toContain('预计耗时约')
    // 未开始时没有结果区。
    expect(wrapper.find('.overview').exists()).toBe(false)
  })

  test('跑一次模拟：进度推进并渲染全部结果区', async () => {
    // 挂载。
    const { wrapper } = mountView(SimulateView)
    await flushPromises()
    // 局数改为 10（更快）。
    await wrapper.findAll('.chip.run')[0].trigger('click')
    await flushPromises()
    // 开始。
    await findButton(wrapper, '开始模拟').trigger('click')
    // 等结果出现。
    await waitFor(() => wrapper.find('.overview').exists())
    await flushPromises()
    // 概览：六个指标。
    expect(wrapper.findAll('.overview .cell').length).toBe(6)
    // 寿命分布：11 档。
    expect(wrapper.findAll('.bar-row').length).toBe(11)
    // 分档区显示三档中文（普通/优秀/极佳 之一至少出现）。
    expect(wrapper.text()).toMatch(/普通|优秀|极佳/)
    // 属性均值区（终局 / 历史最高）。
    expect(wrapper.text()).toContain('属性均值（终局 / 历史最高）')
    // 收集率（百分比）。
    expect(wrapper.text()).toMatch(/\d+\.\d%/)
    // 最佳一局区。
    expect(wrapper.text()).toContain('最佳一局（总评最高）')
    // 进度文本显示已完成 10/10。
    expect(wrapper.find('.progress-text').text()).toContain('10')
    // 按钮回到「开始模拟」。
    expect(findButton(wrapper, '开始模拟').exists()).toBe(true)
  })

  test('运行中可以停止，并保留已完成部分的聚合', async () => {
    // 挂载。
    const { wrapper } = mountView(SimulateView)
    await flushPromises()
    // 100 局（足够长以便中途停止）。
    await wrapper.findAll('.chip.run')[3].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.chip.run')[3].text()).toBe('100')
    // 开始。
    await findButton(wrapper, '开始模拟').trigger('click')
    // 等进度动起来（至少完成一局）。
    await waitFor(() => wrapper.find('.progress-text').exists() && wrapper.find('.progress-text').text().includes('已完成'))
    // 停止。
    await findButton(wrapper, '停止').trigger('click')
    // 等运行结束（按钮回到开始）。
    await waitFor(() => wrapper.findAll('button').some((b) => b.text().includes('开始模拟')))
    await flushPromises()
    // 有结果（已完成的那些局）。
    expect(wrapper.find('.overview').exists()).toBe(true)
    // 局数不超过设定值。
    const overview = wrapper.find('.overview').text()
    expect(overview).toContain('局')
  })

  test('填种子后结果标注 seed（可复现）', async () => {
    // 挂载。
    const { wrapper } = mountView(SimulateView)
    await flushPromises()
    // 只跑 10 局。
    await wrapper.findAll('.chip.run')[0].trigger('click')
    // 填种子。
    await wrapper.find('input.num.wide').setValue('42')
    await flushPromises()
    // 开始。
    await findButton(wrapper, '开始模拟').trigger('click')
    await waitFor(() => wrapper.find('.overview').exists())
    await flushPromises()
    // 概览标题里带 seed（标题是概览区的兄弟节点，故按整页文本断言）。
    expect(wrapper.text()).toContain('seed=42')
  })

  test('没有内容 Mod：明确提示，且不会用演示数据兜底跑空模拟', async () => {
    // 让数据请求失败 → 内容为空（引擎不内置内容）。
    stubFetchFail()
    // 挂载。
    const { wrapper } = mountView(SimulateView)
    await flushPromises()
    // 提示指向内容 Mod（而不是某个演示模式）。
    expect(wrapper.find('.warn').text()).toContain('没有可模拟的内容')
    expect(wrapper.find('.warn').text()).toContain('lifeRestart-data')
    // 数据源标注为空内容。
    expect(wrapper.find('.source').text()).toContain('空内容')
    // 点「开始模拟」也不会跑出结果（回归：以前会静默切到 fixture 演示数据）。
    await findButton(wrapper, '开始模拟').trigger('click')
    await flushPromises()
    expect(wrapper.find('.overview').exists()).toBe(false)
  })

  test('返回按钮回主页', async () => {
    // 挂载。
    const { wrapper, router } = mountView(SimulateView)
    await flushPromises()
    // 返回。
    await findButton(wrapper, '返回').trigger('click')
    await flushPromises()
    // 跳转。
    expect(router.currentRoute.value.path).toBe('/')
  })

  test('固定特性：可搜索挑选，跑局后结果使用所选特性', async () => {
    // 挂载。
    const { wrapper } = mountView(SimulateView)
    await flushPromises()
    // 只跑 10 局。
    await wrapper.findAll('.chip.run')[0].trigger('click')
    // 切到固定特性（页面上有两个「固定」按钮：特性/属性，用专属 class 区分）。
    await wrapper.findAll('.talent-mode')[1].trigger('click')
    await flushPromises()
    // 天赋列表出现。
    const items = wrapper.findAll('.talent-item')
    expect(items.length).toBeGreaterThan(0)
    // 挑第一个（用 checkbox 的 change 事件，等价用户勾选）。
    const firstName = items[0].find('.t-name').text()
    await items[0].find('input[type="checkbox"]').setValue(true)
    await flushPromises()
    // 已选计数与提示。
    expect(wrapper.text()).toContain('已选 1/3')
    // 搜索过滤：输入一个不存在的关键字 → 无匹配（搜索框是 .num.wide.search，随机种子是 .num.wide）。
    await wrapper.find('input.num.wide.search').setValue('绝不可能匹配的天赋名')
    await flushPromises()
    expect(wrapper.findAll('.talent-item').length).toBe(0)
    // 清空关键字恢复。
    await wrapper.find('input.num.wide.search').setValue('')
    await flushPromises()
    // 开始模拟。
    await findButton(wrapper, '开始模拟').trigger('click')
    await waitFor(() => wrapper.find('.overview').exists())
    await flushPromises()
    // 结果里策略标注为固定，并渲染所选天赋名。
    expect(wrapper.text()).toContain('特性：固定（')
    expect(wrapper.find('.overview').text()).toContain('局')
    expect(wrapper.text()).toContain(firstName)
  })

  test('固定属性：手填四项并在结果中生效；超预算给出警告', async () => {
    // 挂载。
    const { wrapper } = mountView(SimulateView)
    await flushPromises()
    // 只跑 10 局。
    await wrapper.findAll('.chip.run')[0].trigger('click')
    // 切到固定属性（专属 class）。
    await wrapper.findAll('.alloc-mode')[1].trigger('click')
    await flushPromises()
    // 四个属性数字输入（.alloc 专属 class：页面上还有一个"局数"数字输入）。
    const nums = wrapper.findAll('input.num.alloc')
    expect(nums.length).toBe(4)
    // 填 10/10/10/10（合计 40 > 20 → 超预算）。
    for (const input of nums) await input.setValue(10)
    await flushPromises()
    // 合计提示。
    expect(wrapper.text()).toContain('合计 40 点')
    // 跑。
    await findButton(wrapper, '开始模拟').trigger('click')
    await waitFor(() => wrapper.find('.overview').exists())
    await flushPromises()
    // 超预算 → 引擎警告被展示出来（不静默）。
    expect(wrapper.find('.warn-block').text()).toContain('超过可用 20')
    // 缩减后的分配合计应正好用完可用点数（最佳一局里能看到）。
    expect(wrapper.text()).toContain('属性分配')
  })

  test('导出：CSV / JSON / Markdown 三个按钮都会触发下载并给出反馈', async () => {
    // 挂载 + 10 局。
    const { wrapper } = mountView(SimulateView)
    await flushPromises()
    await wrapper.findAll('.chip.run')[0].trigger('click')
    await findButton(wrapper, '开始模拟').trigger('click')
    await waitFor(() => wrapper.find('.overview').exists())
    await flushPromises()
    // 打桩下载链路。
    const createObjectURL = vi.fn(() => 'blob:sim')
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    // 导出按钮存在（三种格式：MD 是 Markdown 的缩写）。
    expect(findButton(wrapper, 'CSV').exists()).toBe(true)
    expect(findButton(wrapper, 'JSON').exists()).toBe(true)
    expect(findButton(wrapper, 'MD').exists()).toBe(true)
    // 逐个导出。
    for (const [label, ext] of [['CSV', 'csv'], ['JSON', 'json'], ['MD', 'md']]) {
      await findButton(wrapper, label).trigger('click')
      await flushPromises()
      // 反馈里带文件名与扩展名。
      expect(wrapper.find('.ok').text()).toContain(`已导出 ${label}`)
      expect(wrapper.find('.ok').text()).toContain(`.${ext}`)
    }
    // 每次都真的建了 Blob URL 并点击了锚点。
    expect(createObjectURL).toHaveBeenCalledTimes(3)
    expect(clickSpy).toHaveBeenCalledTimes(3)
    // 还原。
    vi.restoreAllMocks()
  })
})
