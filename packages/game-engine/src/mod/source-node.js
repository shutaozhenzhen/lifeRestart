/**
 * mod/source-node — Node 侧的 Mod 文件源（fs 实现）
 *
 * 背景（把 Mod 支持搬到前端）：
 *   loader 原先直接 `import node:fs`，导致浏览器里根本用不了（打包也过不去）。
 *   现在 loader 只依赖一个**平台无关的源接口**：
 *     listMods()            → 有哪些 Mod
 *     listFiles(mod)        → 该 Mod 包含哪些文件（null = 未知，按约定清单探测）
 *     readText(mod, rel)    → 读一个文本文件（不存在返回 null）
 *   Node 侧用本模块（fs），浏览器侧用 source-fetch（HTTP）——两边共用同一套
 *   manifest 校验、依赖拓扑、数据合并与 code.js 执行。
 */

// Node 内置：文件系统与路径。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// #createNodeSource
// 创建基于文件系统的 Mod 源。
//
// @param {string} modsDir - mods 目录
// @returns {{listMods: Function, listFiles: Function, readText: Function, kind: string}} 源
export function createNodeSource(modsDir) {
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
    // #listFiles：列出 Mod 目录下的文件名（无目录返回 null）。
    async listFiles(mod) {
      // Mod 目录。
      const dir = join(modsDir, mod)
      // 不存在。
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return null
      // 列出文件（只取文件，跳过子目录）。
      return readdirSync(dir, { withFileTypes: true })
        // 文件项。
        .filter((entry) => entry.isFile())
        // 名字。
        .map((entry) => entry.name)
    },
    // #readText：读文本文件（不存在/读失败返回 null，不抛）。
    async readText(mod, rel) {
      // 路径。
      const path = join(modsDir, mod, rel)
      // 不存在。
      if (!existsSync(path)) return null
      // 读取（异常降级为 null，由 loader 记日志）。
      try {
        // 返回内容。
        return readFileSync(path, 'utf8')
      } catch {
        // 失败。
        return null
      }
    },
  }
}
