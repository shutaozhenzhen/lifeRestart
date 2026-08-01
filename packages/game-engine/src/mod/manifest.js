/**
 * Mod manifest 校验与依赖解析
 *
 * manifest.json 结构（设计文档 6.3）：
 *   {
 *     "name": "my-mod",
 *     "version": "1.0.0",
 *     "author": "...",
 *     "permissions": ["ai", "network", "storage", "hooks"],
 *     "ai": { "provider": "openai", "model": "gpt-4o" },
 *     "dependencies": ["base-mod"],
 *     "system": false
 *   }
 *
 * 功能：
 *   1. validateManifest：校验 manifest 合法/非法。
 *   2. resolveOrder：拓扑排序（含循环依赖检测、缺失依赖报错）。
 */

// #REQUIRED_FIELDS
// manifest 必填字段。
const REQUIRED_FIELDS = ['name', 'version']

// 合法权限集合（共享常量）。
import { VALID_PERMISSIONS } from './permissions.js'

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
  // 返回结果。
  return { ok: errors.length === 0, errors }
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
