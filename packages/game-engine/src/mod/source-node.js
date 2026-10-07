/**
 * mod/source-node — Node 侧的 Mod 文件源（fs 实现）
 *
 * 背景（把 Mod 支持搬到前端）：
 *   loader 原先直接 `import node:fs`，导致浏览器里根本用不了（打包也过不去）。
 *   现在 loader 只依赖一个**平台无关的源接口**：
 *     listMods()            → 有哪些 Mod
 *     listFiles(mod)        → 该 Mod 包含哪些文件（null = 未知，按约定清单探测）
 *     readText(mod, rel)    → 读一个文本文件（不存在返回 null）
 *     readBytes(mod, rel)   → 读一个**二进制资源**（不存在返回 null）
 *   Node 侧用本模块（fs），浏览器侧用 source-fetch（HTTP）——两边共用同一套
 *   manifest 校验、依赖拓扑、数据合并与 code.js 执行。
 *
 * ⚠️ 路径安全（2026-10 加固）：`rel` 来自 Mod 包（外部输入），必须解析后确认仍在
 *    **该 Mod 的目录之内**，否则 `rel = '../../secret.txt'` 就能读走仓库外的文件。
 *    readText 与 readBytes 共用这一道检查（只有一份实现）。
 *
 * 2026-10 能力补齐 ②：`listFiles` 改为**递归**列出（相对路径，用 `/` 分隔），
 * 否则 `assets/logo.png`、`vendor/x.mjs` 这类子目录文件在 Node 侧根本列不出来。
 */

// Node 内置：文件系统与路径。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

// #isInside
// 判断 child 解析后的绝对路径是否在 parent 目录之内（防 `../` 穿越）。
//
// @param {string} parent - 父目录绝对路径
// @param {string} child - 待检查路径
// @returns {boolean} 是否在内部
function isInside(parent, child) {
  // 统一解析（消除 `..` 与相对段）。
  const root = resolve(parent)
  // 目标。
  const target = resolve(child)
  // 相等（就是目录自己）或以其 + 分隔符开头。
  return target === root || target.startsWith(root + sep)
}

// #listFilesRecursive
// 递归列出一个目录下的全部文件（相对路径，`/` 分隔；跳过目录本身）。
//
// @param {string} dir - 目录
// @param {string} [prefix] - 前缀（递归用）
// @returns {string[]} 相对路径数组
function listFilesRecursive(dir, prefix = '') {
  // 结果。
  const out = []
  // 列目录（读不到就当空，由调用方按"没有清单"处理）。
  let entries
  try {
    // 读。
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    // 空。
    return out
  }
  // 逐项。
  for (const entry of entries) {
    // 相对路径（统一 `/`，与 zip 内的键、files.json 的写法一致）。
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    // 子目录 → 递归。
    if (entry.isDirectory()) out.push(...listFilesRecursive(join(dir, entry.name), rel))
    // 文件 → 记录。
    else if (entry.isFile()) out.push(rel)
  }
  // 返回。
  return out
}

// #createNodeSource
// 创建基于文件系统的 Mod 源。
//
// @param {string} modsDir - mods 目录
// @returns {{listMods: Function, listFiles: Function, readText: Function, readBytes: Function, kind: string}} 源
export function createNodeSource(modsDir) {
  // #resolveRel
  // 把 (mod, rel) 解析成一个**安全**的绝对路径（越界/不存在返回 null）。
  //
  // @param {string} mod - Mod 名（目录名）
  // @param {string} rel - 相对路径
  // @returns {string|null} 绝对路径
  function resolveRel(mod, rel) {
    // Mod 目录。
    const dir = join(modsDir, mod)
    // 拼目标。
    const path = join(dir, rel)
    // 越界 → 拒绝（返回 null，调用方按"不存在"处理并记日志）。
    if (!isInside(dir, path)) return null
    // 不存在。
    if (!existsSync(path)) return null
    // 是目录（例如 rel='' 或 'assets'）→ 不是文件。
    try {
      // 判断。
      if (!statSync(path).isFile()) return null
    } catch {
      // 读不到状态。
      return null
    }
    // 通过。
    return path
  }

  // 返回源。
  return {
    // 源类型（便于日志/测试断言）。
    kind: 'node',
    // #listMods：列出所有 Mod 名（跳过 disabled 与文件）。
    async listMods() {
      // 目录不存在。
      if (!existsSync(modsDir)) return []
      // 列出目录项。
      return readdirSync(modsDir, { withFileTypes: true })
        // 只处理目录。
        .filter((entry) => entry.isDirectory())
        // 排除 disabled。
        .filter((entry) => entry.name !== 'disabled')
        // 取名字。
        .map((entry) => entry.name)
    },
    // #listFiles：递归列出 Mod 目录下的文件相对路径（无目录返回 null）。
    // 2026-10 起是递归的：子目录里的资源（assets/logo.png）与运行时模块（vendor/x.mjs）
    // 必须能被列出来，否则 Node 侧与浏览器侧的文件清单不一致（D2 要求两端字段一致）。
    async listFiles(mod) {
      // Mod 目录。
      const dir = join(modsDir, mod)
      // 不存在。
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return null
      // 递归列（相对路径，`/` 分隔）。
      return listFilesRecursive(dir)
    },
    // #readText：读文本文件（不存在/越界/读失败返回 null，不抛）。
    async readText(mod, rel) {
      // 安全解析路径。
      const path = resolveRel(mod, rel)
      // 不存在/越界。
      if (!path) return null
      // 读取（异常降级为 null，由 loader 记日志）。
      try {
        // 返回内容。
        return readFileSync(path, 'utf8')
      } catch {
        // 失败。
        return null
      }
    },
    // #readBytes：读**二进制资源**（2026-10 能力补齐 ②）。
    // 返回 Uint8Array（Buffer 本身就是 Uint8Array 的子类，这里显式转一份**拷贝**，
    // 避免调用方改动 Buffer 池里的字节）。
    async readBytes(mod, rel) {
      // 安全解析路径。
      const path = resolveRel(mod, rel)
      // 不存在/越界。
      if (!path) return null
      // 读取。
      try {
        // Buffer → Uint8Array 拷贝。
        const buf = readFileSync(path)
        // 拷贝（Buffer 的底层内存可能被复用）。
        return new Uint8Array(buf)
      } catch {
        // 失败。
        return null
      }
    },
  }
}
