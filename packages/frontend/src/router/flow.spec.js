// @vitest-environment happy-dom
/**
 * 全流程集成测试 — 主流程贯通：主页 → 天赋 → 属性 → 轨迹 → 总结
 *
 * 为什么必须有这一层（真实故障复盘）：
 *   之前的 bug（属性页读点数崩溃、总结页整列空值、死亡后继续推进）**全部发生在页面与
 *   store 的接缝上**：单模块测试各自自洽，接缝没人负责。这里用真实路由 + 真实组件 +
 *   真实 store，按用户的真实顺序走完一遍，接缝上的问题会直接炸出来。
 *
 * 覆盖：
 *   1. 主页开始 → 引擎就绪 → 跳天赋页
 *   2. 抽卡 → 选满 3 个 → 下一步（confirmTalents）→ 属性页**能读点数**（回归点）
 *   3. 随机分配 + 下一步 → 轨迹页；自动播放推进、逐年累积完整轨迹
 *   4. 人生结束：自动播放停止、轨迹不再增长、「总结」按钮变为可用
 *   5. 总结页：评价非空、成就计数渲染、点「重开」次数 +1 并回主页
 *   6. 路由守卫：未初始化直进引擎页会被重定向回主页
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
// 真实路由（含守卫与导航日志）。
import { router } from '../router/index.js'
// 根组件（router-view + 全局日志悬浮窗）。
import App from '../App.vue'
// store。
import { useGameStore } from '../stores/game.js'
// 测试装置（真实数据 / fixture 降级 / 安装内存 localStorage）。
import { installLocalStorage, stubFetchOk, stubFetchFail, stubFetchReal } from '../test-utils/setup.js'

// #findButton
// 按可见文本找一个按钮（中文标签稳定，避免给页面加测试专用属性）。
//
// @param {object} wrapper - 挂载结果
// @param {string} text - 文本片段
// @returns {object} 按钮 wrapper
function findButton(wrapper, text) {
  // 查找。
  const btn = wrapper.findAll('button').find((b) => b.text().includes(text))
  // 找不到直接失败，便于定位。
  if (!btn) throw new Error(`未找到按钮：${text}`)
  // 返回。
  return btn
}

// #mountApp
// 挂载整个应用（真实路由 + 全新 pinia）。
//
// @param {object} [options]
// @param {boolean} [options.dataFail] - 数据请求失败（验证降级路径）
// @param {boolean} [options.realData] - 用**真实数据**跑（501 年龄 / 184 天赋 / 1720 事件）
// @returns {Promise<{wrapper: object, store: object}>} 挂载结果
async function mountApp({ dataFail = false, realData = false } = {}) {
  // 全新 pinia。
  const pinia = createPinia()
  // 激活（组件外 useGameStore 也一致）。
  setActivePinia(pinia)
  // 干净 localStorage（引擎 storage 适配器会用）。
  installLocalStorage()
  // 数据请求：真实数据 / fixture / 故意失败。
  if (dataFail) stubFetchFail()
  else if (realData) stubFetchReal()
  else stubFetchOk()
  // 起始路由。
  await router.push('/')
  // 等待路由就绪。
  await router.isReady()
  // 挂载。
  const wrapper = mount(App, { global: { plugins: [pinia, router] } })
  // 等首屏渲染。
  await flushPromises()
  // 返回。
  return { wrapper, store: useGameStore() }
}

// 每个用例前：真实定时器 + 复位路由。
beforeEach(() => {
  // 默认真实定时器（需要假定时器的用例自己开）。
  vi.useRealTimers()
})

// 每个用例后：清理假定时器，避免污染其它用例。
afterEach(() => {
  // 假定时器可能仍在运行。
  vi.useRealTimers()
})

describe('全流程集成', () => {
  test('主页 → 天赋 → 属性 → 轨迹 → 总结：主流程贯通且数据非空（**真实数据**）', async () => {
    // 挂载应用（真实数据：501 年龄 / 184 天赋 / 1720 事件 —— 与线上一致）。
    const { wrapper, store } = await mountApp({ realData: true })

    // ── 阶段 1：主页开始新人生 ──
    expect(router.currentRoute.value.path).toBe('/')
    // 点「立即重开」。
    await findButton(wrapper, '立即重开').trigger('click')
    // 等数据加载 + 引擎初始化 + 跳转。
    await flushPromises()
    // 引擎就绪。
    expect(store.isReady).toBe(true)
    // 数据源是原版数据（真实数据文件）。
    expect(store.dataSource).toContain('lifeRestart-data')
    // 种子已分配（真实数据下同样每局一颗）。
    expect(Number.isInteger(store.seed)).toBe(true)
    // 已跳天赋页。
    expect(router.currentRoute.value.path).toBe('/talent')

    // ── 阶段 2：抽卡 + 选满天赋 + 下一步 ──
    // 抽卡。
    await findButton(wrapper, '十连抽').trigger('click')
    await flushPromises()
    // 天赋池非空。
    expect(store.talentPool.length).toBeGreaterThan(0)
    // 天赋卡片已渲染。
    const cards = wrapper.findAll('.card')
    expect(cards.length).toBe(store.talentPool.length)
    // 逐个点击直到选满（跳过会互斥失败的）。
    const limit = store.life.talentSelectLimit
    for (let i = 0; i < cards.length && store.selectedTalents.length < limit; i++) {
      await cards[i].trigger('click')
    }
    // 选满。
    expect(store.selectedTalents.length).toBe(limit)
    // 下一步：会先 confirmTalents（remake）再跳属性页。
    await findButton(wrapper, '下一步').trigger('click')
    await flushPromises()
    // 到了属性页。
    expect(router.currentRoute.value.path).toBe('/property')

    // ── 阶段 3：属性页读数（**历史崩溃点**）──
    // 修复前：这里读 store.propertyPoints 会抛 TypeError（#initialData 未建立）。
    expect(() => store.propertyPoints).not.toThrow()
    // 可用点数 = 默认 20 + 天赋加成。
    expect(store.propertyPoints).toBeGreaterThanOrEqual(20)
    // 页面把点数渲染成了文本（不是 —）。
    expect(wrapper.find('.points').text()).toBe(String(store.propertyPoints))

    // ── 阶段 4：分配点数 + 进轨迹页 ──
    // 随机分配（UI 按钮）。
    await findButton(wrapper, '随机分配').trigger('click')
    await flushPromises()
    // 点数分配完毕。
    expect(store.leftPoints).toBe(0)
    // 只假造 interval（自动播放用 setInterval）：保留真实 setTimeout，
    // 否则 @vue/test-utils 的 flushPromises（内部用 setTimeout）会死锁。
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    // 下一步（进入轨迹页时挂载 GameView，其 onMounted 会用假 interval 起播放）。
    await findButton(wrapper, '下一步').trigger('click')
    await flushPromises()
    // 到轨迹页。
    expect(router.currentRoute.value.path).toBe('/game')
    // 已开局。
    expect(store.started).toBe(true)

    // ── 阶段 5：自动播放推进（假定时器控制节奏）──
    // 等一个间隔（默认 800ms）后应推进一年。
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()
    // 至少推进了一年。
    expect(store.history.length).toBeGreaterThanOrEqual(1)
    // 轨迹页逐年渲染出「N 岁」。
    expect(wrapper.findAll('.year').length).toBe(store.history.length)

    // 推进到人生结束（真实数据下单局可达上百岁；给足上限，假定时器不耗真实时间）。
    for (let i = 0; i < 200 && !store.isEnd; i++) {
      await vi.advanceTimersByTimeAsync(900)
    }
    await flushPromises()
    // 人生已结束（LIF 归零）。
    expect(store.isEnd).toBe(true)
    // 真实数据下随机分配也可能活得很短（属性差 → 早期事件致死），
    // 因此只要求"跑过若干年"而不是"长寿"。
    expect(store.history.length).toBeGreaterThan(2)
    // 结束那一刻的轨迹条数。
    const frozen = store.history.length
    // 再推进多个间隔：自动播放必须已停止 → 轨迹不再增长（历史 bug：死亡后还在继续）。
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(store.history.length).toBe(frozen)

    // 回到真实定时器，避免影响后续阶段。
    vi.useRealTimers()

    // ── 阶段 6：总结页 ──
    // 结束后「总结」按钮可用。
    await findButton(wrapper, '总结').trigger('click')
    await flushPromises()
    // 到总结页。
    expect(router.currentRoute.value.path).toBe('/summary')
    // 本局随机种子可见（复现入口：同种子 + 同样选择 = 同一局）。
    expect(wrapper.find('.seed-value').text()).toBe(String(store.seed))
    // 属性评价：七行且不是空值（历史 bug：整列 —）。
    const rows = wrapper.findAll('.summary .section .row')
    expect(rows.length).toBeGreaterThanOrEqual(7)
    expect(wrapper.find('.summary .section').text()).not.toContain('—')
    // 评价文案已翻译（J_Good → 优秀/普通/极佳之一）。
    expect(wrapper.find('.summary').text()).toMatch(/普通|优秀|极佳/)
    // 成就区渲染了计数。
    expect(wrapper.text()).toContain(`成就（`)

    // ── 阶段 7：重开 → 次数 +1 且回主页 ──
    await findButton(wrapper, '重开').trigger('click')
    await flushPromises()
    // 回主页。
    expect(router.currentRoute.value.path).toBe('/')
    // 次数写入持久化存储（跨局累积）。
    expect(store.life.times).toBe(1)

    // 卸载（避免残留的定时器/watch 影响其它用例）。
    wrapper.unmount()
  }, 180000)

  test('路由守卫：未初始化直进引擎页 → 重定向回主页', async () => {
    // 全新 pinia（未初始化任何一局）。
    const pinia = createPinia()
    setActivePinia(pinia)
    installLocalStorage()
    // 先回到主页（避免"已经在该路由"导致 push 变成 no-op 而跳过守卫 → 用例间相互影响）。
    await router.push('/')
    await flushPromises()
    // 直接跳到需要引擎的页面。
    await router.push('/game')
    await flushPromises()
    // 守卫把它送回主页（而不是白屏/报错）。
    expect(router.currentRoute.value.path).toBe('/')
  })

  test('数据加载失败时降级为 fixture 数据源（并在报告里可见）', async () => {
    // 挂载时让数据请求失败（走 HomeView 的降级分支）。
    const { wrapper, store } = await mountApp({ dataFail: true })
    // 开始新人生。
    await findButton(wrapper, '立即重开').trigger('click')
    await flushPromises()
    // 数据源标注为降级。
    expect(store.dataSource).toContain('fixture')
    // 依然可以玩（引擎已初始化）。
    expect(store.isReady).toBe(true)
    // 卸载。
    wrapper.unmount()
  })
})
