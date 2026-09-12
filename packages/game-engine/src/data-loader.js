/**
 * data-loader 数据加载层
 *
 * 替代原版的 Laya.promises.loader.load()，统一加载 JSON 数据。
 * 新项目使用 fetch（浏览器）或注入的 loader（Node/测试），
 * 并按数据源约定把原版 JSON 转换成引擎需要的结构。
 *
 * 数据源约定（对应原版 template/public/data/{locale}/）：
 *   age.json / talents.json / events.json / achievement.json / character.json
 *
 * 转换点：
 *   - 原版 talents/events/achievement 的 key 可能是字符串或数字，统一转字符串 ID。
 *   - 原版 talent 的 condition 是旧语法，Data Mod 打包时由 convertLegacy 处理，
 *     本层只负责加载 + 基本结构校验，不做语法转换。
 */

// 兼容层（旧语法转换，Data Mod 打包用）。
import { convertLegacy } from './condition/compat.js'
// 日志器（缺省静默）。
import { SILENT_LOGGER } from './functions/logger.js'

// #ARRAY_PROPS
// 默认数组属性集合（成员判断用 .some()，值转字符串 ID）。
// 属性系统 TYPES 中，TLT/EVT/ATLT/AEVT/ACHV 都是数组（ID 列表）。
export const ARRAY_PROPS = ['TLT', 'EVT', 'ATLT', 'AEVT', 'ACHV']

// #createLoader
// 创建数据加载器。
//
// @param {object} deps
// @param {(url: string) => Promise<object>} deps.fetch - 加载函数（浏览器 fetch / Node fs mock）
// @param {string} deps.baseUrl - 数据基础路径
// @param {string} deps.locale - 语言目录名（zh-cn / en-us）
// @returns {object} 加载器
export function createLoader({ fetch, baseUrl = '', locale = 'zh-cn', log } = {}) {
  // 日志器（缺省静默，不干扰测试）。
  const logger = log || SILENT_LOGGER
  // 返回加载器对象。
  return {
    // #loadAll
    // 加载全部游戏数据。
    //
    // @returns {Promise<object>} { age, talents, events, achievements, characters, total }
    async loadAll() {
      // 记录（debug）。
      logger.debug(`data-loader.loadAll: 从 ${baseUrl}/${locale}/ 加载 5 个数据文件`)
      // 并行加载各数据文件。
      const [age, talents, events, achievements, characters] = await Promise.all([
        this.load('age.json'),
        this.load('talents.json'),
        this.load('events.json'),
        this.load('achievement.json'),
        this.load('character.json'),
      ])
      // 记录（debug）。
      logger.debug('data-loader: 全部加载完成（age/talents/events/achievements/characters）')
      // 返回整合数据。
      return { age, talents, events, achievements, characters }
    },

    // #load
    // 加载单个数据文件。
    //
    // @param {string} file - 文件名
    // @returns {Promise<object>} JSON 对象
    async load(file) {
      // 拼接完整 URL。
      const url = `${baseUrl}/${locale}/${file}`
      // 记录（trace）。
      logger.trace(`data-loader.load(${file})`)
      // 调用注入的 fetch。
      const res = await fetch(url)
      // 非 2xx 抛错。
      if (!res.ok) throw new Error(`加载失败: ${url} (${res.status})`)
      // 记录（debug）。
      logger.debug(`data-loader: ${file} 加载成功`)
      // 返回 JSON。
      return res.json()
    },
  }
}

// #validateStructure
// 校验数据基本结构是否合法。
//
// @param {object} data - 加载后的数据
// @returns {{ok: boolean, errors: string[]}} 校验结果
export function validateStructure(data) {
  // 错误列表。
  const errors = []
  // 各数据集必须是对象（或数组）。
  for (const key of ['age', 'talents', 'events', 'achievements', 'characters']) {
    // 值。
    const v = data[key]
    // 必须存在且非 null。
    if (v === undefined || v === null) errors.push(`缺少 ${key}`)
    // 类型。
    else if (typeof v !== 'object') errors.push(`${key} 必须是对象`)
  }
  // 返回结果。
  return { ok: errors.length === 0, errors }
}

// #prepareForEngine
// 把原版数据转换为引擎需要的结构。
// 主要工作：确保所有 ID 为字符串。
//
// @param {object} data - 加载后的数据
// @returns {object} 转换后的数据
export function prepareForEngine(data) {
  // 深拷贝避免修改原数据。
  const result = structuredClone(data)
  // 处理 ID 集合：talents/events/achievements/characters 的键。
  for (const key of ['talents', 'events', 'achievements', 'characters']) {
    // 该数据集。
    const set = result[key]
    // 非对象跳过。
    if (!set || typeof set !== 'object') continue
    // 遍历键。
    for (const id in set) {
      // 当前条目。
      const item = set[id]
      // 条目是对象且 id 字段存在。
      if (item && typeof item === 'object' && 'id' in item) {
        // 确保 id 字段为字符串。
        item.id = String(item.id)
      }
    }
  }
  // 返回转换结果。
  return result
}

// #convertConditions
// 把数据中的旧语法条件转换为新语法（构建期 Data Mod 打包用）。
// branch 的解析与运行时 event.js 保持一致：扁平字符串 "cond:目标ID" 拆成 [条件, 目标]。
// 转换后 branch 保持扁平格式，运行时 initial() 自行拆分（幂等保护已覆盖）。
//
// @param {object} data - 准备后的数据
// @param {object} propTypes - 属性类型映射 { TLT: 'array', ... }
// @returns {object} 转换后的数据
export function convertConditions(data, propTypes = {}) {
  // 合并默认数组属性标注（调用方可覆盖）。
  const types = { ...Object.fromEntries(ARRAY_PROPS.map(p => [p, 'array'])), ...propTypes }
  // 深拷贝。
  const result = structuredClone(data)
  // 转换 talents 的 condition。
  const convertTalent = (talent) => {
    // 有 condition 则转换。
    if (talent.condition) talent.condition = convertLegacy(talent.condition, types)
    // 返回。
    return talent
  }
  // 转换 events 的 include/exclude/branch 条件。
  const convertEvent = (event) => {
    // include 条件。
    if (event.include) event.include = convertLegacy(event.include, types)
    // exclude 条件。
    if (event.exclude) event.exclude = convertLegacy(event.exclude, types)
    // branch：扁平字符串数组 ["条件:目标ID", ...]，逐条拆分后转换条件部分。
    if (event.branch) {
      // 拆分并转换每条分支。
      event.branch = event.branch.map(b => {
        // 幂等：已是 [条件, 目标] 二维数组则直接转换条件部分。
        if (Array.isArray(b)) return [convertLegacy(b[0], types), b[1]]
        // 按最后一个冒号拆分 [条件, 目标ID]（条件本身不含冒号，目标 ID 是纯数字/ID）。
        const idx = b.lastIndexOf(':')
        // 转换条件部分。
        return `${convertLegacy(b.slice(0, idx), types)}:${b.slice(idx + 1)}`
      })
    }
    // 返回。
    return event
  }
  // 转换 achievements 的 condition。
  const convertAchievement = (ach) => {
    // 有 condition 则转换。
    if (ach.condition) ach.condition = convertLegacy(ach.condition, types)
    // 返回。
    return ach
  }
  // 应用到各数据集。
  if (result.talents) for (const id in result.talents) convertTalent(result.talents[id])
  if (result.events) for (const id in result.events) convertEvent(result.events[id])
  if (result.achievements) for (const id in result.achievements) convertAchievement(result.achievements[id])
  // 返回。
  return result
}
