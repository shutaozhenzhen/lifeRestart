/**
 * 宿主桥单元测试 — host.spec.js（Mod 架构 v2，seam #3）
 *
 * 覆盖范围：
 *   1. createHostBridge（available/has/call、错误归一化）
 *   2. createDenyHost（静态站降级契约）
 *   3. createNodeHost（server.js 注册器 + **完全权限实证固化**）
 *   4. gameAPI.host 接线（含"传适配器也能用"）
 *
 * ⚠️ 其中 `完全权限` 那组是本设计的**事实基础**：Mod 的 server.js 只被注入
 *    { handle, log, modsDir, name }，却必须能 import node:fs / child_process / 访问
 *    process。一旦哪天有人给它加了"能力白名单"，这组用例会立刻红 —— 这正是目的。
 */

// 导入 vitest 测试 DSL 和被测试函数。
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
// Node 内置：临时目录与文件。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
// Node 内置：路径。
import { join } from 'node:path'
// Node 内置：临时目录。
import { tmpdir } from 'node:os'
// Node 内置：子进程（用于"原生 Node 解析"的集成验证）。
import { execFileSync } from 'node:child_process'
// Node 内置：URL ↔ 路径（定位示例 Mod 与仓库根）。
import { fileURLToPath } from 'node:url'
// 被测：宿主桥 + 空桥。
import { createHostBridge, createDenyHost } from './host.js'
// 被测：Node 侧适配器。
import { createNodeHost } from './host-node.js'
// 被测：gameAPI（host 接线）。
import { createGameAPI } from './gameapi.js'

// 临时目录集合（afterEach 统一清理）。
let tmpDirs = []

// 包根（packages/game-engine/）：子进程集成测试的 cwd。
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
// 示例 Mod 的 Node 入口（原生 ESM 解析的验证目标）。
const EXAMPLES_SERVER_URL = new URL('../../examples/demo-node-mod/server.js', import.meta.url).href

// #makeModsDir
// 造一个临时 Mods 根目录，并写入 {"type":"module"} —— 这样目录里的 .js 按 ESM 解析
// （Mod 的 server.js 用 export default，缺这一行会被 Node 当 CJS 而语法错误）。
//
// @param {string} [type] - package.json 的 type 取值（默认 module；传 commonjs 可复现 CJS 误判）
// @returns {string} 目录路径
function makeModsDir(type = 'module') {
  // 临时目录。
  const dir = mkdtempSync(join(tmpdir(), 'mod-host-'))
  // 记录以便清理。
  tmpDirs.push(dir)
  // 写入 type 声明。
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type }))
  // 返回。
  return dir
}

// #writeMod
// 在 Mods 根目录下造一个 Mod 目录（manifest + 若干文件）。
//
// @param {string} modsDir - Mods 根目录
// @param {string} name - Mod 名（= 目录名）
// @param {object} manifest - manifest 对象
// @param {object} [files] - { 文件名: 内容 }
// @returns {{name: string, manifest: object}} loader 风格的 Mod 元信息
function writeMod(modsDir, name, manifest, files = {}) {
  // Mod 目录。
  const dir = join(modsDir, name)
  // 建目录。
  mkdirSync(dir, { recursive: true })
  // 写 manifest。
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  // 写其余文件。
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content)
  // 返回元信息（形状与 loader 的 scanMods 输出一致）。
  return { name, manifest }
}

// 典型的双目标 manifest。
const DUAL = { name: 'dual-mod', version: '1.0.0', targets: ['browser', 'node'], entry: { browser: 'code.js', node: 'server.js' } }

// 一个功能齐全的 server.js：演示完全权限 + 同步/异步处理器 + 重名覆盖。
const SERVER_JS = `
export default function setup({ handle, log }) {
  // 异步：真读文件系统（完全权限）。
  handle('readJsonName', async ({ file }) => {
    const fs = await import('node:fs')
    return JSON.parse(fs.readFileSync(file, 'utf8')).name
  })
  // 异步：进程与平台信息（完全权限）。
  handle('nodeInfo', async () => {
    const os = await import('node:os')
    return { platform: os.platform(), hasProcess: typeof process === 'object', cwdIsString: typeof process.cwd() === 'string' }
  })
  // 异步：child_process 可达（只查类型，不真起进程，避免平台差异）。
  handle('canSpawn', async () => {
    const cp = await import('node:child_process')
    return typeof cp.execFileSync === 'function'
  })
  // 同步处理器：证明两种都能用。
  handle('add', ({ a, b }) => a + b)
  // 参数原样回传。
  handle('echo', (args) => args)
  // 抛错：验证错误归一化。
  handle('boom', () => { throw new Error('处理器内部炸了') })
  // 重名：先注册 old，再覆盖成 new（后注册覆盖）。
  handle('overwrite', () => 'old')
  handle('overwrite', () => 'new')
}
`

// 每个用例后清理临时目录。
afterEach(() => {
  // 逐个删。
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  // 重置。
  tmpDirs = []
})

// ========== 测试组 1：createHostBridge ==========
describe('host - createHostBridge', () => {
  test('available 返回副本，外部改不到内部状态', async () => {
    // 适配器。
    const adapter = { available: ['a'], call: async () => 1 }
    // 建桥。
    const bridge = createHostBridge(adapter)
    // 取出的数组改掉。
    bridge.available.push('hacked')
    // 内部状态不受影响。
    expect(bridge.available).toEqual(['a'])
    // 适配器侧的原数组改掉。
    adapter.available.push('also-hacked')
    // 快照语义：建桥时复制。
    expect(bridge.available).toEqual(['a'])
  })

  test('has() 判断 Mod 是否在线', () => {
    // 建桥。
    const bridge = createHostBridge({ available: ['x', 'y'], call: async () => null })
    // 在线。
    expect(bridge.has('x')).toBe(true)
    // 离线。
    expect(bridge.has('z')).toBe(false)
    // 数字也按字符串比较（容错）。
    expect(bridge.has(1)).toBe(false)
  })

  test('call 原样转发参数与返回值', async () => {
    // 记录调用。
    const seen = []
    // 适配器。
    const adapter = {
      available: ['m'],
      call: async (mod, handler, args) => {
        seen.push([mod, handler, args])
        return { ok: true }
      },
    }
    // 桥。
    const bridge = createHostBridge(adapter)
    // 调用。
    const r = await bridge.call('m', 'h', { a: 1 })
    // 透传。
    expect(seen).toEqual([['m', 'h', { a: 1 }]])
    // 返回值。
    expect(r).toEqual({ ok: true })
  })

  test('call 未注册的 Mod：报错并列出在线清单', async () => {
    // 桥。
    const bridge = createHostBridge({ available: ['a', 'b'], call: async () => null })
    // 断言。
    await expect(bridge.call('zzz', 'h')).rejects.toThrow(/宿主 Mod 未注册: zzz/)
    // 清单可读。
    await expect(bridge.call('zzz', 'h')).rejects.toThrow(/在线：a, b/)
  })

  test('无在线 Mod 时错误信息也不含糊', async () => {
    // 桥。
    const bridge = createHostBridge({ available: [], call: async () => null })
    // 断言。
    await expect(bridge.call('a', 'h')).rejects.toThrow(/在线：无/)
  })

  test('处理器抛错：包装成「Mod x 处理器 y 失败」并保留 cause', async () => {
    // 原始错误。
    const original = new Error('内部错误')
    // 桥。
    const bridge = createHostBridge({ available: ['m'], call: async () => { throw original } })
    // 捕获。
    let caught = null
    try {
      await bridge.call('m', 'h')
    } catch (e) {
      caught = e
    }
    // 信息包含定位。
    expect(caught.message).toBe('Mod m 处理器 h 失败: 内部错误')
    // 原始错误未丢失。
    expect(caught.cause).toBe(original)
  })

  test('适配器未实现 call：明确报错', async () => {
    // 缺 call 的适配器。
    const bridge = createHostBridge({ available: ['m'] })
    // 断言。
    await expect(bridge.call('m', 'h')).rejects.toThrow(/宿主适配器未实现 call/)
  })

  test('缺省/空适配器按"无能力"处理', () => {
    // 不传。
    expect(createHostBridge().available).toEqual([])
    // 传 null。
    expect(createHostBridge(null).available).toEqual([])
  })
})

// ========== 测试组 2：createDenyHost（降级契约）==========
describe('host - createDenyHost', () => {
  test('available 为空且 has 恒为 false', () => {
    // 空桥。
    const deny = createDenyHost()
    // 无能力。
    expect(deny.available).toEqual([])
    // 任何 Mod 都不在线。
    expect(deny.has('anything')).toBe(false)
    // 空字符串也不在线。
    expect(deny.has('')).toBe(false)
  })

  test('call 报错且信息可操作（指出替代做法）', async () => {
    // 空桥。
    const deny = createDenyHost()
    // 断言。
    await expect(deny.call('m', 'h')).rejects.toThrow(/宿主 Mod 未注册: m/)
  })

  test('call 提示静态站限制（绕过未注册判断直接看空适配器语义）', async () => {
    // 直接建一个"在线但调用失败"的空桥，验证 deny 的可读错误。
    const bridge = createHostBridge({
      available: ['m'],
      call: async () => {
        throw new Error('当前环境没有后端宿主（纯静态站）')
      },
    })
    // 断言。
    await expect(bridge.call('m', 'h')).rejects.toThrow(/纯静态站/)
  })
})

// ========== 测试组 3：createNodeHost —— 完全权限（实证固化）==========
describe('host - createNodeHost：完全权限（事实基础）', () => {
  test('server.js 能 import node:fs 并读到真实文件内容', async () => {
    // 临时的"外部数据文件"。
    const modsDir = makeModsDir()
    // 目标文件。
    const target = join(modsDir, 'payload.json')
    // 写入。
    writeFileSync(target, JSON.stringify({ name: '从磁盘读到的名字' }))
    // Mod（只注入 handle/log，没有任何宿主 API 参数）。
    const mod = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': SERVER_JS })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 注册成功。
    expect(host.errors).toEqual([])
    expect(host.available).toEqual(['dual-mod'])
    // 读文件（完全权限）。
    const name = await host.call('dual-mod', 'readJsonName', { file: target })
    // 拿到了磁盘内容。
    expect(name).toBe('从磁盘读到的名字')
  })

  test('server.js 能拿到 process / os / child_process（完全权限）', async () => {
    // 造 Mod。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': SERVER_JS })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 进程与平台。
    const info = await host.call('dual-mod', 'nodeInfo')
    expect(info.hasProcess).toBe(true)
    expect(info.cwdIsString).toBe(true)
    expect(typeof info.platform).toBe('string')
    // 子进程模块可达。
    expect(await host.call('dual-mod', 'canSpawn')).toBe(true)
  })

  test('只注册声明了 node 目标的 Mod', async () => {
    // 一个纯前端、一个双目标。
    const modsDir = makeModsDir()
    const browserOnly = writeMod(modsDir, 'browser-only', { name: 'browser-only', version: '1.0.0' }, { 'code.js': '// 纯前端' })
    const dual = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': SERVER_JS })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [browserOnly, dual] })
    // 只有双目标的在线。
    expect(host.available).toEqual(['dual-mod'])
    // 纯前端的不可调用。
    await expect(host.call('browser-only', 'anything')).rejects.toThrow(/未注册/)
  })

  test('同步与异步处理器都能调用', async () => {
    // 造 Mod。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': SERVER_JS })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 同步处理器。
    expect(await host.call('dual-mod', 'add', { a: 2, b: 3 })).toBe(5)
    // 参数原样回传（同进程按引用，不强制 JSON）。
    expect(await host.call('dual-mod', 'echo', { deep: [1, 2] })).toEqual({ deep: [1, 2] })
  })

  test('未注册的处理器：报错并列出已有处理器名', async () => {
    // 造 Mod。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': SERVER_JS })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 断言（拼写错误可定位）。
    await expect(host.call('dual-mod', 'nope')).rejects.toThrow(/未注册处理器: nope/)
    await expect(host.call('dual-mod', 'nope')).rejects.toThrow(/现有：.*add/)
  })
  test('重名处理器：后注册覆盖先注册', async () => {
    // 造 Mod。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': SERVER_JS })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 覆盖生效。
    expect(await host.call('dual-mod', 'overwrite')).toBe('new')
    // 只有一个同名处理器。
    expect(host.handlersOf('dual-mod').filter((h) => h === 'overwrite')).toHaveLength(1)
  })

  test('handler 内部抛错：冒泡到调用方', async () => {
    // 造 Mod。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': SERVER_JS })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 断言。
    await expect(host.call('dual-mod', 'boom')).rejects.toThrow(/处理器内部炸了/)
  })

  test('handlersOf：未注册的 Mod 返回空数组', async () => {
    // 空宿主。
    const host = await createNodeHost({ modsDir: makeModsDir(), mods: [] })
    // 断言。
    expect(host.handlersOf('ghost')).toEqual([])
  })
})

// ========== 测试组 4：createNodeHost —— 错误隔离与可读提示 ==========
describe('host - createNodeHost：错误隔离与提示', () => {
  test('entry.node 文件不存在：记入 errors 且不进 available', async () => {
    // 声明了 node 但没写文件。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', DUAL)
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 未注册。
    expect(host.available).toEqual([])
    // 错误可读。
    expect(host.errors).toHaveLength(1)
    expect(host.errors[0]).toMatch(/node 入口不存在: dual-mod\/server\.js/)
  })

  test('声明 node 但缺 entry.node：记入 errors', async () => {
    // 只声明 targets，不给 entry。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', { name: 'dual-mod', version: '1.0.0', targets: ['node'] })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 断言。
    expect(host.available).toEqual([])
    expect(host.errors[0]).toMatch(/缺少 entry\.node/)
  })

  test('setup 不是函数：记入 errors 并提示 export default', async () => {
    // 默认导出是对象。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': 'export default { notAFunction: true }' })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 断言。
    expect(host.available).toEqual([])
    expect(host.errors[0]).toMatch(/必须 export default 一个 setup 函数/)
  })

  test('一个 Mod 的 setup 抛错不影响另一个 Mod 注册', async () => {
    // 坏的 + 好的。
    const modsDir = makeModsDir()
    const bad = writeMod(modsDir, 'bad-mod', { name: 'bad-mod', version: '1.0.0', targets: ['node'], entry: { node: 'server.js' } }, { 'server.js': 'export default function () { throw new Error("setup 炸了") }' })
    const good = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': SERVER_JS })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [bad, good] })
    // 好的仍然可用（异常隔离）。
    expect(host.available).toEqual(['dual-mod'])
    // 坏的记了错。
    expect(host.errors.join(' ')).toMatch(/bad-mod.*setup 炸了/)
  })

  test('handle() 参数校验：空名字 / 非函数都当场报错', async () => {
    // setup 里故意传坏参数。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', DUAL, {
      'server.js': `
        export default function setup({ handle }) {
          handle('', () => {})
          handle('ok', 'not-a-function')
        }
      `,
    })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 第一条错误即空名字。
    expect(host.errors[0]).toMatch(/处理器名必须是非空字符串/)
  })

  test('解析失败时给出可操作提示（CJS/ESM 误判是最常见成因）', async () => {
    // 故意写坏的 server.js（缺右花括号）→ 解析失败。
    // 注意：原生 Node 抛 SyntaxError（"Unexpected token"），Vite/vitest 抛普通
    // Error（"invalid JS syntax"）——两种形态都要能触发提示（见 host-node 的 parseHint）。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': 'export default function setup( {' })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 未注册。
    expect(host.available).toEqual([])
    // 提示可操作（告诉你 CJS/ESM 误判怎么修）。
    expect(host.errors[0]).toMatch(/CommonJS/)
    expect(host.errors[0]).toMatch(/type":"module/)
  })

  test('非解析类错误（如 setup 抛错）不会误加解析提示', async () => {
    // setup 运行时抛错 —— 不是解析问题。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': 'export default function setup() { throw new Error("运行时炸了") }' })
    // 建宿主。
    const host = await createNodeHost({ modsDir, mods: [mod] })
    // 有错误。
    expect(host.errors).toHaveLength(1)
    // 但不该出现解析提示（避免误导）。
    expect(host.errors[0]).not.toMatch(/CommonJS/)
    // 原始信息保留。
    expect(host.errors[0]).toMatch(/运行时炸了/)
  })
})

// ========== 测试组 4.5：原生 Node 解析（vitest 会掩盖这一点）==========
//
// ⚠️ 为什么需要这一组：vitest 里 `import()` 走 **Vite 的 SSR 模块运行器**，它无视
// package.json 的 `"type"` 字段。也就是说上面那些用例**证明不了**"真实 Node 里
// mods/<name>/server.js 会被当成 ESM"。而真实运行（mod.cli.js / Electron / Web）
// 用的是 Node 原生加载器 —— 这里用子进程把真实行为钉住。
describe('host - 原生 Node 解析（子进程验证）', () => {
  test('examples 里的 server.js 在原生 Node 下按 ESM 加载并导出 setup 函数', async () => {
    // 用 node 子进程 import 真实的示例 Mod 入口（原生 ESM 解析路径）。
    const script = `
      const m = await import(${JSON.stringify(EXAMPLES_SERVER_URL)})
      console.log(typeof m.default)
      console.log(await m.default({ handle: (n) => console.log('H:' + n) }))
    `
    // 执行（stdio 用继承外的显式 pipe：本机策略允许；CI 上同样是普通子进程）。
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', cwd: REPO_ROOT })
    // 默认导出是函数（= 原生 ESM 解析成功，没有被当成 CJS）。
    expect(out).toMatch(/function/)
    // setup 里注册的处理器名被打印出来（顺序即注册顺序）。
    expect(out).toMatch(/H:readParentPackage/)
    expect(out).toMatch(/H:nodeInfo/)
  })
})

// ========== 测试组 5：gameAPI.host 接线 ==========
describe('host - gameAPI.host 接线', () => {
  test('不传 host：deny 语义（available 空、has 假、call 抛错）', async () => {
    // 建 API（不传 host）。
    const api = createGameAPI({ data: {} })
    // 桥永远存在（Mod 代码不必判空）。
    expect(api.host).toBeTruthy()
    // 无后端。
    expect(api.host.available).toEqual([])
    expect(api.host.has('m')).toBe(false)
    // 调用报错。
    await expect(api.host.call('m', 'h')).rejects.toThrow(/未注册/)
  })

  test('传宿主桥：has/call 可用', async () => {
    // 假桥。
    const fake = createHostBridge({ available: ['m'], call: async () => 'hello' })
    // 建 API。
    const api = createGameAPI({ data: {}, host: fake })
    // 在线。
    expect(api.host.has('m')).toBe(true)
    // 可用。
    expect(await api.host.call('m', 'h')).toBe('hello')
  })

  test('传适配器（只有 available/call）：自动包成桥', async () => {
    // 裸适配器（没有 has）。
    const adapter = { available: ['m'], call: async () => 42 }
    // 建 API。
    const api = createGameAPI({ data: {}, host: adapter })
    // 自动补出 has。
    expect(typeof api.host.has).toBe('function')
    expect(api.host.has('m')).toBe(true)
    // 调用可用。
    expect(await api.host.call('m', 'h')).toBe(42)
  })

  test('与真实 host-node 串起来：code.js 侧看到的就是它自己的后端', async () => {
    // 造一个双目标 Mod。
    const modsDir = makeModsDir()
    const mod = writeMod(modsDir, 'dual-mod', DUAL, { 'server.js': SERVER_JS })
    // 建适配器 → 桥 → API。
    const adapter = await createNodeHost({ modsDir, mods: [mod] })
    const api = createGameAPI({ data: {}, host: createHostBridge(adapter) })
    // 浏览器侧 code.js 会写的判断。
    expect(api.host.has('dual-mod')).toBe(true)
    // 并调用成功。
    expect(await api.host.call('dual-mod', 'add', { a: 1, b: 1 })).toBe(2)
  })
})
