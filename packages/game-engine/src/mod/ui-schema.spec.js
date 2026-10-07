/**
 * ui-schema 单测 —— Mod 界面扩展声明的 schema 校验（2026-10 能力补齐 ③）
 *
 * 这条能力以前是**硬边界**：`AGENTS.md` 边界 ① 写着"不能加界面 —— 没有页面/组件/路由/
 * 属性面板注册 API"。现在 Mod 可以在 `manifest.ui` 里声明四类扩展点，本 spec 钉住
 * 校验规则（合法声明、未知 slot、超上限、重复 id、非数组、缺 title/blocks）与
 * **错误信息可操作性**，以及 `manifest.js` 真的接上了这条校验。
 */
import { describe, test, expect } from 'vitest'
// 被测模块。
import {
  UI_SLOTS,
  UI_LIMITS,
  UI_KINDS,
  validateUiDeclaration,
  emptyUiDeclaration,
  uiPages,
  uiPanels,
  uiProperties,
  uiStats,
  manifestUi,
} from './ui-schema.js'
// manifest 校验（接线核对）。
import { validateManifest } from './manifest.js'

// #page
// 造一个合法页面声明。
//
// @param {object} [over] - 覆盖字段
// @returns {object} 页面声明
function page(over = {}) {
  // 缺省一条最小合法页面。
  return { id: 'p1', title: '我的页面', blocks: [{ t: 'p', text: '你好' }], ...over }
}

// #panel
// 造一个合法面板声明。
//
// @param {object} [over] - 覆盖字段
// @returns {object} 面板声明
function panel(over = {}) {
  // 缺省一条最小合法面板（slot=home 是白名单里的第一个）。
  return { id: 'n1', slot: 'home', title: '我的面板', blocks: [{ t: 'p', text: '你好' }], ...over }
}

describe('ui-schema - 合法声明', () => {
  test('未声明 / null 都是合法的"没有界面扩展"，并给出空四元组', () => {
    // 未声明。
    const a = validateUiDeclaration(undefined)
    expect(a.ok).toBe(true)
    expect(a.errors).toEqual([])
    expect(a.ui).toEqual(emptyUiDeclaration())
    // null 等价。
    expect(validateUiDeclaration(null).ok).toBe(true)
    // 空对象也合法（四类都缺省为空）。
    const c = validateUiDeclaration({})
    expect(c.ok).toBe(true)
    expect(c.ui).toEqual({ pages: [], panels: [], properties: [], stats: [] })
  })

  test('四类扩展点齐备时全部规范化通过（slot/kind 白名单都认）', () => {
    // 一份"什么都用上"的声明。
    const result = validateUiDeclaration({
      // 页面。
      pages: [page()],
      // 面板：六个 slot 全部合法。
      panels: UI_SLOTS.map((slot, i) => panel({ id: `n${i}`, slot, title: `面板 ${slot}` })),
      // 属性项。
      properties: [{ key: 'LUCK', label: '幸运' }],
      // 统计项：kind 缺省 = count。
      stats: [{ key: 'RKEY', label: 'Mod 计数' }, { key: 'RRATIO', label: 'Mod 比率', kind: 'ratio' }],
    })
    // 通过。
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    // 页面。
    expect(result.ui.pages).toHaveLength(1)
    expect(result.ui.pages[0].title).toBe('我的页面')
    // 面板（slot 原样保留）。
    expect(result.ui.panels.map((p) => p.slot)).toEqual(UI_SLOTS)
    // 属性 / 统计。
    expect(result.ui.properties).toEqual([{ key: 'LUCK', label: '幸运' }])
    expect(result.ui.stats).toEqual([
      { key: 'RKEY', label: 'Mod 计数', kind: 'count' },
      { key: 'RRATIO', label: 'Mod 比率', kind: 'ratio' },
    ])
  })

  test('规范化会复制内容（调用方改结果不会串回 manifest）', () => {
    // 原文。
    const source = { pages: [page()] }
    // 校验。
    const { ui } = validateUiDeclaration(source)
    // 改规范化结果里的块。
    ui.pages[0].blocks[0].text = '改过了'
    ui.pages.push(page({ id: 'p2' }))
    // 原文不受影响。
    expect(source.pages).toHaveLength(1)
    expect(source.pages[0].blocks[0].text).toBe('你好')
  })
})

describe('ui-schema - 错误行为（信息必须可操作）', () => {
  test('未知 slot 报错并列出合法值（不是静默忽略）', () => {
    // 校验。
    const r = validateUiDeclaration({ panels: [panel({ slot: 'sidebar' })] })
    // 报错。
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(1)
    // 信息里同时有"实际值"与"全部合法值"。
    expect(r.errors[0]).toContain('"sidebar"')
    expect(r.errors[0]).toContain('home/mods/property/game/summary/settings')
    // 非法面板不入结果。
    expect(r.ui.panels).toEqual([])
  })

  test('每类扩展点超上限时报错并说明上限', () => {
    // 超一个。
    const tooMany = (n, make) => Array.from({ length: n }, (_, i) => make(i))
    // 页面超限。
    const pages = validateUiDeclaration({ pages: tooMany(UI_LIMITS.pages + 1, (i) => page({ id: `p${i}` })) })
    expect(pages.ok).toBe(false)
    expect(pages.errors[0]).toContain(`最多 ${UI_LIMITS.pages} 项`)
    expect(pages.errors[0]).toContain(`当前 ${UI_LIMITS.pages + 1} 项`)
    // 面板超限。
    const panels = validateUiDeclaration({ panels: tooMany(UI_LIMITS.panels + 1, (i) => panel({ id: `n${i}` })) })
    expect(panels.ok).toBe(false)
    expect(panels.errors[0]).toContain(`最多 ${UI_LIMITS.panels} 项`)
    // 属性超限。
    const props = validateUiDeclaration({ properties: tooMany(UI_LIMITS.properties + 1, (i) => ({ key: `K${i}`, label: `属性${i}` })) })
    expect(props.ok).toBe(false)
    expect(props.errors[0]).toContain(`最多 ${UI_LIMITS.properties} 项`)
    // 统计超限。
    const stats = validateUiDeclaration({ stats: tooMany(UI_LIMITS.stats + 1, (i) => ({ key: `S${i}`, label: `统计${i}` })) })
    expect(stats.ok).toBe(false)
    expect(stats.errors[0]).toContain(`最多 ${UI_LIMITS.stats} 项`)
    // 上限刚好等于时合法。
    const atLimit = validateUiDeclaration({ pages: tooMany(UI_LIMITS.pages, (i) => page({ id: `q${i}` })) })
    expect(atLimit.ok).toBe(true)
    expect(atLimit.ui.pages).toHaveLength(UI_LIMITS.pages)
  })

  test('同一个 Mod 内重复 id 直接报错（含跨类别撞车）', () => {
    // 同类重复。
    const same = validateUiDeclaration({ pages: [page(), page()] })
    expect(same.ok).toBe(false)
    expect(same.errors.some((e) => e.includes('必须唯一'))).toBe(true)
    // 只收下第一个。
    expect(same.ui.pages).toHaveLength(1)
    // 跨类别撞车（页面 id 与面板 id 相同）：同样是笔误，一起挡。
    const cross = validateUiDeclaration({ pages: [page({ id: 'x' })], panels: [panel({ id: 'x' })] })
    expect(cross.ok).toBe(false)
    expect(cross.errors[0]).toContain('必须唯一')
    // 属性 key 与统计 key 撞车也算。
    const keyCross = validateUiDeclaration({ properties: [{ key: 'K', label: '属性' }], stats: [{ key: 'K', label: '统计' }] })
    expect(keyCross.ok).toBe(false)
    // 不重复时合法。
    const ok = validateUiDeclaration({ pages: [page({ id: 'a' })], panels: [panel({ id: 'b' })] })
    expect(ok.ok).toBe(true)
  })

  test('非数组 / 元素不是对象 / 未知字段都会报错', () => {
    // ui 本身不是对象。
    const notObject = validateUiDeclaration([])
    expect(notObject.ok).toBe(false)
    expect(notObject.errors[0]).toContain('ui 必须是对象')
    // 某类不是数组。
    const notArray = validateUiDeclaration({ panels: { id: 'n1' } })
    expect(notArray.ok).toBe(false)
    expect(notArray.errors).toContain('ui.panels 必须是数组')
    // 元素不是对象。
    const notItems = validateUiDeclaration({ pages: ['nope'] })
    expect(notItems.ok).toBe(false)
    expect(notItems.errors[0]).toContain('ui.pages[0] 必须是对象')
    // 未知字段（写错名字不能让整段静默失效）。
    const unknown = validateUiDeclaration({ page: [page()] })
    expect(unknown.ok).toBe(false)
    expect(unknown.errors[0]).toContain('ui 含未知字段: page')
    expect(unknown.errors[0]).toContain('pages / panels / properties / stats')
  })

  test('缺 title / 缺 blocks / 空 blocks 都报错（并指出块类型去哪看）', () => {
    // 缺标题。
    const noTitle = validateUiDeclaration({ pages: [page({ title: '' })] })
    expect(noTitle.ok).toBe(false)
    expect(noTitle.errors[0]).toContain('ui.pages[0].title')
    // 缺 blocks。
    const noBlocks = validateUiDeclaration({ pages: [{ id: 'p1', title: 'x' }] })
    expect(noBlocks.ok).toBe(false)
    expect(noBlocks.errors[0]).toContain('ui.pages[0].blocks')
    // 空 blocks。
    const emptyBlocks = validateUiDeclaration({ pages: [page({ blocks: [] })] })
    expect(emptyBlocks.ok).toBe(false)
    expect(emptyBlocks.errors[0]).toContain('ui.pages[0].blocks')
    // 块不是对象。
    const badBlock = validateUiDeclaration({ pages: [page({ blocks: ['x'] })] })
    expect(badBlock.ok).toBe(false)
    // 提示里给了块类型清单（作者知道该去查什么）。
    expect(badBlock.errors[0]).toContain('p/sub/note/list/table/code/link/api/action')
    // 面板同理。
    const panelNoTitle = validateUiDeclaration({ panels: [panel({ title: '' })] })
    expect(panelNoTitle.errors[0]).toContain('ui.panels[0].title')
    // 块数超上限。
    const manyBlocks = validateUiDeclaration({ pages: [page({ blocks: Array.from({ length: UI_LIMITS.blocks + 1 }, () => ({ t: 'p', text: 'x' })) })] })
    expect(manyBlocks.ok).toBe(false)
    expect(manyBlocks.errors[0]).toContain(`最多 ${UI_LIMITS.blocks} 块`)
  })

  test('properties / stats 的字段校验（key、label、kind 白名单）', () => {
    // key 缺失。
    const noKey = validateUiDeclaration({ properties: [{ label: '幸运' }] })
    expect(noKey.ok).toBe(false)
    expect(noKey.errors[0]).toContain('ui.properties[0].key')
    // label 缺失。
    const noLabel = validateUiDeclaration({ properties: [{ key: 'LUCK' }] })
    expect(noLabel.ok).toBe(false)
    expect(noLabel.errors[0]).toContain('ui.properties[0].label')
    // 属性元素不是对象。
    const notObj = validateUiDeclaration({ properties: ['LUCK'] })
    expect(notObj.ok).toBe(false)
    expect(notObj.errors[0]).toContain('{ key, label }')
    // 统计 kind 非法。
    const badKind = validateUiDeclaration({ stats: [{ key: 'R', label: '比率', kind: 'percent' }] })
    expect(badKind.ok).toBe(false)
    expect(badKind.errors[0]).toContain('"percent"')
    expect(badKind.errors[0]).toContain(UI_KINDS.join('/'))
    // 统计 key 缺失。
    const statNoKey = validateUiDeclaration({ stats: [{ label: 'x' }] })
    expect(statNoKey.ok).toBe(false)
    expect(statNoKey.errors[0]).toContain('ui.stats[0].key')
    // 统计 label 缺失。
    const statNoLabel = validateUiDeclaration({ stats: [{ key: 'R' }] })
    expect(statNoLabel.ok).toBe(false)
    expect(statNoLabel.errors[0]).toContain('ui.stats[0].label')
  })

  test('错误会一次报多条（不是遇到第一个就返回）', () => {
    // 三个错：未知 slot、缺标题、重复 id。
    const r = validateUiDeclaration({
      panels: [
        panel({ id: 'a', slot: 'sidebar' }),
        panel({ id: 'b', title: '' }),
        panel({ id: 'b' }),
      ],
    })
    // 至少三条。
    expect(r.errors.length).toBeGreaterThanOrEqual(3)
  })
})

describe('ui-schema - 取值助手', () => {
  test('四个助手各自取一类，写坏/没写都给空数组（调用方不用判空）', () => {
    // 一份合法 manifest。
    const manifest = {
      // 界面声明。
      ui: {
        pages: [page()],
        panels: [panel()],
        properties: [{ key: 'LUCK', label: '幸运' }],
        stats: [{ key: 'RKEY', label: '计数' }],
      },
    }
    // 逐个。
    expect(uiPages(manifest)).toHaveLength(1)
    expect(uiPanels(manifest)).toHaveLength(1)
    expect(uiProperties(manifest)).toEqual([{ key: 'LUCK', label: '幸运' }])
    expect(uiStats(manifest)).toEqual([{ key: 'RKEY', label: '计数', kind: 'count' }])
    // 没写 ui 的 manifest。
    expect(uiPages({ name: 'x' })).toEqual([])
    expect(uiPanels(undefined)).toEqual([])
    expect(uiProperties(null)).toEqual([])
    expect(uiStats({ ui: { pages: 'nope' } })).toEqual([])
    // manifestUi 一次取全。
    expect(manifestUi(manifest).pages).toHaveLength(1)
    expect(manifestUi({})).toEqual(emptyUiDeclaration())
  })
})

describe('manifest.js 接线 - ui 校验失败会报错', () => {
  test('合法 manifest（含 ui）通过校验', () => {
    // 完整 manifest。
    const r = validateManifest({
      name: 'my-mod',
      version: '1.0.0',
      ui: { pages: [page()], panels: [panel()], properties: [{ key: 'LUCK', label: '幸运' }], stats: [{ key: 'RKEY', label: '计数' }] },
    })
    // 通过。
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  test('ui 里的错误会并入 manifest 校验错误（同一条错误链路，信息可读）', () => {
    // 非法 slot + 超上限。
    const r = validateManifest({
      name: 'my-mod',
      version: '1.0.0',
      ui: { panels: [panel({ slot: 'nope' })] },
    })
    // 失败。
    expect(r.ok).toBe(false)
    // 信息可操作（带实际值与合法值）。
    expect(r.errors.join('\n')).toContain('不是合法 slot')
    expect(r.errors.join('\n')).toContain('home/mods/property/game/summary/settings')
  })

  test('不写 ui 的 manifest 行为逐位不变（旧 Mod 一个字都不用改）', () => {
    // 旧形态。
    const r = validateManifest({ name: 'old-mod', version: '0.1.0', permissions: ['hooks'] })
    // 通过且没有任何 ui 相关错误。
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })
})
