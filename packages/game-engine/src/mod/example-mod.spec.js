/**
 * example-mod 回归测试 —— 「示例 Mod 必须真能跑」
 *
 * 为什么要有这份测试：`mods/example-mod/` 是**文档的活样板**（页面里的「Mod 制作文档」直接
 * 让人对照它读）。样板一旦坏了，文档就变成了错误示范，而且坏法往往很安静：
 *   字段名写错（比如把事件的 `event` 写成 `description`）→ 引擎读不到 → 事件永不触发；
 *   `dependencies` 漏了 → 被数据 Mod 整键覆盖 → "我的事件从来不触发"，日志里还看不出来。
 * 所以这里不测"能加载"，而是**真的跑一局**：把仓库真实数据 + 示例 Mod 一起加载，
 * 逐项断言"数据进来了 / 代码执行了 / 参数注册了 / 钩子挂上了 / 第 1 岁的事件真的被选中"。
 *
 * 数据源用的是仓库里的 `packages/frontend/public/data/*.json`（真实 501/184/1720），
 * 而不是 fixture —— 因为要验证的正是"示例 Mod 与**真实**内容 Mod 的合并与覆盖顺序"。
 */
import { describe, test, expect, beforeEach } from 'vitest'
// Node 内置：路径与 URL → 路径。
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
// Node 内置：读文件（真实数据）。
import { readFileSync, existsSync } from 'node:fs'
// 引擎：Mod 加载内核 + Node 文件源 + gameAPI + 参数注册表。
import { createModLoader, scanMods } from './loader.js'
import { createNodeSource } from './source-node.js'
import { createGameAPI, createHookBus } from './gameapi.js'
// manifest 校验与界面扩展取值助手（2026-10 能力补齐 ③）。
import { validateManifest } from './manifest.js'
import { manifestUi, uiPanels, uiPages, uiProperties, uiStats } from './ui-schema.js'
// 资源桥（Mod 包内二进制资源；2026-10 能力补齐 ②）。
import { createAssetBridge } from './asset-bridge.js'
import { createParamRegistry } from '../params/param-registry.js'
// 引擎：Life（真跑一局）。
import Life from '../modules/life.js'
// 引擎：种子 RNG（同 seed 可复现）。
import { createRng } from '../functions/util.js'

// #memoryStorage
// 内存 storage（**别用真实存档**：引擎里所有跨局数据都走注入的 storage）。
//
// @returns {object} storage 适配器
function memoryStorage() {
  // 底层数据。
  const data = {}
  // 适配器（引擎只要求 getItem/setItem）。
  return {
    // 读。
    getItem(k) { return k in data ? data[k] : null },
    // 写。
    setItem(k, v) { data[k] = String(v) },
  }
}

// 仓库真实 mods/ 目录（示例 Mod 就在里面）。
const MODS_DIR = fileURLToPath(new URL('../../../../mods/', import.meta.url))
// 仓库真实数据目录（前端静态产物；Data Mod 的数据就是它）。
const DATA_DIR = fileURLToPath(new URL('../../../frontend/public/data/', import.meta.url))

// #readData
// 读真实数据表的辅助（读不到就跳过依赖它的断言，避免在裁剪过的仓库里误红）。
function readData(file) {
  // 路径。
  const p = join(DATA_DIR, file)
  // 不存在。
  if (!existsSync(p)) return null
  // 解析。
  return JSON.parse(readFileSync(p, 'utf8'))
}

// #makeLifeData
// 造一份"真实数据 + 示例 Mod 覆盖"的数据对象（模拟引擎合并后的结果）。
function makeLifeData(merged) {
  // 合并结果优先，缺的用真实数据补（数据 Mod 已提供的内容）。
  return {
    // 年龄表。
    age: merged.age || readData('age.json'),
    // 天赋表。
    talents: merged.talents || readData('talents.json'),
    // 事件表。
    events: merged.events || readData('events.json'),
    // 成就表。
    achievements: merged.achievements || readData('achievements.json'),
    // 名人表。
    characters: merged.characters || readData('characters.json'),
  }
}

describe('example-mod - 加载与数据合并', () => {
  // 加载器（每例重建）。
  let loader

  beforeEach(async () => {
    // 用 Node 文件源加载仓库真实 mods/（含示例 Mod 与数据 Mod）。
    loader = await createModLoader({ source: createNodeSource(MODS_DIR), only: ['lifeRestart-data', 'example-mod'] })
  })

  test('示例 Mod 被发现，且 manifest 合法、无加载错误', () => {
    // 被发现。
    const found = loader.mods.find((m) => m.name === 'example-mod')
    expect(found, '示例 Mod 应该被扫描到').toBeTruthy()
    // 权限声明。
    expect(found.manifest.permissions).toEqual(['hooks', 'storage'])
    // 依赖数据 Mod（**这是它不被整键覆盖的前提**，见 README 的坑 2）。
    expect(found.manifest.dependencies).toEqual(['lifeRestart-data'])
    // 没有错误（顺序/扫描）。
    expect(loader.errors).toEqual([])
  })

  test('加载顺序：依赖先加载，示例 Mod 排在数据 Mod 之后', () => {
    // 位置。
    const iData = loader.order.indexOf('lifeRestart-data')
    const iExample = loader.order.indexOf('example-mod')
    // 两者都在。
    expect(iData).toBeGreaterThanOrEqual(0)
    expect(iExample).toBeGreaterThanOrEqual(0)
    // 示例在后（后加载覆盖先加载 —— 它的 age.json 才能生效）。
    expect(iExample).toBeGreaterThan(iData)
  })

  test('数据真的并进来了：天赋/事件/成就各就各位', async () => {
    // 加载全部数据。
    const { data, errors } = await loader.loadAll()
    // 无错。
    expect(errors).toEqual([])
    // 示例天赋。
    expect(data.talents['90001']).toBeTruthy()
    expect(data.talents['90001'].effect).toEqual({ CHR: 1, SPR: 1 })
    // 带 condition 的天赋（30 岁后才生效）。
    expect(data.talents['90002'].condition).toBe('params.AGE >= 30')
    // 示例事件：**字段名是 `event`**（写错成 description 就再也触发不了）。
    expect(data.events['90001'].event).toContain('示例事件')
    expect(data.events['90001'].postEvent).toContain('口袋')
    // 分支是"条件:目标id"的顺序列表。
    expect(data.events['90001'].branch).toEqual(['params.MNY > 8:90002', 'true:90003'])
    // NoRandom 事件（只能被 branch 链到）。
    expect(data.events['90002'].NoRandom).toBe(1)
    expect(data.events['90003'].NoRandom).toBe(1)
    // 成就。
    expect(data.achievements['90001'].opportunity).toBe('END')
    // age 表：示例 Mod 替换了第 1 岁，且**保留了原版那三个 id**（否则那三句就消失了）。
    expect(data.age['1'].event).toEqual([['90001', 20], ['10009', 10], ['10010', 10], ['10011', 1]])
  })

  test('原版内容没有被示例 Mod 弄丢（三个原始事件仍在表里）', async () => {
    // 加载。
    const { data } = await loader.loadAll()
    // 原版 age 1 引用过的事件都还在（示例 Mod 只是把 id 抄进了自己的 age 表）。
    expect(data.events['10009']).toBeTruthy()
    expect(data.events['10010']).toBeTruthy()
    expect(data.events['10011']).toBeTruthy()
    // 真实数据条数只增不减（示例 Mod 加 2 天赋 / 3 事件 / 1 成就）。
    const realTalents = readData('talents.json')
    if (realTalents) expect(Object.keys(data.talents).length).toBeGreaterThan(Object.keys(realTalents).length)
  })
})

describe('example-mod - code.js 执行与钩子', () => {
  // 钩子总线 / 参数注册表 / 数据。
  let hooks
  let params
  let data
  let code

  beforeEach(async () => {
    // 加载（拿到数据与代码文本）。
    const loader = await createModLoader({ source: createNodeSource(MODS_DIR), only: ['lifeRestart-data', 'example-mod'] })
    const r = await loader.loadAll()
    data = r.data
    // 示例 Mod 的代码。
    code = r.codeList.find((c) => c.name === 'example-mod').code
    // 总线与注册表（与 Life 共享）。
    hooks = createHookBus()
    params = createParamRegistry({ data: {}, storage: memoryStorage() })
  })

  test('code.js 是脚本体（不是 ES 模块）：用 new Function 执行，注入 gameAPI/require', () => {
    // 直接编译执行（与 loader.js:258 同一形态）。
    const api = createGameAPI({ data, hooks, params })
    // 不该抛错。
    expect(() => new Function('gameAPI', 'require', '"use strict";\n' + code)(api, () => { throw new Error('nope') })).not.toThrow()
  })

  test('code.js 注册了新参数，并挂上了 4 个钩子', () => {
    // 执行。
    const api = createGameAPI({ data, hooks, params })
    new Function('gameAPI', 'require', '"use strict";\n' + code)(api, () => {})
    // 参数注册成功（可以在条件里用了）。
    expect(params.names).toContain('LUCK_EXAMPLE')
    // 四个钩子都挂上了（注意 hooks.list() 返回的是**名字 → 数量**，不是数组）。
    const names = Object.keys(hooks.list())
    expect(names).toContain('onTalentPoolGenerate')
    expect(names).toContain('onYearAdvance')
    expect(names).toContain('onEventRender')
    expect(names).toContain('propertyChange')
    // gameAPI.hooks() 是同一个视图。
    // ⚠️ onYearAdvance 是 **2 个**回调：一个在 §2 演示逐岁注入，另一个在 §9 维护界面统计项
    //    （2026-10 能力补齐 ③ 加的那一段）。
    expect(api.hooks().onYearAdvance).toBe(2)
  })

  test('运行时增删数据：addTalent/addEvent/addAchievement 立即生效', () => {
    // 执行前。
    const api = createGameAPI({ data, hooks, params })
    new Function('gameAPI', 'require', '"use strict";\n' + code)(api, () => {})
    // 运行时加进来的天赋/事件/成就（code.js 第 3 节）。
    expect(data.talents['90004'].name).toContain('运行时')
    // **运行期注入必须显式给 maxTriggers**：浏览器侧 code.js 在 life.initial() 之后执行，
    // 绕过了 talent.js 的规范化（缺 maxTriggers → `0 < undefined` 为假 → 永不触发）。
    expect(data.talents['90004'].maxTriggers).toBe(1)
    expect(typeof data.talents['90004'].grade).toBe('number')
    expect(data.events['90005'].event).toContain('写 Mod')
    expect(data.achievements['90002'].condition).toBe('params.AGE > 0')
    // 反向删除也存在（成就的 remove 已于 2026-10 补齐 —— 这条断言以前钉的是"没有 remove"）。
    expect(typeof api.removeTalent).toBe('function')
    expect(typeof api.removeEvent).toBe('function')
    expect(typeof api.removeAchievement).toBe('function')
  })

  test('propertyChange：能观察到引擎内部的属性变化，且能改真属性（2026-10 能力补齐）', async () => {
    // 真 Life + 真属性桥（与浏览器接线一致：property 传 Life 本体）。
    const bus = createHookBus()
    const life = new Life({ data: makeLifeData({}), random: createRng(20261006), storage: memoryStorage(), hooks: bus })
    await life.initial()
    life.config()
    life.start({ CHR: 5, INT: 5, STR: 5, MNY: 5, SPR: 5 })
    // 执行示例 Mod 的 code.js（属性可用）。
    const api = createGameAPI({ data: {}, hooks: bus, property: life, params: life.params })
    new Function('gameAPI', 'require', '"use strict";\n' + readFileSync(join(MODS_DIR, 'example-mod', 'code.js'), 'utf8'))(api, () => {})
    // 属性桥可用（示例 Mod 据此决定要不要改属性）。
    expect(api.property.available).toBe(true)
    // 跑一次 20 岁的逐岁钩子：示例 Mod 会给 SPR +3。
    const before = life.propertys.SPR
    const content = []
    bus.emitSync('onYearAdvance', { age: 20, content, isEnd: false }, { error: () => {}, debug: () => {}, warn: () => {} })
    // **真属性**变了（不是写进某个没人读的自定义键）。
    expect(life.propertys.SPR).toBe(before + 3)
    // 当年轨迹里也说了这件事。
    expect(content.some((c) => String(c.description).includes('精神 +3'))).toBe(true)
    // 引擎内部的变化照样能被观察到：年龄自增 → propertyChange（source='engine'）。
    const seen = []
    bus.on('propertyChange', (p) => seen.push(p))
    life.next()
    expect(seen.some((p) => p.prop === 'AGE' && p.source === 'engine')).toBe(true)
  })

  test('属性不可用时（没跑到一局游戏里）示例 Mod 不会炸，且写操作明确报错', () => {
    // 不注入 property → 降级桥。
    const api = createGameAPI({ data: {}, hooks: createHookBus(), params })
    // 执行 code.js 不该抛（示例里用 `available` 守卫了）。
    expect(() => new Function('gameAPI', 'require', '"use strict";\n' + code)(api, () => {})).not.toThrow()
    // 降级桥的写操作明确报错（不是静默写进没人读的对象）。
    expect(api.property.available).toBe(false)
    expect(() => api.property.set('SPR', 1)).toThrow(/没有游戏属性系统/)
  })

  test('资源：不注入资源能力时示例 Mod 不炸，降级桥读操作报可读错误', async () => {
    // 不注入 asset → 降级桥。
    const api = createGameAPI({ data: {}, hooks: createHookBus(), params })
    // 降级桥。
    expect(api.asset.available).toBe(false)
    // 清单空（探测语义不抛）。
    await expect(api.asset.list()).resolves.toEqual([])
    // 读操作明确报错（示例 Mod 的 `available` 守卫让它不会走到这里）。
    expect(() => api.asset.url('assets/logo.png')).toThrow(/资源能力不可用/)
    // 执行 code.js 不该抛。
    expect(() => new Function('gameAPI', 'require', '"use strict";\n' + code)(api, () => {})).not.toThrow()
  })

  test('资源：注入资源源后能**逐字节**读到示例 Mod 包里的 png（2026-10 能力补齐 ②）', async () => {
    // 假资源源：只认这三个资源路径（**不碰真实文件系统的路径拼接** ——
    // 顺便证明"只读该 Mod 包内"这条约束是靠注入的 readBytes 实现的）。
    const allowed = ['assets/logo.png', 'assets/a.png', 'assets/b.ogg']
    // 真字节（从示例 Mod 目录真读一份，用于逐字节比对）。
    const realPng = new Uint8Array(readFileSync(join(MODS_DIR, 'example-mod', 'assets', 'logo.png')))
    // 替身。
    const fake = {
      // 清单。
      async listFiles() { return ['manifest.json', 'code.js', 'assets/logo.png'] },
      // 读字节（清单外的路径 → null，与真实 Node 源的行为一致）。
      async readBytes(_mod, path) {
        // 越界/不存在。
        if (!allowed.includes(path)) return null
        // 真 png。
        return realPng
      },
    }
    // 桥（Node 形态：传一个没有 createObjectURL 的 urlApi）。
    const bridge = createAssetBridge({ modName: 'example-mod', listFiles: fake.listFiles, readBytes: fake.readBytes, baseDir: join(MODS_DIR, 'example-mod'), urlApi: { Blob: undefined } })
    // 清单只列资源（manifest.json / code.js 不算资源）。
    expect(await bridge.list()).toEqual(['assets/logo.png'])
    // 逐字节一致。
    const bytes = await bridge.bytes('assets/logo.png')
    expect([...bytes]).toEqual([...realPng])
    // PNG magic（真的是一张图，不是被 UTF-8 损坏的文本）。
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    // Node 形态的 url() 是绝对路径，且指向这个 Mod 目录里的文件。
    const url = await bridge.url('assets/logo.png')
    expect(url.endsWith('assets/logo.png')).toBe(true)
    expect(existsSync(url)).toBe(true)
    // **路径穿越被拒**（连 readBytes 都不会被调用）。
    await expect(bridge.bytes('../../package.json')).rejects.toThrow(/资源路径不合法/)
    // 包内没有的资源 → 可读错误。
    await expect(bridge.bytes('assets/nope.png')).rejects.toThrow(/没有资源/)
  })

  test('资源：示例 Mod 的 30 岁轨迹文本里带受控占位符（界面据此渲染 <img>）', () => {
    // 执行 code.js（钩子要先注册上）。
    const api = createGameAPI({ data, hooks, params })
    new Function('gameAPI', 'require', '"use strict";\n' + code)(api, () => {})
    // 整十岁之外。
    const c29 = []
    hooks.emitSync('onYearAdvance', { age: 29, content: c29, isEnd: false }, { error: () => {}, debug: () => {} })
    expect(c29.some((c) => String(c.description).includes('{{asset:'))).toBe(false)
    // 30 岁：追加的那条里带占位符（**语法固定**：`{{asset:相对路径}}`）。
    const c30 = []
    hooks.emitSync('onYearAdvance', { age: 30, content: c30, isEnd: false }, { error: () => {}, debug: () => {} })
    // 命中。
    const hit = c30.find((c) => String(c.description).includes('{{asset:'))
    expect(hit, '30 岁应该追加一条带资源占位符的轨迹').toBeTruthy()
    // 路径与包内实际文件一致（写错路径 = 界面上永远是一串字符）。
    expect(hit.description).toContain('{{asset:assets/logo.png}}')
    // 那张图真的在包里（这条断言把"文档/示例"与真实文件钉在一起）。
    expect(existsSync(join(MODS_DIR, 'example-mod', 'assets', 'logo.png'))).toBe(true)
  })

  test('onEventRender 是唯一返回值生效的钩子：示例文本被加 ✨ 前缀', async () => {
    // 执行 code.js。
    const api = createGameAPI({ data, hooks, params })
    new Function('gameAPI', 'require', '"use strict";\n' + code)(api, () => {})
    // 直接问总线要渲染结果（emitSync 收集返回值）。
    const out = hooks.emitSync('onEventRender', { text: '【示例事件】测试' }, { error: () => {}, debug: () => {} })
    // 至少有一个返回值是加了前缀的。
    expect(JSON.stringify(out)).toContain('✨')
    // 非示例文本不改（返回 undefined）。
    const out2 = hooks.emitSync('onEventRender', { text: '普通事件' }, { error: () => {}, debug: () => {} })
    expect(JSON.stringify(out2)).not.toContain('✨')
  })

  test('onYearAdvance 会推进自定义参数，并往当年轨迹里追加条目', () => {
    // 执行 code.js。
    const api = createGameAPI({ data, hooks, params })
    new Function('gameAPI', 'require', '"use strict";\n' + code)(api, () => {})
    // 造一岁的 content。
    const content = []
    hooks.emitSync('onYearAdvance', { age: 10, content, isEnd: false }, { error: () => {}, debug: () => {} })
    // 参数 +1（从 undefined 起算 → 1）。
    expect(params.get('LUCK_EXAMPLE')).toBe(1)
    // 整十岁追加了一句。
    expect(content.length).toBe(1)
    expect(content[0].description).toContain('示例幸运值')
    // 非整十岁不追加。
    const c2 = []
    hooks.emitSync('onYearAdvance', { age: 11, content: c2, isEnd: false }, { error: () => {}, debug: () => {} })
    expect(c2.length).toBe(0)
    expect(params.get('LUCK_EXAMPLE')).toBe(2)
  })

  test('onTalentPoolGenerate 只塞一次（不重复入池）', () => {
    // 执行。
    const api = createGameAPI({ data, hooks, params })
    new Function('gameAPI', 'require', '"use strict";\n' + code)(api, () => {})
    // 触发两次。
    const pool = []
    hooks.emitSync('onTalentPoolGenerate', { pool }, { error: () => {}, debug: () => {} })
    hooks.emitSync('onTalentPoolGenerate', { pool }, { error: () => {}, debug: () => {} })
    // 只塞了一个。
    expect(pool.filter((t) => t.id === '90001').length).toBe(1)
  })
})

describe('example-mod - 界面扩展（2026-10 能力补齐 ③）', () => {
  // manifest / 代码。
  let manifest
  let code
  let hooks
  let data

  beforeEach(async () => {
    // 直接读 manifest（不必走加载器：本组只关心 ui 段）。
    manifest = JSON.parse(readFileSync(join(MODS_DIR, 'example-mod', 'manifest.json'), 'utf8'))
    // 加载（拿数据与代码）。
    const loader = await createModLoader({ source: createNodeSource(MODS_DIR), only: ['lifeRestart-data', 'example-mod'] })
    const r = await loader.loadAll()
    data = r.data
    code = r.codeList.find((c) => c.name === 'example-mod').code
    hooks = createHookBus()
  })

  test('manifest.ui 通过校验，且规范化后四类都拿到了预期内容', () => {
    // 校验（**示例 Mod 必须自己先过校验**：它是文档里让人照抄的样板）。
    const result = validateManifest(manifest)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    // 规范化。
    const ui = manifestUi(manifest)
    // 1 个页面 + 1 个面板 + 1 个属性 + 1 个统计。
    expect(ui.pages).toHaveLength(1)
    expect(ui.pages[0].id).toBe('example-guide')
    expect(ui.pages[0].title).toBe('示例 Mod 的页面')
    // 块真的是数组，且块类型都在渲染器支持的那几种里（写错会显示"未知内容块类型"）。
    const blockTypes = ui.pages[0].blocks.map((b) => b.t)
    expect(blockTypes.length).toBeGreaterThan(0)
    for (const t of blockTypes) expect(['p', 'sub', 'note', 'list', 'table', 'code', 'link', 'api', 'action']).toContain(t)
    // 面板：slot 在白名单里 + 有标题。
    expect(ui.panels).toHaveLength(1)
    expect(ui.panels[0]).toMatchObject({ id: 'example-home', slot: 'home' })
    expect(ui.panels[0].blocks.length).toBeGreaterThan(0)
    // 属性项（key = 内置的 CHR；`addProperty` 对已存在属性是幂等注册 —— 界面不重复加行）。
    expect(ui.properties).toEqual([{ key: 'CHR', label: '颜值' }])
    // 统计项：kind 缺省补齐成 count。
    expect(ui.stats).toEqual([{ key: 'EXAMPLE_YEARS', label: '示例 · 走过的年头', kind: 'count' }])
    // 取值助手（与 getTargets/getEntry 同样的风格）。
    expect(uiPanels(manifest)).toHaveLength(1)
    expect(uiPages(manifest)[0].id).toBe('example-guide')
    expect(uiProperties(manifest)).toHaveLength(1)
    expect(uiStats(manifest)).toHaveLength(1)
  })

  test('没有注入 uiSink（= CLI 这类宿主）：available 为 false，注册调用抛可读错误', () => {
    // 执行 code.js（不注入 uiSink）。
    const api = createGameAPI({ data, hooks, params: createParamRegistry({ data: {}, storage: memoryStorage() }) })
    // 不抛（示例代码有 available 守卫）。
    expect(() => new Function('gameAPI', 'require', '"use strict";\n' + code)(api, () => {})).not.toThrow()
    // 能力探测：明确不可用（而不是"看着能用、实际什么都没发生"）。
    expect(api.ui.available).toBe(false)
    // 注册调用抛**可读错误**（消息里说清了怎么办）。
    expect(() => api.ui.addPanel({ id: 'x', slot: 'home', title: 'x', blocks: [] })).toThrow(/界面注册能力/)
    expect(() => api.ui.addPanel({ id: 'x', slot: 'home', title: 'x', blocks: [] })).toThrow(/manifest\.ui/)
    // 读操作是安全的。
    expect(api.ui.list().panels).toEqual([])
    // 动作表由桥自己持有 → onAction 在没有 sink 时**也能注册**（界面侧另有渲染器按 id 查）。
    const off = api.ui.onAction('act', () => {})
    expect(api.ui.hasAction('act')).toBe(true)
    // 注销后不可点。
    off()
    expect(api.ui.hasAction('act')).toBe(false)
  })

  test('注入 uiSink 后：示例 Mod 的**运行期注册**真的落到宿主（1 面板 + 1 统计 + 1 动作）', () => {
    // 宿主注册表替身。
    const added = []
    const stats = []
    // sink（与 stores/extensions.js 同形）。
    const sink = {
      // 收声明。
      add: (kind, item, mod) => { added.push({ kind, item, mod }) },
      // 收统计键（转给 Life 的形态）。
      addStatistic: (key, value) => { stats.push([key, value]); return true },
    }
    // 执行 code.js。
    const api = createGameAPI({ data, hooks, params: createParamRegistry({ data: {}, storage: memoryStorage() }), uiSink: sink, modName: 'example-mod' })
    new Function('gameAPI', 'require', '"use strict";\n' + code)(api, () => {})
    // available 为 true。
    expect(api.ui.available).toBe(true)
    // 运行期注册了一个 summary 面板（**刻意用已挂载的 slot**，这样启用示例 Mod 后总结页真的能看到）。
    const panel = added.find((x) => x.kind === 'panels')
    expect(panel).toBeTruthy()
    expect(panel.item).toMatchObject({ id: 'example-runtime-panel', slot: 'summary' })
    expect(panel.mod).toBe('example-mod')
    // 面板里有一个动作块（注册过 → 可点）。
    expect(panel.item.blocks.some((b) => b.t === 'action' && b.id === 'example-hello')).toBe(true)
    // 动作注册到了本地桥（界面渲染器据此决定按钮可点/禁用）。
    expect(api.ui.hasAction('example-hello')).toBe(true)
    // 统计：addStatistic（引擎产生键）+ addStat（界面怎么显示）两步都发生了。
    expect(stats).toContainEqual(['EXAMPLE_YEARS', 0])
    const statDecl = added.find((x) => x.kind === 'stats')
    expect(statDecl.item).toMatchObject({ key: 'EXAMPLE_YEARS', label: '示例 · 走过的年头', kind: 'count' })
    // 逐年维护那个统计项：推一年 → 值变 1。
    hooks.emitSync('onYearAdvance', { age: 1, content: [], isEnd: false })
    expect(stats).toContainEqual(['EXAMPLE_YEARS', 1])
    // 非法 slot 会被桥拦下（可读错误，而不是静默不显示）。
    expect(() => api.ui.addPanel({ id: 'bad', slot: 'sidebar', title: 'x', blocks: [] })).toThrow(/不是合法 slot/)
  })
})

describe('example-mod - 真跑一局', () => {
  test('第 1 岁的候选里包含示例事件；事件真的能执行，且 branch 命中后递归到下一事件', async () => {
    // 加载数据与代码。
    const loader = await createModLoader({ source: createNodeSource(MODS_DIR), only: ['lifeRestart-data', 'example-mod'] })
    const r = await loader.loadAll()
    // 数据（缺真实数据时跳过本用例，避免在裁剪仓库里误红）。
    const lifeData = makeLifeData(r.data)
    if (!lifeData.age || !lifeData.events) return
    // 钩子总线（与 Life 共享，这样 code.js 的 onEventRender 会影响 Life 渲染）。
    const hooks = createHookBus()
    // 建 Life（与 game.cli.js 同一形态：new → initial → config → start）。
    const life = new Life({ data: lifeData, random: createRng(20261006), hooks, storage: memoryStorage() })
    await life.initial()
    life.config()
    life.start({ CHR: 5, INT: 5, STR: 5, MNY: 5, SPR: 5 })
    // 执行 code.js（与浏览器侧一样，在 Life 建好之后）。
    const api = createGameAPI({ data: lifeData, hooks, params: life.params })
    new Function('gameAPI', 'require', '"use strict";\n' + readFileSync(join(MODS_DIR, 'example-mod', 'code.js'), 'utf8'))(api, () => {})
    // 第 1 岁的候选里必须有示例事件（说明 age.json 生效了、没被数据 Mod 整键覆盖回去）。
    expect(JSON.stringify(lifeData.age['1'])).toContain('90001')
    // 直接执行示例事件：走完整流程（branch → 递归 → 渲染），且不该抛错。
    const content = life.doEvent('90001')
    expect(content.length).toBeGreaterThanOrEqual(1)
    // 描述来自事件的 `event` 字段，并被 onEventRender 加了 ✨ 前缀（证明钩子真的接进了 Life）。
    expect(content[0].description).toContain('示例事件')
    expect(content[0].description).toContain('✨')
    // branch `true:90003` 命中 → 第 2 条是分支目标。
    expect(JSON.stringify(content)).toContain('古币')
  })
})
