/**
 * Mod manifest 校验与依赖解析
 *
 * manifest.json 结构（设计文档 6.3 + Mod 架构 v2）：
 *   {
 *     "name": "my-mod",
 *     "version": "1.0.0",
 *     "author": "...",
 *     "permissions": ["ai", "network", "storage", "hooks"],
 *     "ai": { "provider": "openai", "model": "gpt-4o" },
 *     "dependencies": ["base-mod"],
 *     "system": false,
 *     // === Mod 架构 v2（均可选；不写 = 与旧版逐位一致）===
 *     "targets": ["browser", "node"],          // 缺省 ["browser"]
 *     "entry": { "browser": "code.js", "node": "server.js" },
 *     "deterministic": false                    // 缺省由 targets 推导
 *   }
 *
 * 功能：
 *   1. validateManifest：校验 manifest 合法/非法。
 *   2. resolveOrder：拓扑排序（含循环依赖检测、缺失依赖报错）。
 *   3. 3 个取值助手（manifestTargets / manifestEntry / manifestDeterministic）：
 *      **默认值只在这里定义一次**，loader / 宿主桥 / consistency 全部从这里读，
 *      避免"缺省语义"散落在多处而互相不一致。
 *
 * 为什么要"缺省 = 旧语义"：现有 4 个内置 Mod 的 manifest 一个字都不改，
 * 行为必须逐位相同（有回归用例钉住）。
 */

// #REQUIRED_FIELDS
// manifest 必填字段。
const REQUIRED_FIELDS = ['name', 'version']

// #VALID_TARGETS
// 合法运行目标。browser = 浏览器执行 code；node = 提供 server.js（完全 Node 权限）。
export const VALID_TARGETS = ['browser', 'node']

// #DEFAULT_BROWSER_ENTRY
// 浏览器侧入口的缺省文件名（与 loader.js 的 CODE_FILE 一致）。
export const DEFAULT_BROWSER_ENTRY = 'code.js'

// 合法权限集合（共享常量）。
import { VALID_PERMISSIONS } from './permissions.js'

// #isSafeRelativePath
// 判断 entry 里的文件名是否安全（不含路径穿越、不是绝对路径）。
//
// 为什么不复用 zip.js 的 isSafeEntryPath：那会把它依赖的 fflate 拉进
// manifest 校验路径（manifest 目前在 loader 热路径上，且 zip 是另一件事）。
// 这里只需要"相对文件名"这一条最小规则，保持 manifest.js 零传递依赖。
//
// @param {string} p - 待检查的路径
// @returns {boolean} 是否安全
function isSafeRelativePath(p) {
  // 必须是非空字符串。
  if (typeof p !== 'string' || p.length === 0) return false
  // 统一分隔符（有的写法用 \）。
  const norm = p.replace(/\\/g, '/')
  // 绝对路径（POSIX 根 / Windows 盘符）。
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) return false
  // 含 .. 段 → 拒绝（路径穿越）。
  if (norm.split('/').some((seg) => seg === '..')) return false
  // 通过。
  return true
}

// #validateManifest
// 校验 manifest 是否合法。
//
// @param {object} manifest - manifest 对象
// @returns {{ok: boolean, errors: string[]}} 校验结果
export function validateManifest(manifest) {
  // 错误列表。
  const errors = []
  // 非对象。
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    // 报错。
    return { ok: false, errors: ['manifest 必须是对象'] }
  }
  // 必填字段。
  for (const field of REQUIRED_FIELDS) {
    // 缺失或为空。
    if (!manifest[field] || typeof manifest[field] !== 'string') {
      // 报错。
      errors.push(`缺少必填字段: ${field}`)
    }
  }
  // name 必须是合法字符串（字母数字连字符）。
  if (manifest.name && !/^[a-zA-Z0-9_-]+$/.test(manifest.name)) {
    // 报错。
    errors.push('name 只能包含字母数字连字符')
  }
  // 权限声明。
  if (manifest.permissions !== undefined) {
    // 必须是数组。
    if (!Array.isArray(manifest.permissions)) {
      // 报错。
      errors.push('permissions 必须是数组')
    } else {
      // 未知权限。
      for (const p of manifest.permissions) {
        // 非法权限。
        if (!VALID_PERMISSIONS.includes(p)) errors.push(`未知权限: ${p}`)
      }
    }
  }
  // dependencies 必须是数组。
  if (manifest.dependencies !== undefined && !Array.isArray(manifest.dependencies)) {
    // 报错。
    errors.push('dependencies 必须是数组')
  }
  // === Mod 架构 v2：targets ===
  if (manifest.targets !== undefined) {
    // 必须是数组。
    if (!Array.isArray(manifest.targets)) {
      // 报错。
      errors.push('targets 必须是数组')
    } else if (manifest.targets.length === 0) {
      // 空数组没有意义（缺省即 ["browser"]）。
      errors.push('targets 不能是空数组（缺省为 ["browser"]）')
    } else {
      // 逐项。
      for (const t of manifest.targets) {
        // 未知目标。
        if (!VALID_TARGETS.includes(t)) errors.push(`未知 target: ${t}（合法值：${VALID_TARGETS.join(' / ')}）`)
      }
      // 重复项。
      if (new Set(manifest.targets).size !== manifest.targets.length) {
        // 报错。
        errors.push('targets 不能有重复项')
      }
    }
  }
  // === Mod 架构 v2：entry ===
  if (manifest.entry !== undefined) {
    // 必须是对象（非数组）。
    if (!manifest.entry || typeof manifest.entry !== 'object' || Array.isArray(manifest.entry)) {
      // 报错。
      errors.push('entry 必须是对象')
    } else {
      // 逐键校验。
      for (const [key, value] of Object.entries(manifest.entry)) {
        // 未知目标键。
        if (!VALID_TARGETS.includes(key)) {
          // 报错。
          errors.push(`entry 含未知目标键: ${key}（合法键：${VALID_TARGETS.join(' / ')}）`)
          // 继续看下一个。
          continue
        }
        // 值必须是非空字符串。
        if (typeof value !== 'string' || value.length === 0) {
          // 报错。
          errors.push(`entry.${key} 必须是非空字符串`)
          // 继续。
          continue
        }
        // 必须是安全的相对路径。
        if (!isSafeRelativePath(value)) {
          // 报错。
          errors.push(`entry.${key} 必须是不含路径穿越的相对文件名`)
        }
      }
    }
  }
  // === Mod 架构 v2：deterministic ===
  if (manifest.deterministic !== undefined && typeof manifest.deterministic !== 'boolean') {
    // 报错。
    errors.push('deterministic 必须是布尔值')
  }
  // === 运行时模块（依赖随包分发）===
  if (manifest.modules !== undefined) {
    // 必须是对象（非数组）。
    if (!manifest.modules || typeof manifest.modules !== 'object' || Array.isArray(manifest.modules)) {
      // 报错。
      errors.push('modules 必须是对象（{ 模块名: 相对路径 }）')
    } else {
      // 逐条。
      for (const [id, rel] of Object.entries(manifest.modules)) {
        // 模块名非空。
        if (typeof id !== 'string' || id.length === 0) {
          // 报错。
          errors.push('modules 的键必须是非空模块名')
          // 继续。
          continue
        }
        // 路径必须是非空字符串。
        if (typeof rel !== 'string' || rel.length === 0) {
          // 报错。
          errors.push(`modules.${id} 必须是相对路径字符串`)
          // 继续。
          continue
        }
        // 路径安全（与 entry 同一套规则）。
        if (!isSafeRelativePath(rel)) {
          // 报错。
          errors.push(`modules.${id} 必须是不含路径穿越的相对路径`)
        }
      }
    }
  }
  // 返回结果。
  return { ok: errors.length === 0, errors }
}

// #manifestModules
// 取该 Mod 声明的**运行时模块**（依赖随包分发：模块名 → 包内相对路径）。
//
// 为什么依赖要随包分发、且必须是自包含单文件：见 src/mod/modules.js 的模块注释。
//
// @param {object} manifest - manifest 对象
// @returns {Record<string, string>} 模块名 → 相对路径（新对象，调用方可安全修改）
export function manifestModules(manifest) {
  // 未声明。
  if (!manifest?.modules || typeof manifest.modules !== 'object' || Array.isArray(manifest.modules)) return {}
  // 复制一层（不交出内部引用）。
  return { ...manifest.modules }
}

// #manifestTargets
// 取该 Mod 的运行目标（缺省 ["browser"] = 旧语义）。
//
// @param {object} manifest - manifest 对象
// @returns {string[]} 目标数组（新数组，调用方可安全修改）
export function manifestTargets(manifest) {
  // 声明了就用声明的。
  if (Array.isArray(manifest?.targets) && manifest.targets.length > 0) return [...manifest.targets]
  // 缺省：纯前端。
  return ['browser']
}

// #manifestEntry
// 取某目标下的入口文件名。
//   browser → entry.browser ?? 'code.js'（与旧行为一致）
//   node    → entry.node ?? null（未声明即"没有后端入口"）
//
// @param {object} manifest - manifest 对象
// @param {string} target - 'browser' | 'node'
// @returns {string|null} 入口文件名；无则 null
export function manifestEntry(manifest, target) {
  // 显式声明优先。
  const declared = manifest?.entry?.[target]
  // 声明了字符串就用它。
  if (typeof declared === 'string' && declared.length > 0) return declared
  // 浏览器侧缺省 code.js（保持旧语义）。
  if (target === 'browser') return DEFAULT_BROWSER_ENTRY
  // 其它目标无缺省。
  return null
}

// #manifestDeterministic
// 该 Mod 的行为是否确定。
// 缺省推导：**面向 node（宿主动作：文件/进程/网络）→ 不确定**，否则确定。
//
// 用途：consistency 跳过策略 + "同 seed 可复现"承诺的脚注（见设计文档第七节）。
//
// @param {object} manifest - manifest 对象
// @returns {boolean} 是否确定
export function manifestDeterministic(manifest) {
  // 显式声明优先。
  if (typeof manifest?.deterministic === 'boolean') return manifest.deterministic
  // 缺省推导。
  return !manifestTargets(manifest).includes('node')
}

// #resolveOrder
// 依赖拓扑排序：返回加载顺序（依赖先加载）。
// 后加载者覆盖同名内容（设计文档 6.5 冲突策略）。
//
// @param {Array<{name: string, dependencies?: string[]}>} mods - 所有 Mod 元信息
// @returns {{order: string[], errors: string[]}} 加载顺序与错误
export function resolveOrder(mods) {
  // 名称 → Mod 映射。
  const byName = {}
  // 建立映射。
  for (const m of mods) byName[m.name] = m

  // 访问状态：0 未访问，1 访问中，2 已完成。
  const state = {}
  // 加载顺序。
  const order = []
  // 错误列表。
  const errors = []
  // 已入栈集合（用于去重）。
  const visited = new Set()

  // 深度优先遍历。
  const visit = (name, stack) => {
    // 已完成直接返回。
    if (state[name] === 2) return
    // 访问中 → 循环依赖。
    if (state[name] === 1) {
      // 记录环路径。
      errors.push(`循环依赖: ${[...stack, name].join(' → ')}`)
      // 返回。
      return
    }
    // Mod 不存在。
    if (!byName[name]) {
      // 记录缺失。
      errors.push(`缺失依赖: ${name}`)
      // 返回。
      return
    }
    // 标记访问中。
    state[name] = 1
    // 递归依赖。
    for (const dep of byName[name].dependencies || []) {
      // 深度优先。
      visit(dep, [...stack, name])
    }
    // 标记完成。
    state[name] = 2
    // 去重后入序。
    if (!visited.has(name)) {
      // 加入顺序。
      order.push(name)
      // 记录。
      visited.add(name)
    }
  }

  // 遍历所有 Mod。
  for (const m of mods) visit(m.name, [])

  // 返回。
  return { order, errors }
}
