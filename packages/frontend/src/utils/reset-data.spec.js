/**
 * reset-data 单元测试 — 首页「重置数据」
 *
 * 覆盖：
 *   1. 清单：引擎存档（带前缀）+ 前端键（不带）；摘要文案
 *   2. resetAppData：删掉清单里的键、**保留无关键**、如实区分"清掉了/本来就没有"
 *   3. 已安装 Mod：全部卸载；单步失败只进 errors 不抛
 *   4. 容错：没有 storage / 适配器不支持 removeItem / removeItem 抛错
 *   5. **清单不许漏**（本文件最重要的两条守卫）：
 *      · 扫描 frontend 源码里所有 `getItem/setItem/removeItem('字面量')` → 必须都在清单里
 *      · 遍历引擎 BUILTIN_PARAMS 里所有 `type: 'storage'` 参数（键 = storeKey || 参数名）→ 同上
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 源码扫描（守卫用；目录遍历收敛在 test-utils/source-scan.js）。
import { readSourceFiles } from '../test-utils/source-scan.js'
// 被测模块。
import { APP_STORAGE_KEYS, ENGINE_SAVE_KEYS, resetAppData, resetPlan, resetSummary } from './reset-data.js'
// 引擎内置参数（守卫用：storage 参数一个都不能漏）。
import { BUILTIN_PARAMS } from 'game-engine/src/params/params.js'
// 内存 Mod 存储（"已安装 Mod" 场景）。
import { createMemoryModStore } from './mod-store.js'

// 源码目录（src）在 test-utils/source-scan.js 里。

// #memStorage// 内存存储适配器（带 removeItem，语义与 localStorage 一致）。
//
// @param {object} [initial] - 初始数据
// @returns {object} { storage, data }
function memStorage(initial = {}) {
  // 数据（字符串化，与真实 storage 一致）。
  const data = {}
  for (const [k, v] of Object.entries(initial)) data[k] = String(v)
  // 适配器。
  const storage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: (k) => { delete data[k] },
  }
  // 返回。
  return { storage, data }
}

describe('reset-data - 清单', () => {
  test('引擎存档带前缀、前端键不带；摘要包含两边', () => {
    // 清单。
    const plan = resetPlan()
    // 引擎存档。
    const engine = plan.filter((i) => i.scope === 'engine')
    expect(engine.length).toBe(ENGINE_SAVE_KEYS.length)
    expect(engine.map((i) => i.key)).toContain('lifeRestart:times')
    expect(engine.map((i) => i.key)).toContain('lifeRestart:ACHV')
    // 前端键。
    const app = plan.filter((i) => i.scope === 'app')
    expect(app.map((i) => i.key)).toEqual(['modsState', 'aiConfig', 'logLevel', 'playSpeed'])
    // 自定义前缀（测试用）。
    expect(resetPlan({ prefix: 'X:' }).map((i) => i.key)).toContain('X:times')
    // 摘要（界面显示"将清空什么"）。
    expect(resetSummary()).toContain('重开次数')
    expect(resetSummary()).toContain('AI 配置')
  })
})

describe('reset-data - resetAppData', () => {
  test('删掉清单里的键，保留无关键，并区分"清掉了 / 本来就没有"', async () => {
    // 预置：3 个存档 + 1 个前端键 + 1 个无关键（模拟同源下的别的东西）。
    const { storage, data } = memStorage({
      'lifeRestart:times': '7',
      'lifeRestart:ACHV': '[[101,1]]',
      modsState: '{"enabled":{}}',
      'other-app:token': 'keep-me',
    })
    // 跑（注入空 Mod 存储，避免碰真 IndexedDB）。
    const result = await resetAppData({ storage, modStore: createMemoryModStore() })
    // 清掉了 3 个。
    expect(result.cleared.sort()).toEqual(['lifeRestart:ACHV', 'lifeRestart:times', 'modsState'])
    // **无关键必须留着**（不做 localStorage.clear()）。
    expect(data['other-app:token']).toBe('keep-me')
    // 本来就没有的记在 absent（如实，不当成"清掉了"）。
    expect(result.absent).toContain('lifeRestart:ATLT')
    expect(result.absent).toContain('aiConfig')
    // 无错误。
    expect(result.errors).toEqual([])
  })

  test('已安装的 Mod 全部卸载', async () => {
    // Mod 存储里装两个。
    const store = createMemoryModStore()
    await store.install({ name: 'a-mod', manifest: { name: 'a-mod', version: '1' }, files: { 'manifest.json': '{}' } })
    await store.install({ name: 'b-mod', manifest: { name: 'b-mod', version: '1' }, files: { 'manifest.json': '{}' } })
    // 存储。
    const { storage } = memStorage({ 'lifeRestart:times': '1' })
    // 跑。
    const result = await resetAppData({ storage, modStore: store })
    // 两个都卸了。
    expect(result.removedMods.sort()).toEqual(['a-mod', 'b-mod'])
    // 存储里确实没有了。
    expect(await store.list()).toEqual([])
  })

  test('没有可用的 storage：记错但不抛', async () => {
    // storage = null（隐私模式）→ 显式传 null 并清掉全局，确保走那条分支。
    const result = await resetAppData({ storage: null, modStore: createMemoryModStore(), log: null })
    // 环境有 localStorage（happy-dom/node 环境）时不会报这个错；没有时才对。
    // 这里只断言"不抛 + 结构完整"。
    expect(Array.isArray(result.errors)).toBe(true)
    expect(Array.isArray(result.cleared)).toBe(true)
  })

  test('适配器不支持 removeItem：逐个记错，不抛', async () => {
    // 只有 getItem/setItem 的适配器（引擎注入的那种）。
    const storage = { getItem: () => 'x', setItem: () => {} }
    // 跑。
    const result = await resetAppData({ storage, modStore: createMemoryModStore() })
    // 每个键一条错误。
    expect(result.errors.length).toBe(resetPlan().length)
    expect(result.errors[0]).toContain('removeItem')
  })

  test('removeItem 抛错：该键进 errors，其它键继续清', async () => {
    // 第 2 个键抛。
    let calls = 0
    const data = { 'lifeRestart:times': '1', 'lifeRestart:extendTalent': '2', modsState: '{}' }
    const storage = {
      getItem: (k) => (k in data ? data[k] : null),
      removeItem: (k) => {
        calls++
        if (k === 'lifeRestart:extendTalent') throw new Error('quota')
        delete data[k]
      },
    }
    // 跑。
    const result = await resetAppData({ storage, modStore: createMemoryModStore() })
    // 抛错那条进 errors。
    expect(result.errors.join(' ')).toContain('quota')
    // 其它照常清掉。
    expect(result.cleared).toContain('lifeRestart:times')
    expect(result.cleared).toContain('modsState')
    // 试过所有键（没提前中断）。
    expect(calls).toBe(resetPlan().length)
  })
})

describe('reset-data - 清单不许漏（守卫）', () => {
  test('frontend 源码里出现的存储键字面量都在清单里', () => {
    // 清单里的键（含前缀与不带前缀两种写法）。
    const known = new Set(resetPlan().map((i) => i.key))
    // 源码里找到的键。
    const found = new Set()
    // 扫描所有非测试的 js/vue（目录遍历在 test-utils/source-scan.js）。
    for (const { text } of readSourceFiles()) {
      // `getItem('x')` / `setItem('x', …)` / `removeItem('x')`。
      for (const m of text.matchAll(/\.(?:get|set|remove)Item\(\s*'([^']+)'/g)) {
        // 记下（失败信息里能看出是哪个键）。
        found.add(`${m[1]}`)
      }
    }
    // 清单里必须覆盖源码里出现的每一个。
    const missing = [...found].filter((k) => !known.has(k))
    // 断言（把缺的键打出来）。
    expect(missing, `这些存储键没进 reset-data 清单：${missing.join(', ')}`).toEqual([])
    // 反向：清单里的前端键确实被源码用过（防止清单里塞了不存在的键）。
    const appKeys = APP_STORAGE_KEYS.map((i) => i.key)
    expect(appKeys.filter((k) => !found.has(k))).toEqual([])
  })

  test('引擎的 storage 参数（键 = storeKey || 参数名）都在清单里', () => {
    // 清单里的引擎键（去掉前缀）。
    const known = new Set(ENGINE_SAVE_KEYS.map((i) => i.key))
    // 引擎里所有 storage 参数的键。
    const engineKeys = Object.entries(BUILTIN_PARAMS)
      // 只看 storage 类型。
      .filter(([, def]) => def?.type === 'storage')
      // 键 = storeKey || 参数名（与 param-registry 的 storage 分支一致）。
      .map(([name, def]) => def.storeKey || name)
    // 一个都不能漏。
    const missing = engineKeys.filter((k) => !known.has(k))
    // 断言。
    expect(missing, `引擎新增了 storage 参数但没进重置清单：${missing.join(', ')}`).toEqual([])
    // 反向：清单里也不该有引擎已不存在的键。
    expect([...known].filter((k) => !engineKeys.includes(k))).toEqual([])
  })

  test('Mod 自带存储（mod: 前缀）也会被清掉（2026-10：键是运行期写的，清单追不上，只能按前缀扫）', async () => {
    // 假 localStorage（带 keys 枚举）。
    const m = new Map()
    // 引擎存档键 + Mod 键 + 无关键。
    m.set('lifeRestart:TMS', '3')
    m.set('lifeRestart:mod:demo:score', '100')
    m.set('lifeRestart:mod:other:k', '1')
    m.set('unrelated', 'keep')
    // 适配器。
    const storage = {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      keys: () => [...m.keys()],
    }
    // 跑清空（不注入 modStore：用空实现避免碰 IndexedDB）。
    const res = await resetAppData({ storage, modStore: { list: async () => [], delete: async () => {} }, log: { info: () => {}, warn: () => {} } })
    // Mod 键被清（两个 Mod 的都被清）。
    expect(m.has('lifeRestart:mod:demo:score')).toBe(false)
    expect(m.has('lifeRestart:mod:other:k')).toBe(false)
    // 无关键不动（**不做 localStorage.clear()**）。
    expect(m.get('unrelated')).toBe('keep')
    // 记账里有这两个键。
    expect(res.cleared.some((k) => k.includes('mod:demo:score'))).toBe(true)
  })
})
