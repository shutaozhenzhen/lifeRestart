/**
 * Mod 系统单元测试 — mod.spec.js
 *
 * 覆盖范围（5 组）：
 *   1. validateManifest（合法/非法/权限/依赖）
 *   2. resolveOrder（拓扑排序/循环依赖/缺失依赖）
 *   3. createModLoader（扫描/加载/合并覆盖）
 *   4. createGameAPI（钩子/CRUD/冲突覆盖）
 *   5. Mod 架构 v2：manifest 的 targets / entry / deterministic 三字段与取值助手
 *
 * 宿主桥（seam #3）的测试在 host.spec.js。
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
// Node 内置：临时文件。
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs'
// Node 内置：路径。
import { join } from 'node:path'
// Node 内置：临时目录。
import { tmpdir } from 'node:os'
// Node 内置：URL → 路径（定位仓库真实 mods/）。
import { fileURLToPath } from 'node:url'
// manifest 校验与排序 + v2 取值助手。
import { validateManifest, resolveOrder, manifestTargets, manifestEntry, manifestDeterministic, VALID_TARGETS, DEFAULT_BROWSER_ENTRY } from './manifest.js'
// Mod 加载器。
import { createModLoader, scanMods } from './loader.js'
// Node 文件源（平台无关内核的 fs 实现）。
import { createNodeSource } from './source-node.js'
// gameAPI。
import { createGameAPI, createHookBus } from './gameapi.js'
// 参数注册表。
import { createParamRegistry } from '../params/param-registry.js'

// ========== 测试组 1：validateManifest ==========
describe('mod - validateManifest', () => {
  test('valid manifest passes', async () => {
    // 合法 manifest。
    const m = { name: 'my-mod', version: '1.0.0', author: 'a', permissions: ['hooks'] }
    // 校验。
    expect(validateManifest(m).ok).toBe(true)
  })

  test('missing name fails', async () => {
    // 缺 name。
    const m = { version: '1.0.0' }
    // 校验。
    expect(validateManifest(m).ok).toBe(false)
  })

  test('missing version fails', async () => {
    // 缺 version。
    const m = { name: 'x' }
    // 校验。
    expect(validateManifest(m).ok).toBe(false)
  })

  test('invalid name chars fail', async () => {
    // 非法字符。
    const m = { name: 'bad name!', version: '1.0.0' }
    // 校验。
    expect(validateManifest(m).ok).toBe(false)
  })

  test('unknown permission fails', async () => {
    // 未知权限。
    const m = { name: 'x', version: '1', permissions: ['hack'] }
    // 校验。
    expect(validateManifest(m).ok).toBe(false)
  })

  test('valid permissions pass', async () => {
    // 合法权限。
    const m = { name: 'x', version: '1', permissions: ['ai', 'network', 'storage', 'hooks'] }
    // 校验。
    expect(validateManifest(m).ok).toBe(true)
  })

  test('non-object manifest fails', async () => {
    // 非对象。
    expect(validateManifest('nope').ok).toBe(false)
    // null。
    expect(validateManifest(null).ok).toBe(false)
  })
})

// ========== 测试组 2：resolveOrder ==========
describe('mod - resolveOrder', () => {
  test('sorts dependencies first', async () => {
    // 两个 Mod：b 依赖 a。
    const mods = [
      { name: 'b', dependencies: ['a'] },
      { name: 'a' },
    ]
    // 排序。
    const { order } = resolveOrder(mods)
    // a 先加载。
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
  })

  test('detects circular dependency', async () => {
    // 互相依赖。
    const mods = [
      { name: 'a', dependencies: ['b'] },
      { name: 'b', dependencies: ['a'] },
    ]
    // 排序。
    const { errors } = resolveOrder(mods)
    // 报循环错误。
    expect(errors.some(e => e.includes('循环依赖'))).toBe(true)
  })

  test('reports missing dependency', async () => {
    // 依赖不存在。
    const mods = [{ name: 'a', dependencies: ['ghost'] }]
    // 排序。
    const { errors } = resolveOrder(mods)
    // 报缺失错误。
    expect(errors.some(e => e.includes('缺失依赖'))).toBe(true)
  })

  test('no dependencies returns insertion order', async () => {
    // 无依赖。
    const mods = [{ name: 'x' }, { name: 'y' }]
    // 排序。
    const { order } = resolveOrder(mods)
    // 顺序不变。
    expect(order).toEqual(['x', 'y'])
  })

  // --- loader 实际传进来的形态：{ name, manifest }（2026-10 修的真实 bug）---
  // 以前 resolveOrder 只读 `byName[name].dependencies`，而 loader.js:85 推的是
  // `{ name, manifest }` → 依赖永远读不到 → "依赖先加载"在加载链路上等于没生效，
  // 顺序退化成文件源的列表顺序（fun-mod→base-mod 恰好字母序正确，所以一直没暴露）。
  test('manifest 形态也要按 manifest.dependencies 排序（不能只看扫描顺序）', () => {
    // 目录名故意让"依赖方"排在前面（a-dependent 在 b-base 之前）。
    const mods = [
      { name: 'a-dependent', manifest: { name: 'a-dependent', version: '1.0.0', dependencies: ['b-base'] } },
      { name: 'b-base', manifest: { name: 'b-base', version: '1.0.0' } },
    ]
    // 排序。
    const { order, errors } = resolveOrder(mods)
    // 无错。
    expect(errors).toEqual([])
    // 被依赖的先加载（后加载者覆盖先加载者 → 依赖方的数据才不会被覆盖回去）。
    expect(order).toEqual(['b-base', 'a-dependent'])
  })

  test('manifest 形态的缺失依赖同样要报出来', () => {
    // 依赖不存在。
    const mods = [{ name: 'a', manifest: { name: 'a', version: '1.0.0', dependencies: ['ghost'] } }]
    // 排序。
    const { errors } = resolveOrder(mods)
    // 报缺失。
    expect(errors).toEqual(['缺失依赖: ghost'])
  })

  test('chain dependency sorts transitively', async () => {
    // 链：c→b→a。
    const mods = [
      { name: 'c', dependencies: ['b'] },
      { name: 'b', dependencies: ['a'] },
      { name: 'a' },
    ]
    // 排序。
    const { order } = resolveOrder(mods)
    // a 最先，c 最后。
    expect(order).toEqual(['a', 'b', 'c'])
  })
})

// ========== 测试组 3：createModLoader ==========
describe('mod - createModLoader', () => {
  // 临时目录。
  let tempDir
  // 建 Mod 辅助。
  function makeMod(name, manifest, files = {}) {
    // 目录。
    const dir = join(tempDir, name)
    // 建目录。
    mkdirSync(dir, { recursive: true })
    // manifest。
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
    // 数据文件。
    for (const [file, content] of Object.entries(files)) {
      // 写文件。
      writeFileSync(join(dir, file), JSON.stringify(content))
    }
    // 返回。
    return dir
  }

  beforeEach(() => {
    // 建临时目录。
    tempDir = mkdtempSync(join(tmpdir(), 'mod-test-'))
  })

  afterEach(() => {
    // 清理。
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('scans mods and loads in order', async () => {
    // Mod a。
    makeMod('a', { name: 'a', version: '1' }, { 'talents.json': { t1: { id: 't1', name: 'A天赋' } } })
    // Mod b 依赖 a。
    makeMod('b', { name: 'b', version: '1', dependencies: ['a'] }, { 'talents.json': { t2: { id: 't2', name: 'B天赋' } } })
    // 加载器。
    const loader = await createModLoader({ source: createNodeSource(tempDir) })
    // 无错误。
    expect(loader.errors).toEqual([])
    // 加载全部。
    const { data } = await loader.loadAll()
    // 两个天赋合并。
    expect(data.talents.t1.name).toBe('A天赋')
    expect(data.talents.t2.name).toBe('B天赋')
  })

  test('later mod overrides same id', async () => {
    // 两个 Mod 同名天赋。
    makeMod('a', { name: 'a', version: '1' }, { 'talents.json': { t1: { id: 't1', name: '原始' } } })
    makeMod('b', { name: 'b', version: '1' }, { 'talents.json': { t1: { id: 't1', name: '覆盖' } } })
    // 加载器。
    const loader = await createModLoader({ source: createNodeSource(tempDir) })
    // 加载。
    const { data } = await loader.loadAll()
    // 后加载者覆盖。
    expect(data.talents.t1.name).toBe('覆盖')
  })

  test('executes code.js with gameAPI', async () => {
    // Mod 含 code.js：注册钩子 + 注入天赋。
    const dir = makeMod('code-mod', { name: 'code-mod', version: '1' })
    // 写 code.js（原生 JS，非 JSON）。
    writeFileSync(join(dir, 'code.js'),
      'gameAPI.on("onYearAdvance", (p) => { p.content.push({ type: "EVT", description: "code注入" }) });\n' +
      'gameAPI.addTalent({ id: "code_t1", name: "代码天赋", grade: 1 });'
    )
    // 加载器。
    const loader = await createModLoader({ source: createNodeSource(tempDir) })
    // 记录钩子触发。
    const bus = createHookBus()
    // 加载并执行。
    const { data } = await loader.loadAll({
      createAPI: (name, mergedData) => createGameAPI({ data: mergedData, hooks: bus }),
    })
    // code.js 注入的天赋。
    expect(data.talents.code_t1.name).toBe('代码天赋')
    // 注册的钩子可触发。
    const payload = { content: [] }
    return bus.emit('onYearAdvance', payload).then(() => {
      // 钩子注入内容。
      expect(payload.content.some(c => c.description === 'code注入')).toBe(true)
    })
  })

  test('code.js exception is isolated', async () => {
    // Mod code.js 抛错。
    const dir = makeMod('bad-mod', { name: 'bad-mod', version: '1' })
    // 抛错代码。
    writeFileSync(join(dir, 'code.js'), 'throw new Error("boom")')
    // 加载器。
    const loader = await createModLoader({ source: createNodeSource(tempDir) })
    // 加载不抛（异常被隔离）。
    await expect(loader.loadAll({ createAPI: () => createGameAPI({ data: {} }) })).resolves.toBeTruthy()
  })

  test('invalid manifest is rejected', async () => {
    // 非法 manifest。
    makeMod('bad', { version: '1' })
    // 加载器。
    const loader = await createModLoader({ source: createNodeSource(tempDir) })
    // 报错。
    expect(loader.errors.some(e => e.includes('非法'))).toBe(true)
    // 不加载。
    expect(loader.mods.length).toBe(0)
  })

  test('missing manifest reported', async () => {
    // 无 manifest 的目录。
    mkdirSync(join(tempDir, 'nomod'), { recursive: true })
    // 加载器。
    const loader = await createModLoader({ source: createNodeSource(tempDir) })
    // 报错。
    expect(loader.errors.some(e => e.includes('缺少 manifest'))).toBe(true)
  })

  test('disabled directory is skipped', async () => {
    // disabled 目录。
    makeMod('disabled', { name: 'x', version: '1' })
    // 加载器（disabled 应是目录被排除）。
    const loader = await createModLoader({ source: createNodeSource(tempDir) })
    // disabled 被跳过。
    expect(loader.mods.some(m => m.name === 'x')).toBe(false)
  })

  test('scanMods returns mod list', async () => {
    // 两个 Mod。
    makeMod('a', { name: 'a', version: '1' })
    makeMod('b', { name: 'b', version: '1' })
    // 扫描。
    const { mods } = await scanMods({ source: createNodeSource(tempDir) })
    // 两个。
    expect(mods).toHaveLength(2)
  })
})

// ========== 测试组 4：createGameAPI ==========
describe('mod - createGameAPI', () => {
  test('hook on/emit/off works', async () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 记录。
    let called = 0
    // 回调。
    const fn = () => { called++ }
    // 注册。
    api.on('test', fn)
    // 触发。
    api.emit('test')
    // 调用一次。
    expect(called).toBe(1)
    // 移除。
    api.off('test', fn)
    // 触发。
    api.emit('test')
    // 不再调用。
    expect(called).toBe(1)
  })

  test('hooks execute in registration order', async () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 顺序记录。
    const order = []
    // 两个钩子。
    api.on('seq', () => order.push(1))
    api.on('seq', () => order.push(2))
    // 触发（emit 支持 async，需 await 保证全部执行）。
    await api.emit('seq')
    // 按序。
    expect(order).toEqual([1, 2])
  })

  test('async hooks are awaited in order', async () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 顺序记录。
    const order = []
    // 异步钩子（延迟执行）。
    api.on('seq', async () => { await Promise.resolve(); order.push(1) })
    api.on('seq', async () => { await Promise.resolve(); order.push(2) })
    // 触发。
    await api.emit('seq')
    // 按序。
    expect(order).toEqual([1, 2])
  })

  test('hook exception does not break others', async () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 记录。
    let reached = false
    // 抛错钩子 + 正常钩子。
    api.on('t', () => { throw new Error('boom') })
    api.on('t', () => { reached = true })
    // 触发。
    await api.emit('t')
    // 第二个仍执行。
    expect(reached).toBe(true)
  })

  test('property：没注入属性桥时是**降级桥**（available=false，写操作给可读错误）', () => {
    // API（不注入 property）。
    const api = createGameAPI({ data: {} })
    // 明确 advertise 不可用（Mod 应当先判断它）。
    expect(api.property.available).toBe(false)
    // 读取不抛（顺手读一下不该炸）。
    expect(api.property.get('CHR')).toBeUndefined()
    // 写操作**明确报错**（而不是静默写进一个没人读的对象里 —— 那正是修掉的旧行为）。
    expect(() => api.property.set('CHR', 10)).toThrow(/没有游戏属性系统/)
    expect(() => api.property.change('CHR', 1)).toThrow(/没有游戏属性系统/)
    expect(() => api.property.effect({ CHR: 1 })).toThrow(/没有游戏属性系统/)
  })

  test('property：注入属性桥后读写真实属性，并触发 propertyChange（source=mod）', () => {
    // 假属性模块（桥只依赖 get/set/change/effect/getAll/TYPES）。
    const calls = []
    const property = {
      TYPES: { CHR: 'CHR', SPR: 'SPR' },
      get: (p) => (p === 'CHR' ? 7 : undefined),
      set: (p, v, s) => calls.push(['set', p, v, s]),
      change: (p, v, s) => calls.push(['change', p, v, s]),
      effect: (e, s) => calls.push(['effect', e, s]),
      getAll: () => ({ CHR: 7 }),
    }
    // API。
    const api = createGameAPI({ data: {}, property })
    // 可用。
    expect(api.property.available).toBe(true)
    // 读。
    expect(api.property.get('CHR')).toBe(7)
    expect(api.property.all()).toEqual({ CHR: 7 })
    expect(api.property.types()).toEqual(['CHR', 'SPR'])
    // 写：**统一打上 source='mod'**（观察者据此过滤自己造成的变化）。
    api.property.set('CHR', 99)
    api.property.change('SPR', 1)
    api.property.effect({ CHR: 1 })
    // 转发正确。
    expect(calls).toEqual([
      ['set', 'CHR', 99, 'mod'],
      ['change', 'SPR', 1, 'mod'],
      ['effect', { CHR: 1 }, 'mod'],
    ])
  })

  test('property：传 Life 本体也能建桥（取它的 .property 模块）', () => {
    // 假 Life。
    const property = { TYPES: {}, get: () => 42, set: () => {}, change: () => {}, effect: () => {}, getAll: () => ({}) }
    // API（property 传的是"有 .property 的对象"）。
    const api = createGameAPI({ data: {}, property: { property } })
    // 可用且读到了值。
    expect(api.property.available).toBe(true)
    expect(api.property.get('CHR')).toBe(42)
  })

  test('addTalent with conflict overrides', async () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 添加。
    api.addTalent({ id: 't1', name: '第一版' })
    // 覆盖。
    api.addTalent({ id: 't1', name: '第二版' })
    // 覆盖生效。
    expect(api.getTalent('t1').name).toBe('第二版')
  })

  test('addEvent/removeEvent works', async () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 添加。
    api.addEvent({ id: 'e1', event: '描述' })
    // 读取。
    expect(api.getEvent('e1').event).toBe('描述')
    // 删除。
    api.removeEvent('e1')
    // 已删。
    expect(api.getEvent('e1')).toBeUndefined()
  })

  test('addAchievement works', async () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 添加。
    api.addAchievement({ id: 'a1', name: '成就' })
    // 读取。
    expect(api.getAchievement('a1').name).toBe('成就')
  })

  test('removeTalent works', async () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 添加。
    api.addTalent({ id: 't1', name: 'x' })
    // 删除。
    api.removeTalent('t1')
    // 已删。
    expect(api.getTalent('t1')).toBeUndefined()
  })

  test('createHookBus standalone works', async () => {
    // 总线。
    const bus = createHookBus()
    // 注册。
    bus.on('a', () => 1)
    // 有钩子。
    expect(bus.has('a')).toBe(true)
    // 列出。
    expect(bus.list()).toEqual({ a: 1 })
  })

  test('accepts external hook bus (shared with Life)', async () => {
    // 外部总线。
    const bus = createHookBus()
    // gameAPI 用外部总线。
    const api = createGameAPI({ data: {}, hooks: bus })
    // 记录。
    const calls = []
    // 注册钩子。
    api.on('onYearAdvance', (payload) => calls.push(payload))
    // 引擎侧通过同一总线触发。
    await bus.emit('onYearAdvance', { age: 5 })
    // 钩子被触发。
    expect(calls).toEqual([{ age: 5 }])
  })

  test('gameAPI.ai unavailable when no ai config', async () => {
    // 无 AI 配置。
    const api = createGameAPI({ data: {} })
    // 不可用。
    expect(api.ai.available).toBe(false)
    // 调用抛错。
    expect(() => api.ai.generate({ prompt: 'x' })).toThrow()
  })

  test('gameAPI.ai delegates to client when configured', async () => {
    // mock AI 客户端。
    const aiClient = {
      chatCompletion: async ({ messages }) => `reply:${messages.length}`,
      generateJSON: async ({ user }) => ({ id: user }),
    }
    // 配置 AI。
    const api = createGameAPI({ data: {}, ai: { client: aiClient, baseUrl: 'x', model: 'm' } })
    // 可用。
    expect(api.ai.available).toBe(true)
    // 对话。
    const chat = await api.ai.chat({ messages: [{ role: 'user', content: 'hi' }] })
    expect(chat).toBe('reply:1')
    // 生成。
    const gen = await api.ai.generate({ user: 'gen-me' })
    expect(gen).toEqual({ id: 'gen-me' })
  })

  test('gameAPI.param defines and reads custom params', async () => {
    // 参数注册表。
    const registry = createParamRegistry()
    // 定义基础参数。
    registry.define('CHR', { type: 'local' })
    // API（注入注册表）。
    const api = createGameAPI({ data: {}, params: registry })
    // param 可用。
    expect(api.param).not.toBeNull()
    // reset。
    registry.reset({ CHR: 5 })
    // 读。
    expect(api.param.get('CHR')).toBe(5)
    // 注册自定义参数（function 类型）。
    api.param.define('DOUBLE', { type: 'function', get: "return ctx.get('CHR') * 2" })
    // 读。
    expect(api.param.get('DOUBLE')).toBe(10)
    // 写。
    api.param.set('CHR', 7)
    expect(api.param.get('DOUBLE')).toBe(14)
    // 全部。
    expect(api.param.names).toContain('CHR')
    expect(api.param.names).toContain('DOUBLE')
  })
})

// ========== 测试组 5：manifest v2（targets / entry / deterministic）==========
describe('mod - manifest v2 字段与取值助手', () => {
  // 仓库真实 mods 目录（用于"内置 Mod 语义不变"的回归）。
  const MODS_DIR = fileURLToPath(new URL('../../../../mods/', import.meta.url))

  // --- 向后兼容：不写新字段 = 与旧版逐位一致 ---

  test('旧 manifest（无新字段）仍然合法', () => {
    // 旧版典型 manifest。
    const old = { name: 'old-mod', version: '1.0.0', permissions: ['hooks'], dependencies: ['base-mod'] }
    // 校验通过。
    expect(validateManifest(old)).toEqual({ ok: true, errors: [] })
  })

  test('旧 manifest 的取值助手给出旧语义默认值', () => {
    // 旧版 manifest。
    const old = { name: 'old-mod', version: '1.0.0' }
    // 目标缺省纯前端。
    expect(manifestTargets(old)).toEqual(['browser'])
    // 浏览器入口缺省 code.js（与 loader.js 的 CODE_FILE 一致）。
    expect(manifestEntry(old, 'browser')).toBe('code.js')
    expect(manifestEntry(old, 'browser')).toBe(DEFAULT_BROWSER_ENTRY)
    // 没有后端入口。
    expect(manifestEntry(old, 'node')).toBeNull()
    // 缺省确定（纯前端 → 可复现承诺成立）。
    expect(manifestDeterministic(old)).toBe(true)
  })

  test('空对象/undefined 也能安全取默认值', () => {
    // 不炸，且语义与旧版一致。
    expect(manifestTargets(undefined)).toEqual(['browser'])
    expect(manifestEntry({}, 'browser')).toBe('code.js')
    expect(manifestEntry({}, 'node')).toBeNull()
    expect(manifestDeterministic({})).toBe(true)
  })

  test('manifestTargets 返回新数组（外部改不到内部）', () => {
    // 带 targets 的 manifest。
    const m = { name: 'a', version: '1.0.0', targets: ['browser', 'node'] }
    // 取出并改。
    manifestTargets(m).push('hacked')
    // 原数据不受影响。
    expect(m.targets).toEqual(['browser', 'node'])
  })

  // --- 合法值 ---

  test('完整 v2 manifest 通过校验', () => {
    // 双目标。
    const m = {
      name: 'dual-mod',
      version: '1.0.0',
      targets: ['browser', 'node'],
      entry: { browser: 'code.js', node: 'server.js' },
      deterministic: false,
    }
    // 校验。
    expect(validateManifest(m)).toEqual({ ok: true, errors: [] })
    // 助手取值。
    expect(manifestTargets(m)).toEqual(['browser', 'node'])
    expect(manifestEntry(m, 'node')).toBe('server.js')
    expect(manifestDeterministic(m)).toBe(false)
  })

  test('只声明 node 目标也合法（后端 Mod）', () => {
    // 纯后端。
    const m = { name: 'back-mod', version: '1.0.0', targets: ['node'], entry: { node: 'server.mjs' } }
    // 校验。
    expect(validateManifest(m).ok).toBe(true)
    // 入口可自定义扩展名（.mjs 在无 type:module 的目录里也按 ESM 解析）。
    expect(manifestEntry(m, 'node')).toBe('server.mjs')
  })

  test('VALID_TARGETS 就是 browser / node', () => {
    // 契约常量（改它会牵动校验与宿主桥语义）。
    expect(VALID_TARGETS).toEqual(['browser', 'node'])
  })

  // --- targets 非法 ---

  test('targets 必须是数组且非空', () => {
    // 非数组。
    expect(validateManifest({ name: 'a', version: '1', targets: 'browser' }).errors).toContain('targets 必须是数组')
    // 空数组。
    expect(validateManifest({ name: 'a', version: '1', targets: [] }).errors).toContain('targets 不能是空数组（缺省为 ["browser"]）')
  })

  test('targets 含未知值：报错并列出合法值', () => {
    // 未知目标。
    const r = validateManifest({ name: 'a', version: '1', targets: ['browser', 'electron'] })
    // 不合法。
    expect(r.ok).toBe(false)
    // 错误可读。
    expect(r.errors[0]).toMatch(/未知 target: electron/)
    expect(r.errors[0]).toMatch(/browser \/ node/)
  })

  test('targets 有重复项：报错', () => {
    // 重复。
    const r = validateManifest({ name: 'a', version: '1', targets: ['node', 'node'] })
    // 不合法。
    expect(r.errors).toContain('targets 不能有重复项')
  })

  // --- entry 非法 ---

  test('entry 必须是对象（非数组/非 null）', () => {
    // 数组。
    expect(validateManifest({ name: 'a', version: '1', entry: [] }).errors).toContain('entry 必须是对象')
    // 字符串。
    expect(validateManifest({ name: 'a', version: '1', entry: 'code.js' }).errors).toContain('entry 必须是对象')
  })

  test('entry 含未知目标键：报错并列出合法键', () => {
    // 未知键。
    const r = validateManifest({ name: 'a', version: '1', entry: { desktop: 'main.js' } })
    // 错误可读。
    expect(r.errors[0]).toMatch(/entry 含未知目标键: desktop/)
    expect(r.errors[0]).toMatch(/browser \/ node/)
  })

  test('entry 的值必须是非空字符串', () => {
    // 空串。
    expect(validateManifest({ name: 'a', version: '1', entry: { node: '' } }).errors).toContain('entry.node 必须是非空字符串')
    // 数字。
    expect(validateManifest({ name: 'a', version: '1', entry: { node: 42 } }).errors).toContain('entry.node 必须是非空字符串')
  })

  test('entry 拒绝路径穿越与绝对路径（同 zip 的防护思路）', () => {
    // 各种危险写法。
    for (const bad of ['../evil.js', 'a/../../evil.js', '/etc/passwd', 'C:/win.js', 'C:\\win.js']) {
      // 校验。
      const r = validateManifest({ name: 'a', version: '1', entry: { node: bad } })
      // 必然不合法。
      expect(r.ok, `应拒绝: ${bad}`).toBe(false)
      // 错误信息统一。
      expect(r.errors).toContain('entry.node 必须是不含路径穿越的相对文件名')
    }
  })

  test('entry 允许子目录里的相对文件', () => {
    // 子目录是合理的（Mod 可能把后端代码放 src/ 下）。
    const r = validateManifest({ name: 'a', version: '1', entry: { node: 'src/server.js' } })
    // 通过。
    expect(r.ok).toBe(true)
  })

  // --- deterministic ---

  test('deterministic 必须是布尔值', () => {
    // 字符串。
    expect(validateManifest({ name: 'a', version: '1', deterministic: 'yes' }).errors).toContain('deterministic 必须是布尔值')
    // 数字。
    expect(validateManifest({ name: 'a', version: '1', deterministic: 0 }).errors).toContain('deterministic 必须是布尔值')
  })

  test('deterministic 缺省由 targets 推导（含 node → false）', () => {
    // 纯前端 → 确定。
    expect(manifestDeterministic({ name: 'a', version: '1' })).toBe(true)
    // 含 node → 不确定（宿主动作会改变结果）。
    expect(manifestDeterministic({ name: 'a', version: '1', targets: ['browser', 'node'] })).toBe(false)
    expect(manifestDeterministic({ name: 'a', version: '1', targets: ['node'] })).toBe(false)
  })

  test('deterministic 显式声明的优先级高于推导', () => {
    // 含 node 但作者声明确定（例如只读固定文件）。
    expect(manifestDeterministic({ name: 'a', version: '1', targets: ['node'], deterministic: true })).toBe(true)
    // 纯前端但作者声明不确定。
    expect(manifestDeterministic({ name: 'a', version: '1', deterministic: false })).toBe(false)
  })

  // --- 真实数据回归：内置 4 个 Mod 语义不变 ---

  test('仓库真实 mods/ 下所有 manifest 仍然合法，且语义等同旧版', () => {
    // 逐个真实 Mod 目录。
    const names = readdirSync(MODS_DIR, { withFileTypes: true })
      // 只取目录。
      .filter((e) => e.isDirectory())
      // 名字。
      .map((e) => e.name)
    // 至少要有内置的 4 个（防止路径写错导致空跑）。
    expect(names.length).toBeGreaterThanOrEqual(4)
    // 逐个校验。
    for (const name of names) {
      // manifest 路径。
      const file = join(MODS_DIR, name, 'manifest.json')
      // 必须有（数据 Mod 与系统 Mod 都带）。
      if (!existsSync(file)) continue
      // 解析。
      const manifest = JSON.parse(readFileSync(file, 'utf8'))
      // 合法。
      expect(validateManifest(manifest).ok, `${name} 的 manifest 应合法`).toBe(true)
      // 没有声明新字段 → 语义必须与旧版一致（纯前端 + 确定）。
      if (manifest.targets === undefined) {
        // 目标缺省。
        expect(manifestTargets(manifest)).toEqual(['browser'])
        // 确定。
        expect(manifestDeterministic(manifest)).toBe(true)
      }
    }
  })
})
