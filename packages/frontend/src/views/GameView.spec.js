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

  test('轨迹里的 `{{asset:...}}` 渲染成 <img>；资源缺失时降级成纯文本且不报错', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 造一个"解析得出 URL"的 Mod 资源桥并注册（**不碰真实网络/文件系统**）。
    const { createAssetRegistry } = await import('../utils/mod-runtime.js')
    const { createAssetBridge } = await import('game-engine/src/mod/asset-bridge.js')
    // 假的 URL 原语（happy-dom 有 URL.createObjectURL，但这里要能断言"缓存 + 只造一个"）。
    const created = []
    const urlApi = {
      Blob: class { constructor(parts, opts) { this.type = opts?.type } },
      createObjectURL: vi.fn(() => { const u = `blob:test/${created.length + 1}`; created.push(u); return u }),
      revokeObjectURL: vi.fn(),
    }
    // 桥（清单 + 字节都来自注入的替身）。
    const bridge = createAssetBridge({
      modName: 'demo',
      listFiles: async () => ['assets/logo.png'],
      readBytes: async () => new Uint8Array([137, 80, 78, 71]),
      urlApi,
    })
    // 注册表。
    const registry = createAssetRegistry()
    registry.register('demo', bridge)
    // 写进 store（生产里由 store.init 里的 executeModCodes 完成）。
    store.assetRegistry = registry
    store.assetUrlCache = new Map()
    // 两条轨迹：一条资源存在、一条**路径不存在**（降级）。
    store.history.push({ age: 30, isEnd: false, items: [{ type: 'EVT', description: '翻出照片 {{asset:assets/logo.png}} 好看' }] })
    store.history.push({ age: 31, isEnd: false, items: [{ type: 'EVT', description: '缺图 {{asset:assets/missing.png}} 尾巴' }] })
    // 触发解析（生产里由 store.next() 在推进一年后调用）。
    store.trackAssets()
    await flushPromises()
    await nextTick()
    // **有资源的那条渲染成真 <img>**。
    const img = wrapper.find('img.asset-img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('blob:test/1')
    // alt/title 是路径（排障时看得到到底是哪个资源）。
    expect(img.attributes('alt')).toBe('assets/logo.png')
    // 同一个路径只造一个 URL（**缓存**：不缓存的话同一张图会造无数个 blob）。
    expect(urlApi.createObjectURL).toHaveBeenCalledTimes(1)
    // **缺失的那条降级成纯文本**：占位符原样可见，且没有第二个 img。
    const entries = wrapper.findAll('.entry .text')
    expect(entries.length).toBe(2)
    expect(entries[1].text()).toContain('{{asset:assets/missing.png}}')
    expect(wrapper.findAll('img.asset-img').length).toBe(1)
    // 两侧的普通文本都没丢。
    expect(entries[0].text()).toContain('翻出照片')
    expect(entries[0].text()).toContain('好看')
    expect(entries[1].text()).toContain('尾巴')
  })

  test('没有资源能力时（assetRegistry 为 null）占位符原样当文本，页面不报错', async () => {
    // 准备（默认 init 不传资源能力 → assetRegistry 为 null）。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 一条带占位符的轨迹。
    store.history.push({ age: 30, isEnd: false, items: [{ type: 'EVT', description: '照片 {{asset:assets/logo.png}}' }] })
    // 解析（没有注册表 → 直接返回，不做任何事）。
    store.trackAssets()
    await flushPromises()
    await nextTick()
    // 没有 img。
    expect(wrapper.find('img.asset-img').exists()).toBe(false)
    // 占位符原样可见（不是"（图片缺失）"这种替换 —— 保留路径才好排障）。
    expect(wrapper.find('.entry .text').text()).toContain('{{asset:assets/logo.png}}')
    // 也没有解析出任何 URL。
    expect(store.assetUrlTick).toBe(0)
    expect(store.assetUrl('assets/logo.png')).toBeNull()
  })

  test('状态栏显示本局随机种子，点击可复制（用于复现）', async () => {    // 准备。
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

// ==================== 异步逐岁介入（2026-10 能力补齐 ④）====================
//
// 轨迹页这一侧的义务有三条：
//   ① 异步推进期间**有可见状态**（不白屏、不看起来卡死）；
//   ② "下一年"按钮在生成中不可重复点（一次只推进一年）；
//   ③ 自动播放（`utils/auto-play.js` 的 onTick）**走同一条选择逻辑**（不退回同步）。
describe('GameView 异步逐岁介入（能力补齐 ④）', () => {
  // #ASYNC_MOD_CODE
  // 异步 Mod：`onBeforeYear` 里 await 一个真 Promise，然后把内容塞进当年轨迹。
  const ASYNC_MOD_CODE = `
gameAPI.on('onBeforeYear', async (p) => {
  if (p.nextAge !== 1) return
  await new Promise(function (r) { setTimeout(r, 1) })
  p.pending.push({ type: 'EVT', description: '_ASYNC_INJECTED_' })
})
`
  // #ASYNC_MANIFEST
  // 异步 Mod 的 manifest（前端据此选 nextAsync）。
  const ASYNC_MANIFEST = { name: 'async-demo', version: '1.0.0', async: true }

  // #asyncReadyStore
  // 建一个**带异步 Mod** 的就绪 store（轨迹页挂载时会 begin）。
  //
  // @returns {Promise<object>} store
  async function asyncReadyStore() {
    // store。
    const store = useGameStore()
    // 初始化（**带异步 Mod**：hasAsyncMods 为 true → 推进走 nextAsync()）。
    await store.init(buildFixtureData(), {
      // 代码。
      modCodes: [{ name: 'async-demo', code: ASYNC_MOD_CODE }],
      // 各 Mod 的 manifest（异步标记的来源）。
      manifests: [{ name: 'async-demo', manifest: ASYNC_MANIFEST }],
      // 判定。
      hasAsyncMods: true,
      asyncMods: [{ name: 'async-demo', hooks: ['onBeforeYear'] }],
      // 小超时（用例不依赖它，但别让失败挂 3 秒）。
      asyncTimeoutMs: 1000,
    })
    // 天赋确认 + 分配（轨迹页挂载时会 begin）。
    store.confirmTalents()
    store.allocation = { CHR: 5, INT: 5, STR: 5, MNY: 5 }
    // 返回。
    return store
  }

  test('异步推进期间显示「生成中」，结束后消失（不白屏、不看起来卡死）', async () => {
    // 准备（带异步 Mod）。
    const store = await asyncReadyStore()
    // 挂载（onMounted 会 begin 并启动自动播放）。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 初始状态：没有"生成中"。
    expect(wrapper.find('.generating').exists()).toBe(false)
    // 手动推进：用**原生 click**（`trigger('click')` 会等到下一个 tick 才返回，那时推进
    // 已经结束、"生成中"这一段就再也观察不到了 —— 这个用例要观察的正是**中间态**）。
    const btn = findButton(wrapper, '下一年')
    // 播放中该按钮是禁用的（本用例只想看"点一下之后"的状态，所以先停掉自动播放）。
    await findButton(wrapper, '暂停').trigger('click')
    await flushPromises()
    // 点击前：可点。
    expect(findButton(wrapper, '下一年').attributes('disabled')).toBeUndefined()
    // 原生点击（同步派发 → 处理器随即开始 await）。
    findButton(wrapper, '下一年').element.click()
    // 推进已经开始（store 侧标记）。
    expect(store.advancing).toBe(true)
    // **可见的生成中状态**（这正是"不许白屏 / 不许看起来卡死"的落点）。
    await nextTick()
    expect(wrapper.find('.generating').exists()).toBe(true)
    expect(wrapper.find('.generating').text()).toContain('生成中')
    // 生成中不能重复点（一次只推进一年）。
    expect(findButton(wrapper, '下一年').attributes('disabled')).toBeDefined()
    // 等推进落地。
    await flushPromises()
    await nextTick()
    // 状态消失。
    expect(wrapper.find('.generating').exists()).toBe(false)
    // 这一年已经进了轨迹（异步路径真的走通了）。
    expect(store.history.length).toBe(1)
    expect(store.advancing).toBe(false)
    // 卸载（`onBeforeUnmount` 会停播放器；否则本文件"只假造 setInterval"的做法会让它的
    // 定时器活到下一个用例里，搅乱那里的自动播放 —— 实测踩过）。
    wrapper.unmount()
  })

  test('自动播放走同一条选择逻辑（异步集合下也走 nextAsync，不退回同步）', async () => {
    // 准备（带异步 Mod）。
    const store = await asyncReadyStore()
    // 挂载（onMounted 会 begin + 启动自动播放）。
    const { wrapper } = mountView(GameView)
    await flushPromises()
    // 生命拉满（fixture 里 0 岁就可能死）。
    keepAlive(store)
    // 钉住"没有退回同步"：自动播放的推进也必须走异步路径。
    const syncSpy = vi.spyOn(store.life, 'next')
    // 自动播放每一拍（真实间隔 800ms；这里手动推进假定时器）。
    // ⚠️ 用 `advanceTimersByTimeAsync`（它会连微任务一起清）而不是同步的 `advanceTimersByTime`：
    //    异步推进跨了好几个微任务 / 真实定时器，同步推进定时器的话下一拍会撞上"上一拍还没回来"。
    for (let i = 0; i < 3; i++) {
      // 走一拍。
      await vi.advanceTimersByTimeAsync(800)
      // 等异步推进落地（真实定时器 1ms + 微任务）。
      await new Promise((r) => setTimeout(r, 20))
      await flushPromises()
      await nextTick()
    }
    // 前三年都推进了（第 1 岁那年就是异步注入的那年）。
    expect(store.history.length).toBeGreaterThanOrEqual(2)
    // 异步注入的内容出现在**当年**轨迹（而且是自动播放路径推出来的）。
    const year1 = store.history.find((h) => h.age === 1)
    expect(year1).toBeTruthy()
    expect(year1.items.some((c) => String(c.description).includes('_ASYNC_INJECTED_'))).toBe(true)
    // 同步 next() 一次都没被调用。
    expect(syncSpy).not.toHaveBeenCalled()
    // 清理。
    syncSpy.mockRestore()
    wrapper.unmount()
  })
})
