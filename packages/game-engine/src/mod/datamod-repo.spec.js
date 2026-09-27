/**
 * Data Mod 入库回归测试（datamod-repo.spec.js）
 *
 * 回归背景：
 *   mods/lifeRestart-data/ 曾因 .gitignore 被排除在仓库外，导致干净克隆下
 *   CLI（smoke / ai-game / consistency）与相关测试因缺少 achievements 等数据
 *   抛出 `TypeError: Cannot convert undefined or null to object`。
 *
 * 本测试锁定「仓库内置 Data Mod 必须存在且可被 mod 加载器加载」，
 * 防止该目录再次被 gitignore 或遗漏。
 */

// 导入 vitest。
import { describe, test, expect } from 'vitest'
// Node 内置：文件存在性检查。
import { existsSync } from 'node:fs'
// Node 内置：路径解析。
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// 被测模块：mod 加载器。
import { createModLoader } from './loader.js'

// 本文件目录（src/mod/）。
const HERE = dirname(fileURLToPath(import.meta.url))
// 仓库根：src/mod → src → game-engine → packages → <repo>。
const REPO_ROOT = join(HERE, '..', '..', '..', '..')
// 仓库 mods 目录。
const MODS_DIR = join(REPO_ROOT, 'mods')
// 内置 Data Mod 目录。
const DATA_MOD_DIR = join(MODS_DIR, 'lifeRestart-data')

describe('仓库内置 Data Mod（防 gitignore 回归）', () => {
  // manifest 必须存在（目录被入库的最小证明）。
  test('mods/lifeRestart-data/manifest.json 已入库', () => {
    expect(existsSync(join(DATA_MOD_DIR, 'manifest.json'))).toBe(true)
  })

  // 数据必须可被加载器读取，且各数据集非空。
  test('Data Mod 可被加载且 age/talents/events/achievements/characters 非空', () => {
    // 创建加载器。
    const loader = createModLoader({ modsDir: MODS_DIR })
    // 加载合并数据。
    const { data } = loader.loadAll()
    // 无扫描/排序错误。
    expect(loader.errors).toEqual([])
    // 各数据集非空。
    expect(Object.keys(data.age || {}).length).toBeGreaterThan(0)
    expect(Object.keys(data.talents || {}).length).toBeGreaterThan(0)
    expect(Object.keys(data.events || {}).length).toBeGreaterThan(0)
    expect(Object.keys(data.achievements || {}).length).toBeGreaterThan(0)
    expect(Object.keys(data.characters || {}).length).toBeGreaterThan(0)
  })
})
