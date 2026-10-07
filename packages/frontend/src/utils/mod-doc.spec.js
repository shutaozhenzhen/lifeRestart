/**
 * mod-doc 单测 —— 两份 Mod 文档（制作文档 / gameAPI 参考）的**结构与覆盖性**守卫
 *
 * 文档写成结构化数据（见 components/DocPage.vue 文件头）之后就能被机器校验了。这里检查四件事：
 *   1. **结构完整**：章节 id 不重复、块类型合法、必填字段齐全、代码块非空、表格列数对得上
 *      —— 内容写错时页面上会渲染出"未知内容块"，这里更早一步挡住。
 *   2. **API 双向覆盖（最要紧的一条）**：把 MOD_API 里所有 `api` 块的 `path` 与引擎
 *      `createGameAPI()` **真实返回的键**比对 —— 引擎新加了方法而文档没跟上 → 红；
 *      文档写了不存在的 API → 也红。与 `statistics-view.spec.js` 的覆盖性守卫同一个思路。
 *   3. **核心内容没被删掉**：四个钩子名、5 张表文件名都要在文档里出现（防止重构时静默丢内容）。
 *   4. **文档里的链接指向真实存在的 Mod**：`/mods/example-mod` 必须在内置目录清单里，
 *      否则点过去是"未找到"。
 */
import { describe, test, expect } from 'vitest'
// 两份文档内容。
import { MOD_GUIDE } from './mod-doc-guide.js'
import { MOD_API } from './mod-doc-api.js'
// 内置目录清单（校验文档链接用）。
import { DEFAULT_MOD_LIST } from './mod-catalog.js'
// 引擎：真实 gameAPI（**唯一权威**，用来核对文档）。
import { createGameAPI, createHookBus } from 'game-engine/src/mod/gameapi.js'
import { createParamRegistry } from 'game-engine/src/params/param-registry.js'

// 允许展开到第二层的命名空间（其余键当叶子处理）。
// `ui` 是 2026-10 能力补齐 ③ 新增的（Mod 能加界面）—— 它的每个键都必须在文档里有条目。
const NAMESPACES = ['ai', 'param', 'property', 'host', 'asset', 'ui']

// 合法的块类型（DocBlocks.vue 里实现了这几种；`action` 是 2026-10 能力补齐 ③ 新增的动作按钮）。
const BLOCK_TYPES = ['p', 'sub', 'note', 'list', 'table', 'code', 'link', 'api', 'action']

// #collectApiPaths
// 从一个文档里收集所有 `api` 块的 path。
//
// @param {object} doc - 文档对象
// @returns {string[]} path 列表
function collectApiPaths(doc) {
  // 结果。
  const out = []
  // 逐章逐块。
  for (const s of doc.sections) {
    for (const b of s.blocks) {
      if (b.t === 'api') out.push(b.path)
    }
  }
  // 返回。
  return out
}

// #allText
// 把一个文档里所有块的可读文本拼起来（用于"核心内容还在不在"这类断言）。
//
// @param {object} doc - 文档对象
// @returns {string} 文本
function allText(doc) {
  // 收集。
  const parts = [doc.title, doc.subtitle || '']
  // 逐章逐块。
  for (const s of doc.sections) {
    // 章节标题。
    parts.push(s.title)
    // 块内容。
    for (const b of s.blocks) {
      // 常见字段。
      parts.push(b.text || '', b.code || '', b.path || '', b.sig || '')
      // 列表。
      if (Array.isArray(b.items)) parts.push(b.items.join(' '))
      // 表格。
      if (Array.isArray(b.head)) parts.push(b.head.join(' '))
      if (Array.isArray(b.rows)) parts.push(b.rows.map((r) => r.join(' ')).join(' '))
      // API 参数。
      if (Array.isArray(b.params)) parts.push(b.params.map((p) => p.join(' ')).join(' '))
    }
  }
  // 拼起来。
  return parts.join('\n')
}

// #realApi
// 造一个"能力最全"的真实 gameAPI（把可选依赖都注入，这样所有键都存在）。
//
// @returns {object} gameAPI
function realApi() {
  // 内存 storage（参数注册表需要）。
  const storage = { getItem: () => null, setItem: () => {} }
  // 构造。
  return createGameAPI({
    // 空数据。
    data: {},
    // 钩子总线。
    hooks: createHookBus(),
    // 参数注册表（**不注入时 gameAPI.param 是 null**，我们要最全的形态）。
    params: createParamRegistry({ data: {}, storage }),
    // AI 客户端（不注入时 ai.available 为 false）。
    ai: { client: { chatCompletion: async () => '', generateJSON: async () => ({}) } },
    // AI Mod 工厂（不注入时 createAIMod 是 null）。
    aiModFactory: () => ({ register: () => {}, unregister: () => {}, generateTalent: async () => ({}), generateEvent: async () => ({}) }),
  })
}

// 两份文档（同一个 describe 里跑同样的结构检查）。
const DOCS = [
  ['制作文档', MOD_GUIDE],
  ['API 参考', MOD_API],
]

describe('mod-doc - 结构完整性', () => {
  // 逐个文档。
  for (const [label, doc] of DOCS) {
    test(`${label}：基本信息齐全`, () => {
      // id / 标题 / 副标题。
      expect(doc.id).toBeTruthy()
      expect(doc.title).toBeTruthy()
      expect(doc.subtitle).toBeTruthy()
      // 章节数量：真·详细（防止有人把它删成三行）。
      expect(doc.sections.length).toBeGreaterThanOrEqual(10)
    })

    test(`${label}：章节 id 唯一、标题齐全、块不为空`, () => {
      // 收集 id。
      const ids = doc.sections.map((s) => s.id)
      // 唯一。
      expect(new Set(ids).size).toBe(ids.length)
      // 逐章。
      for (const s of doc.sections) {
        // 有 id 与标题。
        expect(s.id, '章节缺 id').toBeTruthy()
        expect(s.title, `章节 ${s.id} 缺标题`).toBeTruthy()
        // 有块。
        expect(s.blocks.length, `章节 ${s.id} 没有内容块`).toBeGreaterThan(0)
      }
    })

    test(`${label}：块类型合法、必填字段齐全`, () => {
      // 逐章逐块。
      for (const s of doc.sections) {
        // 逐块。
        for (const [i, b] of s.blocks.entries()) {
          // 位置（报错时好定位）。
          const at = `${s.id}#${i}`
          // 类型合法。
          expect(BLOCK_TYPES, `${at} 的块类型非法：${b.t}`).toContain(b.t)
          // 按类型查必填。
          if (b.t === 'p' || b.t === 'sub' || b.t === 'note') expect(b.text, `${at} 缺 text`).toBeTruthy()
          if (b.t === 'note') expect(['info', 'warn', 'tip']).toContain(b.kind || 'info')
          if (b.t === 'list') expect(Array.isArray(b.items) && b.items.length > 0, `${at} 的 items 为空`).toBe(true)
          if (b.t === 'code') expect(String(b.code || '').trim().length, `${at} 的代码块为空`).toBeGreaterThan(0)
          if (b.t === 'link') expect(b.to, `${at} 缺 to`).toBeTruthy()
          if (b.t === 'table') {
            // 表头非空。
            expect(Array.isArray(b.head) && b.head.length > 0, `${at} 的表头为空`).toBe(true)
            // 每行不超过表头列数（DocPage 会把最后一行补齐，但超了就是写错了）。
            for (const row of b.rows) expect(row.length, `${at} 有一行的列数超过表头`).toBeLessThanOrEqual(b.head.length)
          }
          if (b.t === 'api') {
            // API 条目必须有 path 与签名。
            expect(b.path, `${at} 缺 path`).toBeTruthy()
            expect(b.sig, `${at} 缺 sig`).toBeTruthy()
            // 参数要么不写，要么每条都是 [名字, 类型, 说明]。
            if (b.params) for (const p of b.params) expect(p.length, `${at} 的参数项应为 [名字,类型,说明]`).toBe(3)
          }
        }
      }
    })
  }
})

describe('mod-doc - API 覆盖性（与引擎真实键双向核对）', () => {
  test('顶层键：文档一条不多一条不少', () => {
    // 真实顶层键。
    const real = Object.keys(realApi()).sort()
    // 文档里的一级 path（不含 "."）。
    const documented = collectApiPaths(MOD_API).filter((p) => !p.includes('.')).sort()
    // 双向比较（缺了/多了都会红，并把差异打出来）。
    expect(documented, `文档与引擎不一致：缺 ${real.filter((k) => !documented.includes(k)).join(',') || '无'}；多 ${documented.filter((k) => !real.includes(k)).join(',') || '无'}`).toEqual(real)
  })

  test('二级键：ai / param / property / host / asset / ui 的每个 key 都被文档覆盖', () => {
    // 真实的二级 path。
    const api = realApi()
    const real = []
    for (const ns of NAMESPACES) {
      for (const k of Object.keys(api[ns] || {})) real.push(`${ns}.${k}`)
    }
    // 文档里的二级 path。
    const documented = collectApiPaths(MOD_API).filter((p) => p.includes('.'))
    // 逐个必须有文档。
    for (const p of real) expect(documented, `引擎有 ${p}，但文档里没写`).toContain(p)
    // 反向：文档里写的必须真实存在。
    for (const p of documented) expect(real, `文档写了 ${p}，但引擎里没有`).toContain(p)
  })

  test('没有重复的 API 条目（同一个 path 只讲一次）', () => {
    // 收集。
    const paths = collectApiPaths(MOD_API)
    // 唯一。
    expect(new Set(paths).size).toBe(paths.length)
  })

  test('四个钩子名都在文档里（核心能力面不能被重构掉）', () => {
    // 全文。
    const text = allText(MOD_API)
    // 逐个。
    for (const h of ['onTalentPoolGenerate', 'onYearAdvance', 'onEventRender', 'propertyChange']) {
      expect(text, `API 文档里找不到钩子 ${h}`).toContain(h)
    }
  })
})

describe('mod-doc - 制作文档的关键内容', () => {
  test('五张数据表与两份入口文件都被讲到', () => {
    // 全文。
    const text = allText(MOD_GUIDE)
    // 表文件名 + manifest + code.js。
    for (const f of ['talents.json', 'events.json', 'achievements.json', 'characters.json', 'age.json', 'manifest.json', 'code.js']) {
      expect(text, `制作文档里没讲到 ${f}`).toContain(f)
    }
  })

  test('几个"最容易踩的坑"必须写在文档里（它们是这份文档存在的理由）', () => {
    // 全文。
    const text = allText(MOD_GUIDE)
    // 逐条（都是 2026-10 实际踩过/核对过的）。
    const musts = [
      '整键替换',            // age 表的语义
      'NoRandom',           // 事件字段
      'opportunity',        // 成就时机
      'maxTriggers',        // 运行期注入天赋的陷阱
      'dependencies',       // 加载顺序
      'vendor/',            // 运行时依赖
      'export',             // code.js 不是模块
    ]
    // 逐个。
    for (const m of musts) expect(text, `制作文档里缺少关键提示：${m}`).toContain(m)
  })

  test('文档里指向示例 Mod 的链接，指向的是一个真实存在的 Mod', () => {
    // 收集所有站内链接。
    const links = []
    for (const doc of [MOD_GUIDE, MOD_API]) {
      for (const s of doc.sections) for (const b of s.blocks) if (b.t === 'link') links.push(b.to)
    }
    // 至少有一条指向示例 Mod。
    expect(links).toContain('/mods/example-mod')
    // 且它必须在内置目录清单里（否则点过去是"未找到 Mod"）。
    expect(DEFAULT_MOD_LIST.map((m) => m.name)).toContain('example-mod')
    // 内置清单里的描述要与 manifest 对得上（页面上两处显示同一个东西）。
    const item = DEFAULT_MOD_LIST.find((m) => m.name === 'example-mod')
    expect(item.enabled).toBe(false)   // 教学 Mod 默认禁用（不悄悄改变所有人的游戏数据）
  })
})
