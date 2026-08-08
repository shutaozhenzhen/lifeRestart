/**
 * Data Mod 打包 CLI 单元测试 — data-mod.cli.spec.js
 *
 * 覆盖范围：
 *   1. buildDataModFromDir：真实 JSON 加载 + 打包（条件转新语法、ID 字符串化、age 透传）
 *   2. writeDataMod：落盘目录结构与文件内容
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
// Node 内置：临时目录与文件操作。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
// 被测函数。
import { buildDataModFromDir, writeDataMod } from './data-mod.cli.js'
// manifest 常量。
import { DATA_MOD_MANIFEST } from '../mod/datamod.js'

// #makeRawData
// 构造最小原版 JSON 数据目录（模拟 remake public/data 结构）。
// @returns {string} 临时数据目录路径
function makeRawData() {
  // 临时目录。
  const dir = mkdtempSync(join(tmpdir(), 'datamod-src-'))
  // 语言子目录。
  const locale = join(dir, 'zh-cn')
  // 创建。
  mkdirSync(locale, { recursive: true })
  // 写数据文件。
  writeFileSync(join(locale, 'age.json'), JSON.stringify({
    0: { event: ['10000*10'], talent: [] },
    1: { event: [], talent: [] },
  }))
  // 天赋：数字 ID + 旧语法条件。
  writeFileSync(join(locale, 'talents.json'), JSON.stringify({
    1001: { id: 1001, name: 't1', condition: '(AGE?[18])&(INT>5)' },
  }))
  // 事件：include + branch 扁平。
  writeFileSync(join(locale, 'events.json'), JSON.stringify({
    10000: { id: 10000, event: 'e1', include: 'AEVT?[10000]', branch: ['(CHR>5)&(TLT?[1001]):20000'] },
    20000: { id: 20000, event: 'e2' },
  }))
  // 成就。
  writeFileSync(join(locale, 'achievement.json'), JSON.stringify({
    101: { id: 101, name: 'a1', condition: 'HAGE>79' },
  }))
  // 名人。
  writeFileSync(join(locale, 'character.json'), JSON.stringify({
    10: { id: 10, name: 'c1', property: { CHR: '2' } },
  }))
  // 返回目录。
  return dir
}

// #cleanup
// 删除临时目录。
// @param {string} dir - 目录路径
function cleanup(dir) {
  // 存在则删除。
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

// ========== 测试组 1：buildDataModFromDir ==========
describe('data-mod - buildDataModFromDir', () => {
  // 临时数据目录。
  let dataDir
  // 每个用例前建。
  beforeEach(() => { dataDir = makeRawData() })
  // 每个用例后清。
  afterEach(() => cleanup(dataDir))

  test('loads and packages raw JSON', async () => {
    // 打包。
    const mod = await buildDataModFromDir({ dataDir })
    // manifest。
    expect(mod.manifest).toEqual(DATA_MOD_MANIFEST)
    // 各数据集数量。
    expect(Object.keys(mod.talents)).toHaveLength(1)
    expect(Object.keys(mod.events)).toHaveLength(2)
    expect(Object.keys(mod.achievements)).toHaveLength(1)
    expect(Object.keys(mod.characters)).toHaveLength(1)
    // age 事件解析为 [id, weight] 二维数组。
    expect(mod.age['0'].event).toEqual([['10000', 10]])
  })

  test('stringifies numeric ids', async () => {
    // 打包。
    const mod = await buildDataModFromDir({ dataDir })
    // 天赋 ID 字符串化。
    expect(mod.talents['1001'].id).toBe('1001')
    // 事件 ID 字符串化。
    expect(mod.events['10000'].id).toBe('10000')
  })

  test('converts legacy conditions to new syntax', async () => {
    // 打包。
    const mod = await buildDataModFromDir({ dataDir })
    // 天赋条件。
    expect(mod.talents['1001'].condition).toBe('([18].includes(params.AGE)) && (params.INT > 5)')
    // 事件 include（AEVT 数组属性 → .some + 字符串 ID）。
    expect(mod.events['10000'].include).toBe('params.AEVT.some(id => ["10000"].includes(id))')
    // branch 条件部分转换、目标保留。
    expect(mod.events['10000'].branch[0]).toBe(
      '(params.CHR > 5) && (params.TLT.some(id => ["1001"].includes(id))):20000'
    )
    // 成就条件。
    expect(mod.achievements['101'].condition).toBe('params.HAGE > 79')
  })
})

// ========== 测试组 2：writeDataMod ==========
describe('data-mod - writeDataMod', () => {
  // 输出目录。
  let outDir
  // 每个用例前建。
  beforeEach(() => { outDir = mkdtempSync(join(tmpdir(), 'datamod-out-')) })
  // 每个用例后清。
  afterEach(() => cleanup(outDir))

  test('writes all data files to <out>/lifeRestart-data', async () => {
    // 打包（用最小数据目录）。
    const dataDir = makeRawData()
    // 打包。
    const mod = await buildDataModFromDir({ dataDir })
    // 落盘。
    const target = await writeDataMod({ mod, outDir })
    // 目录名。
    expect(target).toBe(join(outDir, 'lifeRestart-data'))
    // 文件齐全。
    const files = readdirSync(target).sort()
    expect(files).toEqual([
      'achievements.json', 'age.json', 'characters.json',
      'events.json', 'manifest.json', 'talents.json',
    ])
    // 清理数据目录。
    cleanup(dataDir)
  })

  test('written JSON is loader-compatible', async () => {
    // 打包（用最小数据目录）。
    const dataDir = makeRawData()
    // 打包。
    const mod = await buildDataModFromDir({ dataDir })
    // 落盘。
    await writeDataMod({ mod, outDir })
    // 目标目录。
    const target = join(outDir, 'lifeRestart-data')
    // manifest 可解析且字段齐全。
    const manifest = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8'))
    expect(manifest.name).toBe('lifeRestart-data')
    expect(manifest.system).toBe(true)
    // 数据可解析。
    const talents = JSON.parse(readFileSync(join(target, 'talents.json'), 'utf8'))
    expect(talents['1001'].condition).toContain('params.')
    // 清理数据目录。
    cleanup(dataDir)
  })
})
