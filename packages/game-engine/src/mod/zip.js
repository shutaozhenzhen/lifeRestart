/**
 * mod/zip — Mod 包的 zip 读写（**浏览器与 Node 共用同一实现**）
 *
 * 为什么放引擎侧：
 *   用户要"前端支持 zip 安装"，同时要求"后端 zip 也用相同逻辑"。
 *   解压/打包、路径安全、尺寸上限、manifest 校验只写一份，CLI（manager.importZip）、
 *   Electron、网页版都走它 —— 用 fflate：浏览器与 Node 都能跑，读写支持 deflate/store
 *   与 zip64，零传递依赖。
 *
 * 安全与健壮性（安装外部 zip 必须挡住的事）：
 *   · 路径穿越：拒绝绝对路径与 `..`（zip slip）
 *   · 尺寸炸弹：单个文件与总解压量都有上限（用 fflate 的 filter 在**解压前**判断）
 *   · 条目数上限：避免几万个空文件的 zip
 *   · 单层包装目录：GitHub 下载的 zip 常带一层 `repo-main/`，自动剥掉
 *   · manifest 必须存在且通过 validateManifest
 *
 * 二进制资源（2026-10 能力补齐 ②，硬边界解除）：
 *   以前 Mod 包**只收文本**（`.json/.js/.mjs/.txt/.md`），其它后缀（png/ogg/woff…）
 *   被丢弃、只在结果里留一个 `binaries` 名字数组并给警告。现在二进制**逐字节保留**在
 *   `assets` 里（`{ 相对路径: Uint8Array }`），由 `gameAPI.asset` 交给 Mod 使用。
 *   体积上限**没有放宽**（仍是单文件 8 MB / 累计 32 MB）—— 图片/音效/字体够用。
 */

// fflate：解压/压缩 + 字符串转换。
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
// manifest 校验（与加载器/管理页同一套）。
import { validateManifest } from './manifest.js'

// 条目数上限。
export const MAX_ENTRIES = 512
// 单文件解压上限（8MB；原版 age.json 约 3.6MB，留足余量）。
export const MAX_FILE_BYTES = 8 * 1024 * 1024
// 总解压上限（32MB）。
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024
// 视为文本的文件后缀（Mod 包约定只有 JSON/JS；其它后缀按二进制处理并提示）。
// 导出给"从 GitHub 拉源码当 Mod"的源用（frontend/src/utils/mod-github.js）——两边必须同一张表，
// 否则会出现"上传 zip 收 .md、从 GitHub 装不收"这种随来源而变的行为分叉。
export const TEXT_EXT = ['.json', '.js', '.mjs', '.txt', '.md']

// #ASSET_EXT
// 视为「资源文件」的后缀（图片 / 音频 / 字体）。
//
// 它决定 `gameAPI.asset.list()` 列出什么（**只有这些后缀算资源**；`manifest.json` /
// `code.js` / 数据表**不在**其中 —— 那些走引擎自己的加载链路，不是 Mod 资源）。
// 与 `TEXT_EXT` 互补但不互斥：`.svg` 既是图片也是文本，这里仍按资源保留字节，
// Mod 想读文本用 `gameAPI.asset.text(path)`（浏览器按 MIME 造 Blob，Node 读文件）。
//
// 导出给 `asset-bridge.js` 用 —— **清单只写一份**，否则"zip 认得的资源"与
// "asset.list() 列出的资源"迟早分叉。
export const ASSET_EXT = [
  // 图片。
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  // 音频。
  '.mp3', '.ogg', '.wav', '.m4a', '.flac',
  // 字体。
  '.woff', '.woff2', '.ttf', '.otf',
]

// #MIME_TYPES
// 后缀 → MIME（至少覆盖任务要求的一组；未知后缀给 application/octet-stream）。
//
// 为什么需要它：`URL.createObjectURL(new Blob([bytes], { type }))` **不猜类型**，
// 给错（或给空）会让浏览器拒渲染（`<img>` 显示破图、`<audio>` 不放音）。
export const MIME_TYPES = {
  // 图片。
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  // 音频。
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  // 字体。
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

// #getMimeType
// 按后缀判 MIME（未知 → `application/octet-stream`）。
//
// @param {string} path - 文件路径（只看后缀，大小写不敏感）
// @returns {string} MIME 类型
export function getMimeType(path) {
  // 后缀（统一小写；没有点就取不到 → undefined）。
  const lower = String(path || '').toLowerCase()
  // 最后一个点之后的部分（含点）。
  const dot = lower.lastIndexOf('.')
  // 无后缀。
  if (dot === -1) return 'application/octet-stream'
  // 查表（未知后缀给通用二进制类型）。
  return MIME_TYPES[lower.slice(dot)] || 'application/octet-stream'
}

// #isSafeEntryPath
// 判断 zip 内条目路径是否安全（防路径穿越）。
//
// @param {string} path - 条目路径
// @returns {boolean} 是否安全
export function isSafeEntryPath(path) {
  // 空。
  if (!path || typeof path !== 'string') return false
  // 反斜杠归一化后判断（有的 zip 用 \ 分隔）。
  const p = path.replace(/\\/g, '/')
  // 绝对路径。
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false
  // 目录项（以 / 结尾）允许（后续会被忽略）。
  if (p.endsWith('/')) return true
  // 含 .. 段 → 拒绝。
  if (p.split('/').some((seg) => seg === '..')) return false
  // 通过。
  return true
}

// #stripWrapperDir
// 去掉"单层包装目录"：GitHub 导出的 zip 常见结构是 `repo-main/manifest.json`。
//
// @param {object} files - { path: Uint8Array }
// @returns {object} 归一化后的文件表
export function stripWrapperDir(files) {
  // 键。
  const paths = Object.keys(files)
  // 根已有 manifest → 不动。
  if (paths.includes('manifest.json')) return files
  // 顶层目录集合。
  const tops = new Set(paths.map((p) => p.split('/')[0]))
  // 必须恰好一层目录，且该目录下有 manifest.json。
  if (tops.size !== 1) return files
  // 顶层名。
  const top = [...tops][0]
  // 该目录下没有 manifest。
  if (!paths.includes(`${top}/manifest.json`)) return files
  // 剥掉前缀。
  const out = {}
  // 逐项。
  for (const [path, bytes] of Object.entries(files)) {
    // 去掉顶层目录名（保留其余相对路径）。
    out[path.slice(top.length + 1)] = bytes
  }
  // 返回。
  return out
}

// #readModPackage
// 解析 Mod 包（解压 + 安全校验 + manifest 校验），返回可直接落盘/入库的文件表。
//
// @param {Uint8Array|ArrayBuffer} zipBytes - zip 内容
// @param {object} [params]
// @param {object} [params.log] - 日志器
// @returns {{ok: boolean, errors: string[], name?: string, manifest?: object, files?: object, assets?: object, skipped?: string[], binaries?: string[]}} 结果
//   · `files`：文本文件表（`{ 路径: string }`）—— 后缀命中 TEXT_EXT 的才在这里
//   · `assets`：**二进制资源表**（`{ 路径: Uint8Array }`）—— 非文本后缀的**原始字节**，
//     逐字节保留（2026-10 能力补齐 ② 之前这些字节是被丢弃的）
//   · `binaries`：`Object.keys(assets)` 的**别名**（历史字段名，语义已变：从"被丢弃的
//     文件名单"变成"已保留的资源名单"）。保留它是为了不打断既有调用方 —— 但它现在
//     **不该再被当成警告**：装进包里的资源是真的留下来了。
export function readModPackage(zipBytes, { log } = {}) {
  // 错误。
  const errors = []
  // 被上限挡掉的文件。
  const skipped = []
  // 累计解压量。
  let total = 0
  // 是否已经就 node_modules 提过一次醒（几千个文件不该刷屏）。
  let nodeModulesReported = false
  // 解压（filter 在解压前就能拿到 originalSize → 挡尺寸炸弹）。
  let raw
  try {
    // 转 Uint8Array（兼容 Buffer / ArrayBuffer）。
    const bytes = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes)
    // 解压。
    raw = unzipSync(bytes, {
      // 过滤器：目录跳过、路径不安全跳过、超限跳过（都记录下来）。
      filter: (file) => {
        // 目录项。
        if (file.name.endsWith('/')) return false
        // 依赖目录（node_modules/**）：Mod 包不该带它。
        // 理由：Mod 的依赖以**自包含单文件**随包分发（放 vendor/ 并在 manifest.modules 里声明），
        //       由引擎在**运行时**加载 —— 不需要（也不该有）node_modules 目录树。
        //       带上它会直接撞条目数上限，而报"条目过多"会让人以为是包太大，看不出真实原因。
        if (/(^|\/)node_modules\//.test(file.name.replace(/\\/g, '/'))) {
          // 只报一次。
          if (!nodeModulesReported) {
            // 记录（指向正确做法）。
            nodeModulesReported = true
            errors.push('zip 内含 node_modules（已忽略）：依赖请以自包含单文件放 vendor/，并在 manifest.modules 里声明（引擎运行时会加载它）')
          }
          // 跳过。
          return false
        }
        // 路径不安全。
        if (!isSafeEntryPath(file.name)) {
          // 记录。
          errors.push(`zip 内含不安全路径（已忽略）：${file.name}`)
          // 跳过。
          return false
        }
        // 单文件超限。
        if (file.originalSize > MAX_FILE_BYTES) {
          // 记录。
          skipped.push(`${file.name}（超过单文件上限 ${MAX_FILE_BYTES} 字节）`)
          // 跳过。
          return false
        }
        // 累计超限。
        total += file.originalSize
        if (total > MAX_TOTAL_BYTES) {
          // 记录。
          skipped.push(`${file.name}（累计超过上限 ${MAX_TOTAL_BYTES} 字节）`)
          // 跳过。
          return false
        }
        // 通过。
        return true
      },
    })
  } catch (e) {
    // 解压失败。
    return { ok: false, errors: [`zip 解压失败: ${e.message}`] }
  }
  // 条目数上限。
  if (Object.keys(raw).length > MAX_ENTRIES) {
    // 失败。
    return { ok: false, errors: [`zip 条目过多（${Object.keys(raw).length} > ${MAX_ENTRIES}）`] }
  }
  // 剥包装目录。
  const entries = stripWrapperDir(raw)
  // 必须有 manifest.json。
  if (!entries['manifest.json']) {
    // 失败（给出可读原因：常见是打成多层目录或缺文件）。
    return { ok: false, errors: ['zip 缺少 manifest.json（Mod 包根目录必须有它）'] }
  }
  // 解析 manifest。
  let manifest
  try {
    // 解析。
    manifest = JSON.parse(strFromU8(entries['manifest.json']))
  } catch (e) {
    // 失败。
    return { ok: false, errors: [`manifest.json 不是合法 JSON: ${e.message}`] }
  }
  // 校验。
  const check = validateManifest(manifest)
  // 非法。
  if (!check.ok) {
    // 失败。
    return { ok: false, errors: [`manifest 非法: ${check.errors.join('; ')}`] }
  }
  // 文本文件表（引擎按文本消费：JSON/JS）。
  const files = {}
  // 二进制资源表（**原始字节**，逐字节保留；由 gameAPI.asset 交给 Mod）。
  const assets = {}
  // 逐个分类。
  for (const [path, bytes] of Object.entries(entries)) {
    // 后缀。
    const lower = path.toLowerCase()
    // 文本 → 解码成字符串。
    if (TEXT_EXT.some((ext) => lower.endsWith(ext))) {
      // 存文本。
      files[path] = strFromU8(bytes)
      // 继续。
      continue
    }
    // 其它 → **保留字节**（2026-10 起；以前这里只 push 一个名字然后丢掉内容）。
    assets[path] = bytes
  }
  // 资源名单（历史字段名 `binaries`，见 readModPackage 的返回说明）。
  const binaries = Object.keys(assets)
  // 日志。
  if (log?.debug) {
    // 文本与资源数都报出来（只报文本会让人以为资源没进包）。
    log.debug(`zip: ${manifest.name} → ${Object.keys(files).length} 个文本文件、${binaries.length} 个资源文件`)
  }
  // 返回。
  return {
    // 成功。
    ok: true,
    // 路径警告 + 其它错误信息（安装仍可继续）。
    errors,
    // Mod 名。
    name: manifest.name,
    // manifest。
    manifest,
    // 文件表（路径 → 文本）。
    files,
    // **资源表（路径 → Uint8Array 原始字节）**。
    assets,
    // 被上限挡掉的。
    skipped,
    // 资源路径清单（= Object.keys(assets)；历史字段名，语义已变，不再是"被丢弃"）。
    binaries,
  }
}

// #createModZip
// 把文件表打包成 zip（供"导出 Mod"与往返测试）。
//
// 两种调用形态（都支持，且可以同时用）：
//   ① `createModZip({ files })` —— `files` 的值是 `string | Uint8Array`（老形态，仍然有效）；
//   ② `createModZip({ files, assets })` —— `assets` 是**二进制资源表**
//      （`{ 路径: Uint8Array }`）。等价于把资源并进 `files`，但更明确：
//      写 Mod 导出的代码时不会把 `Uint8Array` 误当成文本。
//
// 往返是硬要求：`readModPackage(createModZip({ files, assets }))` 必须能读回，
// 且 `assets` 里的字节**逐字节一致**（有测试钉住，含 png 与未知后缀）。
//
// @param {object} params
// @param {object} [params.files] - { path: string|Uint8Array }
// @param {object} [params.assets] - { path: Uint8Array }（二进制资源）
// @param {number} [params.level] - 压缩级别（0 = store，1-9 = deflate；缺省 6）
// @returns {Uint8Array} zip 字节
export function createModZip({ files = {}, assets = {}, level = 6 } = {}) {
  // 转成 fflate 需要的 Uint8Array 表。
  const table = {}
  // 文本/混合表：字符串 → 字节；字节原样。
  for (const [path, content] of Object.entries(files)) {
    // 字符串 → 字节；字节原样。
    table[path] = typeof content === 'string' ? strToU8(content) : content
  }
  // 资源表：一律按字节写入（字符串会被当 UTF-8 文本编码，这是有意的宽容）。
  for (const [path, content] of Object.entries(assets)) {
    // 写进同一张表（zip 本身不区分文本/二进制）。
    table[path] = typeof content === 'string' ? strToU8(content) : content
  }
  // 压缩。
  return zipSync(table, { level })
}
