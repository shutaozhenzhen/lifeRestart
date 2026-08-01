/**
 * 内置 Data Mod（Step 15）
 *
 * 原版 JSON 数据打包为系统 Mod（system: true，不可删除只能禁用）。
 * 数据源：原版 template/public/data/{zh-cn}/ 的 JSON 产物，
 * 构建期用 convertLegacy 把旧语法条件转为新语法。
 *
 * 本文件提供：
 *   1. buildDataMod：把原始数据打包成 Mod 结构（含 manifest）。
 *   2. DATA_MOD_MANIFEST：内置 Data Mod 的 manifest 常量。
 *   3. isDataMod / 系统 Mod 判定。
 */

// 兼容层（旧语法 → 新语法）。
import { convertLegacy } from '../condition/compat.js'

// #DATA_MOD_MANIFEST
// 内置 Data Mod 的 manifest。
export const DATA_MOD_MANIFEST = {
  name: 'lifeRestart-data',
  version: '1.0.0',
  author: 'lifeRestart',
  description: '原版数据（系统内置，不可删除）',
  system: true,
  permissions: [],
}

// #buildDataMod
// 把原始数据打包成 Data Mod 结构。
// 转换：talents/events/achievements 的 condition 用 convertLegacy 转新语法。
//
// @param {object} raw - 原始数据 { talents, events, achievements, characters }
// @param {object} propTypes - 属性类型映射 { TLT: 'array', ... }
// @returns {object} Mod 结构 { manifest, talents, events, achievements, characters }
export function buildDataMod(raw, propTypes = {}) {
  // 深拷贝原始数据（避免修改源）。
  const data = structuredClone(raw)
  // 转换天赋条件。
  if (data.talents) {
    // 逐天赋。
    for (const id in data.talents) {
      // 有条件则转换。
      if (data.talents[id].condition) {
        // 转换。
        data.talents[id].condition = convertLegacy(data.talents[id].condition, propTypes)
      }
    }
  }
  // 转换事件条件。
  if (data.events) {
    // 逐事件。
    for (const id in data.events) {
      // 事件对象。
      const ev = data.events[id]
      // include。
      if (ev.include) ev.include = convertLegacy(ev.include, propTypes)
      // exclude。
      if (ev.exclude) ev.exclude = convertLegacy(ev.exclude, propTypes)
      // branch。
      if (ev.branch) {
        // 逐分支。
        ev.branch = ev.branch.map(([cond, target]) => [convertLegacy(cond, propTypes), target])
      }
    }
  }
  // 转换成就条件。
  if (data.achievements) {
    // 逐成就。
    for (const id in data.achievements) {
      // 有条件则转换。
      if (data.achievements[id].condition) {
        // 转换。
        data.achievements[id].condition = convertLegacy(data.achievements[id].condition, propTypes)
      }
    }
  }
  // 返回 Mod 结构。
  return {
    manifest: DATA_MOD_MANIFEST,
    talents: data.talents,
    events: data.events,
    achievements: data.achievements,
    characters: data.characters,
  }
}

// #isSystemMod
// 是否系统 Mod（不可删除）。
//
// @param {object} manifest - Mod manifest
// @returns {boolean}
export function isSystemMod(manifest) {
  // system 字段为真。
  return manifest?.system === true
}

// #isDataMod
// 是否内置 Data Mod。
//
// @param {object} manifest - Mod manifest
// @returns {boolean}
export function isDataMod(manifest) {
  // 名字匹配。
  return manifest?.name === DATA_MOD_MANIFEST.name
}
