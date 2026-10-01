/**
 * random-strategy — 批量模拟用的随机策略（纯函数，随机源可注入）
 *
 * 背景（新增「模拟系统」）：
 *   要在前端批量跑几十到上千局，每局都需要「随机选天赋 + 随机分配属性」。
 *   这套策略如果写进页面里就没法验证（随机结果不可断言），因此抽成纯函数：
 *   随机源 `random` 与互斥判定 `isConflict` 全部注入，测试可用固定种子断言。
 *
 * 设计要点：
 *   - 不用 `while(true)` 自旋做拒绝采样（点数超过总容量时会死循环），
 *     改为「先算可用属性集合再抽」+ 循环次数上限。
 *   - 返回值都是新对象，调用方可就地改。
 */

// #ALLOC_KEYS
// 可分配的四项属性（与前端属性分配页一致；SPR/快乐由事件驱动，不参与分配）。
export const ALLOC_KEYS = ['CHR', 'INT', 'STR', 'MNY']

// #randomAllocation
// 随机把点数分配到各项属性（每项不超过 max）。
//
// @param {object} [params]
// @param {number} [params.points] - 可分配总点数
// @param {Array<string>} [params.keys] - 可分配属性
// @param {number} [params.max] - 单项上限
// @param {Function} [params.random] - 随机源（[0,1)）
// @returns {object} 分配结果，如 { CHR: 3, INT: 4, STR: 5, MNY: 8 }
export function randomAllocation({ points, keys = ALLOC_KEYS, max = 10, random = Math.random } = {}) {
  // 初始化全 0。
  const allocation = Object.fromEntries(keys.map((k) => [k, 0]))
  // 剩余点数（负数/非数字按 0 处理）。
  let left = Math.max(0, Math.floor(Number(points) || 0))
  // 单项上限规范化。
  const cap = Math.max(0, Math.floor(Number(max) || 0))
  // 逐点分配：每轮只在「还有余量」的属性里抽，避免自旋。
  while (left > 0) {
    // 还有余量的属性。
    const available = keys.filter((k) => allocation[k] < cap)
    // 全满：剩余点数无法分配（点数 > 总容量），退出。
    if (available.length === 0) break
    // 随机取一项。
    const pick = available[Math.floor(random() * available.length)]
    // 落点。
    allocation[pick]++
    // 扣减。
    left--
  }
  // 返回。
  return allocation
}

// #randomTalents
// 从天赋池里随机挑 limit 个（不重复、可选互斥校验）。
//
// @param {object} [params]
// @param {Array<object|string>} [params.pool] - 天赋池（对象需含 id）
// @param {number} [params.limit] - 最多选几个
// @param {Function} [params.isConflict] - (已选ID数组, 候选ID) => boolean
// @param {Function} [params.random] - 随机源
// @returns {Array<string>} 选中的天赋 ID（池不足时可能少于 limit）
export function randomTalents({ pool = [], limit = 3, isConflict, random = Math.random } = {}) {
  // 已选。
  const chosen = []
  // 候选副本（就地 splice 抽取，天然不重复）。
  const candidates = [...pool]
  // 逐个抽取。
  while (chosen.length < limit && candidates.length > 0) {
    // 随机下标。
    const index = Math.floor(random() * candidates.length)
    // 取出（同时从候选里移除）。
    const [item] = candidates.splice(index, 1)
    // 兼容「对象池」与「ID 数组」两种入参。
    const id = item && typeof item === 'object' ? item.id : item
    // ID 无效跳过。
    if (id === undefined || id === null) continue
    // 互斥校验：冲突则换下一个（该候选已被移除，不会重复尝试）。
    if (typeof isConflict === 'function' && isConflict(chosen, id)) continue
    // 选中。
    chosen.push(id)
  }
  // 返回。
  return chosen
}
