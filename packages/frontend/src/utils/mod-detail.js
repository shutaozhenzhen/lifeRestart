/**
 * mod-detail — 读取**单个 Mod** 的 manifest 与数据（供「Mod 管理 → 查看数据」页）
 *
 * 为什么单独一个模块：
 *   `mod-runtime.js` 的 `loadModBundle()` 只给**合并后**的数据（后加载覆盖先加载），
 *   从结果里看不出"这条天赋是哪个 Mod 带来的"；而"点进去看某个 Mod 到底装了什么"
 *   必须**按 Mod 名单独读、不合并**。
 *
 * 与引擎的关系（关键）：
 *   数据文件的读法**直接复用引擎的 `loadMod()`**（同一份实现，遵守同样的约定：
 *   优先 `files.json` 清单，没有就按 `DATA_FILES` 探测；单个文件解析失败只记错误不中断）。
 *   因此本页显示的内容 = 引擎实际会加载的内容，不存在"界面读一套、引擎读另一套"。
 *
 * 本模块**不碰 DOM**（node 环境单测可直接引用）。
 */

// 引擎：单 Mod 数据读取（DATA_FILES / CODE_FILE）+ 文件源 + manifest 校验 + 取值助手。
import { loadMod, DATA_FILES, CODE_FILE } from 'game-engine/src/mod/loader.js'
import { validateManifest, manifestTargets, manifestEntry, manifestDeterministic, manifestModules } from 'game-engine/src/mod/manifest.js'
// 浏览器侧文件源（HTTP + 本地已安装）。
import { createBrowserModSource, MODS_BASE_URL } from './mod-runtime.js'
// HTTP 文件源（"数据目录"兜底用）。
import { createFetchSource } from 'game-engine/src/mod/source-fetch.js'
// 内置 Mod 清单（Data Mod 的 `dataFrom`：数据在站点另一个目录）。
import { DEFAULT_MOD_LIST } from './mod-catalog.js'

// #resolveDataBase
// 把 `dataFrom`（相对站点根的目录名，如 `data`）解析成可直接请求的 URL 前缀。
//
// 为什么要拼 BASE_URL：GitHub Pages 部署在子路径（`/lifeRestart/`）下，
// 站点根的 `/data/...` 会 404；`import.meta.env.BASE_URL` 在 dev 是 `/`、
// Pages 构建是 `./`（与 utils/game-data.js 的 fetchOriginalData 同一套规则）。
//
// @param {string|null} dataFrom - 相对目录（null = 不使用）
// @param {string} [baseUrl] - 站点基础路径（缺省 import.meta.env.BASE_URL）
// @returns {string|null} URL 前缀（以 / 结尾）；dataFrom 为空时 null
export function resolveDataBase(dataFrom, baseUrl) {
  // 没声明。
  if (!dataFrom) return null
  // 基础路径（node 环境 / 单测里 import.meta.env 可能不存在）。
  const base = String(baseUrl !== undefined ? baseUrl : (import.meta.env?.BASE_URL || '/'))
  // 相对目录（去掉前导斜杠）。
  const rel = String(dataFrom).replace(/^\/+/, '')
  // 拼（两侧都保证有 /）。
  return `${base.endsWith('/') ? base : `${base}/`}${rel.endsWith('/') ? rel : `${rel}/`}`
}

// #createDataFallbackSource
// 造一个"**Mod 目录优先 → 数据目录兜底**"的源（只在该 Mod 声明了 dataFrom 时用）。
//
// 为什么不直接用组合源：`loadMod()` 会用 `files.json` 过滤数据文件，
// 而 Data Mod 的 `files.json` 里只有 `manifest.json`（数据不在 Mod 目录）——
// 直接用组合源的话，5 张数据表会被"清单里没有"直接跳过，兜底永远轮不到。
// 所以这里把清单交给**数据目录**（通常没有 files.json → null → 引擎按约定探测 5 张表），
// 读文本时先试 Mod 自己的目录，再落到数据目录。
//
// @param {object} params
// @param {object} params.source - 原 Mod 源
// @param {string} params.dataBase - 数据目录 URL 前缀
// @param {Function} [params.fetchImpl] - fetch 实现
// @param {object} [params.log] - 日志器
// @returns {object} 文件源
export function createDataFallbackSource({ source, dataBase, fetchImpl, log } = {}) {
  // 数据目录源（**扁平**：忽略 Mod 名，`<dataBase><file>`）。
  const flat = createFetchSource({ baseUrl: dataBase, fetchImpl, log })
  // 返回源。
  return {
    // 类型（排查用）。
    kind: 'data-fallback',
    // 清单：以数据目录为准（没有 files.json 时返回 null → 引擎按约定探测）。
    async listFiles() {
      // 读数据目录的 files.json（通常不存在）。
      return flat.listFiles('')
    },
    // 读文本：Mod 目录优先 → 数据目录兜底。
    async readText(mod, rel) {
      // 先试 Mod 自己的目录。
      const own = await source.readText(mod, rel)
      // 命中。
      if (own !== null && own !== undefined) return own
      // 兜底：数据目录。
      return flat.readText('', rel)
    },
  }
}

// #CONVENTION_FILES
// 源不支持 `files.json` 时的"约定清单"（界面展示用；与引擎探测的范围一致）。
//
// @param {object} manifest - manifest
// @returns {string[]} 文件清单
export function conventionFiles(manifest = {}) {
  // 清单。
  const files = ['manifest.json', ...DATA_FILES, CODE_FILE]
  // 运行时模块（依赖随包分发的自包含文件）。
  for (const rel of Object.values(manifestModules(manifest) || {})) {
    // 只收字符串路径。
    if (typeof rel === 'string') files.push(rel)
  }
  // 去重。
  return [...new Set(files)]
}

// #listModFiles
// 读某个 Mod 的文件清单：优先源提供的 `files.json`，否则用约定清单。
//
// @param {object} params
// @param {object} params.source - 文件源
// @param {string} params.name - Mod 名
// @param {object} [params.manifest] - manifest（约定清单要读 modules）
// @returns {Promise<{files: string[], fromIndex: boolean}>} 清单与来源
export async function listModFiles({ source, name, manifest = {} } = {}) {
  // 源提供的清单（浏览器里通常是 null：sync-mods 不生成 files.json）。
  let listed = null
  // 读（失败按"没有"处理，与引擎 loadMod 的做法一致）。
  try {
    // 读。
    listed = await source.listFiles(name)
  } catch {
    // 忽略。
    listed = null
  }
  // 有清单就用清单，否则用约定清单。
  return Array.isArray(listed)
    ? { files: listed.map(String), fromIndex: true }
    : { files: conventionFiles(manifest), fromIndex: false }
}

// #loadModDetail
// 读取单个 Mod 的全部可展示信息（manifest + 数据 + 文件清单 + manifest 校验结果）。
//
// 不抛异常：找不到 Mod / manifest 坏 JSON / 单个数据文件坏 JSON 都进 `errors`，
// 由页面显示（"错误不许静默"）。
//
// @param {object} params
// @param {string} params.name - Mod 名（目录名）
// @param {string} [params.baseUrl] - Mod 根路径
// @param {Function} [params.fetchImpl] - fetch 实现（测试注入）
// @param {object} [params.store] - 已安装 Mod 的本地存储（可选）
// @param {object} [params.log] - 日志器
// @param {string} [params.dataFrom] - 数据目录（覆盖内置清单里的声明；测试用）
// @param {string} [params.siteBaseUrl] - 站点基础路径（数据目录相对它解析；测试用）
// @returns {Promise<{name: string, found: boolean, manifest: object|null, check: object|null, files: string[], filesFromIndex: boolean, dataFrom: string|null, data: object, present: string[], codeLines: number, errors: string[]}>} 详情
export async function loadModDetail({ name, baseUrl = MODS_BASE_URL, fetchImpl, store, log, dataFrom, siteBaseUrl } = {}) {
  // 错误累积（一路带到界面，不许静默）。
  const errors = []
  // 结果骨架。
  const result = {
    name,
    found: false,
    manifest: null,
    check: null,
    files: [],
    filesFromIndex: false,
    dataFrom: null,
    data: {},
    present: [],
    codeLines: 0,
    errors,
  }
  // 没有名字就没什么可读的。
  if (!name) {
    errors.push('未指定 Mod 名')
    return result
  }
  // 文件源（本地已安装优先 → 服务器）。
  const source = createBrowserModSource({ baseUrl, fetchImpl, store, log })
  // 读 manifest。
  let text = null
  try {
    // 读。
    text = await source.readText(name, 'manifest.json')
  } catch (e) {
    // 记错。
    errors.push(`读取 manifest.json 失败: ${e.message}`)
  }
  // 不存在 → 没这个 Mod。
  if (text === null || text === undefined) {
    errors.push(`找不到 Mod「${name}」（服务器上没有它的 manifest.json，本地也没装）`)
    return result
  }
  // 解析。
  let manifest = null
  try {
    // 解析。
    manifest = JSON.parse(text)
  } catch (e) {
    // 记错并返回（没有 manifest 就无从知道数据文件约定）。
    errors.push(`manifest.json 解析失败: ${e.message}`)
    return result
  }
  // 校验（引擎同一实现）。
  const check = validateManifest(manifest)
  // 非法也继续展示（让人看到问题在哪），但把错误带出去。
  if (!check.ok) {
    for (const e of check.errors) errors.push(`manifest 校验失败: ${e}`)
  }
  // 填结果。
  result.found = true
  result.manifest = manifest
  result.check = check
  // 数据目录（显式参数 > 内置清单声明）→ URL 前缀。
  // 只有系统 Data Mod 会走到这里：它的数据在 <BASE_URL>data/，不在自己的目录里。
  const dataFromRel = dataFrom !== undefined ? dataFrom : (DEFAULT_MOD_LIST.find((m) => m.name === name)?.dataFrom || null)
  // 解析成可请求的前缀。
  result.dataFrom = resolveDataBase(dataFromRel, siteBaseUrl)
  // 文件清单（声明了数据目录 → 数据文件也算它的"内容"，一并列出）。
  const listed = await listModFiles({ source, name, manifest })
  // 清单 + 数据文件（去重）。
  result.files = result.dataFrom ? [...new Set([...listed.files, ...DATA_FILES])] : listed.files
  result.filesFromIndex = listed.fromIndex
  // 数据（**引擎同一实现**：遵守 files.json / 约定清单，坏 JSON 只记错不中断）。
  const loaded = await loadMod({
    // Mod 描述。
    mod: { name, manifest },
    // 文件源：声明了数据目录就用"Mod 目录优先 → 数据目录兜底"的源，
    // 否则就是普通源（此时 files.json 的过滤照常生效）。
    source: result.dataFrom ? createDataFallbackSource({ source, dataBase: result.dataFrom, fetchImpl, log }) : source,
    // 日志器（把引擎的解析错误也收集进 errors）。
    log: collectingLog(errors, log),
  })
  // 填数据。
  result.data = loaded.data
  // 非空数据集（顺序固定，界面按它渲染卡片）。
  result.present = DATA_FILES.map((f) => f.replace('.json', '')).filter((k) => result.data[k])
  // 代码行数（只显示规模，不执行代码；去掉末尾空行再数，否则会多算一行）。
  result.codeLines = loaded.code ? String(loaded.code).replace(/\n+$/, '').split('\n').length : 0
  // 日志：读到了什么（可观测）。
  if (log?.debug) log.debug(`[mod-detail] ${name}: ${result.present.join('/') || '无数据'}，文件 ${result.files.length} 个`)
  // 返回。
  return result
}

// #collectingLog
// 包一层日志器：把引擎内部报的 error 也收进错误列表（页面统一展示）。
//
// @param {string[]} errors - 错误收集数组
// @param {object} [log] - 原日志器
// @returns {object} 日志器
function collectingLog(errors, log) {
  // 返回。
  return {
    // debug 透传。
    debug: (...a) => log?.debug?.(...a),
    // info 透传。
    info: (...a) => log?.info?.(...a),
    // warn 透传。
    warn: (...a) => log?.warn?.(...a),
    // error：既透传也收集。
    error: (...a) => {
      // 透传。
      log?.error?.(...a)
      // 收集。
      errors.push(String(a[0] ?? ''))
    },
  }
}

// #countBy
// 按 key 计数（可视化用的最小原语）。
//
// @param {Array} list - 条目
// @param {Function} keyFn - 取 key
// @returns {Array<{key: *, count: number}>} 计数结果（按 key 升序）
function countBy(list, keyFn) {
  // 计数表。
  const map = new Map()
  // 逐条。
  for (const item of list) {
    // 取 key。
    const key = keyFn(item)
    // 累加。
    map.set(key, (map.get(key) || 0) + 1)
  }
  // 转数组并排序。
  return [...map.entries()]
    // 转对象。
    .map(([key, count]) => ({ key, count }))
    // 数字 key 按数值升序，字符串 key 按字典序。
    .sort((a, b) => (typeof a.key === 'number' && typeof b.key === 'number'
      ? a.key - b.key
      : String(a.key).localeCompare(String(b.key), 'zh-CN')))
}

// #values
// 取对象的值数组（非对象/空 → []）。
//
// @param {*} table - 表
// @returns {Array} 条目数组
function values(table) {
  // 非对象。
  if (!table || typeof table !== 'object') return []
  // 对象 → 值数组。
  return Object.values(table)
}

// #gradeKey
// 星级 key（缺失/非法 → '未知'）。
//
// 注意 `Number(null) === 0` 这个 JS 陷阱：0 星是**有意义**的星级，
// 所以 null / undefined / 空串必须单独判成"未标注"，不能被静默算成 0 星。
//
// @param {object} item - 条目
// @returns {number|string} 星级
function gradeKey(item) {
  // 原始值。
  const raw = item?.grade
  // 明确缺失。
  if (raw === null || raw === undefined || raw === '') return '未知'
  // 取值。
  const g = Number(raw)
  // 合法数字才算星级。
  return Number.isFinite(g) ? g : '未知'
}

// #summarizeModData
// 把某个 Mod 的数据汇总成**可视化用的统计**（纯函数，无副作用，可单测）。
//
// @param {object} [data] - { age, talents, events, achievements, characters }
// @returns {object} 统计
export function summarizeModData(data = {}) {
  // 各表条目。
  const talents = values(data.talents)
  const events = values(data.events)
  const achievements = values(data.achievements)
  const characters = values(data.characters)
  const ages = values(data.age)
  // 年龄条目：event / talent 槽位（缺失按空数组）。
  const ageRows = ages.map((row) => ({
    // 年龄（数据里的 age 字段，缺失用表键无所谓，取 age ?? -1）。
    age: Number(row?.age ?? -1),
    // 事件条数。
    events: Array.isArray(row?.event) ? row.event.length : 0,
    // 天赋条数。
    talents: Array.isArray(row?.talent) ? row.talent.length : 0,
  }))
  // 有效年龄（数字）。
  const validAges = ageRows.filter((r) => Number.isFinite(r.age) && r.age >= 0)
  // 返回统计。
  return {
    // 总量（卡片用）。
    // 键与 DATA_FILES 保持一致（`age` 而不是 `ages`）—— 页面按数据集 key 取数，
    // 键名不一致会让"年龄表"那一格永远空白（这个坑踩过一次）。
    totals: {
      talents: talents.length,
      events: events.length,
      achievements: achievements.length,
      characters: characters.length,
      age: ages.length,
      // 全部条目数。
      all: talents.length + events.length + achievements.length + characters.length + ages.length,
    },
    // 天赋。
    talents: {
      // 条数。
      count: talents.length,
      // 星级分布（0~3 + 未知）。
      byGrade: countBy(talents, gradeKey),
      // 有条件（需要满足才触发）。
      withCondition: talents.filter((t) => !!t?.condition).length,
      // 专属（不入抽取池）。
      exclusive: talents.filter((t) => !!t?.exclusive).length,
      // 带替换链。
      withReplacement: talents.filter((t) => !!t?.replacement).length,
      // 效果属性分布（effect 的键）。
      effectKeys: countBy(talents.flatMap((t) => (t?.effect && typeof t.effect === 'object' ? Object.keys(t.effect) : [])), (k) => k),
    },
    // 事件。
    events: {
      // 条数。
      count: events.length,
      // 触发条件。
      withInclude: events.filter((e) => !!e?.include).length,
      // 排除条件。
      withExclude: events.filter((e) => !!e?.exclude).length,
      // 分支。
      withBranch: events.filter((e) => Array.isArray(e?.branch) && e.branch.length > 0).length,
      // 分支总数。
      branches: events.reduce((sum, e) => sum + (Array.isArray(e?.branch) ? e.branch.length : 0), 0),
      // 不参与随机抽取（关键剧情）。
      noRandom: events.filter((e) => !!e?.NoRandom).length,
      // 有属性变化。
      withEffect: events.filter((e) => !!e?.effect).length,
      // 额外文本（postEvent 等）。
      withPostEvent: events.filter((e) => !!e?.postEvent).length,
      // 效果属性分布。
      effectKeys: countBy(events.flatMap((e) => (e?.effect && typeof e.effect === 'object' ? Object.keys(e.effect) : [])), (k) => k),
    },
    // 成就。
    achievements: {
      // 条数。
      count: achievements.length,
      // 星级分布。
      byGrade: countBy(achievements, gradeKey),
      // 有条件。
      withCondition: achievements.filter((a) => !!a?.condition).length,
      // 隐藏成就。
      hidden: achievements.filter((a) => !!a?.hide).length,
      // 达成时机分布（START / TRAJECTORY / SUMMARY / END）。
      byOpportunity: countBy(achievements, (a) => a?.opportunity || '未标注'),
    },
    // 名人。
    characters: {
      // 条数。
      count: characters.length,
      // 带初始属性。
      withProperty: characters.filter((c) => c?.property && typeof c.property === 'object').length,
      // 带专属天赋。
      withTalent: characters.filter((c) => Array.isArray(c?.talent) && c.talent.length > 0).length,
    },
    // 年龄表。
    age: {
      // 覆盖的年龄数。
      count: ages.length,
      // 最小 / 最大年龄。
      min: validAges.length ? Math.min(...validAges.map((r) => r.age)) : null,
      max: validAges.length ? Math.max(...validAges.map((r) => r.age)) : null,
      // 事件槽位总数（含权重条目）。
      eventSlots: ageRows.reduce((sum, r) => sum + r.events, 0),
      // 天赋槽位总数。
      talentSlots: ageRows.reduce((sum, r) => sum + r.talents, 0),
      // 平均每岁多少个候选事件。
      avgEvents: ageRows.length ? ageRows.reduce((sum, r) => sum + r.events, 0) / ageRows.length : 0,
      // 候选事件最多的年龄（前 8，降序）。
      topAges: [...ageRows].sort((a, b) => b.events - a.events).slice(0, 8),
    },
  }
}
