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
// 默认数组属性集合（成员判断语义）。
import { ARRAY_PROPS } from '../data-loader.js'

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

// #parseWeightEntry
// 解析单个 age 事件条目为 [id, weight] 标准结构。
// 原版用字符串 DSL "id*权重" 编码，运行时 property.initial() 用 split('*') 拆解。
// 构建期在这里一次性解析，落盘为标准数组，运行时幂等保护跳过二次解析。
//
// @param {number|string} entry - 事件条目（数字 ID / "ID" / "ID*权重"）
// @returns {Array<[string, number]>} [ID, 权重]
function parseWeightEntry(entry) {
  // 按 * 拆分成 [id, weight]。
  const parts = `${entry}`.split('*')
  // ID 原样保留（字符串）。
  const id = parts[0]
  // 权重：第二个元素转数字，缺失时默认 1。
  const weight = parts.length > 1 ? Number(parts[1]) : 1
  // 返回 [id, weight] 对。
  return [id, weight]
}

// #parseReplacement
// 解析 talent replacement 为 { 目标ID: 权重 } 对象映射。
// 原版数组元素可能是数字 ID、字符串 ID 或字符串 DSL "ID*权重"。
// 与运行时 talent.initial() 的解析逻辑一致，构建期提前完成。
//
// @param {Array<number|string>} list - replacement 数组
// @returns {object} { ID: 权重 } 映射
function parseReplacement(list) {
  // 结果映射。
  const obj = {}
  // 遍历目标数组。
  for (const value of list) {
    // 解析 [id, weight]。
    const [id, weight] = parseWeightEntry(value)
    // 写入映射。
    obj[id] = weight
  }
  // 返回映射。
  return obj
}

// #buildDataMod
// 把原始数据打包成 Data Mod 结构。
// 转换：talents/events/achievements 的 condition 用 convertLegacy 转新语法；
//       age 事件与 talent replacement 的字符串 DSL（"ID*权重"）解析为标准结构。
// 运行时 property/talent 的 initial() 有幂等保护，已解析的数据不会被二次处理。
//
// @param {object} raw - 原始数据 { age, talents, events, achievements, characters }
// @param {object} propTypes - 属性类型映射 { TLT: 'array', ... }
// @returns {object} Mod 结构 { manifest, age, talents, events, achievements, characters }
export function buildDataMod(raw, propTypes = {}) {
  // 合并默认数组属性标注（调用方可覆盖）。
  const types = { ...Object.fromEntries(ARRAY_PROPS.map(p => [p, 'array'])), ...propTypes }
  // 深拷贝原始数据（避免修改源）。
  const data = structuredClone(raw)
  // 转换天赋条件 + exclude/replacement 字符串化与 DSL 解析。
  if (data.talents) {
    // 逐天赋。
    for (const id in data.talents) {
      // 有条件则转换。
      if (data.talents[id].condition) {
        // 转换。
        data.talents[id].condition = convertLegacy(data.talents[id].condition, types)
      }
      // exclude 列表 ID 字符串化（原版混合数字/字符串，统一为字符串保证数据自洽）。
      if (data.talents[id].exclude) {
        // 逐项转字符串。
        data.talents[id].exclude = data.talents[id].exclude.map(e => `${e}`)
      }
      // replacement 数组解析为 { ID: 权重 } 对象映射（幂等保护：已是对象则跳过）。
      if (data.talents[id].replacement) {
        // 遍历 grade / talent 两个键。
        for (const key in data.talents[id].replacement) {
          // 非数组跳过（已解析成对象）。
          if (!Array.isArray(data.talents[id].replacement[key])) continue
          // 数组解析为对象映射。
          data.talents[id].replacement[key] = parseReplacement(data.talents[id].replacement[key])
        }
      }
    }
  }
  // age 事件条目解析为 [id, weight] 二维数组（幂等保护：已是二维数组则跳过）。
  if (data.age) {
    // 逐年龄。
    for (const a in data.age) {
      // 事件数组。
      const events = data.age[a] && data.age[a].event
      // 非数组跳过。
      if (!Array.isArray(events)) continue
      // 已是 [id, weight] 二维数组：跳过（运行时幂等保护同款判断）。
      if (Array.isArray(events[0])) continue
      // 逐事件解析为 [id, weight]。
      data.age[a].event = events.map(parseWeightEntry)
    }
  }
  // 转换事件条件。
  if (data.events) {
    // 逐事件。
    for (const id in data.events) {
      // 事件对象。
      const ev = data.events[id]
      // include。
      if (ev.include) ev.include = convertLegacy(ev.include, types)
      // exclude。
      if (ev.exclude) ev.exclude = convertLegacy(ev.exclude, types)
      // branch：扁平字符串数组，拆分后转换条件部分（与运行时 event.js 一致）。
      if (ev.branch) {
        // 逐分支。
        ev.branch = ev.branch.map(b => {
          // 幂等：已是 [条件, 目标] 二维数组则直接转换条件部分。
          if (Array.isArray(b)) return [convertLegacy(b[0], types), b[1]]
          // 按最后一个冒号拆分 [条件, 目标ID]。
          const idx = b.lastIndexOf(':')
          // 转换条件部分。
          return `${convertLegacy(b.slice(0, idx), types)}:${b.slice(idx + 1)}`
        })
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
        data.achievements[id].condition = convertLegacy(data.achievements[id].condition, types)
      }
    }
  }
  // 返回 Mod 结构。
  return {
    manifest: DATA_MOD_MANIFEST,
    age: data.age,
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
