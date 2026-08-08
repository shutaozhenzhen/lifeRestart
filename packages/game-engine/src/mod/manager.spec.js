/**
 * Mod 管理与内置 Data Mod 单元测试 — manager.spec.js（Step 14/15）
 *
 * 覆盖范围：22 个测试用例，分为 4 组：
 *   1. checkPermissions（权限匹配）
 *   2. importZip（zip 导入/JSON 拒绝/重复导入）
 *   3. toggleMod/removeMod/listMods（启用禁用/删除/列表）
 *   4. buildDataMod（Data Mod 打包/条件转换/system 标记）
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
// Node 内置。
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
// Mod 管理。
import { checkPermissions, importZip, listMods, toggleMod, removeMod } from './manager.js'
// Data Mod。
import { buildDataMod, isSystemMod, isDataMod, DATA_MOD_MANIFEST } from './datamod.js'

// ========== 测试组 1：checkPermissions ==========
describe('manager - checkPermissions', () => {
  test('no permissions always ok', () => {
    // 无权限声明。
    const m = { permissions: [] }
    // 匹配。
    expect(checkPermissions(m, []).ok).toBe(true)
  })

  test('granted permissions pass', () => {
    // 声明 hooks。
    const m = { permissions: ['hooks'] }
    // 已授权。
    expect(checkPermissions(m, ['hooks']).ok).toBe(true)
  })

  test('ungranted permission fails', () => {
    // 声明 ai。
    const m = { permissions: ['ai'] }
    // 未授权。
    const r = checkPermissions(m, [])
    // 不通过。
    expect(r.ok).toBe(false)
    // 缺失列出。
    expect(r.missing).toEqual(['ai'])
  })
})

// ========== 测试组 2：importZip ==========
describe('manager - importZip', () => {
  // 临时目录。
  let tempDir
  // mock 解压器。
  const mockUnzip = (files) => () => files

  beforeEach(() => {
    // 建临时目录。
    tempDir = mkdtempSync(join(tmpdir(), 'mgmt-test-'))
  })

  afterEach(() => {
    // 清理。
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('imports valid zip mod', () => {
    // zip 内容。
    const files = {
      'manifest.json': JSON.stringify({ name: 'zmod', version: '1.0.0' }),
      'talents.json': JSON.stringify({ t1: { id: 't1', name: 'Z' } }),
    }
    // 导入。
    const r = importZip({ zipData: 'x', modsDir: tempDir, unzip: mockUnzip(files) })
    // 成功。
    expect(r.ok).toBe(true)
    // 名字。
    expect(r.name).toBe('zmod')
    // 文件已写入。
    expect(listMods(tempDir)).toHaveLength(1)
  })

  test('rejects zip without manifest', () => {
    // 无 manifest。
    const files = { 'talents.json': '{}' }
    // 导入。
    const r = importZip({ zipData: 'x', modsDir: tempDir, unzip: mockUnzip(files) })
    // 失败。
    expect(r.ok).toBe(false)
    // 错误信息。
    expect(r.errors[0]).toContain('manifest')
  })

  test('rejects invalid manifest json', () => {
    // 非法 JSON。
    const files = { 'manifest.json': '{bad}' }
    // 导入。
    const r = importZip({ zipData: 'x', modsDir: tempDir, unzip: mockUnzip(files) })
    // 失败。
    expect(r.ok).toBe(false)
    // 错误信息。
    expect(r.errors[0]).toContain('JSON')
  })

  test('rejects duplicate mod name', () => {
    // 先导入。
    const files = { 'manifest.json': JSON.stringify({ name: 'dup', version: '1' }) }
    importZip({ zipData: 'x', modsDir: tempDir, unzip: mockUnzip(files) })
    // 再导入同名。
    const r = importZip({ zipData: 'x', modsDir: tempDir, unzip: mockUnzip(files) })
    // 失败。
    expect(r.ok).toBe(false)
    // 错误信息。
    expect(r.errors[0]).toContain('已存在')
  })

  test('rejects unzip failure', () => {
    // 解压抛错。
    const badUnzip = () => { throw new Error('corrupt') }
    // 导入。
    const r = importZip({ zipData: 'x', modsDir: tempDir, unzip: badUnzip })
    // 失败。
    expect(r.ok).toBe(false)
  })
})

// ========== 测试组 3：toggle/remove/list ==========
describe('manager - toggle/remove/list', () => {
  // 临时目录。
  let tempDir

  beforeEach(() => {
    // 建目录。
    tempDir = mkdtempSync(join(tmpdir(), 'mgmt-test-'))
    // 建 Mod。
    mkdirSync(join(tempDir, 'm1'), { recursive: true })
    writeFileSync(join(tempDir, 'm1', 'manifest.json'), JSON.stringify({ name: 'm1', version: '1' }))
  })

  afterEach(() => {
    // 清理。
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('listMods returns enabled mods', () => {
    // 列表。
    const mods = listMods(tempDir)
    // 一个。
    expect(mods).toHaveLength(1)
    // 名字。
    expect(mods[0].name).toBe('m1')
  })

  test('toggleMod disables and re-enables', () => {
    // 禁用。
    expect(toggleMod(tempDir, 'm1', false).ok).toBe(true)
    // 已禁用（目录名变 .disabled）。
    expect(listMods(tempDir)).toHaveLength(0)
    // 重新启用。
    expect(toggleMod(tempDir, 'm1', true).ok).toBe(true)
    // 恢复。
    expect(listMods(tempDir)).toHaveLength(1)
  })

  test('toggleMod missing mod fails', () => {
    // 不存在。
    const r = toggleMod(tempDir, 'ghost', false)
    // 失败。
    expect(r.ok).toBe(false)
  })

  test('removeMod deletes mod', () => {
    // 删除。
    expect(removeMod(tempDir, 'm1').ok).toBe(true)
    // 列表空。
    expect(listMods(tempDir)).toHaveLength(0)
  })

  test('removeMod missing mod fails', () => {
    // 不存在。
    const r = removeMod(tempDir, 'ghost')
    // 失败。
    expect(r.ok).toBe(false)
  })
})

// ========== 测试组 4：buildDataMod ==========
describe('datamod - buildDataMod', () => {
  test('builds mod with system manifest', () => {
    // 打包。
    const mod = buildDataMod({ talents: {}, events: {}, achievements: {}, characters: {} })
    // manifest。
    expect(mod.manifest.name).toBe('lifeRestart-data')
    // 系统标记。
    expect(mod.manifest.system).toBe(true)
  })

  test('converts talent condition to new syntax', () => {
    // 原始数据。
    const raw = { talents: { t1: { id: 't1', condition: 'CHR>5' } } }
    // 打包。
    const mod = buildDataMod(raw, { CHR: 'scalar' })
    // 转换。
    expect(mod.talents.t1.condition).toBe('params.CHR > 5')
  })

  test('converts event conditions', () => {
    // 原始数据。
    const raw = {
      events: {
        e1: { id: 'e1', include: 'INT>3', exclude: 'MNY<2', branch: [['CHR>7', 'e2']] },
      },
    }
    // 打包。
    const mod = buildDataMod(raw, { INT: 'scalar', MNY: 'scalar', CHR: 'scalar' })
    // 转换。
    expect(mod.events.e1.include).toBe('params.INT > 3')
    expect(mod.events.e1.exclude).toBe('params.MNY < 2')
    expect(mod.events.e1.branch[0][0]).toBe('params.CHR > 7')
  })

  test('stringifies exclude and parses age event weights', () => {
    // 原始数据（exclude 混合数字/字符串，age 事件混合数字与 "id*权重" 字符串）。
    const raw = {
      talents: { t1: { id: 't1', exclude: [1004, '1025'] } },
      age: { 0: { event: ['10001*110', 10110, '10494*999999'] }, 1: { event: [10111] } },
    }
    // 打包。
    const mod = buildDataMod(raw)
    // exclude 全部字符串化。
    expect(mod.talents.t1.exclude).toEqual(['1004', '1025'])
    // age 事件解析为 [id, weight] 二维数组（标准结构）。
    expect(mod.age['0'].event).toEqual([['10001', 110], ['10110', 1], ['10494', 999999]])
    expect(mod.age['1'].event).toEqual([['10111', 1]])
  })

  test('parses talent replacement into weight map', () => {
    // 原始数据（replacement.talent 混合数字 ID 与 "ID*权重" DSL）。
    const raw = {
      talents: {
        t1: { id: 't1', replacement: { talent: [1141, '1033*6'], grade: [2] } },
      },
    }
    // 打包。
    const mod = buildDataMod(raw)
    // 数组解析为对象映射。
    expect(mod.talents.t1.replacement).toEqual({
      talent: { '1141': 1, '1033': 6 },
      grade: { '2': 1 },
    })
  })

  test('does not mutate original data', () => {
    // 原始数据。
    const raw = { talents: { t1: { id: 't1', condition: 'CHR>5' } } }
    // 打包。
    buildDataMod(raw, { CHR: 'scalar' })
    // 原始不变。
    expect(raw.talents.t1.condition).toBe('CHR>5')
  })

  test('isSystemMod and isDataMod detection', () => {
    // Data Mod manifest。
    expect(isSystemMod(DATA_MOD_MANIFEST)).toBe(true)
    // Data Mod。
    expect(isDataMod(DATA_MOD_MANIFEST)).toBe(true)
    // 普通 Mod。
    expect(isSystemMod({ name: 'x', version: '1' })).toBe(false)
    // 非 Data Mod。
    expect(isDataMod({ name: 'other', version: '1' })).toBe(false)
  })
})
