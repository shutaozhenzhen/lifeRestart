/**
 * mod/zip 单元测试 — Mod 包 zip 读写（浏览器与 Node 共用）
 *
 * 覆盖：
 *   1. 往返：createModZip → readModPackage（deflate 与 store 两种压缩都读得出来）
 *   2. 单层包装目录（GitHub 导出的 zip）自动剥离
 *   3. 缺 manifest / manifest 非法 → 可读错误
 *   4. **路径穿越**（`../x`、绝对路径）被挡住并报告
 *   5. 尺寸与条目数上限（尺寸炸弹防护）
 *   6. **二进制资源逐字节保留**（2026-10 能力补齐 ②：以前是被丢弃 + 警告）
 *   7. MIME 判定（浏览器渲染资源全靠它）
 *   8. manager.importZip 走共用模块：真 zip → 落盘成功；危险 zip → 不落盘
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { MAX_ENTRIES, MAX_FILE_BYTES, createModZip, getMimeType, isSafeEntryPath, readModPackage, stripWrapperDir } from './zip.js'
import { importZip } from './manager.js'
// Node 内置（落盘校验）。
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 一个合法 manifest（validateManifest 要求 name + version）。
const MANIFEST = JSON.stringify({ name: 'zip-mod', version: '1.0.0', description: '来自 zip' })

describe('mod/zip - 路径安全与包装目录', () => {
  test('isSafeEntryPath 挡住绝对路径与 ..', () => {
    // 安全。
    expect(isSafeEntryPath('manifest.json')).toBe(true)
    expect(isSafeEntryPath('data/talents.json')).toBe(true)
    // 不安全。
    expect(isSafeEntryPath('../evil.json')).toBe(false)
    expect(isSafeEntryPath('a/../../evil.json')).toBe(false)
    expect(isSafeEntryPath('/etc/passwd')).toBe(false)
    expect(isSafeEntryPath('C:/windows/x')).toBe(false)
    expect(isSafeEntryPath('')).toBe(false)
  })

  test('stripWrapperDir 剥掉单层包装目录', () => {
    // 包装结构。
    const files = {
      'repo-main/manifest.json': new Uint8Array([1]),
      'repo-main/code.js': new Uint8Array([2]),
    }
    // 剥掉后键变成根级。
    expect(Object.keys(stripWrapperDir(files)).sort()).toEqual(['code.js', 'manifest.json'])
    // 根已有 manifest 时不动。
    const root = { 'manifest.json': new Uint8Array([1]) }
    expect(stripWrapperDir(root)).toBe(root)
  })
})

describe('mod/zip - 读写往返', () => {
  test('deflate 压缩：打包 → 解包内容一致', () => {
    // 打包。
    const zip = createModZip({ files: { 'manifest.json': MANIFEST, 'code.js': 'gameAPI.on("x", () => {})' } })
    // 解包。
    const r = readModPackage(zip)
    // 成功。
    expect(r.ok).toBe(true)
    expect(r.name).toBe('zip-mod')
    expect(r.errors).toEqual([])
    // 内容一致。
    expect(r.files['code.js']).toBe('gameAPI.on("x", () => {})')
    expect(JSON.parse(r.files['manifest.json']).description).toBe('来自 zip')
  })

  test('store（不压缩）也能读', () => {
    // level 0 = store。
    const zip = createModZip({ files: { 'manifest.json': MANIFEST }, level: 0 })
    // 解包。
    const r = readModPackage(zip)
    // 成功。
    expect(r.ok).toBe(true)
    expect(r.name).toBe('zip-mod')
  })

  test('包装目录 + 数据文件：整体可用', () => {
    // 带包装目录与数据文件。
    const zip = createModZip({
      files: {
        'my-mod/manifest.json': MANIFEST,
        'my-mod/talents.json': '{"t1":{"id":"t1","name":"甲"}}',
        'my-mod/events.json': '{"e1":{"id":"e1","name":"乙"}}',
      },
    })
    // 解包。
    const r = readModPackage(zip)
    // 成功且路径已归一化到根。
    expect(r.ok).toBe(true)
    expect(Object.keys(r.files).sort()).toEqual(['events.json', 'manifest.json', 'talents.json'])
    expect(JSON.parse(r.files['talents.json']).t1.name).toBe('甲')
  })

  test('二进制资源**逐字节保留**（2026-10 能力补齐 ②：以前是被丢弃 + 警告）', () => {
    // 一段"像 PNG"的字节（真要逐字节比对，不能用随机文本）。
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 7])
    // 打包（用 assets 形态）。
    const zip = createModZip({ files: { 'manifest.json': MANIFEST }, assets: { 'assets/logo.png': png } })
    // 解包。
    const r = readModPackage(zip)
    // 成功。
    expect(r.ok).toBe(true)
    // 资源在 assets 里（**不是** files —— files 只装文本）。
    expect(r.files['assets/logo.png']).toBeUndefined()
    expect(r.assets['assets/logo.png']).toBeInstanceOf(Uint8Array)
    // 逐字节一致。
    expect([...r.assets['assets/logo.png']]).toEqual([...png])
    // binaries 是资源名单的别名（历史字段名，语义已变：从"被丢弃"变成"已保留"）。
    expect(r.binaries).toContain('assets/logo.png')
    // **不该再给"二进制被丢弃"的警告** —— 它现在留下来了，给警告会让人以为丢了。
    expect(r.errors).toEqual([])
    expect(r.skipped).toEqual([])
  })

  test('未知后缀也逐字节保留（按 application/octet-stream 对待）', () => {
    // 任意字节（含 0x00 与高位字节：UTF-8 解码会毁掉它们）。
    const blob = new Uint8Array([0, 1, 2, 254, 255, 128, 0])
    // 打包（未知后缀 + 目录嵌套）。
    const zip = createModZip({ files: { 'manifest.json': MANIFEST }, assets: { 'assets/data.bin': blob } })
    // 解包。
    const r = readModPackage(zip)
    // 保留且一致。
    expect([...r.assets['assets/data.bin']]).toEqual([...blob])
    // MIME 走通用二进制。
    expect(getMimeType('assets/data.bin')).toBe('application/octet-stream')
  })

  test('往返同时含文本与资源：各归各位，互不串味', () => {
    // 资源。
    const png = new Uint8Array([137, 80, 78, 71])
    // 打包（files 与 assets 混用，且 files 里也允许字节）。
    const zip = createModZip({
      files: { 'manifest.json': MANIFEST, 'code.js': 'gameAPI.log.info("x")' },
      assets: { 'assets/a.png': png, 'assets/b.woff2': new Uint8Array([119, 79, 70, 50]) },
    })
    // 解包。
    const r = readModPackage(zip)
    // 文本可读。
    expect(r.files['code.js']).toContain('gameAPI.log.info')
    // 资源逐字节一致。
    expect([...r.assets['assets/a.png']]).toEqual([...png])
    expect(Object.keys(r.assets).sort()).toEqual(['assets/a.png', 'assets/b.woff2'])
    // 清单里没有任何文本文件混进资源表。
    expect(Object.keys(r.assets)).not.toContain('code.js')
  })

  test('资源也受体积上限约束：超限的被跳过并报告（上限没有放宽）', () => {
    // 超单文件上限的字节（**常量没变**：8 MB）。
    const huge = new Uint8Array(MAX_FILE_BYTES + 1)
    // 打包。
    const zip = createModZip({ files: { 'manifest.json': MANIFEST }, assets: { 'assets/huge.png': huge } })
    // 解包。
    const r = readModPackage(zip)
    // 安装仍可继续（资源被跳过）。
    expect(r.ok).toBe(true)
    // 没进 assets。
    expect(r.assets['assets/huge.png']).toBeUndefined()
    // 报告可读（带上限数值）。
    expect(r.skipped.some((s) => s.includes('assets/huge.png') && s.includes(String(MAX_FILE_BYTES)))).toBe(true)
    // 小文件照常通过（不是"一超全丢"）。
    const okZip = createModZip({ files: { 'manifest.json': MANIFEST }, assets: { 'assets/small.png': new Uint8Array([1, 2, 3]) } })
    expect([...readModPackage(okZip).assets['assets/small.png']]).toEqual([1, 2, 3])
  })

  test('资源的路径穿越同样被挡住（`../evil.png` 不进 assets）', () => {
    // 含穿越路径的资源。
    const zip = createModZip({ files: { 'manifest.json': MANIFEST }, assets: { '../evil.png': new Uint8Array([1, 2]) } })
    // 解包。
    const r = readModPackage(zip)
    // 安装继续，但没有那条资源。
    expect(r.ok).toBe(true)
    expect(r.assets['../evil.png']).toBeUndefined()
    expect(r.binaries).toEqual([])
    // 报告了不安全路径。
    expect(r.errors.some((e) => e.includes('不安全路径'))).toBe(true)
  })

  test('getMimeType：覆盖任务要求的后缀，未知给 application/octet-stream', () => {
    // 图片。
    expect(getMimeType('a.png')).toBe('image/png')
    expect(getMimeType('a.jpg')).toBe('image/jpeg')
    expect(getMimeType('a.jpeg')).toBe('image/jpeg')
    expect(getMimeType('a.gif')).toBe('image/gif')
    expect(getMimeType('a.webp')).toBe('image/webp')
    expect(getMimeType('a.svg')).toBe('image/svg+xml')
    // 音频。
    expect(getMimeType('a.mp3')).toBe('audio/mpeg')
    expect(getMimeType('a.ogg')).toBe('audio/ogg')
    expect(getMimeType('a.wav')).toBe('audio/wav')
    // 字体。
    expect(getMimeType('a.woff')).toBe('font/woff')
    expect(getMimeType('a.woff2')).toBe('font/woff2')
    expect(getMimeType('a.ttf')).toBe('font/ttf')
    // 大小写与未知后缀。
    expect(getMimeType('assets/LOGO.PNG')).toBe('image/png')
    expect(getMimeType('a.unknown')).toBe('application/octet-stream')
    expect(getMimeType('noext')).toBe('application/octet-stream')
  })
})

describe('mod/zip - 拒绝不合法的包', () => {
  test('缺 manifest.json → 可读错误', () => {
    // 只有 code.js。
    const zip = createModZip({ files: { 'code.js': 'x' } })
    // 解包。
    const r = readModPackage(zip)
    // 失败信息点明原因。
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('缺少 manifest.json')
  })

  test('manifest 非法（缺 version）→ 报非法并给出校验细节', () => {
    // 缺 version。
    const zip = createModZip({ files: { 'manifest.json': '{"name":"x"}' } })
    // 解包。
    const r = readModPackage(zip)
    // 失败。
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('manifest 非法')
  })

  test('manifest 不是 JSON → 报解析失败', () => {
    // 坏 JSON。
    const zip = createModZip({ files: { 'manifest.json': '{oops' } })
    // 解包。
    const r = readModPackage(zip)
    // 失败。
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('不是合法 JSON')
  })

  test('路径穿越条目被忽略并报告（不写进 files）', () => {
    // 含 ../ 条目。
    const zip = createModZip({ files: { 'manifest.json': MANIFEST, '../evil.json': '{"x":1}' } })
    // 解包。
    const r = readModPackage(zip)
    // 安装仍可继续（manifest 合法），但危险条目被挡掉且报告。
    expect(r.ok).toBe(true)
    expect(r.files['../evil.json']).toBeUndefined()
    expect(r.errors.some((e) => e.includes('不安全路径'))).toBe(true)
  })

  test('条目数超上限 → 拒绝（尺寸/数量炸弹防护）', () => {
    // 造 MAX_ENTRIES+1 个空文件（外加 manifest）。
    const files = { 'manifest.json': MANIFEST }
    for (let i = 0; i <= MAX_ENTRIES; i++) files[`f${i}.txt`] = ''
    // 打包。
    const zip = createModZip({ files })
    // 解包。
    const r = readModPackage(zip)
    // 拒绝。
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('条目过多')
  })

  test('不是 zip 的字节 → 解压失败而不是抛异常', () => {
    // 随便一段文本。
    const r = readModPackage(new Uint8Array([1, 2, 3, 4, 5]))
    // 返回可读错误。
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('zip 解压失败')
  })
})

describe('mod/zip - manager.importZip 复用同一实现（后端与前端一致）', () => {
  test('真 zip → 落盘成功（无需注入 unzip）', () => {
    // 临时 mods 目录。
    const dir = mkdtempSync(join(tmpdir(), 'zip-import-'))
    // 清理。
    try {
      // 打包。
      const zip = createModZip({ files: { 'manifest.json': MANIFEST, 'code.js': 'gameAPI.on("y", () => {})' } })
      // 导入（不传 unzip → 走共用 zip 模块）。
      const r = importZip({ zipData: zip, modsDir: dir })
      // 成功。
      expect(r.ok).toBe(true)
      expect(r.name).toBe('zip-mod')
      // 文件真的落盘。
      expect(existsSync(join(dir, 'zip-mod', 'manifest.json'))).toBe(true)
      expect(readFileSync(join(dir, 'zip-mod', 'code.js'), 'utf8')).toContain('gameAPI.on')
      // 重复导入被拒绝。
      const again = importZip({ zipData: zip, modsDir: dir })
      expect(again.ok).toBe(false)
      expect(again.errors[0]).toContain('已存在')
    } finally {
      // 清理。
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('含资源的 zip → 字节按原样落盘（CLI 侧也能装带图的 Mod）', () => {
    // 临时 mods 目录。
    const dir = mkdtempSync(join(tmpdir(), 'zip-import-asset-'))
    // 清理。
    try {
      // 一段带高位字节的内容（用 utf8 写盘会坏掉，所以这条能真正验证"按字节写"）。
      const png = new Uint8Array([137, 80, 78, 71, 255, 0, 128])
      // 打包。
      const zip = createModZip({ files: { 'manifest.json': MANIFEST }, assets: { 'assets/logo.png': png } })
      // 导入。
      const r = importZip({ zipData: zip, modsDir: dir })
      // 成功。
      expect(r.ok).toBe(true)
      // 文件真的落盘，且逐字节一致（`writeFileSync` 收到 Uint8Array 时不会做文本转换）。
      const written = readFileSync(join(dir, 'zip-mod', 'assets', 'logo.png'))
      expect([...written]).toEqual([...png])
    } finally {
      // 清理。
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('危险 zip（路径穿越）→ 危险文件不落盘', () => {
    // 临时目录。
    const dir = mkdtempSync(join(tmpdir(), 'zip-import-bad-'))
    // 清理。
    try {
      // 打包（含穿越条目）。
      const zip = createModZip({ files: { 'manifest.json': MANIFEST, '../evil.json': '{"x":1}' } })
      // 导入。
      const r = importZip({ zipData: zip, modsDir: dir })
      // 安装成功但危险条目没写出去。
      expect(r.ok).toBe(true)
      expect(existsSync(join(dir, 'evil.json'))).toBe(false)
      expect(existsSync(join(dir, '..', 'evil.json'))).toBe(false)
      // 有警告带出。
      expect(r.errors.some((e) => e.includes('不安全路径'))).toBe(true)
    } finally {
      // 清理。
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ========== 组 5：node_modules 护栏（Mod 打包外部依赖的场景）==========
describe('mod/zip - node_modules 护栏', () => {
  test('带 node_modules 的包：给出可操作提示而不是"条目过多"', () => {
    // 造一个"错误地打进了依赖目录"的包：node_modules 下几十个文件 + 一个合法 manifest。
    const files = { 'manifest.json': MANIFEST, 'code.js': 'gameAPI.on("a", () => {})' }
    // 模拟 npm 依赖的目录结构。
    for (let i = 0; i < 40; i++) files[`node_modules/dep/f${i}.js`] = 'export default 1'
    // 打包成 zip。
    const zip = createModZip({ files })
    // 解析。
    const r = readModPackage(zip)
    // **安装仍然成功**（依赖被跳过，manifest/code 有效）。
    expect(r.ok).toBe(true)
    // 依赖没进产物。
    expect(Object.keys(r.files).some((f) => f.includes('node_modules'))).toBe(false)
    // 提示是可操作的（指向运行时方案：vendor/ + manifest.modules），且只出现一次（不刷屏）。
    const hits = r.errors.filter((e) => e.includes('node_modules'))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatch(/manifest\.modules/)
    // 关键：错误信息里**不该**出现误导性的"条目过多"。
    expect(r.errors.some((e) => e.includes('条目过多'))).toBe(false)
  })

  test('只有 node_modules 的超大包也不会误报条目过多（上限按过滤后计算）', () => {
    // 600 个依赖文件（超过 MAX_ENTRIES=512），但有效文件只有 2 个。
    const files = { 'manifest.json': MANIFEST, 'code.js': 'x' }
    // 填充。
    for (let i = 0; i < 600; i++) files[`node_modules/big/f${i}.js`] = '1'
    // 打包 + 解析。
    const r = readModPackage(createModZip({ files }))
    // 成功：条目数上限针对的是"真正会被安装的文件"。
    expect(r.ok).toBe(true)
    expect(MAX_ENTRIES).toBe(512)
    // 也不该报条目过多。
    expect(r.errors.some((e) => e.includes('条目过多'))).toBe(false)
  })
})
