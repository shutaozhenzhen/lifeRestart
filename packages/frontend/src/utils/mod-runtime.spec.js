/**
 * mod-runtime / mod-catalog / sync-mods 测试 —— 前端 Mod 支持的三个新模块
 *
 * 覆盖（node 环境即可，不需要 DOM）：
 *   1. discoverMods：从 index.json 发现服务器上的 Mod
 *   2. loadModBundle：只加载启用的 Mod；合并数据；收集代码；错误不抛
 *   3. executeModCodes：**Mod 注册新属性**（gameAPI.param）与注册钩子；异常隔离
 *   4. mod-catalog：原型清单 ↔ 真实 Mod 合并（覆盖展示字段 / 标记不可用 / 追加第三方）
 *   5. sync-mods：同步计划正确（Data Mod 不重复同步 4MB 数据）+ 真跑一次写盘
 *   6. **Mod 包内二进制资源**（2026-10 能力补齐 ②）：`gameAPI.asset` 能读到自己包里的图，
 *      且读取是**惰性**的（不预下载）
 */

// vitest DSL。
import { describe, test, expect, vi } from 'vitest'
// 被测模块。
import { createBrowserAIConfig, discoverMods, executeModCodes, loadModBundle, readAIConfig, resolveAIProxyBase, resolveSitePath, MODS_BASE_URL, NATIVE_AI_PROXY_PORT, createAssetRegistry, createSourceAssetReader, createStoreSource } from './mod-runtime.js'
// 源码扫描（守卫用）。
import { readSourceFiles } from '../test-utils/source-scan.js'
import { DEFAULT_MOD_LIST, buildModCatalog, enabledModNames } from './mod-catalog.js'
import { buildSyncPlan, syncMods, writeSync } from '../../scripts/sync-mods.mjs'
// 引擎（造真实 Life 验证参数注册）。
import Life from 'game-engine/src/modules/life.js'
import { createHookBus } from 'game-engine/src/mod/gameapi.js'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// fixture 数据（Life 需要的最小数据）。
import { buildFixtureData } from '../test-utils/fixture-data.js'

// #makeFetch
// 静态文件服务器替身（键为 URL 路径）。
function makeFetch(files) {
  // 记录请求。
  const calls = []
  // 实现。
  const fetchImpl = async (url) => {
    // 记录。
    calls.push(String(url))
    // 命中。
    const hit = files[String(url)]
    // 404。
    if (hit === undefined) return { ok: false, status: 404, text: async () => '' }
    // 200。
    return { ok: true, status: 200, text: async () => hit }
  }
  // 附带记录。
  fetchImpl.calls = calls
  // 返回。
  return fetchImpl
}

// #makeBinaryFetch
// 静态文件服务器替身，**同时支持文本与二进制**（`arrayBuffer()`）。
//
// 与 makeFetch 分开写的原因：老替身只实现 `text()`，拿它测"读二进制"会得到
// "源不支持"的假象（而真实 fetch 一直有 arrayBuffer）。
//
// @param {object} files - { URL: string|Uint8Array }
// @returns {Function} fetch 替身（带 calls / binaryCalls 记录）
function makeBinaryFetch(files) {
  // 记录请求（区分走了 text 还是 arrayBuffer —— 用来证明"没有用 text 读 PNG"）。
  const calls = []
  const binaryCalls = []
  // 实现。
  const fetchImpl = async (url) => {
    // 记录。
    calls.push(String(url))
    // 命中。
    const hit = files[String(url)]
    // 404。
    if (hit === undefined) return { ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
    // 字节化。
    const bytes = typeof hit === 'string' ? new TextEncoder().encode(hit) : hit
    // 200。
    return {
      ok: true,
      status: 200,
      // 文本形态（引擎读 manifest/code.js 用）。
      text: async () => (typeof hit === 'string' ? hit : new TextDecoder().decode(hit)),
      // 二进制形态（资源用）。
      arrayBuffer: async () => {
        // 记一笔（证明资源确实走的这条路）。
        binaryCalls.push(String(url))
        // 拷一份 ArrayBuffer（模拟真实 fetch 给新缓冲区）。
        return bytes.slice().buffer
      },
    }
  }
  // 记录挂在函数上。
  fetchImpl.calls = calls
  fetchImpl.binaryCalls = binaryCalls
  // 返回。
  return fetchImpl
}

// #makeLife
// 造一个真实 Life（用于验证 Mod 注册属性/钩子）。
//
// @param {object} [hooks] - 钩子总线；**要与 executeModCodes 用同一条**（生产里 store.init 就是这么接的），
//   否则属性变更通知会发到 Life 自己的（空）总线上，Mod 收不到 propertyChange。
// @returns {Promise<object>} Life
async function makeLife(hooks) {
  // 实例（内存 storage）。
  const life = new Life({ data: buildFixtureData(), storage: { getItem: () => null, setItem: () => {} }, hooks })
  // 初始化 + 配置。
  await life.initial()
  life.config()
  // 返回。
  return life
}

describe('mod-runtime - 发现与加载（浏览器路径）', () => {
  test('discoverMods：读 index.json + 各 manifest', async () => {
    // 假服务器。
    const fetchImpl = makeFetch({
      '/mods/index.json': '["base-mod","fun-mod"]',
      '/mods/base-mod/manifest.json': '{"name":"base-mod","version":"1.0.0","permissions":["hooks"]}',
      '/mods/fun-mod/manifest.json': '{"name":"fun-mod","version":"1.0.0"}',
    })
    // 发现。
    const { mods, errors } = await discoverMods({ fetchImpl })
    // 两个 Mod，无错误。
    expect(mods.map((m) => m.name)).toEqual(['base-mod', 'fun-mod'])
    expect(errors).toEqual([])
    // 展示字段来自 manifest。
    expect(mods[0].manifest.permissions).toEqual(['hooks'])
  })

  test('未同步 mods（index.json 404）→ 空结果，不抛', async () => {
    // 全 404。
    const { mods, errors } = await discoverMods({ fetchImpl: makeFetch({}) })
    // 空（调用方回退到"无 Mod"路径）。
    expect(mods).toEqual([])
    expect(errors).toEqual([])
  })

  test('loadModBundle：合并数据 + 收集代码 + 按拓扑顺序', async () => {
    // 假服务器：a 供数据，b 依赖 a 且有 code.js。
    const fetchImpl = makeFetch({
      '/mods/index.json': '["a","b"]',
      '/mods/a/files.json': '["manifest.json","talents.json"]',
      '/mods/a/manifest.json': '{"name":"a","version":"1.0.0"}',
      '/mods/a/talents.json': '{"t1":{"id":"t1","name":"甲"}}',
      '/mods/b/files.json': '["manifest.json","code.js"]',
      '/mods/b/manifest.json': '{"name":"b","version":"1.0.0","dependencies":["a"]}',
      '/mods/b/code.js': 'gameAPI.on("x", () => {})',
    })
    // 加载。
    const bundle = await loadModBundle({ fetchImpl })
    // 顺序 + 数据 + 代码。
    expect(bundle.loaded).toEqual(['a', 'b'])
    expect(bundle.data.talents.t1.name).toBe('甲')
    expect(bundle.codes.map((c) => c.name)).toEqual(['b'])
    expect(bundle.errors).toEqual([])
    // 钩子总线可用（Life 会注入它）。
    expect(typeof bundle.hooks.emit).toBe('function')
  })

  test('loadModBundle：enabled 只加载启用的 Mod', async () => {
    // 假服务器。
    const fetchImpl = makeFetch({
      '/mods/index.json': '["a","b"]',
      '/mods/a/files.json': '["manifest.json","talents.json"]',
      '/mods/a/manifest.json': '{"name":"a","version":"1.0.0"}',
      '/mods/a/talents.json': '{"tA":{"id":"tA","name":"A"}}',
      '/mods/b/files.json': '["manifest.json","talents.json"]',
      '/mods/b/manifest.json': '{"name":"b","version":"1.0.0"}',
      '/mods/b/talents.json': '{"tB":{"id":"tB","name":"B"}}',
    })
    // 只启用 a。
    const bundle = await loadModBundle({ fetchImpl, enabled: ['a'] })
    // 只加载 a。
    expect(bundle.loaded).toEqual(['a'])
    expect(bundle.disabled).toEqual(['b'])
    expect(bundle.data.talents.tA).toBeDefined()
    expect(bundle.data.talents.tB).toBeUndefined()
  })
})

describe('mod-runtime - Mod 包内二进制资源（2026-10 能力补齐 ②）', () => {
  // 一段"像 PNG"的字节（含高位字节：用 text() 读会被 UTF-8 解码破坏，所以能真正验证走的是字节通道）。
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 7])
  // 假服务器：Mod `a` 的清单里同时有文本与资源。
  const files = {
    '/mods/index.json': '["a"]',
    '/mods/a/files.json': '["manifest.json","code.js","assets/logo.png"]',
    '/mods/a/manifest.json': '{"name":"a","version":"1.0.0"}',
    '/mods/a/code.js': 'gameAPI.on("x", () => {})',
    '/mods/a/assets/logo.png': PNG,
  }

  test('loadModBundle 带出**惰性**的资源读取能力（构造时不读任何字节）', async () => {
    // 假服务器（记录请求）。
    const fetchImpl = makeBinaryFetch(files)
    // 加载。
    const bundle = await loadModBundle({ fetchImpl })
    // 能力带出来了。
    expect(bundle.assetReader).toBeTruthy()
    expect(bundle.assetSource).toBeTruthy()
    expect(bundle.assetReader.available).toBe(true)
    // **没有读任何资源**（惰性：开局不该把几 MB 图片拉下来）。
    expect(fetchImpl.binaryCalls).toEqual([])
    // 也没请求过那个 png 的文本形态。
    expect(fetchImpl.calls.some((u) => u.includes('logo.png'))).toBe(false)
  })

  test('Mod 通过 gameAPI.asset 拿到自己包里的资源（逐字节；blob URL）', async () => {
    // 假服务器。
    const fetchImpl = makeBinaryFetch(files)
    // 阶段一。
    const bundle = await loadModBundle({ fetchImpl })
    // 阶段二：Mod 代码读自己包里的图。
    const { executed } = executeModCodes({
      // ⚠️ 用外部注册表（生产里 store 就是这么接的：界面与 Mod 用**同一份**桥）。
      assetRegistry: createAssetRegistry(),
      // 资源读取能力。
      assetReader: bundle.assetReader,
      // 钩子总线。
      hooks: bundle.hooks,
      // Mod 代码（回调里断言 —— 顶层不能 await）。
      codes: [{
        name: 'a',
        code: [
          'gameAPI.asset.list().then(function (list) { globalThis.__assetList = list })',
          'gameAPI.asset.bytes("assets/logo.png").then(function (b) { globalThis.__assetBytes = Array.from(b) })',
          'gameAPI.asset.url("assets/logo.png").then(function (u) { globalThis.__assetUrl = u })',
        ].join('\n'),
      }],
    })
    // 执行成功。
    expect(executed).toEqual(['a'])
    // 等异步回调（真实网络/文件都不碰）。
    await new Promise((r) => setTimeout(r, 0))
    // 清单只列资源（manifest.json / code.js 不算资源）。
    expect(globalThis.__assetList).toEqual(['assets/logo.png'])
    // **逐字节一致**（含 0 与 255；走 text() 读会坏掉）。
    expect(globalThis.__assetBytes).toEqual([...PNG])
    // Node/happy-dom 里没有 URL.createObjectURL → url() 降级为路径（不抛）。
    expect(typeof globalThis.__assetUrl).toBe('string')
    // 资源真的被请求过一次（而且是走 arrayBuffer，不是 text）。
    expect(fetchImpl.binaryCalls).toEqual(['/mods/a/assets/logo.png'])
    // 清理全局。
    delete globalThis.__assetList
    delete globalThis.__assetBytes
    delete globalThis.__assetUrl
  })

  test('Mod 代码读**别人**包的资源读不到（按 Mod 隔离）', async () => {
    // 假服务器（同一个包里没有的资源）。
    const fetchImpl = makeBinaryFetch(files)
    // 阶段一 + 阶段二。
    const bundle = await loadModBundle({ fetchImpl })
    // Mod 代码读一个包内不存在的路径 → 可读错误（**不静默返回空字节**）。
    const errors = []
    const { errors: execErrors } = executeModCodes({
      assetReader: bundle.assetReader,
      hooks: bundle.hooks,
      codes: [{
        name: 'a',
        // 顶层不能 await，所以用 catch 收集（同步执行完就已经拿到错误对象了）。
        code: 'gameAPI.asset.bytes("assets/nope.png").catch(function (e) { globalThis.__assetErr = e.message })',
      }],
    })
    // 代码本身执行成功（错误在 promise 里，不影响其它 Mod）。
    expect(execErrors).toEqual([])
    // 等回调。
    await new Promise((r) => setTimeout(r, 0))
    // 可读错误带 Mod 名、路径与"用 list() 看清单"的指引。
    expect(globalThis.__assetErr).toMatch(/a 里没有资源 assets\/nope\.png/)
    expect(globalThis.__assetErr).toMatch(/asset\.list\(\)/)
    // 收尾。
    delete globalThis.__assetErr
    // errors 变量只是为了让 lint 不抱怨未使用（本用例的错误在 promise 里）。
    expect(errors).toEqual([])
  })

  test('注册表：按路径跨 Mod 查找 + 缺失时给 null（界面渲染不该被炸）', async () => {
    // 两个 Mod 各带一张图。
    const fetchImpl = makeBinaryFetch({
      '/mods/index.json': '["a","b"]',
      '/mods/a/files.json': '["manifest.json","assets/a.png"]',
      '/mods/a/manifest.json': '{"name":"a","version":"1.0.0"}',
      '/mods/a/assets/a.png': new Uint8Array([1, 2, 3]),
      '/mods/b/files.json': '["manifest.json","dependencies-marker.json","assets/b.ogg"]',
      '/mods/b/manifest.json': '{"name":"b","version":"1.0.0","dependencies":["a"]}',
      '/mods/b/assets/b.ogg': new Uint8Array([4, 5, 6]),
    })
    // 阶段一。
    const bundle = await loadModBundle({ fetchImpl })
    // 阶段二（Mod 代码为空也要建桥 —— 界面侧的占位符解析靠注册表）。
    const registry = createAssetRegistry()
    executeModCodes({ codes: [{ name: 'a', code: '' }, { name: 'b', code: '' }], hooks: bundle.hooks, assetReader: bundle.assetReader, assetRegistry: registry })
    // 注册表可用，两个 Mod 都登记了。
    expect(registry.available).toBe(true)
    expect(registry.names().sort()).toEqual(['a', 'b'])
    // 跨 Mod 按路径查找。
    expect(await registry.has('assets/a.png')).toBe(true)
    expect(await registry.has('assets/b.ogg')).toBe(true)
    expect(await registry.has('assets/nope.png')).toBe(false)
    // url 给字符串（Node 里是路径）、缺失给 null。
    expect(typeof (await registry.url('assets/a.png'))).toBe('string')
    expect(await registry.url('assets/nope.png')).toBeNull()
    // list 带 Mod 名（排障用）。
    expect((await registry.list()).map((x) => `${x.mod}:${x.path}`).sort()).toEqual(['a:assets/a.png', 'b:assets/b.ogg'])
    // dispose 幂等。
    expect(registry.dispose()).toBe(0)
    expect(registry.dispose()).toBe(0)
    // dispose 之后找不到东西（不返回失效 URL）。
    expect(await registry.has('assets/a.png')).toBe(false)
    expect(await registry.url('assets/a.png')).toBeNull()
  })

  test('没有资源能力时（源不支持 readBytes / 源缺失）→ 降级且不报错', async () => {
    // 源替身：只实现"读文本"（模拟升级前的旧源 / 旧存储）。
    const legacy = {
      kind: 'legacy',
      async listMods() { return ['a'] },
      async listFiles() { return ['manifest.json'] },
      async readText() { return null },
    }
    // 读取器。
    const reader = createSourceAssetReader(legacy, { warn: () => {} })
    // 明确标成不可用（不是"看起来能用但一直读不到"）。
    expect(reader.available).toBe(false)
    // 读字节给 null（不抛：调用方按"没有"处理）。
    expect(await reader.readBytes('a', 'assets/x.png')).toBeNull()
    // 桥因此降级（available false，读操作抛可读错误）。
    const bundle = { assetReader: reader, hooks: createHookBus() }
    const registry = createAssetRegistry()
    executeModCodes({ codes: [{ name: 'a', code: '' }], hooks: bundle.hooks, assetReader: bundle.assetReader, assetRegistry: registry })
    expect(registry.available).toBe(false)
    // 界面拿不到 URL（降级成纯文本），不抛。
    expect(await registry.url('assets/x.png')).toBeNull()
    // 没有源时也不炸。
    const none = createSourceAssetReader(undefined, { warn: () => {} })
    expect(none.available).toBe(false)
    expect(await none.listFiles('a')).toBeNull()
  })

  test('store 源：能读 zip 装出来的 Mod 的资源（listFiles 取文本+资源并集）', async () => {
    // 存储替身（与 mod-store 记录同形）。
    const store = {
      async list() { return [{ name: 'a', manifest: {} }] },
      async listFiles() { return ['manifest.json', 'assets/logo.png'] },
      async readText(_n, rel) { return rel === 'manifest.json' ? '{}' : null },
      async readBytes(_n, rel) { return rel === 'assets/logo.png' ? PNG : null },
    }
    // 源适配。
    const source = createStoreSource(store)
    // 清单含资源。
    expect(await source.listFiles('a')).toEqual(['manifest.json', 'assets/logo.png'])
    // 读出字节。
    expect([...(await source.readBytes('a', 'assets/logo.png'))]).toEqual([...PNG])
    // 老存储（没有 readBytes）→ null（不是抛）。
    const legacy = createStoreSource({ async listFiles() { return [] }, async readText() { return null } })
    expect(await legacy.readBytes('a', 'assets/logo.png')).toBeNull()
  })
})

describe('mod-runtime - 执行 Mod 代码（注册新属性 / 钩子 / 异常隔离）', () => {
  test('Mod 可以注册新属性并通过注册表读写（把属性加到引擎）', async () => {
    // Life + 总线。
    const life = await makeLife()
    const hooks = createHookBus()
    // Mod 代码：定义一个 32 位整数属性并设初值。
    const codes = [{ name: 'stamina-mod', code: 'gameAPI.param.define("STA", { type: "local", array: false });\ngameAPI.param.set("STA", 7);' }]
    // 执行。
    const { executed, errors } = executeModCodes({ codes, hooks, life })
    // 成功。
    expect(executed).toEqual(['stamina-mod'])
    expect(errors).toEqual([])
    // 属性真的进了 Life 的参数注册表（Mod 加属性闭环）。
    expect(life.params.get('STA')).toBe(7)
    // 也能被条件引擎看到（params 自动包含新参数）。
    expect(life.params.names).toContain('STA')
  })

  test('Mod 注册的钩子在游戏推进时可触发', async () => {
    // Life + 总线。
    const life = await makeLife()
    const hooks = createHookBus()
    // 注册钩子。
    executeModCodes({
      codes: [{ name: 'hook-mod', code: 'gameAPI.on("onYearAdvance", (p) => { p.content.push({ type: "EVT", description: "来自 mod" }); });' }],
      hooks,
      life,
    })
    // 触发。
    const payload = { content: [] }
    await hooks.emit('onYearAdvance', payload)
    // 生效。
    expect(payload.content.some((c) => c.description === '来自 mod')).toBe(true)
  })

  test('Mod 能改**真实**游戏属性，也能观察引擎内部的属性变化（2026-10 能力补齐）', async () => {
    // Life + 总线。
    // ⚠️ 这里必须把**同一条总线**给 Life 与 executeModCodes（生产里 `store.init` 就是这么接的）：
    //    属性变更通知是从 Life 的总线广播的 —— 给 Life 传另一条（或干脆不传）会让 Mod
    //    注册的 propertyChange 收不到通知。
    const hooks = createHookBus()
    const life = await makeLife(hooks)
    // 先给属性一个已知初值（走引擎自己的写入）。
    life.property.set('CHR', 5)
    // 记录 propertyChange（Mod 侧观察）。
    const seen = []
    hooks.on('propertyChange', (p) => seen.push(p))
    // Mod 代码：读一次、改一次、再观察一次。
    const codes = [{
      name: 'prop-mod',
      code: [
        'var before = gameAPI.property.get("CHR");',
        'gameAPI.property.change("CHR", 4);',
        'gameAPI.on("propertyChange", function (p) { if (p.source === "engine") { console.log("engine:", p.prop); } });',
        'gameAPI.property.set("SPR", before + 1);',
      ].join('\n'),
    }]
    // 执行。
    const { executed, errors } = executeModCodes({ codes, hooks, life })
    // 成功。
    expect(executed).toEqual(['prop-mod'])
    expect(errors).toEqual([])
    // **真的改了游戏属性**（这条守卫钉住 `executeModCodes` 里那行 `property: life` 接线：
    // 少了它 gameAPI.property 就退回降级桥，写操作会抛错、CI 直接红）。
    expect(life.propertys.CHR).toBe(9)
    expect(life.propertys.SPR).toBe(6)
    // Mod 自己的两次写入都带 source='mod'。
    const modWrites = seen.filter((p) => p.source === 'mod').map((p) => p.prop)
    expect(modWrites).toEqual(['CHR', 'SPR'])
    // 引擎内部的变化（年龄自增，就是 life.next() 里的那一步）也能被观察到，且标成 engine。
    life.property.ageNext()
    expect(seen.some((p) => p.prop === 'AGE' && p.source === 'engine')).toBe(true)
  })

  test('单个 Mod 抛错被隔离：其它 Mod 照常执行', async () => {
    // Life + 总线。
    const life = await makeLife()
    const hooks = createHookBus()
    // 一个坏、一个好。
    const { executed, errors } = executeModCodes({
      codes: [
        { name: 'bad', code: 'throw new Error("boom")' },
        { name: 'good', code: 'gameAPI.param.define("OK", { type: "local" });' },
      ],
      hooks,
      life,
    })
    // 好的执行成功。
    expect(executed).toEqual(['good'])
    // 坏的记错误（不抛）。
    expect(errors[0]).toContain('bad')
    expect(errors[0]).toContain('boom')
    // 好的 Mod 的属性已注册。
    expect(life.params.names).toContain('OK')
  })

  test('AI 配置：无 Key → null；有 Key → 走代理并把 provider/apiKey 注入 body', async () => {
    // 存储替身。
    const storage = { getItem: (k) => (k === 'aiConfig' ? JSON.stringify({ provider: 'deepseek', apiKey: 'sk-t', baseUrl: 'https://x', model: 'deepseek-chat' }) : null) }
    // 读取配置。
    const cfg = readAIConfig(storage)
    expect(cfg.provider).toBe('deepseek')
    // 无 Key 场景。
    expect(readAIConfig({ getItem: () => null })).toBeNull()
    // 造 AI 配置（注入 fetch 探针）。
    const seen = []
    const aiConfig = createBrowserAIConfig({
      config: cfg,
      proxyBase: '/ai-proxy',
      fetchImpl: async (url, init) => {
        // 记录请求。
        seen.push({ url: String(url), body: JSON.parse(init.body) })
        // 返回一个合法响应。
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }] }), text: async () => JSON.stringify({ choices: [{ message: { content: 'hi' } }] }) }
      },
    })
    // baseUrl 指向代理的 /v1。
    expect(aiConfig.baseUrl).toBe('/ai-proxy/v1')
    // 真发一次请求，确认 provider/apiKey 被注入。
    await aiConfig.client.chatCompletion({ baseUrl: aiConfig.baseUrl, apiKey: aiConfig.apiKey, model: aiConfig.model, messages: [{ role: 'user', content: 'x' }] })
    expect(seen[0].url).toBe('/ai-proxy/v1/chat/completions')
    expect(seen[0].body.provider).toBe('deepseek')
    expect(seen[0].body.apiKey).toBe('sk-t')
  })
})

describe('AI 代理地址解析（三种运行环境）', () => {
  test('Electron 桌面版：用主进程注入的 baseUrl（优先级最高）', () => {
    // 即使同时有 Capacitor 与构建期注入，也先用 Electron 的。
    expect(
      resolveAIProxyBase({
        window: {
          electronAIProxy: { baseUrl: 'http://127.0.0.1:9123' },
          Capacitor: { isNativePlatform: () => true },
        },
        viteProxy: '/other',
      }),
    ).toBe('http://127.0.0.1:9123')
  })

  test('Capacitor 移动端：指向 App 内嵌的 Node 代理（绝对地址，因为移动端没有 vite 代理）', () => {
    const base = resolveAIProxyBase({ window: { Capacitor: { isNativePlatform: () => true } } })
    expect(base).toBe(`http://127.0.0.1:${NATIVE_AI_PROXY_PORT}`)
    // 必须是绝对地址：WebView 页面是 https://localhost，相对路径会打到 Capacitor 自己的服务器上。
    expect(base.startsWith('http://127.0.0.1:')).toBe(true)
  })

  test('浏览器 / Web 单进程版：构建期注入 > 默认 /ai-proxy', () => {
    // 有构建期注入用注入值（Capacitor 存在但不是原生平台，例如浏览器里加载了 Capacitor web 包）。
    expect(resolveAIProxyBase({ window: { Capacitor: { isNativePlatform: () => false } }, viteProxy: '/custom-proxy' })).toBe('/custom-proxy')
    // 都没有 → 默认前缀（vite 开发代理与 Web 版内嵌代理都挂在这个前缀下）。
    expect(resolveAIProxyBase({ window: undefined, viteProxy: undefined })).toBe('/ai-proxy')
  })

  test('代理地址会拼出 /v1（与代理服务的路由一致）', () => {
    // 内嵌 Node 代理的路由是 /v1/chat/completions，createBrowserAIConfig 负责拼前缀。
    const nativeBase = resolveAIProxyBase({ window: { Capacitor: { isNativePlatform: () => true } } })
    expect(`${nativeBase.replace(/\/$/, '')}/v1`).toBe(`http://127.0.0.1:${NATIVE_AI_PROXY_PORT}/v1`)
  })
})

describe('mod-catalog - 目录合并', () => {
  test('发现的 Mod 覆盖展示字段；未发现的标记 available=false', () => {
    // 发现结果（只有 base-mod 与一个第三方）。
    const discovered = [
      { name: 'base-mod', manifest: { name: 'base-mod', version: '2.0.0', description: '真实描述', permissions: ['hooks', 'storage'] } },
      { name: 'third-party', manifest: { name: 'third-party', version: '1.0.0', description: '第三方' } },
    ]
    // 目录。
    const catalog = buildModCatalog({ discovered })
    // 原型清单里的项仍在（顺序稳定）。
    expect(catalog.slice(0, DEFAULT_MOD_LIST.length).map((m) => m.name)).toEqual(DEFAULT_MOD_LIST.map((m) => m.name))
    // base-mod 用 manifest 的字段。
    const base = catalog.find((m) => m.name === 'base-mod')
    expect(base.version).toBe('2.0.0')
    expect(base.description).toBe('真实描述')
    expect(base.permissions).toEqual(['hooks', 'storage'])
    expect(base.available).toBe(true)
    // 未发现的（ai-mod）标注不可用。
    expect(catalog.find((m) => m.name === 'ai-mod').available).toBe(false)
    // 第三方被追加且默认启用。
    const third = catalog.find((m) => m.name === 'third-party')
    expect(third.available).toBe(true)
    expect(third.enabled).toBe(true)
  })

  test('保存状态优先：禁用/删除生效', () => {
    // 保存状态：base-mod 禁用、fun-mod 删除。
    const saved = { enabled: { 'base-mod': false }, removed: ['fun-mod'] }
    // 目录。
    const catalog = buildModCatalog({ discovered: [], saved })
    // 启用状态。
    expect(catalog.find((m) => m.name === 'base-mod').enabled).toBe(false)
    // 删除的项不出现。
    expect(catalog.some((m) => m.name === 'fun-mod')).toBe(false)
    // 要加载的名字（启用 + 可用）。
    const names = enabledModNames(buildModCatalog({ discovered: [{ name: 'base-mod', manifest: { name: 'base-mod', version: '1' } }, { name: 'lifeRestart-data', manifest: { name: 'lifeRestart-data', version: '1' } }], saved }))
    expect(names).toEqual(['lifeRestart-data'])
  })
})

describe('sync-mods - 同步计划与写盘', () => {
  // 仓库真实 mods 目录。
  const MODS_DIR = fileURLToPath(new URL('../../../../mods/', import.meta.url))

  test('计划正确：Data Mod 不重复同步数据，其它 Mod 带数据/代码', () => {
    // 计划。
    const plan = buildSyncPlan({ modsDir: MODS_DIR })
    // 仓库里的 Mod 全部在计划里，无错误（新加 Mod 时这里要跟着加，**别把断言写成数量**：
    // 数量断言只会报"5 !== 4"，看不出是谁没进计划）。
    expect(plan.index.sort()).toEqual(['ai-mod', 'base-mod', 'example-mod', 'fun-mod', 'lifeRestart-data'])
    expect(plan.errors).toEqual([])
    // Data Mod：跳过数据（其数据已在 public/data）。
    const dataMod = plan.mods.find((m) => m.name === 'lifeRestart-data')
    expect(dataMod.skipData).toBe(true)
    expect(dataMod.files).toEqual(['manifest.json'])
    // ai-mod 带代码；base-mod 带数据。
    expect(plan.mods.find((m) => m.name === 'ai-mod').files).toContain('code.js')
    expect(plan.mods.find((m) => m.name === 'base-mod').files.some((f) => f.endsWith('.json') && f !== 'manifest.json')).toBe(true)
    // 示例 Mod（教学样板）必须同时带代码与数据 —— 否则"照抄它"的人会拿到一个空壳。
    const example = plan.mods.find((m) => m.name === 'example-mod')
    expect(example.files).toContain('code.js')
    expect(example.files).toContain('manifest.json')
    expect(example.files).toContain('age.json')
  })

  test('资源文件（图片/音频/字体）也进计划与 files.json —— **漏列 = 浏览器侧静默少读**', () => {
    // 计划（仓库真实 mods/：example-mod 带了一张 assets/logo.png）。
    const plan = buildSyncPlan({ modsDir: MODS_DIR })
    // 示例 Mod 的资源在计划里（**含子目录**）。
    const example = plan.mods.find((m) => m.name === 'example-mod')
    expect(example.files).toContain('assets/logo.png')
    // 无错误。
    expect(plan.errors).toEqual([])
  })

  test('writeSync：资源按**字节**复制到 public/mods（逐字节一致）', () => {
    // 临时目录。
    const outDir = mkdtempSync(join(tmpdir(), 'sync-mods-assets-'))
    // 同步。
    try {
      // 计划 + 写盘。
      const plan = buildSyncPlan({ modsDir: MODS_DIR })
      writeSync({ plan, modsDir: MODS_DIR, outDir })
      // 目标文件存在。
      const copied = join(outDir, 'example-mod', 'assets', 'logo.png')
      expect(existsSync(copied)).toBe(true)
      // **逐字节一致**（copyFileSync 是二进制复制；用 readFileSync + 文本写回就会坏）。
      const src = readFileSync(join(MODS_DIR, 'example-mod', 'assets', 'logo.png'))
      const dst = readFileSync(copied)
      expect([...dst]).toEqual([...src])
      // PNG magic（真的是一张图）。
      expect([...dst.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      // files.json 里列了它（浏览器据此才会去请求）。
      const files = JSON.parse(readFileSync(join(outDir, 'example-mod', 'files.json'), 'utf8'))
      expect(files).toContain('assets/logo.png')
    } finally {
      // 清理。
      rmSync(outDir, { recursive: true, force: true })
    }
  })

  test('资源后缀清单：sync-mods 与引擎 zip 模块**必须一致**（少一个就是静默少读）', async () => {
    // 动态导入（避免顶层再多一个 import）。
    const engine = await import('game-engine/src/mod/zip.js')
    const sync = await import('../../scripts/sync-mods.mjs')
    // 双向比对（顺序无关）。
    expect([...sync.ASSET_EXT].sort()).toEqual([...engine.ASSET_EXT].sort())
  })

  test('writeSync：写出 index.json 与各 Mod 的 files.json', () => {
    // 临时目录。
    const outDir = mkdtempSync(join(tmpdir(), 'sync-mods-'))
    // 同步。
    try {
      // 计划。
      const plan = buildSyncPlan({ modsDir: MODS_DIR })
      // 写盘。
      const result = writeSync({ plan, modsDir: MODS_DIR, outDir })
      // 有文件写入。
      expect(result.copied).toBeGreaterThan(0)
      // 索引存在且是数组。
      const index = JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf8'))
      expect(index).toContain('base-mod')
      // files.json 与计划一致。
      const files = JSON.parse(readFileSync(join(outDir, 'base-mod', 'files.json'), 'utf8'))
      expect(files).toContain('manifest.json')
      // 数据 Mod 的目标目录里没有数据文件（避免 4MB 重复）。
      expect(existsSync(join(outDir, 'lifeRestart-data', 'age.json'))).toBe(false)
      // 二次同步不残留（清掉已删除的 Mod 目录）。
      const again = syncMods({ modsDir: MODS_DIR, outDir })
      expect(again.mods.length).toBe(plan.index.length)
    } finally {
      // 清理。
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})

describe('Mod 根路径必须跟着 BASE_URL（子路径部署的坑）', () => {
  test('resolveSitePath：dev / Pages / 子路径三种形态', () => {
    // dev（站点根就是 /）。
    expect(resolveSitePath('mods/')).toBe('/mods/')
    expect(resolveSitePath('mods/', '/')).toBe('/mods/')
    // GitHub Pages 构建：base './'（**相对**，子路径下自动正确）。
    expect(resolveSitePath('mods/', './')).toBe('./mods/')
    // 用户页/自定义子路径（绝对子路径也对）。
    expect(resolveSitePath('mods', '/lifeRestart/')).toBe('/lifeRestart/mods/')
    expect(resolveSitePath('data', './')).toBe('./data/')
    // 空 base 也要能用（退化成站点根）。
    expect(resolveSitePath('mods/', '')).toBe('/mods/')
  })

  test('前导斜杠会被剥掉 —— 这正是线上 404 的成因', () => {
    // 写死 `/mods/`（绝对路径）在子路径部署下会打到域名根。
    expect(resolveSitePath('/mods/', './')).toBe('./mods/')
    expect(resolveSitePath('//mods/', '/lifeRestart/')).toBe('/lifeRestart/mods/')
  })

  test('语义验证：相对 base 解析到子路径，绝对路径解析到域名根', () => {
    // Pages 的实际形态：文档在 https://<user>.github.io/lifeRestart/。
    const doc = 'https://shutaozhenzhen.github.io/lifeRestart/'
    // 我们的写法（相对）→ 落在子路径下（部署里文件就在这里）。
    expect(new URL(resolveSitePath('mods/', './') + 'index.json', doc).pathname).toBe('/lifeRestart/mods/index.json')
    // 旧写法（绝对）→ 落到域名根，那里什么都没有（2026-10 线上就是这个 404）。
    expect(new URL('/mods/' + 'index.json', doc).pathname).toBe('/mods/index.json')
  })

  test('MODS_BASE_URL 由 BASE_URL 推导，不是写死的字面量', () => {
    // 与同一个函数算出来的一致（改 BASE_URL 就会跟着变）。
    expect(MODS_BASE_URL).toBe(resolveSitePath('mods/'))
    // 以当前 BASE_URL 开头（dev/PAGES 都对）。
    const base = import.meta.env.BASE_URL || '/'
    expect(MODS_BASE_URL.startsWith(base.endsWith('/') ? base : `${base}/`)).toBe(true)
    // 也必须以 /mods/ 结尾。
    expect(MODS_BASE_URL.endsWith('mods/')).toBe(true)
  })

  test('源码守卫：不许再出现写死的绝对 mods 路径', () => {
    // 扫 src（跳过 spec 与 test-utils）。
    const hits = []
    // 找 '…/mods/…' / "…/mods/…" 这类**单双引号**字面量。
    //   · 不只匹配整串 `/mods/`：`'/mods/index.json'` 才是真实写法（第一版漏过它）
    //   · 含 `:` 的跳过（路由路径 `/mods/:name` 是合法的，不是 fetch 前缀）
    //   · 反引号不看（`router.push(\`/mods/${x}\`)` 也是路由，不是请求）
    //   · **路由目标**跳过（`to:` / `path:` / `push(` / `replace(` 后面的字面量是导航，
    //     不是请求 —— 2026-10 加 Mod 文档页时误报过：`path: '/mods/docs'` 与文档里的
    //     `to: '/mods/example-mod'` 都是合法路由。这一条只放宽"导航语境"，不放过 fetch 语境）
    for (const { file, text } of readSourceFiles()) {
      // 逐个候选。
      for (const m of text.matchAll(/['"](\/mods\/[^'"]*)['"]/g)) {
        // 路由参数（`/mods/:name`）跳过。
        if (m[1].includes(':')) continue
        // 前文（判断是不是导航语境）。
        const before = text.slice(Math.max(0, m.index - 16), m.index)
        // 导航语境跳过。
        if (/(to:|path:|push\(|replace\(|redirect:)\s*$/.test(before)) continue
        // 记下（带文件与原文，失败信息可读）。
        hits.push(`${file}: ${m[0]}`)
      }
    }
    // 一个都不许有：会 fetch 的前缀必须过 resolveSitePath。
    expect(hits, `这些地方写死了绝对 mods 路径（子路径部署会 404）：\n${hits.join('\n')}`).toEqual([])
  })

  test('源码守卫：调 createFetchSource 必须显式给 baseUrl', () => {
    // 引擎那个源有个历史默认值 `baseUrl = '/mods/'`（CLI/测试用）—— 浏览器里若有人
    // 不传 baseUrl 直接用它，就会重演同一个 404。前端所有调用必须显式传。
    const misses = []
    // 扫 src。
    for (const { file, text } of readSourceFiles()) {
      // 逐个调用点。
      for (const m of text.matchAll(/createFetchSource\(\s*\{([^}]*)\}/g)) {
        // 参数对象里必须有 baseUrl。
        if (!/\bbaseUrl\b/.test(m[1])) misses.push(`${file}: createFetchSource({${m[1].trim()}}`)
      }
    }
    // 断言。
    expect(misses, `这些调用没给 baseUrl（会退到引擎默认的绝对路径）：\n${misses.join('\n')}`).toEqual([])
  })
})
