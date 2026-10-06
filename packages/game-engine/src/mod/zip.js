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
// @returns {{ok: boolean, errors: string[], name?: string, manifest?: object, files?: object, skipped?: string[]}} 结果
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
  // 文本文件表（引擎只消费文本：JSON/JS）。
  const files = {}
  // 二进制/未知后缀。
  const binaries = []
  // 逐个转换。
  for (const [path, bytes] of Object.entries(entries)) {
    // 后缀。
    const lower = path.toLowerCase()
    // 文本 → 解码；其它 → 只记名字（Mod 包约定不含资源文件）。
    if (TEXT_EXT.some((ext) => lower.endsWith(ext))) files[path] = strFromU8(bytes)
    else binaries.push(path)
  }
  // 日志。
  if (log?.debug) log.debug(`zip: ${manifest.name} → ${Object.keys(files).length} 个文本文件`)
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
    // 被上限挡掉的。
    skipped,
    // 非文本文件（提示用）。
    binaries,
  }
}

// #createModZip
// 把文件表打包成 zip（供"导出 Mod"与往返测试）。
//
// @param {object} params
// @param {object} params.files - { path: string|Uint8Array }
// @param {number} [params.level] - 压缩级别（0 = store，1-9 = deflate；缺省 6）
// @returns {Uint8Array} zip 字节
export function createModZip({ files = {}, level = 6 } = {}) {
  // 转成 fflate 需要的 Uint8Array 表。
  const table = {}
  // 逐个。
  for (const [path, content] of Object.entries(files)) {
    // 字符串 → 字节；字节原样。
    table[path] = typeof content === 'string' ? strToU8(content) : content
  }
  // 压缩。
  return zipSync(table, { level })
}
