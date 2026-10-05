/**
 * mod-export 单元测试 — 把 Mod 打包成 zip（「下载」按钮的实现）
 *
 * 覆盖：
 *   1. modZipFilename / dataFromOf：文件名清洗、数据目录声明查找（纯函数）
 *   2. 本地已安装（内存 store）→ 打包，且**不把站点的 files.json 打进包**
 *   3. 失败路径：没名字 / 找不到 Mod / manifest 坏 JSON / 清单列了却读不到（警告不静默）
 *   4. **往返**：createModZip → readModPackage 能装回来（下载的包必须可用）
 *   5. 真实数据 + 线上形态（Mod 目录只有 manifest+files.json，数据在 public/data）：
 *      5 张表全部进包，解回来是 501 年龄 / 184 天赋 / 1720 事件；
 *      系统 Mod 的包在安装侧被拒（按设计：系统名保留）——这条也要钉住，
 *      否则"下载成功但装不回来"会变成用户撞上的哑谜
 *   6. 第三方小 Mod（仓库里的 base-mod）：只有天赋表也能打包
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// node 文件（真实数据用例：把磁盘上的 mods/ 与 public/data 当"服务器"）。
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// 被测模块。
import { MOD_INDEX_FILE, dataFromOf, exportModZip, modZipFilename } from './mod-export.js'
// 引擎 zip 读写（往返验证）+ 安装入口（验证系统 Mod 名被拒）。
import { readModPackage } from 'game-engine/src/mod/zip.js'
import { installModFromZip } from './mod-runtime.js'
// 内存 Mod 存储（模拟"本地已安装"）。
import { createMemoryModStore } from './mod-store.js'

// 本文件所在目录 → lifeRestart 根（src/utils → src → frontend → packages → lifeRestart）。
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
// 前端 public 目录（含入库的 data/）。
const PUBLIC_DIR = join(REPO_ROOT, 'packages', 'frontend', 'public')

// #fsFetch
// 把磁盘目录当 HTTP 服务器：url 形如 `mods/<name>/<file>`。
//
// @param {string} rootDir - 根目录
// @returns {Function} fetch 实现（只提供 text()，与真实源一致）
function fsFetch(rootDir) {
  // 请求。
  return async (url) => {
    // 相对路径。
    const rel = String(url).replace(/^\/+/, '')
    // 读。
    try {
      // 读文本。
      const text = readFileSync(join(rootDir, rel), 'utf8')
      // 命中。
      return { ok: true, status: 200, text: async () => text }
    } catch {
      // 不存在。
      return { ok: false, status: 404, text: async () => '' }
    }
  }
}

// #deployedFetch
// 复刻**线上部署形态**：Mod 目录里只有 manifest.json + files.json（sync-mods 刻意不复制
// 那 4MB 数据），数据在 `data/`。两个目录都用仓库里入库的真实文件。
//
// @returns {Function} fetch 实现
function deployedFetch() {
  // 站点文件表（相对 URL → 内容）。
  const site = {
    // 系统 Data Mod 的 manifest（真实文件）。
    'mods/lifeRestart-data/manifest.json': readFileSync(join(REPO_ROOT, 'mods', 'lifeRestart-data', 'manifest.json'), 'utf8'),
    // sync-mods 为它生成的清单：数据文件不在自己目录，所以只列 manifest。
    'mods/lifeRestart-data/files.json': JSON.stringify(['manifest.json']),
  }
  // 数据目录：按磁盘实际内容（含清单）。
  for (const f of readdirSync(join(PUBLIC_DIR, 'data'))) site[`data/${f}`] = readFileSync(join(PUBLIC_DIR, 'data', f), 'utf8')
  // 请求。
  return async (url) => {
    // 归一化（去掉前导 / 与 ./）。
    const rel = String(url).replace(/^\.?\//, '').replace(/^\.\//, '')
    // 命中。
    if (site[rel] !== undefined) return { ok: true, status: 200, text: async () => site[rel] }
    // 失败。
    return { ok: false, status: 404, text: async () => '' }
  }
}

describe('mod-export - modZipFilename', () => {
  test('带上目录名与版本，并清洗非法字符', () => {
    // 常规。
    expect(modZipFilename('base-mod', '1.0.0')).toBe('liferestart-mod-base-mod-1.0.0.zip')
    // 没有版本。
    expect(modZipFilename('fun-mod')).toBe('liferestart-mod-fun-mod.zip')
    // 目录名带路径分隔符/中文（外部输入，不能直接进文件名）。
    expect(modZipFilename('a/b:c', '1.0')).toBe('liferestart-mod-a-b-c-1.0.zip')
    // 空名。
    expect(modZipFilename('', null)).toBe('liferestart-mod-mod.zip')
  })
})

describe('mod-export - dataFromOf', () => {
  test('系统 Data Mod 声明了数据目录，其它 Mod 没有', () => {
    // 内置清单里只有它。
    expect(dataFromOf('lifeRestart-data')).toBe('data')
    // 普通 Mod。
    expect(dataFromOf('base-mod')).toBeNull()
    // 不存在。
    expect(dataFromOf('nope')).toBeNull()
  })
})

describe('mod-export - exportModZip（本地已安装）', () => {
  test('打包 manifest + 数据 + code，且不把站点的 files.json 打进包', async () => {
    // 内存存储：装一个带数据与代码的 Mod（外加一个 files.json，模拟 sync-mods 产物）。
    const store = createMemoryModStore()
    // manifest。
    const manifest = { name: 'demo', version: '2.0.0', description: '演示', permissions: [] }
    // 安装。
    await store.install({
      // 名。
      name: 'demo',
      // manifest。
      manifest,
      // 文件。
      files: {
        'manifest.json': JSON.stringify(manifest),
        'talents.json': JSON.stringify({ t1: { id: 't1', name: '天赋一', grade: 1 } }),
        'events.json': JSON.stringify({ e1: { id: 'e1', event: '事件一' } }),
        'code.js': 'export default () => {}\n',
        'files.json': JSON.stringify(['manifest.json', 'talents.json']),
      },
    })
    // 打包（HTTP 一律 404：确保全部来自本地存储）。
    const r = await exportModZip({ name: 'demo', store, fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }) })
    // 成功。
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    // 文件名 + 版本。
    expect(r.filename).toBe('liferestart-mod-demo-2.0.0.zip')
    expect(r.version).toBe('2.0.0')
    // 打进包的文件。
    expect(Object.keys(r.files).sort()).toEqual(['code.js', 'events.json', 'manifest.json', 'talents.json'])
    // 站点生成的索引不进包。
    expect(r.files[MOD_INDEX_FILE]).toBeUndefined()
    // 是 zip 字节。
    expect(r.bytes).toBeInstanceOf(Uint8Array)
    expect(r.bytes.length).toBeGreaterThan(0)
    // 非系统 Mod。
    expect(r.system).toBe(false)
    // **往返**：下载的包必须能被 zip 安装读出来（同一个引擎实现）。
    const back = readModPackage(r.bytes)
    expect(back.ok).toBe(true)
    expect(back.name).toBe('demo')
    expect(Object.keys(back.files).sort()).toEqual(['code.js', 'events.json', 'manifest.json', 'talents.json'])
    expect(JSON.parse(back.files['talents.json']).t1.name).toBe('天赋一')
  })

  test('原始文本原样打包（不做"解析后再 stringify"）', async () => {
    // 存储：故意用紧凑 + 尾随空白的写法。
    const store = createMemoryModStore()
    // manifest。
    const manifest = { name: 'raw', version: '1.0.0' }
    // 安装。
    await store.install({
      // 名。
      name: 'raw',
      // manifest。
      manifest,
      // 文件（压缩写法的 JSON + 带空行的 JS）。
      files: {
        'manifest.json': JSON.stringify(manifest),
        'talents.json': '{"t1":{"id":"t1","name":"天赋一"}}',
        'code.js': '// 第一行\n\n// 第三行\n',
      },
    })
    // 打包。
    const r = await exportModZip({ name: 'raw', store, fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }) })
    // 解回来逐字节比较（说明没有被重新排版/丢空行）。
    const back = readModPackage(r.bytes)
    expect(back.files['talents.json']).toBe('{"t1":{"id":"t1","name":"天赋一"}}')
    expect(back.files['code.js']).toBe('// 第一行\n\n// 第三行\n')
  })
})

describe('mod-export - 失败路径（错误不许静默）', () => {
  test('未指定名字', async () => {
    // 打包。
    const r = await exportModZip({ name: '' })
    // 失败 + 可读原因。
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('未指定 Mod 名')
    expect(r.bytes).toBeNull()
  })

  test('找不到 Mod', async () => {
    // HTTP 全 404。
    const r = await exportModZip({ name: 'nope', fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }) })
    // 失败 + 可读原因。
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('找不到 Mod')
  })

  test('manifest 是坏 JSON', async () => {
    // 只给坏 manifest。
    const fetchImpl = async (url) => (String(url).endsWith('manifest.json')
      ? { ok: true, status: 200, text: async () => '{oops' }
      : { ok: false, status: 404, text: async () => '' })
    // 打包。
    const r = await exportModZip({ name: 'broken', fetchImpl })
    // 失败 + 可读原因。
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('解析失败')
  })

  test('manifest 校验不通过：照样打包，但问题进 warnings', async () => {
    // 清单合法 JSON、但缺 name（validateManifest 会报）。
    const fetchImpl = async (url) => (String(url).endsWith('manifest.json')
      ? { ok: true, status: 200, text: async () => JSON.stringify({ version: '1.0.0' }) }
      : { ok: false, status: 404, text: async () => '' })
    // 打包。
    const r = await exportModZip({ name: 'bad', fetchImpl })
    // 成功（能备份），但有警告。
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toContain('manifest 校验问题')
  })

  test('清单里列了却读不到的文件 → 记警告（不是静默丢掉）', async () => {
    // files.json 列了两个文件，但 talents.json 读不到。
    const fetchImpl = async (url) => {
      // 路径。
      const u = String(url)
      // manifest。
      if (u.endsWith('manifest.json')) return { ok: true, status: 200, text: async () => JSON.stringify({ name: 'half', version: '1.0.0' }) }
      // 清单。
      if (u.endsWith('files.json')) return { ok: true, status: 200, text: async () => JSON.stringify(['manifest.json', 'talents.json']) }
      // 其它 404。
      return { ok: false, status: 404, text: async () => '' }
    }
    // 打包。
    const r = await exportModZip({ name: 'half', fetchImpl })
    // 成功，但缺文件被点名。
    expect(r.ok).toBe(true)
    expect(r.files['talents.json']).toBeUndefined()
    expect(r.warnings.join(' ')).toContain('跳过 talents.json')
  })
})

describe('mod-export - 真实数据（仓库里的 mods/ 与 public/data）', () => {
  test('线上形态：数据目录兜底进包，解回来是 501/184/1720，且系统 Mod 名在安装侧被拒', async () => {
    // 线上形态（Mod 目录只有 manifest+files.json，数据在 data/）。
    const r = await exportModZip({
      // 目录名。
      name: 'lifeRestart-data',
      // Mod 根。
      baseUrl: 'mods/',
      // 假服务器。
      fetchImpl: deployedFetch(),
      // 数据目录（内置清单里就是 'data'；显式传，避免测试依赖清单）。
      dataFrom: 'data',
      // 站点根。
      siteBaseUrl: '/',
    })
    // 打包成功。
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    // 5 张表 + manifest（**没有** code.js：清单里没有它，数据目录也没有它）。
    expect(Object.keys(r.files).sort()).toEqual(['achievements.json', 'age.json', 'characters.json', 'events.json', 'manifest.json', 'talents.json'])
    // 数据来自数据目录。
    expect(r.dataFrom).toBe('/data/')
    // 系统 Mod 标记（界面据此提示"装回来前要改名"）。
    expect(r.system).toBe(true)
    // 往返：解回来是真实规模。
    const back = readModPackage(r.bytes)
    expect(back.ok).toBe(true)
    expect(back.name).toBe('lifeRestart-data')
    expect(Object.keys(JSON.parse(back.files['age.json'])).length).toBe(501)
    expect(Object.keys(JSON.parse(back.files['talents.json'])).length).toBe(184)
    expect(Object.keys(JSON.parse(back.files['events.json'])).length).toBe(1720)
    // zip 体积合理（4MB 文本压完应远小于原文件；只是防"压出个空包"）。
    expect(r.bytes.length).toBeGreaterThan(100 * 1024)
    // 安装侧：系统 Mod 名被拒（这是**设计**：防顶掉数据源）——所以界面必须提示改名。
    const store = createMemoryModStore()
    const installed = await installModFromZip({ bytes: r.bytes, store })
    expect(installed.ok).toBe(false)
    expect(installed.errors.join(' ')).toContain('系统 Mod')
  }, 120000)

  test('第三方小 Mod（base-mod）：只有天赋表也能打包并装回来', async () => {
    // 仓库里的 base-mod（只有 talents.json）。
    const r = await exportModZip({ name: 'base-mod', baseUrl: 'mods/', fetchImpl: fsFetch(REPO_ROOT) })
    // 成功。
    expect(r.ok).toBe(true)
    // 打进包的文件（约定清单探测：没有的静默跳过，有的都在）。
    expect(Object.keys(r.files)).toContain('manifest.json')
    expect(Object.keys(r.files)).toContain('talents.json')
    expect(r.system).toBe(false)
    // 往返。
    const back = readModPackage(r.bytes)
    expect(back.ok).toBe(true)
    expect(back.name).toBe('base-mod')
    // 装进本地存储（第三方 Mod 允许）。
    const store = createMemoryModStore()
    const installed = await installModFromZip({ bytes: r.bytes, store })
    expect(installed.ok).toBe(true)
    // 装完后本地能读到它的天赋表（内容非空 = 数据真的落地了）。
    expect(Object.keys(JSON.parse(await store.readText('base-mod', 'talents.json'))).length).toBeGreaterThan(0)
  }, 120000)
})
