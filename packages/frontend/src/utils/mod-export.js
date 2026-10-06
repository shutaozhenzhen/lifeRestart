/**
 * mod-export — 把一个 Mod 打包成 zip（Mod 管理页/详情页「下载」按钮的实现）
 *
 * 为什么单独一个模块：
 *   界面上只是"点一下下载"，背后要做四件事，而且**必须与引擎读 Mod 的方式完全一致**
 *   （否则"下载下来的包"与"引擎实际加载的东西"会分叉）：
 *     1. 文件清单：优先 `<mod>/files.json`，没有就按引擎的约定清单探测
 *        —— 复用 `mod-detail.js` 的 `listModFiles()`（「查看数据」页用的同一份）
 *     2. 数据不在自己目录的 Mod（系统 Data Mod）：数据要经**兜底源**从 `<BASE_URL>data/` 取
 *        —— 复用 `createDataFallbackSource()`（同一个 `dataFrom` 机制）
 *     3. 读**原始文本**再打包，而不是"把解析后的对象 stringify 回去"：
 *        后者会改动字节、放大体积，还会把 `age.json` 的 3.4MB 重新排版
 *     4. 压缩用引擎的 `createModZip()`（与 zip 安装共用同一套 fflate 实现与条目约定）
 *
 * 产出的包必须能**装回去**：`readModPackage(createModZip(files))` 在测试里往返验证
 * （含真实数据 501 年龄 / 184 天赋 / 1720 事件的整包往返，见 mod-export.spec.js）。
 *
 * 两条刻意的取舍：
 *   · **不打包 `files.json`**：那是站点为了"HTTP 列不了目录"生成的索引（sync-mods 产物），
 *     不是 Mod 的内容；带上它既会把生成物当内容分发，也会在 Mod 内容变化后变成过期清单。
 *   · **系统 Mod 也允许下载**：它的数据就是用户的价值所在（4MB 原版数据）。
 *     但 zip 安装默认拒绝系统 Mod 名（`SYSTEM_MOD_NAMES`，防止静默顶掉数据源与 AI 通道），
 *     所以返回值里带 `system` 标记，界面据此明说"这是系统预装，装回来会再问一次"
 *     （用户确认后走 `installModFromZip({ allowSystem: true })`，不需要改 manifest.name）。
 *
 * 本模块**不碰 DOM**（返回 zip 字节，浏览器侧由 log-export 的 `downloadBytes` 落地）。
 */

// 引擎：数据文件约定 + manifest 校验 + zip 打包（与 zip 安装同一实现）。
import { DATA_FILES } from 'game-engine/src/mod/loader.js'
import { validateManifest } from 'game-engine/src/mod/manifest.js'
import { createModZip } from 'game-engine/src/mod/zip.js'
// 浏览器侧文件源 + 站点路径解析 + 系统 Mod 名（同一份清单，安装侧也用它）。
import { createBrowserModSource, MODS_BASE_URL, SYSTEM_MOD_NAMES } from './mod-runtime.js'
// 单 Mod 读法（与「查看数据」页共用）：清单 + 数据目录兜底。
import { createDataFallbackSource, listModFiles, resolveDataBase } from './mod-detail.js'
// 内置 Mod 清单（`dataFrom` 的声明处）。
import { DEFAULT_MOD_LIST } from './mod-catalog.js'

// #MOD_INDEX_FILE
// 站点生成的文件索引：**不进包**（理由见文件头注释）。
export const MOD_INDEX_FILE = 'files.json'

// #dataFromOf
// 查这个 Mod 是否声明了"数据在站点另一个目录"（内置清单里只有系统 Data Mod 有）。
//
// 为什么按 name 也按 dir 找：内置清单按 manifest 的 `name` 登记，而调用方给的可能是
// 目录名（文件源寻址用的键）——两者在系统 Mod 上相同，但这里是接口边界，都认。
//
// @param {string} name - Mod 名或目录名
// @param {Array<object>} [list] - 内置清单
// @returns {string|null} 数据目录（相对站点根）或 null
export function dataFromOf(name, list = DEFAULT_MOD_LIST) {
  // 命中。
  const hit = list.find((m) => m?.name === name || m?.dir === name)
  // 声明值（空串按"没声明"）。
  return hit?.dataFrom || null
}

// #modZipFilename
// 建议的下载文件名（`liferestart-mod-<目录名>[-<版本>].zip`）。
//
// 为什么要清洗：目录名/manifest 字段是外部输入，直接进文件名可能带路径分隔符或
// 平台非法字符（下载在部分浏览器会静默失败或变成奇怪的名字）。
//
// @param {string} name - Mod 名/目录名
// @param {string} [version] - 版本
// @returns {string} 文件名
export function modZipFilename(name, version) {
  // 只保留安全字符。
  const safe = (s) => String(s ?? '').replace(/[^A-Za-z0-9._-]/g, '-')
  // 名（空 → mod）。
  const base = safe(name) || 'mod'
  // 版本段（没有就不加）。
  const v = version ? `-${safe(version)}` : ''
  // 拼。
  return `liferestart-mod-${base}${v}.zip`
}

// #exportModZip
// 把某个 Mod 打包成 zip 字节（不落盘、不碰 DOM）。
//
// 不抛异常：找不到 Mod / manifest 坏 JSON / 个别文件读不到都进 `errors`（致命）或
// `warnings`（非致命），由界面显示（"错误不许静默"）。
//
// @param {object} params
// @param {string} params.name - Mod 名（**目录名**，与「查看数据」页的寻址一致）
// @param {string} [params.baseUrl] - Mod 根路径
// @param {Function} [params.fetchImpl] - fetch 实现（测试注入）
// @param {object} [params.store] - 已安装 Mod 的本地存储（可选，本地已装的 Mod 也能导出）
// @param {object} [params.log] - 日志器
// @param {string} [params.dataFrom] - 数据目录（覆盖内置清单声明；测试用）
// @param {string} [params.siteBaseUrl] - 站点基础路径（数据目录相对它解析；测试用）
// @returns {Promise<{ok: boolean, name: string, version: string|null, filename: string, bytes: Uint8Array|null, files: object, count: number, manifest: object|null, system: boolean, dataFrom: string|null, errors: string[], warnings: string[]}>} 结果
export async function exportModZip({ name, baseUrl = MODS_BASE_URL, fetchImpl, store, log, dataFrom, siteBaseUrl } = {}) {
  // 致命错误。
  const errors = []
  // 非致命（缺文件、manifest 校验问题）。
  const warnings = []
  // 失败骨架（保证调用方拿到的字段形状一致）。
  const empty = {
    ok: false,
    name,
    version: null,
    filename: '',
    bytes: null,
    files: {},
    count: 0,
    manifest: null,
    system: false,
    dataFrom: null,
    errors,
    warnings,
  }
  // 没名字。
  if (!name) {
    // 记错。
    errors.push('未指定 Mod 名')
    // 返回。
    return empty
  }
  // 文件源（本地已安装优先 → 服务器）。
  const source = createBrowserModSource({ baseUrl, fetchImpl, store, log })
  // manifest 文本（包的必要条件）。
  let text = null
  // 读（源异常也要记下来）。
  try {
    // 读。
    text = await source.readText(name, 'manifest.json')
  } catch (e) {
    // 记错。
    errors.push(`读取 manifest.json 失败: ${e.message}`)
  }
  // 不存在。
  if (text === null || text === undefined) {
    // 记错（原因要能读懂）。
    errors.push(`找不到 Mod「${name}」（服务器上没有它的 manifest.json，本地也没装）`)
    // 返回。
    return empty
  }
  // 解析。
  let manifest = null
  // 解析（坏 JSON 直接结束：没有 manifest 就不知道这个包是什么）。
  try {
    // 解析。
    manifest = JSON.parse(text)
  } catch (e) {
    // 记错。
    errors.push(`manifest.json 解析失败: ${e.message}`)
    // 返回。
    return empty
  }
  // 校验（引擎同一实现）。不合法也照打——用户可能是为了备份一个坏包；
  // 但问题必须带出去（否则"下载成功"会掩盖 manifest 有问题）。
  const check = validateManifest(manifest)
  // 记警告。
  if (!check.ok) for (const e of check.errors) warnings.push(`manifest 校验问题：${e}`)
  // 数据目录（系统 Data Mod 的数据不在自己目录里）。
  const dataFromRel = dataFrom !== undefined ? dataFrom : dataFromOf(name)
  // 解析成可请求的前缀。
  const dataBase = resolveDataBase(dataFromRel, siteBaseUrl)
  // 读文件用的源：声明了数据目录 → "Mod 目录优先 → 数据目录兜底"。
  const readSource = dataBase ? createDataFallbackSource({ source, dataBase, fetchImpl, log }) : source
  // 文件清单（与「查看数据」页同一套规则）。
  const listed = await listModFiles({ source, name, manifest })
  // 候选文件：清单 + （有数据目录时）引擎约定的 5 张表；站点生成的索引不进包。
  const candidates = [...new Set([...listed.files, ...(dataBase ? DATA_FILES : [])])]
    // 排除索引。
    .filter((f) => f !== MOD_INDEX_FILE)
  // "清单里明确列了"的文件集合：这类文件读不到才算异常（约定探测没探到是正常的，与引擎一致）。
  const explicit = new Set(listed.fromIndex ? listed.files : (dataBase ? DATA_FILES : []))
  // 文件表（路径 → 原始文本）。
  const files = {}
  // 逐个读。
  for (const rel of candidates) {
    // 内容。
    let body = null
    // 读（异常只记警告，继续打包其余文件）。
    try {
      // 读。
      body = await readSource.readText(name, rel)
    } catch (e) {
      // 记警告。
      warnings.push(`${rel} 读取异常：${e.message}`)
      // 下一个。
      continue
    }
    // 不存在：显式列过的记警告，探测没探到的静默跳过。
    if (body === null || body === undefined) {
      // 清单列了却读不到。
      if (explicit.has(rel)) warnings.push(`跳过 ${rel}（文件清单里有它，但读不到）`)
      // 下一个。
      continue
    }
    // 收下。
    files[rel] = body
  }
  // 连 manifest 都没读到（理论上不会：候选里一定有它）。
  if (!files['manifest.json']) {
    // 记错。
    errors.push('打包失败：manifest.json 没有读到')
    // 返回（带上已知信息，便于排查）。
    return { ...empty, manifest, dataFrom: dataBase }
  }
  // 压缩（与 zip 安装共用的实现；level 6 = 默认）。
  const bytes = createModZip({ files })
  // 系统 Mod：manifest 声明或名字被保留（安装侧会拒绝覆盖）。
  const system = manifest.system === true || SYSTEM_MOD_NAMES.includes(name) || SYSTEM_MOD_NAMES.includes(manifest.name)
  // 日志（可观测：打了多少、多大）。
  if (log?.debug) log.debug(`[mod-export] ${name} → ${Object.keys(files).length} 个文件 / ${bytes.length} 字节`)
  // 返回。
  return {
    // 成功。
    ok: true,
    // 名字（目录名）。
    name,
    // 版本。
    version: manifest.version || null,
    // 建议文件名。
    filename: modZipFilename(name, manifest.version),
    // zip 字节。
    bytes,
    // 文件表（测试与"打了哪些文件"的展示用）。
    files,
    // 文件数。
    count: Object.keys(files).length,
    // manifest。
    manifest,
    // 系统 Mod（装回来前要改名）。
    system,
    // 数据目录（没声明就是 null）。
    dataFrom: dataBase,
    // 错误与警告。
    errors,
    warnings,
  }
}
