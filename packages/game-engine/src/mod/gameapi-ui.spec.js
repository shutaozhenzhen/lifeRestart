/**
 * gameAPI.ui 单测 —— Mod 加界面的**运行期注册**通道（2026-10 能力补齐 ③）
 *
 * 覆盖：
 *   1. 注入 sink：四类注册真的落到宿主（并带来源 Mod 名）
 *   2. 降级（没注入 sink）：`available: false`，**注册调用抛可读错误**，读操作安全
 *   3. 形状校验：非对象 / 非法 slot / 非法 id（可读错误，不是静默）
 *   4. 动作表：onAction / hasAction / trigger / dispose（动作表由桥自己持有 → 无 sink 也能用）
 *   5. `list()` 给的是副本
 */
import { describe, test, expect, vi } from 'vitest'
import { createUiBridge, createGameAPI, createHookBus } from './gameapi.js'
import { UI_SLOTS } from './ui-schema.js'

// #makeSink
// 造一个与 `stores/extensions.js` 的 `uiSink()` 同形的宿主替身。
//
// @returns {object} { added, stats, sink }
function makeSink() {
  // 收到的声明。
  const added = []
  // 收到的统计键。
  const stats = []
  // 返回。
  return {
    // 记录。
    added,
    // 统计。
    stats,
    // sink 本体。
    sink: {
      // 收声明。
      add: (kind, item, mod) => { added.push({ kind, item, mod }) },
      // 收统计。
      addStatistic: (key, value, judge) => { stats.push([key, value, judge]); return true },
    },
  }
}

describe('gameAPI.ui - 注入 sink（正常路径）', () => {
  test('四类注册都落到宿主，并带来源 Mod 名', () => {
    // 宿主。
    const { added, sink } = makeSink()
    // 桥。
    const ui = createUiBridge({ sink, modName: 'my-mod' })
    // 能力探测。
    expect(ui.available).toBe(true)
    // 页面。
    ui.addPage({ id: 'p1', title: '页面', blocks: [{ t: 'p', text: 'x' }] })
    // 面板。
    ui.addPanel({ id: 'n1', slot: 'home', title: '面板', blocks: [{ t: 'p', text: 'y' }] })
    // 属性。
    ui.addProperty({ key: 'LUCK', label: '幸运' })
    // 统计（kind 缺省 count）。
    ui.addStat({ key: 'RKEY', label: '计数' })
    // 落点。
    expect(added.map((x) => x.kind)).toEqual(['pages', 'panels', 'properties', 'stats'])
    // 来源 Mod 名（宿主据此知道是谁注册的）。
    expect(added.every((x) => x.mod === 'my-mod')).toBe(true)
    // 面板形状。
    expect(added[1].item).toEqual({ id: 'n1', slot: 'home', title: '面板', blocks: [{ t: 'p', text: 'y' }] })
    // 统计 kind 规范化。
    expect(added[3].item).toEqual({ key: 'RKEY', label: '计数', kind: 'count' })
    // 合法 slot / 上限常量暴露给 Mod 作者自查。
    expect(ui.slots).toEqual(UI_SLOTS)
    expect(ui.limits.panels).toBe(8)
  })

  test('list() 给的是副本（Mod 改它不会串回桥内部）', () => {
    // 宿主。
    const { sink } = makeSink()
    // 桥。
    const ui = createUiBridge({ sink, modName: 'm' })
    // 注册。
    ui.addPage({ id: 'p1', title: '页面', blocks: [] })
    // 取。
    const first = ui.list()
    // 改它。
    first.pages[0].title = '改过了'
    first.pages.push({ id: 'x' })
    // 再取还是原样。
    expect(ui.list().pages).toHaveLength(1)
    expect(ui.list().pages[0].title).toBe('页面')
  })

  test('统计能力转给宿主（addStatistic）', () => {
    // 宿主。
    const { stats, sink } = makeSink()
    // 桥。
    const ui = createUiBridge({ sink, modName: 'm' })
    // 调用。
    expect(ui.addStatistic('K', 3, 'J_Good')).toBe(true)
    // 转发。
    expect(stats).toEqual([['K', 3, 'J_Good']])
  })
})

describe('gameAPI.ui - 降级（没注入 sink）', () => {
  test('available 为 false；注册调用抛可读错误；读操作安全；onAction 仍可用', () => {
    // 桥（无 sink）。
    const ui = createUiBridge({ modName: 'm' })
    // 能力探测。
    expect(ui.available).toBe(false)
    // 四类注册都抛可读错误。
    for (const call of [
      () => ui.addPage({ id: 'p', title: 't', blocks: [] }),
      () => ui.addPanel({ id: 'p', slot: 'home', title: 't', blocks: [] }),
      () => ui.addProperty({ key: 'K', label: 'L' }),
      () => ui.addStat({ key: 'K', label: 'L' }),
      () => ui.addStatistic('K', 1),
    ]) {
      // 抛。
      expect(call).toThrow()
    }
    // 错误信息里给了怎么办（可操作）。
    expect(() => ui.addStat({ key: 'K', label: 'L' })).toThrow(/uiSink/)
    // 读操作安全。
    expect(ui.list()).toEqual({ pages: [], panels: [], properties: [], stats: [] })
    // 动作表在本地 → 无 sink 也能注册与触发。
    const fn = vi.fn()
    ui.onAction('act', fn)
    expect(ui.hasAction('act')).toBe(true)
    ui.trigger('act', { id: 'act' })
    expect(fn).toHaveBeenCalled()
    // 没注册的动作触发时报可读错误。
    expect(() => ui.trigger('nope')).toThrow(/没有注册处理函数/)
  })

  test('dispose 清掉动作表（幂等，返回数量）；声明不受影响（由宿主管理）', () => {
    // 桥。
    const ui = createUiBridge({ modName: 'm' })
    // 注册两个动作。
    ui.onAction('a', () => {})
    ui.onAction('b', () => {})
    // 清。
    expect(ui.dispose()).toBe(2)
    // 幂等。
    expect(ui.dispose()).toBe(0)
    // 动作没了。
    expect(ui.hasAction('a')).toBe(false)
  })
})

describe('gameAPI.ui - 形状校验（可读错误，不静默）', () => {
  test('非对象的声明抛可读错误（而不是塞进注册表等渲染时才炸）', () => {
    // 宿主。
    const { sink } = makeSink()
    // 桥。
    const ui = createUiBridge({ sink })
    // 各种坏输入。
    expect(() => ui.addPage(null)).toThrow(/必须是对象/)
    expect(() => ui.addPage('x')).toThrow(/必须是对象/)
    expect(() => ui.addPanel([])).toThrow(/必须是对象/)
    expect(() => ui.addProperty(0)).toThrow(/必须是对象/)
  })

  test('非法 slot 抛可读错误并列出合法值（桥这一层也拦一道）', () => {
    // 宿主。
    const { sink, added } = makeSink()
    // 桥。
    const ui = createUiBridge({ sink })
    // 非法。
    expect(() => ui.addPanel({ id: 'p', slot: 'sidebar', title: 't', blocks: [] })).toThrow(/不是合法 slot/)
    // 合法值都列出来了。
    expect(() => ui.addPanel({ id: 'p', slot: 'sidebar', title: 't', blocks: [] })).toThrow(/home\/mods\/property\/game\/summary\/settings/)
    // 一个都没落下去。
    expect(added).toEqual([])
  })

  test('onAction 的 id / 回调校验', () => {
    // 桥。
    const ui = createUiBridge({ modName: 'm' })
    // id 必须是字符串。
    expect(() => ui.onAction('', () => {})).toThrow(/id 必须是非空字符串/)
    expect(() => ui.onAction(1, () => {})).toThrow(/id 必须是非空字符串/)
    // 回调必须是函数。
    expect(() => ui.onAction('a', 'nope')).toThrow(/必须是函数/)
  })
})

describe('gameAPI 顶层接线', () => {
  test('createGameAPI 暴露 ui，并把 uiSink 接上（未注入时是降级桥）', () => {
    // 没注入。
    const api = createGameAPI({ data: {}, hooks: createHookBus() })
    // 键存在（Mod 可以无条件写 gameAPI.ui.available）。
    expect(api.ui).toBeTruthy()
    expect(api.ui.available).toBe(false)
    // 注入。
    const { added, sink } = makeSink()
    const api2 = createGameAPI({ data: {}, hooks: createHookBus(), uiSink: sink, modName: 'wire-mod' })
    // 可用。
    expect(api2.ui.available).toBe(true)
    // 注册真的落下去。
    api2.ui.addStat({ key: 'K', label: 'L' })
    expect(added[0]).toMatchObject({ kind: 'stats', mod: 'wire-mod' })
  })
})
