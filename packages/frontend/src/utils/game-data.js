/**
 * game-data — 游戏数据加载（主页与模拟页共用，避免两套实现）
 *
 * 提取原因：
 *   「加载原版数据 → 失败降级 fixture」这段逻辑原先写在 HomeView 里。
 *   新增「模拟统计」页同样需要一份数据；如果再抄一遍，就会出现两套加载/降级
 *   行为（正是本项目此前踩过的坑）。这里收敛成一处，并保持与主页完全一致的
 *   日志文案与 dataSource 标注。
 *
 * 数据源优先级：
 *   1. `lifeRestart-data` Mod 启用（缺省视为启用）→ 加载 public/data/*.json（Data Mod 产物）
 *   2. 加载失败或被禁用 → 内置 fixture 演示数据（并标注原因，日志报告里可见）
 */

// fixture 数据与克隆工具。
import { clone } from 'game-engine/src/functions/util.js'
import { AGE_DATA, TOTAL } from 'game-engine/src/fixtures/property.fixture.js'
import { TALENTS, EVENTS } from 'game-engine/src/fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from 'game-engine/src/fixtures/achievement-character.fixture.js'

// #buildFixtureData
// 组装 fixture 演示数据（结构 = 原版数据加载结果）。
//
// @returns {object} { age, total, talents, events, achievements, characters }
export function buildFixtureData() {
  // 深拷贝，避免多处消费互相污染。
  return {
    age: clone(AGE_DATA),
    total: TOTAL,
    talents: clone(TALENTS),
    events: clone(EVENTS),
    achievements: clone(ACHIEVEMENTS),
    characters: {},
  }
}

// #loadModState
// 读取某个 Mod 的启停状态（localStorage 键 modsState，与 Mod 管理页共用）。
//
// @param {string} name - Mod 名
// @param {object} [storage] - 存储适配器（缺省 localStorage）
// @returns {boolean|null} 启停；无记录返回 null
export function loadModState(name, storage) {
  // 读取 + 解析。
  try {
    // 解析。
    const parsed = JSON.parse((storage || localStorage).getItem('modsState'))
    // 返回该 Mod 启停（缺省 null = 用默认值）。
    return parsed?.enabled?.[name] ?? null
  } catch {
    // 无记录 / 解析失败。
    return null
  }
}

// #fetchOriginalData
// 加载 Data Mod 产物（public/data/*.json）。
//
// @param {object} [deps]
// @param {Function} [deps.fetchImpl] - 请求实现（测试可注入）
// @param {string} [deps.baseUrl] - 数据基础路径（缺省用 Vite 的 BASE_URL）
// @returns {Promise<object>} 引擎可直接消费的数据
export async function fetchOriginalData({ fetchImpl, baseUrl } = {}) {
  // 请求实现。
  const request = fetchImpl || fetch
  // 基础路径：用 import.meta.env.BASE_URL（dev '/'，Pages 构建 './'），
  // 避免部署到子路径时请求到域名根而 404。
  const base = baseUrl !== undefined ? baseUrl : import.meta.env.BASE_URL || '/'
  // 并行加载 5 个数据文件。
  const [age, talents, events, achievements, characters] = await Promise.all([
    // 年龄表。
    request(`${base}data/age.json`).then((r) => r.json()),
    // 天赋。
    request(`${base}data/talents.json`).then((r) => r.json()),
    // 事件。
    request(`${base}data/events.json`).then((r) => r.json()),
    // 成就。
    request(`${base}data/achievements.json`).then((r) => r.json()),
    // 名人。
    request(`${base}data/characters.json`).then((r) => r.json()),
  ])
  // 返回整合数据（total 供引擎统计使用）。
  return {
    age,
    total: { TACHV: Object.keys(achievements).length, TEVT: Object.keys(events).length, TTLT: Object.keys(talents).length },
    talents,
    events,
    achievements,
    characters,
  }
}

// #loadGameData
// 按数据源优先级加载数据，并给出 dataSource 描述（供日志/报告）。
//
// @param {object} [deps]
// @param {Function} [deps.fetchImpl] - 请求实现（测试可注入）
// @param {object} [deps.storage] - 存储适配器（读 Mod 启停）
// @param {string} [deps.baseUrl] - 数据基础路径
// @returns {Promise<{data: object, dataSource: string, degraded: boolean}>} 数据与来源描述
export async function loadGameData({ fetchImpl, storage, baseUrl } = {}) {
  // 原版数据 Mod 的启停（缺省视为启用：系统内置默认开）。
  const enabled = loadModState('lifeRestart-data', storage)
  // 启用路径。
  if (enabled !== false) {
    // 尝试加载原版。
    try {
      // 加载。
      const data = await fetchOriginalData({ fetchImpl, baseUrl })
      // 返回（含规模摘要）。
      return {
        data,
        dataSource: `lifeRestart-data（${Object.keys(data.talents).length} 天赋 / ${Object.keys(data.events).length} 事件）`,
        degraded: false,
      }
    } catch (e) {
      // 降级：标注失败原因。
      return { data: buildFixtureData(), dataSource: `fixture 演示数据（原版数据加载失败：${e.message}）`, degraded: true }
    }
  }
  // 被禁用：直接用 fixture。
  return { data: buildFixtureData(), dataSource: 'fixture 演示数据（lifeRestart-data 已禁用）', degraded: true }
}
