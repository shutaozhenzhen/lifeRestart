/**
 * ui-extensions 单测 —— Mod 界面扩展的收集 / 合并 / 查询（纯逻辑）
 *
 * 覆盖：
 *   1. 从 manifest 收集四类扩展点（含来源 Mod 名）
 *   2. 合并：去重规则（后加载者胜）、顺序稳定、空输入、坏数据不炸
 *   3. `panelsForSlot` 按 slot 取出面板
 *   4. errors 一路带出（坏数据出声，不静默）
 */
import { describe, test, expect, vi } from 'vitest'
// 被测模块。
import {
  collectUiExtensions,
  mergeUiExtensions,
  panelsForSlot,
  emptyExtensions,
  hasUiDeclaration,
} from './ui-extensions.js'

// #mod
// 造一个带 ui 声明的 Mod 条目。
//
// @param {string} name - Mod 名
// @param {object} ui - ui 声明
// @returns {object} { name, manifest }
function mod(name, ui) {
  // 返回。
  return { name, manifest: { name, version: '1.0.0', ui } }
}

// #onePage
// 造一条页面声明。
//
// @param {string} id - id
// @param {string} [title] - 标题
// @returns {object} 页面
function onePage(id, title = `页面 ${id}`) {
  // 返回。
  return { id, title, blocks: [{ t: 'p', text: `${id} 的内容` }] }
}

describe('ui-extensions - 收集', () => {
  test('从多个 Mod 的 manifest 收集四类扩展点，并带上来源 Mod 名', () => {
    // 收集。
    const r = collectUiExtensions([
      mod('mod-a', {
        pages: [onePage('a-page', 'A 的页面')],
        panels: [{ id: 'a-panel', slot: 'home', title: 'A 的面板', blocks: [{ t: 'p', text: 'hi' }] }],
        properties: [{ key: 'LUCK', label: '幸运' }],
        stats: [{ key: 'RKEY', label: 'A 计数', kind: 'count' }],
      }),
      // 第二个 Mod 只加一个面板。
      mod('mod-b', { panels: [{ id: 'b-panel', slot: 'mods', title: 'B 的面板', blocks: [] }] }),
    ])
    // 页面。
    expect(r.pages).toHaveLength(1)
    expect(r.pages[0].title).toBe('A 的页面')
    // 来源 Mod 名（空态提示要用）。
    expect(r.pages[0].mod).toBe('mod-a')
    // 面板两个、顺序 = 输入顺序。
    expect(r.panels.map((p) => p.id)).toEqual(['a-panel', 'b-panel'])
    expect(r.panels.map((p) => p.mod)).toEqual(['mod-a', 'mod-b'])
    // 属性 / 统计。
    expect(r.properties).toEqual([{ key: 'LUCK', label: '幸运', mod: 'mod-a' }])
    // 统计。
    expect(r.stats).toEqual([{ key: 'RKEY', label: 'A 计数', kind: 'count', mod: 'mod-a' }])
    // 没有错误。
    expect(r.errors).toEqual([])
  })

  test('没声明 ui 的 Mod 不影响结果（也不产生错误）', () => {
    // 收集。
    const r = collectUiExtensions([
      { name: 'plain', manifest: { name: 'plain', version: '1.0.0' } },
      // ui 是空对象 = 没声明。
      mod('empty-ui', {}),
      // ui 只有空数组 = 没声明。
      mod('empty-arrays', { pages: [] }),
    ])
    // 空注册表。
    expect(r).toEqual({ ...emptyExtensions(), errors: [] })
  })

  test('坏数据不炸：非数组 / 非对象条目 / 缺 id 都被跳过并记进 errors', () => {
    // 各类坏数据。
    const r = collectUiExtensions([
      // ui 不是对象。
      { name: 'bad-ui', manifest: { ui: 'nope' } },
      // 某类不是数组。
      { name: 'bad-kind', manifest: { ui: { pages: 'nope' } } },
      // 条目不是对象 / 缺 id / 缺 key。
      { name: 'bad-items', manifest: { ui: { pages: [null, 'x', { title: '没有 id' }, onePage('ok')], properties: [{ label: '没有 key' }] } } },
      // 条目本身是 null。
      null,
      // 不是数组的输入项。
      'nope',
    ])
    // 只收下合法的那个。
    expect(r.pages.map((p) => p.id)).toEqual(['ok'])
    expect(r.properties).toEqual([])
    // 错误逐条带出（不静默）。
    expect(r.errors.length).toBeGreaterThanOrEqual(4)
    expect(r.errors.join('\n')).toContain('bad-kind')
    expect(r.errors.join('\n')).toContain('bad-items')
  })

  test('输入不是数组 / 是 undefined 时给空注册表（启动路径不许抛）', () => {
    // 三种空输入。
    expect(collectUiExtensions(undefined)).toEqual({ ...emptyExtensions(), errors: [] })
    expect(collectUiExtensions(null)).toEqual({ ...emptyExtensions(), errors: [] })
    expect(collectUiExtensions('nope')).toEqual({ ...emptyExtensions(), errors: [] })
  })

  test('收集结果是副本（渲染器改它不会串回 manifest）', () => {
    // 原文。
    const ui = { pages: [onePage('p1')] }
    // 收集。
    const r = collectUiExtensions([mod('m', ui)])
    // 改结果。
    r.pages[0].blocks[0].text = '改过了'
    r.pages[0].title = '改过了'
    // 原文没变。
    expect(ui.pages[0].title).toBe('页面 p1')
    expect(ui.pages[0].blocks[0].text).toBe('p1 的内容')
  })

  test('hasUiDeclaration 判断"有没有声明"', () => {
    // 有。
    expect(hasUiDeclaration({ ui: { stats: [{ key: 'K', label: 'L' }] } })).toBe(true)
    // 有 ui 段就算进流程（哪怕内容写错 —— 那种要被报出来，不能静默跳过）。
    expect(hasUiDeclaration({ ui: { pages: 'nope' } })).toBe(true)
    // 没有。
    expect(hasUiDeclaration({})).toBe(false)
    expect(hasUiDeclaration(undefined)).toBe(false)
    expect(hasUiDeclaration({ ui: 'nope' })).toBe(false)
    expect(hasUiDeclaration({ ui: [] })).toBe(false)
    expect(hasUiDeclaration({ ui: null })).toBe(false)
  })
})

describe('ui-extensions - 合并（冲突规则：后加载者胜）', () => {
  test('不同 id 直接追加，顺序稳定', () => {
    // 合并两份。
    const merged = mergeUiExtensions([
      { pages: [onePage('p1')], panels: [{ id: 'n1', slot: 'home', title: 'N1', blocks: [] }] },
      { pages: [onePage('p2')], panels: [{ id: 'n2', slot: 'home', title: 'N2', blocks: [] }] },
    ])
    // 顺序 = 输入顺序。
    expect(merged.pages.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(merged.panels.map((p) => p.id)).toEqual(['n1', 'n2'])
  })

  test('同 id 冲突：后出现者胜，且位置保持不变（不重复堆叠）', () => {
    // 警告回调。
    const warn = vi.fn()
    // 合并：后一份覆盖前一份的 p1。
    const merged = mergeUiExtensions([
      { pages: [onePage('p1', '旧标题')], stats: [{ key: 'K', label: '旧', kind: 'count' }] },
      { pages: [onePage('p1', '新标题')], stats: [{ key: 'K', label: '新', kind: 'ratio' }] },
    ], { warn })
    // 只有一条，且是新的。
    expect(merged.pages).toHaveLength(1)
    expect(merged.pages[0].title).toBe('新标题')
    // 统计的 kind 也被覆盖。
    expect(merged.stats).toEqual([{ key: 'K', label: '新', kind: 'ratio' }])
    // 出声（静默覆盖会让人以为"我加的面板消失了"）。
    expect(warn).toHaveBeenCalled()
  })

  test('属性项按 key 去重（与页面/面板的 id 同一套规则）', () => {
    // 合并。
    const merged = mergeUiExtensions([
      { properties: [{ key: 'LUCK', label: '幸运', mod: 'a' }] },
      { properties: [{ key: 'LUCK', label: '运气', mod: 'b' }] },
    ])
    // 后者胜，但保留来源（覆盖是浅合并）。
    expect(merged.properties).toHaveLength(1)
    expect(merged.properties[0].label).toBe('运气')
  })

  test('空输入 / 坏输入都给空注册表（不抛）', () => {
    // 各种坏输入。
    expect(mergeUiExtensions()).toEqual(emptyExtensions())
    expect(mergeUiExtensions([])).toEqual(emptyExtensions())
    expect(mergeUiExtensions([null, 'x', 0])).toEqual(emptyExtensions())
    // 段里塞垃圾。
    expect(mergeUiExtensions([{ pages: [null, 'x', { title: 'no id' }] }])).toEqual(emptyExtensions())
  })

  test('合并结果是新对象（不改入参）', () => {
    // 入参。
    const part = { pages: [onePage('p1')] }
    // 合并。
    const merged = mergeUiExtensions([part])
    // 改结果。
    merged.pages[0].title = '改过了'
    merged.pages.push(onePage('p2'))
    // 入参不受影响。
    expect(part.pages).toHaveLength(1)
    expect(part.pages[0].title).toBe('页面 p1')
  })
})

describe('ui-extensions - panelsForSlot', () => {
  test('按 slot 取出面板（顺序 = 注册顺序）', () => {
    // 合并。
    const merged = mergeUiExtensions([
      {
        panels: [
          { id: 'n1', slot: 'home', title: '首页 1', blocks: [] },
          { id: 'n2', slot: 'mods', title: '管理页', blocks: [] },
          { id: 'n3', slot: 'home', title: '首页 2', blocks: [] },
        ],
      },
    ])
    // home 两个。
    expect(panelsForSlot(merged, 'home').map((p) => p.id)).toEqual(['n1', 'n3'])
    // mods 一个。
    expect(panelsForSlot(merged, 'mods').map((p) => p.id)).toEqual(['n2'])
    // 没挂的 slot 给空数组（界面据此"有才渲染"）。
    expect(panelsForSlot(merged, 'settings')).toEqual([])
    expect(panelsForSlot(merged, 'game')).toEqual([])
  })

  test('空注册表 / undefined 都给空数组', () => {
    // 空。
    expect(panelsForSlot(emptyExtensions(), 'home')).toEqual([])
    expect(panelsForSlot(undefined, 'home')).toEqual([])
    expect(panelsForSlot({ panels: null }, 'home')).toEqual([])
  })
})
