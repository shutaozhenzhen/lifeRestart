/**
 * mod-runtime / mod-catalog / sync-mods 测试 —— 前端 Mod 支持的三个新模块
 *
 * 覆盖（node 环境即可，不需要 DOM）：
 *   1. discoverMods：从 index.json 发现服务器上的 Mod
 *   2. loadModBundle：只加载启用的 Mod；合并数据；收集代码；错误不抛
 *   3. executeModCodes：**Mod 注册新属性**（gameAPI.param）与注册钩子；异常隔离
 *   4. mod-catalog：原型清单 ↔ 真实 Mod 合并（覆盖展示字段 / 标记不可用 / 追加第三方）
 *   5. sync-mods：同步计划正确（Data Mod 不重复同步 4MB 数据）+ 真跑一次写盘
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { createBrowserAIConfig, discoverMods, executeModCodes, loadModBundle, readAIConfig, resolveAIProxyBase, resolveSitePath, MODS_BASE_URL, NATIVE_AI_PROXY_PORT } from './mod-runtime.js'
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

// #makeLife
// 造一个真实 Life（用于验证 Mod 注册属性/钩子）。
async function makeLife() {
  // 实例（内存 storage）。
  const life = new Life({ data: buildFixtureData(), storage: { getItem: () => null, setItem: () => {} } })
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
    // 四个 Mod，无错误。
    expect(plan.index.sort()).toEqual(['ai-mod', 'base-mod', 'fun-mod', 'lifeRestart-data'])
    expect(plan.errors).toEqual([])
    // Data Mod：跳过数据（其数据已在 public/data）。
    const dataMod = plan.mods.find((m) => m.name === 'lifeRestart-data')
    expect(dataMod.skipData).toBe(true)
    expect(dataMod.files).toEqual(['manifest.json'])
    // ai-mod 带代码；base-mod 带数据。
    expect(plan.mods.find((m) => m.name === 'ai-mod').files).toContain('code.js')
    expect(plan.mods.find((m) => m.name === 'base-mod').files.some((f) => f.endsWith('.json') && f !== 'manifest.json')).toBe(true)
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
      expect(again.mods.length).toBe(4)
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
    for (const { file, text } of readSourceFiles()) {
      // 逐个候选。
      for (const m of text.matchAll(/['"](\/mods\/[^'"]*)['"]/g)) {
        // 路由参数（`/mods/:name`）跳过。
        if (m[1].includes(':')) continue
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
