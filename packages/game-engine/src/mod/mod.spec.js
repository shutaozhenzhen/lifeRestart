/**
 * Mod 系统单元测试 — mod.spec.js
 *
 * 覆盖范围：33 个测试用例，分为 4 组：
 *   1. validateManifest（合法/非法/权限/依赖）
 *   2. resolveOrder（拓扑排序/循环依赖/缺失依赖）
 *   3. createModLoader（扫描/加载/合并覆盖）
 *   4. createGameAPI（钩子/CRUD/冲突覆盖）
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
// Node 内置：临时文件。
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
// Node 内置：路径。
import { join } from 'node:path'
// Node 内置：临时目录。
import { tmpdir } from 'node:os'
// manifest 校验与排序。
import { validateManifest, resolveOrder } from './manifest.js'
// Mod 加载器。
import { createModLoader, scanMods } from './loader.js'
// gameAPI。
import { createGameAPI, createHookBus } from './gameapi.js'

// ========== 测试组 1：validateManifest ==========
describe('mod - validateManifest', () => {
  test('valid manifest passes', () => {
    // 合法 manifest。
    const m = { name: 'my-mod', version: '1.0.0', author: 'a', permissions: ['hooks'] }
    // 校验。
    expect(validateManifest(m).ok).toBe(true)
  })

  test('missing name fails', () => {
    // 缺 name。
    const m = { version: '1.0.0' }
    // 校验。
    expect(validateManifest(m).ok).toBe(false)
  })

  test('missing version fails', () => {
    // 缺 version。
    const m = { name: 'x' }
    // 校验。
    expect(validateManifest(m).ok).toBe(false)
  })

  test('invalid name chars fail', () => {
    // 非法字符。
    const m = { name: 'bad name!', version: '1.0.0' }
    // 校验。
    expect(validateManifest(m).ok).toBe(false)
  })

  test('unknown permission fails', () => {
    // 未知权限。
    const m = { name: 'x', version: '1', permissions: ['hack'] }
    // 校验。
    expect(validateManifest(m).ok).toBe(false)
  })

  test('valid permissions pass', () => {
    // 合法权限。
    const m = { name: 'x', version: '1', permissions: ['ai', 'network', 'storage', 'hooks'] }
    // 校验。
    expect(validateManifest(m).ok).toBe(true)
  })

  test('non-object manifest fails', () => {
    // 非对象。
    expect(validateManifest('nope').ok).toBe(false)
    // null。
    expect(validateManifest(null).ok).toBe(false)
  })
})

// ========== 测试组 2：resolveOrder ==========
describe('mod - resolveOrder', () => {
  test('sorts dependencies first', () => {
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

  test('detects circular dependency', () => {
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

  test('reports missing dependency', () => {
    // 依赖不存在。
    const mods = [{ name: 'a', dependencies: ['ghost'] }]
    // 排序。
    const { errors } = resolveOrder(mods)
    // 报缺失错误。
    expect(errors.some(e => e.includes('缺失依赖'))).toBe(true)
  })

  test('no dependencies returns insertion order', () => {
    // 无依赖。
    const mods = [{ name: 'x' }, { name: 'y' }]
    // 排序。
    const { order } = resolveOrder(mods)
    // 顺序不变。
    expect(order).toEqual(['x', 'y'])
  })

  test('chain dependency sorts transitively', () => {
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

  test('scans mods and loads in order', () => {
    // Mod a。
    makeMod('a', { name: 'a', version: '1' }, { 'talents.json': { t1: { id: 't1', name: 'A天赋' } } })
    // Mod b 依赖 a。
    makeMod('b', { name: 'b', version: '1', dependencies: ['a'] }, { 'talents.json': { t2: { id: 't2', name: 'B天赋' } } })
    // 加载器。
    const loader = createModLoader({ modsDir: tempDir })
    // 无错误。
    expect(loader.errors).toEqual([])
    // 加载全部。
    const { data } = loader.loadAll()
    // 两个天赋合并。
    expect(data.talents.t1.name).toBe('A天赋')
    expect(data.talents.t2.name).toBe('B天赋')
  })

  test('later mod overrides same id', () => {
    // 两个 Mod 同名天赋。
    makeMod('a', { name: 'a', version: '1' }, { 'talents.json': { t1: { id: 't1', name: '原始' } } })
    makeMod('b', { name: 'b', version: '1' }, { 'talents.json': { t1: { id: 't1', name: '覆盖' } } })
    // 加载器。
    const loader = createModLoader({ modsDir: tempDir })
    // 加载。
    const { data } = loader.loadAll()
    // 后加载者覆盖。
    expect(data.talents.t1.name).toBe('覆盖')
  })

  test('executes code.js with gameAPI', () => {
    // Mod 含 code.js：注册钩子 + 注入天赋。
    const dir = makeMod('code-mod', { name: 'code-mod', version: '1' })
    // 写 code.js（原生 JS，非 JSON）。
    writeFileSync(join(dir, 'code.js'),
      'gameAPI.on("onYearAdvance", (p) => { p.content.push({ type: "EVT", description: "code注入" }) });\n' +
      'gameAPI.addTalent({ id: "code_t1", name: "代码天赋", grade: 1 });'
    )
    // 加载器。
    const loader = createModLoader({ modsDir: tempDir })
    // 记录钩子触发。
    const bus = createHookBus()
    // 加载并执行。
    const { data } = loader.loadAll({
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

  test('code.js exception is isolated', () => {
    // Mod code.js 抛错。
    const dir = makeMod('bad-mod', { name: 'bad-mod', version: '1' })
    // 抛错代码。
    writeFileSync(join(dir, 'code.js'), 'throw new Error("boom")')
    // 加载器。
    const loader = createModLoader({ modsDir: tempDir })
    // 加载不抛（异常被隔离）。
    expect(() => loader.loadAll({ createAPI: () => createGameAPI({ data: {} }) })).not.toThrow()
  })

  test('invalid manifest is rejected', () => {
    // 非法 manifest。
    makeMod('bad', { version: '1' })
    // 加载器。
    const loader = createModLoader({ modsDir: tempDir })
    // 报错。
    expect(loader.errors.some(e => e.includes('非法'))).toBe(true)
    // 不加载。
    expect(loader.mods.length).toBe(0)
  })

  test('missing manifest reported', () => {
    // 无 manifest 的目录。
    mkdirSync(join(tempDir, 'nomod'), { recursive: true })
    // 加载器。
    const loader = createModLoader({ modsDir: tempDir })
    // 报错。
    expect(loader.errors.some(e => e.includes('缺少 manifest'))).toBe(true)
  })

  test('disabled directory is skipped', () => {
    // disabled 目录。
    makeMod('disabled', { name: 'x', version: '1' })
    // 加载器（disabled 应是目录被排除）。
    const loader = createModLoader({ modsDir: tempDir })
    // disabled 被跳过。
    expect(loader.mods.some(m => m.name === 'x')).toBe(false)
  })

  test('scanMods returns mod list', () => {
    // 两个 Mod。
    makeMod('a', { name: 'a', version: '1' })
    makeMod('b', { name: 'b', version: '1' })
    // 扫描。
    const { mods } = scanMods(tempDir)
    // 两个。
    expect(mods).toHaveLength(2)
  })
})

// ========== 测试组 4：createGameAPI ==========
describe('mod - createGameAPI', () => {
  test('hook on/emit/off works', () => {
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

  test('property set triggers propertyChange hook', async () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 记录。
    let last = null
    // 钩子。
    api.on('propertyChange', ({ prop, value }) => { last = { prop, value } })
    // 设置（property.set 内部 emit 是异步的）。
    await api.property.set('CHR', 10)
    // 钩子触发。
    expect(last).toEqual({ prop: 'CHR', value: 10 })
  })

  test('addTalent with conflict overrides', () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 添加。
    api.addTalent({ id: 't1', name: '第一版' })
    // 覆盖。
    api.addTalent({ id: 't1', name: '第二版' })
    // 覆盖生效。
    expect(api.getTalent('t1').name).toBe('第二版')
  })

  test('addEvent/removeEvent works', () => {
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

  test('addAchievement works', () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 添加。
    api.addAchievement({ id: 'a1', name: '成就' })
    // 读取。
    expect(api.getAchievement('a1').name).toBe('成就')
  })

  test('removeTalent works', () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 添加。
    api.addTalent({ id: 't1', name: 'x' })
    // 删除。
    api.removeTalent('t1')
    // 已删。
    expect(api.getTalent('t1')).toBeUndefined()
  })

  test('createHookBus standalone works', () => {
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

  test('gameAPI.ai unavailable when no ai config', () => {
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
})
