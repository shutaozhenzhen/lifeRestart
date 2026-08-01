/**
 * achievement 成就系统模块
 *
 * 从原版 lifeRestart-old/src/modules/achievement.js 移植，按新项目约束改造：
 *   1. 去掉 #system 依赖：构造注入 { clone, check, emit }。
 *   2. 全局 $$event → 注入式事件总线 emit(tag, data)。
 *   3. 不再通过 #prop 直取属性，改为注入 getProp(prop) 读取函数。
 *
 * 公开 API（供 Life 编排器与 gameAPI 调用）：
 *   Opportunity / initial / count / list / get / check / isAchieved / achieve
 */

class Achievement {
  // 触发时机常量。
  Opportunity = {
    START: 'START',           // 分配完成点数，点击开始新人生后
    TRAJECTORY: 'TRAJECTORY', // 每一年的人生经历中
    SUMMARY: 'SUMMARY',       // 人生结束，点击人生总结后
    END: 'END',               // 游戏完成，点击重开，重开次数在这之后才会 +1
  }

  // 构造函数：注入依赖，替代原版的 #system。
  // @param {object} deps
  // @param {Function} [deps.clone]   - 深拷贝函数
  // @param {Function} [deps.check]   - 条件求值函数 check(condition, props)
  // @param {Function} [deps.isAchieved] - 检查成就是否已达成 isAchieved(id)
  // @param {Function} [deps.record]  - 记录达成 record(id)（写入属性系统 ACHV）
  // @param {Function} [deps.emit]    - 事件总线 emit(tag, data)
  constructor({ clone = (v) => v, check = () => false, isAchieved = () => false, record = () => {}, emit = () => {} } = {}) {
    // 保存注入的克隆函数。
    this.#clone = clone
    // 保存注入的条件求值函数。
    this.#check = check
    // 保存注入的达成检查函数。
    this.#isAchieved = isAchieved
    // 保存注入的记录函数。
    this.#record = record
    // 保存注入的事件总线。
    this.#emit = emit
  }

  // 私有字段。
  #clone        // 克隆函数
  #check        // 条件求值函数
  #isAchieved   // 达成检查函数
  #record       // 记录函数
  #emit         // 事件总线
  #achievements // 成就数据

  // #initial
  // 初始化成就数据。
  //
  // @param {object} params
  // @param {object} params.achievements - 成就数据 { id: { ... } }
  // @returns {number} 成就总数
  initial({ achievements }) {
    // 保存成就数据。
    this.#achievements = achievements
    // 返回成就总数。
    return this.count
  }

  // #count
  // 成就总数。
  get count() {
    // 返回对象键数量。
    return Object.keys(this.#achievements).length
  }

  // #list
  // 列出全部成就（含是否达成）。
  //
  // @returns {Array<object>} 成就列表，每项含 isAchieved
  list() {
    // 遍历全部成就。
    return Object.values(this.#achievements).map(({
      id, name, opportunity,
      description, hide, grade,
    }) => ({
      // 基本字段。
      id, name, opportunity, description, hide, grade,
      // 是否达成。
      isAchieved: this.isAchieved(id),
    }))
  }

  // #get
  // 读取成就（深拷贝）。不存在则抛错。
  //
  // @param {string} achievementId - 成就 ID
  // @returns {object} 成就对象副本
  get(achievementId) {
    // 取成就。
    const achievement = this.#achievements[achievementId]
    // 不存在报错。
    if (!achievement) throw new Error(`[ERROR] No Achievement[${achievementId}]`)
    // 返回深拷贝。
    return this.#clone(achievement)
  }

  // #check
  // 检查成就条件是否满足。
  // 无条件（如"开始人生"这类必然成就）视为满足。
  //
  // @param {string} achievementId - 成就 ID
  // @returns {boolean} 条件是否满足
  check(achievementId) {
    // 取成就对象。
    const { condition } = this.get(achievementId)
    // 无条件视为满足（与 talent.check 语义一致）。
    if (!condition) return true
    // 用注入的 check 求值（新语法条件）。
    return this.#check(condition)
  }

  // #isAchieved
  // 该成就是否已达成。
  // 默认用注入的检查函数；未注入时直接查成就对象是否含 condition 条件可满足。
  //
  // @param {string} achievementId - 成就 ID
  // @returns {boolean} 是否已达成
  isAchieved(achievementId) {
    // 用注入的达成检查函数。
    return this.#isAchieved(achievementId)
  }

  // #achieve
  // 在指定时机触发成就检测：达成条件者写入 ACHV 并广播事件。
  //
  // @param {string} opportunity - 触发时机（Opportunity 之一）
  // @returns {void}
  achieve(opportunity) {
    // 流程：
    //   1. 列出全部成就。
    //   2. 过滤未达成的。
    //   3. 过滤时机匹配的。
    //   4. 过滤条件满足的。
    this.list()
      // 未达成。
      .filter(({ isAchieved }) => !isAchieved)
      // 时机匹配。
      .filter(({ opportunity: o }) => o == opportunity)
      // 条件满足。
      .filter(({ id }) => this.check(id))
      // 逐个达成。
      .forEach(({ id }) => {
        // 写入属性系统的 ACHV 累计。
        this.#record(id)
        // 广播成就事件（供 Vue 弹窗/通知）。
        this.#emit('achievement', this.get(id))
      })
  }
}

export default Achievement
