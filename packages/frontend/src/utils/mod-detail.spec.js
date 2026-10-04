/**
 * mod-detail 单元测试 — 单个 Mod 的数据读取与可视化统计
 *
 * 覆盖：
 *   1. conventionFiles：约定清单（manifest + 5 张数据表 + code.js + manifest.modules）
 *   2. loadModDetail：本地已安装（内存 store）→ 解析数据 / 代码行数 / 文件清单
 *   3. loadModDetail 容错：Mod 不存在 / manifest 坏 JSON / manifest 非法 / 数据文件坏 JSON
 *   4. summarizeModData：纯统计（星级分布 / 事件条件 / 成就时机 / 年龄覆盖）与空输入
 *   5. **真实数据**：直接读仓库里的 `mods/`（lifeRestart-data 501 年龄 / 184 天赋 / 1720 事件）
 *
 * 注：这里刻意**不做** fetch 桩的 json() 兼容 —— 引擎的 HTTP 源只认 `text()`
 * （见 game-engine/src/mod/source-fetch.js），测试桩必须与真实接口同形。
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// node 文件（真实数据用例：把磁盘上的 mods/ 当作"服务器"）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// 被测模块。
import { conventionFiles, createDataFallbackSource, listModFiles, loadModDetail, resolveDataBase, summarizeModData } from './mod-detail.js'
// 内存 Mod 存储（模拟"本地已安装"）。
import { createMemoryModStore } from './mod-store.js'

// 本文件所在目录 → lifeRestart 根（src/utils → src → frontend → packages → lifeRestart）。
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

// #fsFetch
// 把磁盘目录当 HTTP 服务器：url 形如 `mods/<name>/<file>`。
//
// @param {string} rootDir - 根目录（lifeRestart）
// @returns {Function} fetch 实现
function fsFetch(rootDir) {
  // 请求。
  return async (url) => {
    // 相对路径（去掉前导 /）。
    const rel = String(url).replace(/^\/+/, '')
    // 读文件。
    try {
      // 读文本。
      const text = readFileSync(join(rootDir, rel), 'utf8')
      // 返回（**只提供 text()**，与真实源一致）。
      return { ok: true, status: 200, text: async () => text }
    } catch {
      // 不存在。
      return { ok: false, status: 404, text: async () => '' }
    }
  }
}

// #installMod
// 往内存 store 里装一个 Mod。
//
// @param {object} store - 内存 store
// @param {object} params
// @param {string} params.name - Mod 名
// @param {object|string} [params.manifest] - manifest（对象或原始字符串）
// @param {object} [params.files] - 额外文件（相对路径 → 文本）
// @returns {Promise<object>} store
async function installMod(store, { name, manifest = { name, version: '1.0.0' }, files = {} }) {
  // manifest 文本。
  const manifestText = typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
  // 安装。
  await store.install({ name, manifest: typeof manifest === 'string' ? {} : manifest, files: { 'manifest.json': manifestText, ...files } })
  // 返回。
  return store
}

describe('mod-detail - conventionFiles', () => {
  test('约定清单：manifest + 5 张数据表 + code.js（去重）', () => {
    // 清单。
    const files = conventionFiles({})
    // 关键文件都在。
    for (const f of ['manifest.json', 'age.json', 'talents.json', 'events.json', 'achievements.json', 'characters.json', 'code.js']) {
      expect(files, f).toContain(f)
    }
    // 无重复。
    expect(new Set(files).size).toBe(files.length)
  })

  test('把 manifest.modules 里的依赖文件也列进去（Mod 随包分发的 vendor）', () => {
    // 带 modules 的 manifest。
    const files = conventionFiles({ modules: { fflate: 'vendor/fflate.mjs' } })
    // 依赖文件在清单里。
    expect(files).toContain('vendor/fflate.mjs')
  })
})

describe('mod-detail - listModFiles', () => {
  test('源没有 files.json → 用约定清单（fromIndex=false）', async () => {
    // 最小源。
    const source = { async listFiles() { return null }, async readText() { return null } }
    // 读。
    const { files, fromIndex } = await listModFiles({ source, name: 'x', manifest: {} })
    // 结果。
    expect(fromIndex).toBe(false)
    expect(files).toContain('talents.json')
  })

  test('源提供 files.json → 以它为准（fromIndex=true）', async () => {
    // 源。
    const source = { async listFiles() { return ['manifest.json', 'talents.json'] }, async readText() { return null } }
    // 读。
    const { files, fromIndex } = await listModFiles({ source, name: 'x' })
    // 结果。
    expect(fromIndex).toBe(true)
    expect(files).toEqual(['manifest.json', 'talents.json'])
  })
})

describe('mod-detail - loadModDetail（本地已安装）', () => {
  test('读 manifest + 数据 + 代码行数', async () => {
    // 存储 + 装一个带数据与代码的 Mod。
    const store = createMemoryModStore()
    await installMod(store, {
      name: 'demo',
      manifest: { name: 'demo', version: '2.0.0', description: '演示', permissions: ['hooks'] },
      files: {
        'talents.json': JSON.stringify({ t1: { id: 't1', name: '天赋一', grade: 1 } }),
        'events.json': JSON.stringify({ e1: { id: 'e1', event: '事件一' } }),
        'code.js': 'export default () => {}\n// 第二行\n',
      },
    })
    // 读详情。
    const detail = await loadModDetail({ name: 'demo', store, baseUrl: 'mods/' })
    // 找到。
    expect(detail.found).toBe(true)
    // manifest 字段。
    expect(detail.manifest.version).toBe('2.0.0')
    expect(detail.manifest.permissions).toEqual(['hooks'])
    // manifest 校验通过。
    expect(detail.check.ok).toBe(true)
    // 数据。
    expect(detail.data.talents.t1.name).toBe('天赋一')
    expect(detail.data.events.e1.event).toBe('事件一')
    // 非空数据集（顺序与 DATA_FILES 一致）。
    expect(detail.present).toEqual(['talents', 'events'])
    // 代码行数（只统计规模，不执行）。
    expect(detail.codeLines).toBeGreaterThanOrEqual(2)
    // 无错误。
    expect(detail.errors).toEqual([])
  })

  test('Mod 不存在：found=false 且给出可读原因', async () => {
    // 空存储。
    const store = createMemoryModStore()
    // 读。
    const detail = await loadModDetail({ name: 'nope', store, baseUrl: 'mods/' })
    // 未找到。
    expect(detail.found).toBe(false)
    expect(detail.errors.join(' ')).toContain('找不到 Mod')
  })

  test('manifest 是坏 JSON：found=false 并记录解析失败', async () => {
    // 装坏 manifest。
    const store = createMemoryModStore()
    await installMod(store, { name: 'broken', manifest: '{oops' })
    // 读。
    const detail = await loadModDetail({ name: 'broken', store, baseUrl: 'mods/' })
    // 结果。
    expect(detail.found).toBe(false)
    expect(detail.errors.join(' ')).toContain('解析失败')
  })

  test('manifest 非法（缺 name）：仍展示，但校验错误带出来', async () => {
    // 装非法 manifest。
    const store = createMemoryModStore()
    await installMod(store, { name: 'bad', manifest: { version: '1.0.0' } })
    // 读。
    const detail = await loadModDetail({ name: 'bad', store, baseUrl: 'mods/' })
    // 找到（能展示）。
    expect(detail.found).toBe(true)
    // 校验不通过 + 错误列表非空。
    expect(detail.check.ok).toBe(false)
    expect(detail.errors.join(' ')).toContain('manifest 校验失败')
  })

  test('单个数据文件坏 JSON：其它数据照常给出，错误不静默', async () => {
    // 装坏数据文件。
    const store = createMemoryModStore()
    await installMod(store, {
      name: 'half',
      files: {
        'talents.json': '{oops',
        'events.json': JSON.stringify({ e1: { id: 'e1', event: '好的那个' } }),
      },
    })
    // 读。
    const detail = await loadModDetail({ name: 'half', store, baseUrl: 'mods/' })
    // 好的数据在。
    expect(detail.data.events.e1.event).toBe('好的那个')
    // 坏的不在。
    expect(detail.data.talents).toBeUndefined()
    // 错误被收集（引擎内部报的 error 也进 errors）。
    expect(detail.errors.join(' ')).toContain('talents.json')
  })

  test('未指定名字：直接返回错误', async () => {
    // 读。
    const detail = await loadModDetail({ name: '', store: createMemoryModStore() })
    // 结果。
    expect(detail.found).toBe(false)
    expect(detail.errors.join(' ')).toContain('未指定 Mod 名')
  })
})

describe('mod-detail - 数据目录（Data Mod 的数据不在自己目录里）', () => {
  test('resolveDataBase：拼 BASE_URL（Pages 子路径下也对）', () => {
    // 站点根。
    expect(resolveDataBase('data', '/')).toBe('/data/')
    // Pages 子路径。
    expect(resolveDataBase('data', '/lifeRestart/')).toBe('/lifeRestart/data/')
    // 没有结尾斜杠的 base。
    expect(resolveDataBase('data', '/lifeRestart')).toBe('/lifeRestart/data/')
    // 已带斜杠的相对目录 / 前导斜杠。
    expect(resolveDataBase('/data/', '/')).toBe('/data/')
    // 未声明。
    expect(resolveDataBase(null, '/')).toBeNull()
    expect(resolveDataBase('', '/')).toBeNull()
  })

  test('createDataFallbackSource：Mod 目录优先，读不到才落到数据目录', async () => {
    // 原 Mod 源：只有 manifest.json。
    const source = {
      async readText(mod, rel) { return rel === 'manifest.json' ? '{}' : null },
      async listFiles() { return ['manifest.json'] },
    }
    // 数据目录源（扁平）。
    const fetchImpl = async (url) => {
      // 数据目录里有 talents.json。
      if (String(url) === '/data/talents.json') return { ok: true, status: 200, text: async () => '{"t1":{}}' }
      // 其它 404。
      return { ok: false, status: 404, text: async () => '' }
    }
    // 造源。
    const fallback = createDataFallbackSource({ source, dataBase: '/data/', fetchImpl })
    // Mod 目录命中。
    expect(await fallback.readText('lifeRestart-data', 'manifest.json')).toBe('{}')
    // 兜底到数据目录。
    expect(await fallback.readText('lifeRestart-data', 'talents.json')).toBe('{"t1":{}}')
    // 两边都没有 → null。
    expect(await fallback.readText('lifeRestart-data', 'nope.json')).toBeNull()
  })

  test('声明了数据目录：即使 files.json 只列 manifest，5 张表也能读到', async () => {
    // 内存存储：装一个"数据不在自己目录"的 Mod（与线上 Data Mod 同形）。
    const store = createMemoryModStore()
    await store.install({
      // 名。
      name: 'lifeRestart-data',
      // manifest。
      manifest: { name: 'lifeRestart-data', version: '1.0.0', system: true, permissions: [] },
      // 文件：只有 manifest + files.json（**没有**数据文件）。
      files: {
        'manifest.json': JSON.stringify({ name: 'lifeRestart-data', version: '1.0.0', system: true, permissions: [] }),
        'files.json': JSON.stringify(['manifest.json']),
      },
    })
    // fetch 桩：数据目录（/data/）里有 5 张表。
    const fetchImpl = async (url) => {
      // 只认数据目录。
      const table = {
        '/data/age.json': { 0: { age: '0', event: [['e1', 1]], talent: [] } },
        '/data/talents.json': { t1: { id: 't1', name: '天赋一', grade: 1 } },
        '/data/events.json': { e1: { id: 'e1', event: '事件一' } },
        '/data/achievements.json': { a1: { id: 'a1', name: '成就一', grade: 0 } },
        '/data/characters.json': { c1: { id: 'c1', name: '名人一' } },
      }
      // 命中。
      if (String(url) in table) return { ok: true, status: 200, text: async () => JSON.stringify(table[String(url)]) }
      // 其它 404。
      return { ok: false, status: 404, text: async () => '' }
    }
    // 读详情（显式声明 dataFrom，避免依赖内置清单）。
    const detail = await loadModDetail({ name: 'lifeRestart-data', store, baseUrl: '/mods/', fetchImpl, dataFrom: 'data', siteBaseUrl: '/' })
    // 数据目录被解析出来。
    expect(detail.dataFrom).toBe('/data/')
    // 五张表全部读到（这正是浏览器里的真实形态：sync-mods 不复制那 4MB）。
    expect(detail.present).toEqual(['age', 'talents', 'events', 'achievements', 'characters'])
    // 文件清单把数据文件也列出来（否则界面看着像"没有数据"）。
    expect(detail.files).toContain('talents.json')
    // 没有错误。
    expect(detail.errors).toEqual([])
  })
})

describe('mod-detail - summarizeModData', () => {
  test('空数据：全 0 且年龄 min/max 为 null', () => {
    // 汇总。
    const s = summarizeModData({})
    // 总量（键与数据集 key 一致：age 而不是 ages —— 页面按 key 取数）。
    expect(s.totals).toEqual({ talents: 0, events: 0, achievements: 0, characters: 0, age: 0, all: 0 })
    // 年龄。
    expect(s.age.min).toBeNull()
    expect(s.age.max).toBeNull()
    expect(s.age.topAges).toEqual([])
  })

  test('天赋：星级分布 / 条件 / 互斥 / 替换 / 效果属性', () => {
    // 汇总。
    const s = summarizeModData({
      talents: {
        1: { id: '1', grade: 0, effect: { INT: 1 } },
        2: { id: '2', grade: 1, condition: 'params.INT > 3', effect: { INT: 1, STR: 1 } },
        3: { id: '3', grade: 1, exclusive: true },
        4: { id: '4', grade: 3, replacement: { talent: ['9'] } },
      },
    })
    // 计数。
    expect(s.talents.count).toBe(4)
    // 星级分布（升序）。
    expect(s.talents.byGrade).toEqual([{ key: 0, count: 1 }, { key: 1, count: 2 }, { key: 3, count: 1 }])
    // 条件 / 互斥 / 替换。
    expect(s.talents.withCondition).toBe(1)
    expect(s.talents.exclusive).toBe(1)
    expect(s.talents.withReplacement).toBe(1)
    // 效果属性分布（INT 出现 2 次、STR 1 次）。
    expect(s.talents.effectKeys).toEqual([{ key: 'INT', count: 2 }, { key: 'STR', count: 1 }])
  })

  test('星级缺失记为「未知」（不静默算成 0 星）', () => {
    // 汇总。
    const s = summarizeModData({ talents: { 1: { id: '1' }, 2: { id: '2', grade: null } } })
    // 未知。
    expect(s.talents.byGrade).toEqual([{ key: '未知', count: 2 }])
  })

  test('事件：include / exclude / branch / NoRandom / effect / postEvent', () => {
    // 汇总。
    const s = summarizeModData({
      events: {
        1: { id: '1', event: 'a', NoRandom: 1, effect: { LIF: -1 } },
        2: { id: '2', event: 'b', include: 'params.CHR > 5', exclude: 'params.INT > 9' },
        3: { id: '3', event: 'c', branch: ['x:1', 'y:2'], postEvent: '补充' },
      },
    })
    // 计数。
    expect(s.events.count).toBe(3)
    expect(s.events.withInclude).toBe(1)
    expect(s.events.withExclude).toBe(1)
    expect(s.events.withBranch).toBe(1)
    expect(s.events.branches).toBe(2)
    expect(s.events.noRandom).toBe(1)
    expect(s.events.withEffect).toBe(1)
    expect(s.events.withPostEvent).toBe(1)
  })

  test('成就：时机分布；名人：属性/天赋；年龄：覆盖范围与最密的年龄', () => {
    // 汇总。
    const s = summarizeModData({
      achievements: {
        1: { id: '1', grade: 0, opportunity: 'END' },
        2: { id: '2', grade: 2, opportunity: 'END', hide: 1, condition: 'params.TMS > 9' },
        3: { id: '3', grade: 1, opportunity: 'START' },
      },
      1: {},
      characters: {
        10: { id: '10', property: { CHR: '2' }, talent: ['1001'] },
        11: { id: '11' },
      },
      age: {
        0: { age: '0', event: [['e1', 1]], talent: [] },
        1: { age: '1', event: [['e1', 1], ['e2', 1]], talent: ['t1'] },
        2: { age: '2', event: [['e1', 1], ['e2', 1], ['e3', 1]], talent: [] },
      },
    })
    // 成就。
    expect(s.achievements.count).toBe(3)
    expect(s.achievements.hidden).toBe(1)
    expect(s.achievements.withCondition).toBe(1)
    expect(s.achievements.byOpportunity).toEqual([{ key: 'END', count: 2 }, { key: 'START', count: 1 }])
    // 名人。
    expect(s.characters.count).toBe(2)
    expect(s.characters.withProperty).toBe(1)
    expect(s.characters.withTalent).toBe(1)
    // 年龄。
    expect(s.age.count).toBe(3)
    expect(s.age.min).toBe(0)
    expect(s.age.max).toBe(2)
    expect(s.age.eventSlots).toBe(6)
    expect(s.age.talentSlots).toBe(1)
    // 候选事件最多的年龄排在最前（2 岁有 3 个）。
    expect(s.age.topAges[0]).toEqual({ age: 2, events: 3, talents: 0 })
  })

  test('表不是对象（脏数据）不抛异常', () => {
    // 直接传坏值。
    expect(() => summarizeModData({ talents: null, events: 42, age: 'x' })).not.toThrow()
    // 结果全是 0。
    expect(summarizeModData({ talents: null }).totals.talents).toBe(0)
  })
})

// #fsFetchTwoRoots
// 把**两个目录**拼成一个假服务器：`mods/...` 去 modsRoot，`data/...` 去 dataRoot。
//
// 为什么要两个根：Mod 目录与数据目录在仓库里本来就是两处（与线上一致：
// `public/mods/` 是生成产物、`public/data/` 是入库产物），而测试只能用**入库**的文件。
//
// @param {object} params
// @param {string} params.modsRoot - Mod 目录的根（lifeRestart）
// @param {string} params.dataRoot - 数据目录的根（packages/frontend/public）
// @returns {Function} fetch 实现
function fsFetchTwoRoots({ modsRoot, dataRoot }) {
  // 两个根的前缀映射。
  const bases = [
    { prefix: 'mods/', root: modsRoot },
    { prefix: 'data/', root: dataRoot },
  ]
  // 请求。
  return async (url) => {
    // 去掉前导 /。
    const rel = String(url).replace(/^\/+/, '')
    // 找匹配的前缀。
    const hit = bases.find((b) => rel.startsWith(b.prefix))
    // 不匹配 → 404。
    if (!hit) return { ok: false, status: 404, text: async () => '' }
    // 读文件。
    try {
      // 读文本（**只提供 text()**，与真实源一致）。
      const text = readFileSync(join(hit.root, rel), 'utf8')
      // 命中。
      return { ok: true, status: 200, text: async () => text }
    } catch {
      // 不存在。
      return { ok: false, status: 404, text: async () => '' }
    }
  }
}

describe('mod-detail - 真实数据（仓库里的 mods/）', () => {
  test('lifeRestart-data：读到原版规模，且与 summarize 一致', async () => {
    // 把磁盘上的 lifeRestart/ 当服务器。
    const detail = await loadModDetail({ name: 'lifeRestart-data', baseUrl: 'mods/', fetchImpl: fsFetch(REPO_ROOT) })
    // 找到 + 系统 Mod。
    expect(detail.found).toBe(true)
    expect(detail.manifest.system).toBe(true)
    // 五张表都在。
    expect(detail.present).toEqual(['age', 'talents', 'events', 'achievements', 'characters'])
    // 规模（原版数据：501 年龄 / 184 天赋 / 1720 事件）。
    expect(Object.keys(detail.data.age).length).toBe(501)
    expect(Object.keys(detail.data.talents).length).toBe(184)
    expect(Object.keys(detail.data.events).length).toBe(1720)
    // 统计与数据一致（星级分布之和 = 天赋数）。
    const s = summarizeModData(detail.data)
    expect(s.talents.byGrade.reduce((sum, b) => sum + b.count, 0)).toBe(184)
    // 年龄覆盖 0~500，且每岁都有候选事件。
    expect(s.age.min).toBe(0)
    expect(s.age.max).toBe(500)
    expect(s.age.avgEvents).toBeGreaterThan(1)
  }, 60000)

  test('第三方小 Mod（base-mod）：只有天赋表', async () => {
    // 读。
    const detail = await loadModDetail({ name: 'base-mod', baseUrl: 'mods/', fetchImpl: fsFetch(REPO_ROOT) })
    // 找到 + 只有天赋。
    expect(detail.found).toBe(true)
    expect(detail.present).toEqual(['talents'])
    // 规模小（原型 Mod）。
    expect(Object.keys(detail.data.talents).length).toBeGreaterThan(0)
  }, 60000)

  test('浏览器真实形态：Mod 目录的 manifest + 站点 data/ 的数据，两边都读到', async () => {
    // 站点根（**混合来源**）：Mod 目录读仓库里的 `mods/`（入库、干净克隆就有），
    // 数据目录读 `packages/frontend/public/data/`（同样入库）。
    //
    // 为什么不用 `packages/frontend/public/mods/`：那是 `scripts/sync-mods.mjs`
    // 生成的**被 gitignore 的产物**（.gitignore 第 64 行），干净克隆里根本不存在 ——
    // 早期版本的本用例就踩了这个坑，本地绿、CI 红（expected false to be true）。
    // 真实链路里不会有这个问题：`pnpm dev` / `pnpm build` 的脚本都会先跑 sync-mods。
    const layout = {
      // Mod 目录 → 仓库的 mods/。
      modsRoot: REPO_ROOT,
      // 数据目录 → 前端的 public/。
      dataRoot: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public'),
    }
    // 读：baseUrl=mods/、dataFrom=data —— 与浏览器里的调用完全一致。
    const detail = await loadModDetail({
      // Mod 名（目录名）。
      name: 'lifeRestart-data',
      // Mod 根。
      baseUrl: 'mods/',
      // 按前缀分流到两个根目录。
      fetchImpl: fsFetchTwoRoots(layout),
      // 数据目录（内置清单里就是这个值；这里显式传，避免测试依赖清单）。
      dataFrom: 'data',
      // 站点根。
      siteBaseUrl: '/',
    })
    // manifest 出自 Mod 目录、数据出自数据目录。
    expect(detail.found).toBe(true)
    expect(detail.dataFrom).toBe('/data/')
    // 五张表都读到了（这是"查看数据"页最重要的用例：Data Mod 的数据不在自己目录里）。
    expect(detail.present).toEqual(['age', 'talents', 'events', 'achievements', 'characters'])
    expect(Object.keys(detail.data.talents).length).toBe(184)
    expect(Object.keys(detail.data.age).length).toBe(501)
    // 文件清单里必须有数据文件（否则界面看着像"没有数据"）。
    // 注意：这里**不断言** filesFromIndex —— 它取决于 `files.json` 是否存在，
    // 而那是 sync-mods 的生成产物（干净克隆里没有），断言它等于把测试绑在生成物上。
    expect(detail.files).toContain('talents.json')
    expect(detail.files).toContain('age.json')
    // 无错误。
    expect(detail.errors).toEqual([])
  }, 60000)
})
