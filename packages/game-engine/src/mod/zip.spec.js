/**
 * mod/zip 单元测试 — Mod 包 zip 读写（浏览器与 Node 共用）
 *
 * 覆盖：
 *   1. 往返：createModZip → readModPackage（deflate 与 store 两种压缩都读得出来）
 *   2. 单层包装目录（GitHub 导出的 zip）自动剥离
 *   3. 缺 manifest / manifest 非法 → 可读错误
 *   4. **路径穿越**（`../x`、绝对路径）被挡住并报告
 *   5. 尺寸与条目数上限（尺寸炸弹防护）
 *   6. 非文本文件被识别但不进 files（Mod 包约定只消费 JSON/JS）
 *   7. manager.importZip 走共用模块：真 zip → 落盘成功；危险 zip → 不落盘
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { MAX_ENTRIES, createModZip, isSafeEntryPath, readModPackage, stripWrapperDir } from './zip.js'
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

  test('非文本文件（如 png）不进 files，但会被提示', () => {
    // 二进制内容。
    const zip = createModZip({ files: { 'manifest.json': MANIFEST, 'icon.png': new Uint8Array([137, 80, 78, 71]) } })
    // 解包。
    const r = readModPackage(zip)
    // 成功。
    expect(r.ok).toBe(true)
    expect(r.files['icon.png']).toBeUndefined()
    expect(r.binaries).toContain('icon.png')
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
