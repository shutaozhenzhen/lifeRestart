/**
 * test-utils/real-data — **真实数据**加载（仅测试使用，不进构建产物）
 *
 * 为什么单独一个模块（而不是塞进 setup.js）：
 *   setup.js 会 import 线上路由表（含 createWebHashHistory），因此只能在 DOM 环境使用；
 *   而"随机种子是否真的生效""复现是否真的成立"这类结论要在 **node 环境的 store 单测**里验证，
 *   也必须用真实数据（fixture 只有 4 个候选天赋、每个年龄单一事件，随机性几乎不可观测）。
 *   这个模块只依赖 node:fs 与引擎工具，任何环境都能用。
 *
 * 数据来源：`packages/frontend/public/data/*.json` —— 与线上 fetch 的是同一批文件
 * （Data Mod 产物：501 年龄 / 184 天赋 / 1720 事件 / 165 成就）。
 */

// 读文件。
import { readFileSync } from 'node:fs'
// 路径解析（注意：**不要用 URL 对象**——happy-dom 环境下的 URL 不是 Node 的 URL，
// readFileSync 会报 "The URL must be of scheme file"，所以统一按路径字符串处理）。
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// 深拷贝（引擎可能就地规范化数据，缓存不能被污染）。
import { clone } from 'game-engine/src/functions/util.js'

// 本文件所在目录 → 数据目录（src/test-utils → 上两级 = packages/frontend）。
const REAL_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data')

// 解析缓存（3.9MB JSON 只解析一次）。
let cache = null

// #loadRealData
// 加载真实数据。
//
// @returns {object} { age, total, talents, events, achievements, characters }（每次返回新副本）
export function loadRealData() {
  // 首次解析。
  if (!cache) {
    // 读单个文件。
    const read = (file) => JSON.parse(readFileSync(join(REAL_DATA_DIR, file), 'utf8'))
    // 五张表。
    const age = read('age.json')
    const talents = read('talents.json')
    const events = read('events.json')
    const achievements = read('achievements.json')
    const characters = read('characters.json')
    // 缓存（total 与 HomeView.fetchOriginalData 的算法一致）。
    cache = {
      age,
      talents,
      events,
      achievements,
      characters,
      total: { TACHV: Object.keys(achievements).length, TEVT: Object.keys(events).length, TTLT: Object.keys(talents).length },
    }
  }
  // 返回副本。
  return clone(cache)
}

// #stubFetchReal
// 用真实数据打桩 fetch（HomeView / SimulateView 会取 `data/*.json`）。
//
// @returns {object} 真实数据（供用例断言规模）
export function stubFetchReal() {
  // 数据。
  const data = loadRealData()
  // 注入。
  globalThis.fetch = async (url) => {
    // 文件名（去掉 query）。
    const name = String(url).split('?')[0].split('/').pop()
    // 文件表。
    const table = {
      'age.json': data.age,
      'talents.json': data.talents,
      'events.json': data.events,
      'achievements.json': data.achievements,
      'characters.json': data.characters,
    }
    // 未知文件 → 404。
    if (!(name in table)) return { ok: false, status: 404, json: async () => ({}) }
    // 返回数据。
    return { ok: true, status: 200, json: async () => table[name] }
  }
  // 返回。
  return data
}
