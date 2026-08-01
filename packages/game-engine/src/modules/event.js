/**
 * event 事件系统模块
 *
 * 从原版 lifeRestart-old/src/modules/event.js 移植，按新项目约束改造：
 *   1. 去掉 #system 依赖：构造注入 { clone, check }。
 *   2. 字符串 ID：branch 目标不再转 Number。
 *   3. 条件用新语法：check(condition) 直接求值。
 *
 * 公开 API（供 Life 编排器与 gameAPI 调用）：
 *   initial / count / check / get / information / do
 */

class Event {
  // 构造函数：注入依赖，替代原版的 #system。
  // @param {object} deps
  // @param {Function} [deps.clone] - 深拷贝函数
  // @param {Function} [deps.check] - 条件求值函数 check(condition, props)
  constructor({ clone = (v) => v, check = () => false } = {}) {
    // 保存注入的克隆函数。
    this.#clone = clone
    // 保存注入的条件求值函数。
    this.#check = check
  }

  // 私有字段。
  #clone      // 克隆函数
  #check      // 条件求值函数
  #events     // 事件数据

  // #initial
  // 初始化事件数据，解析 branch 结构。
  // branch 是数组：["条件:目标ID", ...]，解析为 [["条件", "目标ID"], ...]。
  // 原版把目标转 Number，新项目保留字符串 ID。
  //
  // @param {object} params
  // @param {object} params.events - 事件数据 { id: { ... } }
  // @returns {number} 事件总数
  initial({ events }) {
    // 保存事件数据。
    this.#events = events
    // 遍历每个事件。
    for (const id in events) {
      // 取出事件对象。
      const event = events[id]
      // 无 branch 跳过。
      if (!event.branch) continue
      // 解析每条分支。
      event.branch = event.branch.map(b => {
        // 按冒号拆分为 [条件, 目标ID]。
        const parts = b.split(':')
        // 目标 ID 保持字符串（原版 Number() 已移除）。
        parts[1] = `${parts[1]}`
        // 返回 [条件, 目标ID]。
        return parts
      })
    }
    // 返回事件总数。
    return this.count
  }

  // #count
  // 事件总数。
  get count() {
    // 返回对象键数量。
    return Object.keys(this.#events).length
  }

  // #check
  // 检查事件是否可随机触发。
  // 规则：NoRandom 禁止随机；exclude 命中禁止；include 存在则需满足。
  //
  // @param {string} eventId - 事件 ID
  // @returns {boolean} 是否可触发
  check(eventId) {
    // 取事件字段。
    const { include, exclude, NoRandom } = this.get(eventId)
    // NoRandom 事件不能随机触发。
    if (NoRandom) return false
    // exclude 条件满足 → 禁止触发。
    if (exclude && this.#check(exclude)) return false
    // include 条件存在 → 必须满足。
    if (include) return this.#check(include)
    // 默认可触发。
    return true
  }

  // #get
  // 读取事件（深拷贝）。不存在则抛错。
  //
  // @param {string} eventId - 事件 ID
  // @returns {object} 事件对象副本
  get(eventId) {
    // 取事件。
    const event = this.#events[eventId]
    // 不存在报错。
    if (!event) throw new Error(`[ERROR] No Event[${eventId}]`)
    // 返回深拷贝。
    return this.#clone(event)
  }

  // #information
  // 读取事件描述。
  //
  // @param {string} eventId - 事件 ID
  // @returns {{description: string}}
  information(eventId) {
    // 取描述字段。
    const { event: description } = this.get(eventId)
    // 返回。
    return { description }
  }

  // #do
  // 执行事件：若存在满足条件的分支，返回分支目标；否则返回事件本身效果。
  //
  // @param {string} eventId - 事件 ID
  // @returns {{effect, next?, description, postEvent?, grade}} 执行结果
  do(eventId) {
    // 取事件字段。
    const { effect, branch, event: description, postEvent, grade } = this.get(eventId)
    // 有分支：逐条检查条件。
    if (branch) {
      // 遍历每条分支 [条件, 目标ID]。
      for (const [cond, next] of branch) {
        // 条件满足 → 走分支。
        if (this.#check(cond)) return { effect, next, description, grade }
      }
    }
    // 无分支命中：返回事件本身（可能带 postEvent）。
    return { effect, postEvent, description, grade }
  }
}

export default Event
