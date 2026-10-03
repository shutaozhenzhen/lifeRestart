/**
 * 运行时模块注册表单元测试 — modules.spec.js
 *
 * 覆盖：
 *   1. createDenyRequire（没声明模块时的可读错误）
 *   2. createModuleRegistry（声明→读文件→注入 load→同步 require；缺文件/加载失败/未声明的区分）
 *   3. createNodeModuleLoader + **真端到端**：一个含 manifest.modules 的 Mod，
 *      经 createNodeModLoader → loadAll → code.js 里 require 到依赖（全程运行期，零构建）
 *   4. manifest.modules 的校验与取值助手（在 mod.spec.js 里，见那边）
 *
 * ⚠️ "依赖必须是自包含单文件"是硬要求（浏览器 zip 装出来的 Mod 只有 blob: URL，
 * 而 blob: 没有目录基准 → 依赖内部的相对导入必断）。Node 侧有文件系统，所以那个限制
 * **在 Node 上测不出来** —— 本文件只钉住 Node 行为与注册表契约，
 * 浏览器 blob 语义由 frontend 的 blob 适配器测试（注入式）与文档说明负责。
 */

// vitest DSL。
import { describe, test, expect, afterEach } from 'vitest'
// 文件系统。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
// 路径。
import { join } from 'node:path'
// 临时目录。
import { tmpdir } from 'node:os'
// 被测：注册表与 deny require。
import { createModuleRegistry, createDenyRequire } from './modules.js'
// 被测：Node 侧加载适配器。
import { createNodeModuleLoader } from './modules-node.js'
// 被测：Node 端到端（加载器会把 manifest.modules 自动接上）。
import { createNodeModLoader } from './loader-node.js'
// 假的 gameAPI 构造（只用到 on）。
import { createGameAPI, createHookBus } from './gameapi.js'

// 临时目录集合。
let tmpDirs = []

// #modsDir
// 造一个临时 Mods 根目录。
//
// @returns {string} 目录
function modsDir() {
  // 建。
  const dir = mkdtempSync(join(tmpdir(), 'mod-modules-'))
  // 记录。
  tmpDirs.push(dir)
  // 返回。
  return dir
}

// #writeMod
// 造一个 Mod 目录。
//
// @param {string} root - Mods 根目录
// @param {string} name - Mod 名
// @param {object} manifest - manifest
// @param {object} files - { 相对路径: 内容 }
// @returns {object} { modsDir, manifest }
function writeMod(root, name, manifest, files = {}) {
  // Mod 目录。
  const dir = join(root, name)
  // 建。
  mkdirSync(dir, { recursive: true })
  // 写 manifest。
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  // 写其余文件（支持子目录）。
  for (const [rel, content] of Object.entries(files)) {
    // 绝对路径。
    const p = join(dir, rel)
    // 建父目录。
    mkdirSync(join(p, '..'), { recursive: true })
    // 写。
    writeFileSync(p, content)
  }
  // 返回。
  return { name, manifest }
}

// 清理。
afterEach(() => {
  // 逐个删。
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  // 重置。
  tmpDirs = []
})

// ========== 组 1：createDenyRequire ==========
describe('modules - createDenyRequire', () => {
  test('抛可读错误并点明正确做法', () => {
    // 造一个 deny require。
    const req = createDenyRequire('my-mod')
    // 断言。
    expect(() => req('lodash')).toThrow(/Mod my-mod 不能 require\('lodash'\)/)
    // 指向运行时方案。
    expect(() => req('lodash')).toThrow(/manifest\.modules/)
    expect(() => req('lodash')).toThrow(/vendor\//)
  })

  test('没给 Mod 名也能给出可读信息', () => {
    // 断言。
    expect(() => createDenyRequire()('x')).toThrow(/\(未知\)/)
  })
})

// ========== 组 2：createModuleRegistry ==========
describe('modules - createModuleRegistry', () => {
  test('没有声明 modules：返回空注册表 + deny require', async () => {
    // 建。
    const reg = await createModuleRegistry({ modName: 'm', manifest: {}, source: { readText: async () => null }, load: async () => ({}) })
    // 空。
    expect(reg.ids).toEqual([])
    expect(reg.has('x')).toBe(false)
    // require 抛错（注入面保持一致）。
    expect(() => reg.require('x')).toThrow(/不能 require/)
  })

  test('按声明读文件并交给注入的 load，require 同步取到命名空间', async () => {
    // 记录 load 收到的参数。
    const seen = []
    // 假 source。
    const source = { readText: async (mod, rel) => (rel === 'vendor/a.mjs' ? 'export const v = 1' : null) }
    // 假 load。
    const load = async (spec) => {
      seen.push(spec)
      return { v: 1, default: 'D' }
    }
    // 建注册表。
    const reg = await createModuleRegistry({ modName: 'm', manifest: { modules: { a: 'vendor/a.mjs' } }, source, load })
    // 无错。
    expect(reg.errors).toEqual([])
    // 声明可见。
    expect(reg.ids).toEqual(['a'])
    expect(reg.has('a')).toBe(true)
    // 同步取到。
    expect(reg.require('a').v).toBe(1)
    // load 收到完整上下文（id/path/code/modName）。
    expect(seen[0]).toMatchObject({ id: 'a', path: 'vendor/a.mjs', code: 'export const v = 1', modName: 'm' })
  })

  test('声明了但文件不存在：记错误，且 require 给出"声明了但加载失败"', async () => {
    // source 一律返回 null。
    const reg = await createModuleRegistry({
      modName: 'm',
      manifest: { modules: { a: 'vendor/missing.mjs' } },
      source: { readText: async () => null },
      load: async () => ({}),
    })
    // 错误可读。
    expect(reg.errors[0]).toMatch(/模块 a 声明为 vendor\/missing\.mjs，但该文件不存在/)
    // require 的报错要区分"声明了但失败"与"根本没声明"。
    expect(() => reg.require('a')).toThrow(/声明了但加载失败/)
  })

  test('load 失败：记错误且带成因', async () => {
    // 建（load 抛错）。
    const reg = await createModuleRegistry({
      modName: 'm',
      manifest: { modules: { a: 'vendor/a.mjs' } },
      source: { readText: async () => 'x' },
      load: async () => {
        throw new Error('不是自包含单文件')
      },
    })
    // 错误。
    expect(reg.errors[0]).toMatch(/模块 a 加载失败（vendor\/a\.mjs）：不是自包含单文件/)
    // require 抛错。
    expect(() => reg.require('a')).toThrow(/声明了但加载失败/)
  })

  test('未声明的模块：报错并列出可用清单', async () => {
    // 建（成功加载 a）。
    const reg = await createModuleRegistry({
      modName: 'm',
      manifest: { modules: { a: 'vendor/a.mjs' } },
      source: { readText: async () => 'x' },
      load: async () => ({ ok: 1 }),
    })
    // 未声明。
    expect(() => reg.require('zzz')).toThrow(/没有声明模块 'zzz'（可用：a）/)
  })

  test('一个模块失败不影响另一个成功', async () => {
    // 两个声明，load 只对 a 成功。
    const reg = await createModuleRegistry({
      modName: 'm',
      manifest: { modules: { a: 'vendor/a.mjs', b: 'vendor/b.mjs' } },
      source: { readText: async (mod, rel) => (rel.endsWith('a.mjs') ? 'A' : 'B') },
      load: async ({ id }) => {
        // b 失败。
        if (id === 'b') throw new Error('boom')
        // a 成功。
        return { id }
      },
    })
    // a 可用。
    expect(reg.has('a')).toBe(true)
    expect(reg.require('a')).toEqual({ id: 'a' })
    // b 有错。
    expect(reg.errors).toHaveLength(1)
  })

  test('缺 source / 缺 load：报错但不抛（require 给可读错误）', async () => {
    // 缺 source。
    const r1 = await createModuleRegistry({ modName: 'm', manifest: { modules: { a: 'a.mjs' } }, load: async () => ({}) })
    expect(r1.errors[0]).toMatch(/缺少 source/)
    // 缺 load。
    const r2 = await createModuleRegistry({ modName: 'm', manifest: { modules: { a: 'a.mjs' } }, source: { readText: async () => 'x' } })
    expect(r2.errors[0]).toMatch(/缺少 load 适配器/)
  })
})

// ========== 组 3：Node 端到端（全程运行期，零构建）==========
describe('modules - Node 端到端：依赖随包分发、运行时解析', () => {
  test('code.js 能用 require 取到随包分发的依赖并正常工作', async () => {
    // Mods 根目录。
    const root = modsDir()
    // 造 Mod：声明 modules + 放 vendor 单文件 + code.js 用 require。
    writeMod(
      root,
      'uses-dep',
      {
        name: 'uses-dep',
        version: '1.0.0',
        // 依赖随包分发（自包含单文件）。
        modules: { 'tiny-lib': 'vendor/tiny-lib.mjs' },
      },
      {
        // 自包含单文件：没有相对导入。
        'vendor/tiny-lib.mjs': "export const shout = (s) => '[' + String(s).toUpperCase() + ']'\nexport default shout\n",
        // code.js：注入的 require 同步取（此时依赖已由引擎加载好）。
        'code.js': "const { shout } = require('tiny-lib')\ngameAPI.on('onYearAdvance', (p) => { p.content.push({ type: 'EVT', description: shout('runtime'), grade: 0 }) })\n",
      },
    )
    // Node 加载器（自动接上运行时模块适配器）。
    const loader = await createNodeModLoader({ modsDir: root })
    // 无扫描错误。
    expect(loader.errors).toEqual([])
    // 共享总线 + 执行 code.js。
    const bus = createHookBus()
    const { data, errors } = await loader.loadAll({
      // gameAPI 工厂。
      createAPI: (name, merged) => createGameAPI({ data: merged, hooks: bus }),
    })
    // 执行无错。
    expect(errors).toEqual([])
    // 触发钩子。
    const payload = { age: 1, content: [], isEnd: false }
    await bus.emit('onYearAdvance', payload)
    // 依赖真的工作了（不是空壳）。
    expect(payload.content[0].description).toBe('[RUNTIME]')
    // 没有依赖被打进数据（modules 是代码，不是数据）。
    expect(Object.keys(data)).toEqual([])
  })

  test('依赖文件缺失：错误进 loadAll 的 errors（不静默）', async () => {
    // Mods 根目录。
    const root = modsDir()
    // 声明了但没放文件。
    writeMod(root, 'bad-dep', { name: 'bad-dep', version: '1.0.0', modules: { 'tiny-lib': 'vendor/nope.mjs' } }, { 'code.js': 'require("tiny-lib")' })
    // 加载。
    const loader = await createNodeModLoader({ modsDir: root })
    // 执行。
    const { errors } = await loader.loadAll({ createAPI: (n, d) => createGameAPI({ data: d }) })
    // 错误可读且带 Mod 名（一路带到报告）。
    expect(errors.join(' ')).toMatch(/Mod bad-dep: 模块 tiny-lib 声明为 vendor\/nope\.mjs，但该文件不存在/)
  })

  test('没声明 modules 却 require：deny 版给出可读错误（不静默、不崩整局）', async () => {
    // Mods 根目录。
    const root = modsDir()
    // code.js 用了 require 但没声明。
    writeMod(root, 'no-decl', { name: 'no-decl', version: '1.0.0' }, { 'code.js': "require('lodash')" })
    // 加载。
    const loader = await createNodeModLoader({ modsDir: root })
    // 执行。
    const { errors } = await loader.loadAll({ createAPI: (n, d) => createGameAPI({ data: d }) })
    // 错误信息点明正确做法（执行异常被隔离，不会拖垮其它 Mod）。
    expect(errors.join(' ')).toMatch(/不能 require\('lodash'\)/)
    expect(errors.join(' ')).toMatch(/manifest\.modules/)
  })

  test('createNodeModuleLoader 用原生 import 加载（真模块语义：多文件依赖在 Node 侧也能用）', async () => {
    // 造一个"非单文件"的依赖（Node 有文件系统，所以它的相对导入能工作）。
    const root = modsDir()
    writeMod(
      root,
      'multi-file',
      { name: 'multi-file', version: '1.0.0', modules: { lib: 'vendor/lib/index.mjs' } },
      {
        // 入口再导出内部文件。
        'vendor/lib/index.mjs': "export { twice } from './inner.mjs'\n",
        // 内部文件。
        'vendor/lib/inner.mjs': 'export const twice = (n) => n * 2\n',
      },
    )
    // 直接用适配器建注册表。
    const load = createNodeModuleLoader({ modsDir: root })
    const reg = await createModuleRegistry({
      modName: 'multi-file',
      manifest: { modules: { lib: 'vendor/lib/index.mjs' } },
      // 用真实 fs 源。
      source: (await import('./source-node.js')).createNodeSource(root),
      load,
    })
    // 加载成功且能调。
    expect(reg.errors).toEqual([])
    expect(reg.require('lib').twice(21)).toBe(42)
  })
})
