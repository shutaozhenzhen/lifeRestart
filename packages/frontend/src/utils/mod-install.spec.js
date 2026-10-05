// @vitest-environment happy-dom
/**
 * 前端 zip 安装测试 — 安装 → 启用 → 游戏内生效（整条链路）
 *
 * 覆盖：
 *   1. mod-store（内存实现）：install/list/readText/remove
 *   2. 组合源：Mod 列表取并集；读文件**本地已安装优先**（覆盖服务器同名 Mod）
 *   3. installModFromZip：合法 zip 装上；系统 Mod 名被拒；坏 zip 给可读错误
 *   4. **端到端**：装一个"注册新属性 + 注册钩子"的 Mod → 发现 → 加载 → 执行 →
 *      `life.params` 里真的多了该属性、钩子能触发
 *   5. Mod 管理页：选 zip → 安装 → 列表出现该 Mod（本地安装标签）
 */

// vitest DSL。
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
// 被测模块。
import { createMemoryModStore } from './mod-store.js'
import { createCompositeSource, createStoreSource, discoverMods, executeModCodes, installModFromZip, loadModBundle } from './mod-runtime.js'
// 页面与装置。
import ModManageView from '../views/ModManageView.vue'
import { mountView, resetApp } from '../test-utils/setup.js'
// 引擎（打包 zip、造 Life）。
import { createModZip } from 'game-engine/src/mod/zip.js'
import Life from 'game-engine/src/modules/life.js'
import { buildFixtureData } from '../test-utils/fixture-data.js'

// 合法 manifest。
const MANIFEST = JSON.stringify({ name: 'sta-mod', version: '1.0.0', description: '耐力属性' })
// Mod 代码：注册新属性 + 钩子。
const CODE = 'gameAPI.param.define("STA", { type: "local" });\ngameAPI.param.set("STA", 9);\ngameAPI.on("onYearAdvance", (p) => { p.content.push({ type: "EVT", description: "耐力+1" }); });'

// 每个用例前重置。
beforeEach(() => {
  // 重置 pinia / localStorage / fetch 桩。
  resetApp()
  // 没有服务器上的 Mod（纯本地安装场景）。
  globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '', json: async () => ({}) })
})

describe('mod-store - 本地已安装 Mod', () => {
  test('install / list / readText / remove', async () => {
    // 存储。
    const store = createMemoryModStore()
    // 初始为空。
    expect(await store.list()).toEqual([])
    expect(await store.readText('x', 'code.js')).toBeNull()
    // 安装。
    await store.install({ name: 'x', manifest: { name: 'x', version: '1' }, files: { 'manifest.json': '{}', 'code.js': 'c' } })
    // 列表 + 读文件。
    expect((await store.list()).map((m) => m.name)).toEqual(['x'])
    expect(await store.listFiles('x')).toEqual(['manifest.json', 'code.js'])
    expect(await store.readText('x', 'code.js')).toBe('c')
    // 卸载。
    await store.remove('x')
    expect(await store.list()).toEqual([])
  })
})

describe('组合源 - 本地优先', () => {
  test('Mod 名取并集；同名时本地内容优先', async () => {
    // 本地装一个与服务器同名的 Mod。
    const store = createMemoryModStore()
    await store.install({ name: 'base-mod', manifest: { name: 'base-mod', version: '9.9.9' }, files: { 'manifest.json': '{"name":"base-mod","version":"9.9.9"}' } })
    // 服务器源（同名的旧版本）。
    const http = {
      async listMods() { return ['base-mod', 'server-only'] },
      async listFiles() { return ['manifest.json'] },
      async readText() { return '{"name":"base-mod","version":"1.0.0"}' },
    }
    // 组合。
    const source = createCompositeSource([createStoreSource(store), http])
    // 并集。
    expect(await source.listMods()).toEqual(['base-mod', 'server-only'])
    // 读 manifest：本地优先（版本 9.9.9）。
    expect(JSON.parse(await source.readText('base-mod', 'manifest.json')).version).toBe('9.9.9')
    // 服务器独有的 Mod 仍能读。
    expect(JSON.parse(await source.readText('server-only', 'manifest.json')).version).toBe('1.0.0')
  })
})

describe('installModFromZip - 解析与安全', () => {
  test('合法 zip → 装上并可读', async () => {
    // 存储。
    const store = createMemoryModStore()
    // 打包。
    const zip = createModZip({ files: { 'manifest.json': MANIFEST, 'code.js': CODE } })
    // 安装。
    const r = await installModFromZip({ bytes: zip, store })
    // 成功。
    expect(r.ok).toBe(true)
    expect(r.name).toBe('sta-mod')
    expect(r.files).toBe(2)
    // 已进本地存储。
    expect(await store.readText('sta-mod', 'code.js')).toContain('param.define')
  })

  test('系统 Mod 名不能被 zip 覆盖（默认拒绝，且带 system 标记供界面确认）', async () => {
    // 存储。
    const store = createMemoryModStore()
    // 冒充 lifeRestart-data。
    const zip = createModZip({ files: { 'manifest.json': JSON.stringify({ name: 'lifeRestart-data', version: '9.9.9' }) } })
    // 安装。
    const r = await installModFromZip({ bytes: zip, store })
    // 被拒（避免**未经确认**就顶掉数据源）。
    expect(r.ok).toBe(false)
    expect(r.system).toBe(true)
    expect(r.name).toBe('lifeRestart-data')
    expect(r.errors[0]).toContain('系统 Mod')
    // 没写进本地存储。
    expect(await store.list()).toEqual([])
  })

  // 「完全移除 → 重新上传」闭环：界面在用户二次确认后显式 allowSystem 放行。
  test('系统 Mod 名：显式 allowSystem 后可以装上（重新上传回装）', async () => {
    // 存储。
    const store = createMemoryModStore()
    // 包（带数据文件，模拟"导出的 zip 再传回来"）。
    const zip = createModZip({
      files: {
        'manifest.json': JSON.stringify({ name: 'lifeRestart-data', version: '9.9.9', system: true }),
        'talents.json': JSON.stringify({ t1: { id: 't1', name: '天赋一' } }),
      },
    })
    // 放行安装。
    const r = await installModFromZip({ bytes: zip, store, allowSystem: true })
    // 成功 + 标明这是系统 Mod（界面据此提示"覆盖了系统预装"）。
    expect(r.ok).toBe(true)
    expect(r.system).toBe(true)
    expect(r.files).toBe(2)
    // 真的落地了。
    expect((await store.list()).map((m) => m.name)).toEqual(['lifeRestart-data'])
    expect(JSON.parse(await store.readText('lifeRestart-data', 'talents.json')).t1.name).toBe('天赋一')
  })

  test('坏 zip（缺 manifest）→ 可读错误，不写入', async () => {
    // 存储。
    const store = createMemoryModStore()
    // 打包（无 manifest）。
    const zip = createModZip({ files: { 'code.js': 'x' } })
    // 安装。
    const r = await installModFromZip({ bytes: zip, store })
    // 失败 + 未写入。
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('manifest.json')
    expect(await store.list()).toEqual([])
  })
})

describe('端到端 - 装个 Mod 就能给引擎加属性', () => {
  test('zip 安装 → 发现 → 加载 → 执行 → life.params 有新属性且钩子生效', async () => {
    // 本地存储 + 安装。
    const store = createMemoryModStore()
    const zip = createModZip({ files: { 'manifest.json': MANIFEST, 'code.js': CODE } })
    expect((await installModFromZip({ bytes: zip, store })).ok).toBe(true)
    // 发现（本地已安装优先）。
    const discovered = await discoverMods({ store })
    expect(discovered.mods.map((m) => m.name)).toEqual(['sta-mod'])
    // 加载（启用该 Mod）。
    const bundle = await loadModBundle({ store, enabled: ['sta-mod'] })
    expect(bundle.loaded).toEqual(['sta-mod'])
    expect(bundle.codes.map((c) => c.name)).toEqual(['sta-mod'])
    // 造 Life 并执行 Mod 代码（与 store.init 的顺序一致）。
    const life = new Life({ data: buildFixtureData(), storage: { getItem: () => null, setItem: () => {} } })
    await life.initial()
    life.config()
    const { executed, errors } = executeModCodes({ codes: bundle.codes, hooks: bundle.hooks, life })
    // 执行成功。
    expect(executed).toEqual(['sta-mod'])
    expect(errors).toEqual([])
    // **属性真的加到了引擎里**。
    expect(life.params.get('STA')).toBe(9)
    expect(life.params.names).toContain('STA')
    // 钩子也能触发。
    const payload = { content: [] }
    await bundle.hooks.emit('onYearAdvance', payload)
    expect(payload.content.some((c) => c.description === '耐力+1')).toBe(true)
  })
})

describe('Mod 管理页 - zip 安装交互', () => {
  test('选 zip → 安装 → 列表出现该 Mod（标记本地安装）', async () => {
    // 挂载（原型清单先渲染）。
    const { wrapper } = mountView(ModManageView)
    // 等挂载逻辑（取存储 + 刷新目录）。
    await flushPromises()
    // 安装条在。
    expect(wrapper.find('.install-bar').exists()).toBe(true)
    expect(wrapper.find('input[type="file"]').exists()).toBe(true)
    // 造一个 zip 并伪装成选中的文件。
    const zip = createModZip({ files: { 'manifest.json': MANIFEST, 'code.js': CODE } })
    const input = wrapper.find('input[type="file"]')
    // 注入 files（提供 arrayBuffer，等价浏览器里的 File）。
    Object.defineProperty(input.element, 'files', { value: [{ name: 'sta-mod.zip', arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) }], configurable: true })
    // 触发 change。
    await input.trigger('change')
    await flushPromises()
    // 成功提示。
    expect(wrapper.find('.install-ok').text()).toContain('sta-mod')
    // 列表里出现该 Mod，并标了"本地安装"。
    expect(wrapper.text()).toContain('sta-mod')
    expect(wrapper.findAll('.sys-hint').some((n) => n.text().includes('本地安装'))).toBe(true)
    // 有卸载按钮。
    expect(wrapper.findAll('button').some((b) => b.text().includes('卸载'))).toBe(true)
  })

  // 「完全移除 → 重新上传」闭环的页面侧：预装 Mod 移除后还能靠上传取回，
  // 而且上传成功后必须**自动清掉 removed 标记**，否则装完仍看不见（用户会以为没装上）。
  test('重新上传系统 Mod：二次确认 → 装上 + 自动从「已移除」里恢复', async () => {
    // 先造出"它已被完全移除"的现场。
    globalThis.localStorage.setItem('modsState', JSON.stringify({ enabled: {}, removed: ['lifeRestart-data'] }))
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    await flushPromises()
    // 目录里没有它，但在「已移除」面板里。
    expect(wrapper.findAll('.mod-name').some((n) => n.text().includes('lifeRestart-data'))).toBe(false)
    expect(wrapper.find('.removed-panel').text()).toContain('lifeRestart-data')
    // 用户在确认框里点了"确定"。
    const confirmSpy = vi.fn(() => true)
    globalThis.confirm = confirmSpy
    // 上传一个系统名的 zip（= 之前下载/分享出去的那个包）。
    const zip = createModZip({ files: { 'manifest.json': JSON.stringify({ name: 'lifeRestart-data', version: '1.0.0', system: true }), 'talents.json': '{"t1":{"id":"t1"}}' } })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [{ name: 'lifeRestart-data.zip', arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) }], configurable: true })
    await input.trigger('change')
    await flushPromises()
    // 问过一次（系统 Mod 覆盖确认）。
    expect(confirmSpy).toHaveBeenCalled()
    // 成功提示写明"覆盖了系统预装 Mod"。
    expect(wrapper.find('.install-ok').text()).toContain('覆盖了系统预装 Mod')
    // 目录里回来了。
    expect(wrapper.findAll('.mod-name').some((n) => n.text().includes('lifeRestart-data'))).toBe(true)
    // 「已移除」标记被自动清掉（面板消失 + 持久化里也没了）。
    expect(wrapper.find('.removed-panel').exists()).toBe(false)
    expect(JSON.parse(globalThis.localStorage.getItem('modsState')).removed).toEqual([])
  })

  test('重新上传系统 Mod：确认框拒绝 → 不安装，仍留在「已移除」里', async () => {
    // 现场。
    globalThis.localStorage.setItem('modsState', JSON.stringify({ enabled: {}, removed: ['lifeRestart-data'] }))
    // 挂载。
    const { wrapper } = mountView(ModManageView)
    await flushPromises()
    // 拒绝。
    globalThis.confirm = vi.fn(() => false)
    // 上传。
    const zip = createModZip({ files: { 'manifest.json': JSON.stringify({ name: 'lifeRestart-data', version: '1.0.0' }) } })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [{ name: 'x.zip', arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) }], configurable: true })
    await input.trigger('change')
    await flushPromises()
    // 提示"已取消"，状态不变。
    expect(wrapper.find('.install-error').text()).toContain('已取消安装系统 Mod')
    expect(wrapper.find('.removed-panel').text()).toContain('lifeRestart-data')
    expect(JSON.parse(globalThis.localStorage.getItem('modsState')).removed).toEqual(['lifeRestart-data'])
  })
})
