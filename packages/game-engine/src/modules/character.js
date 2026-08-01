/**
 * character 名人模式模块
 *
 * 从原版 lifeRestart-old/src/modules/character.js 移植，按新项目约束改造：
 *   1. 去掉 #system 依赖：构造注入 { clone, random, storage, now, getTalentRandom }。
 *   2. localStorage → 注入式 storage（uniqueWaTaShi 持久化）。
 *   3. 时间窗口逻辑（10 秒内连点 10 次）的 Date.now() → 注入 now()，便于测试。
 *   4. 天赋随机从 #system.request(TALENT).random() → 注入 getTalentRandom(count)。
 *
 * 公开 API（供 Life 编排器与 gameAPI 调用）：
 *   initial / count / config / generateUnique / random
 */

// #defaultStorage
// 默认内存 storage 适配器（与 property.js 一致）。
const defaultStorage = {
  // 内存数据。
  _data: {},
  // 读取：存在则返回，否则返回 null。
  getItem(key) {
    return key in this._data ? this._data[key] : null
  },
  // 写入：存为字符串。
  setItem(key, value) {
    this._data[key] = String(value)
  },
}

class Character {
  // 构造函数：注入依赖，替代原版的 #system。
  // @param {object} deps
  // @param {Function} [deps.clone]           - 深拷贝函数
  // @param {() => number} [deps.random]      - 随机源
  // @param {object} [deps.storage]           - storage 适配器（uniqueWaTaShi 持久化）
  // @param {() => number} [deps.now]         - 时间戳函数，默认 Date.now
  // @param {(count: number) => Array<string>} [deps.getTalentRandom] - 随机天赋
  constructor({
    clone = (v) => v,
    random = Math.random,
    storage = defaultStorage,
    now = () => Date.now(),
    getTalentRandom = () => [],
  } = {}) {
    // 保存注入的克隆函数。
    this.#clone = clone
    // 保存注入的随机源。
    this.#random = random
    // 保存注入的 storage。
    this.#storage = storage
    // 保存注入的时间戳函数。
    this.#now = now
    // 保存注入的天赋随机函数。
    this.#getTalentRandom = getTalentRandom
  }

  // 私有字段。
  #clone           // 克隆函数
  #random          // 随机源
  #storage         // storage
  #now             // 时间戳函数
  #getTalentRandom // 天赋随机函数
  #characters      // 名人数据
  #characterPullCount // 名人抽取数量
  #rateableKnife   // 保底阈值
  #rate            // 名人抽取权重表
  #pipe = []       // 时间戳队列（判断"快速连点"）
  #uniqueWaTaShi   // 唯一"我"数据
  #propertyWeight  // 属性权重
  #talentWeight    // 天赋数量权重

  // #initial
  // 初始化名人数据，从 storage 恢复唯一"我"。
  //
  // @param {object} params
  // @param {object} params.characters - 名人数据 { id: { ... } }
  // @returns {number} 名人数
  initial({ characters }) {
    // 保存名人数据。
    this.#characters = characters
    // 从 storage 恢复唯一"我"。
    const saved = this.#storage.getItem('uniqueWaTaShi')
    // 有存档则解析。
    if (saved !== null && saved !== 'undefined') {
      // 解析并保存。
      this.#uniqueWaTaShi = JSON.parse(saved)
    }
    // 返回名人数。
    return this.count
  }

  // #count
  // 名人数。
  get count() {
    // 返回对象键数量。
    return Object.keys(this.#characters).length
  }

  // #config
  // 注入配置。
  // @param {object} params
  // @param {number} [params.characterPullCount] - 名人抽取数量
  // @param {number} [params.rateableKnife] - 保底阈值
  // @param {object} [params.propertyWeight] - 属性权重
  // @param {object} [params.talentWeight] - 天赋数量权重
  // @returns {void}
  config({
    characterPullCount = 3,
    rateableKnife = 10,
    propertyWeight,
    talentWeight,
  } = {}) {
    // 保存配置。
    this.#characterPullCount = characterPullCount
    // 保存保底阈值。
    this.#rateableKnife = rateableKnife
    // 保存属性权重。
    this.#propertyWeight = propertyWeight
    // 保存天赋数量权重。
    this.#talentWeight = talentWeight
  }

  // #weightRandom
  // 带权重随机（复用注入的随机源）。
  //
  // @param {Array<[string, number]>} list - [id, weight] 数组
  // @returns {string|null} 抽中的 id；空列表返回 null
  #weightRandom(list) {
    // 空列表守卫：候选耗尽时返回 null（抽取数量超过名人数的情况）。
    if (list.length === 0) return null
    // 总权重。
    let total = 0
    // 累加。
    for (const [, w] of list) total += w
    // 随机值。
    let r = this.#random() * total
    // 逐项。
    for (const [id, w] of list) {
      // 减去权重。
      r -= w
      // 命中。
      if (r < 0) return id
    }
    // 兜底最后一项。
    return list[list.length - 1][0]
  }

  // #unique getter
  // 读取唯一"我"。无存档时：记录点击时间戳，10 秒内连点 10 次才解锁。
  // @returns {object|null} 唯一"我"数据；未解锁返回 null
  get #unique() {
    // 已有数据直接返回（深拷贝）。
    if (this.#uniqueWaTaShi) return this.#clone(this.#uniqueWaTaShi)
    // 记录当前时间戳。
    const nowTs = this.#now()
    // 入队。
    this.#pipe.push(nowTs)
    // 队列不足 10 次。
    if (this.#pipe.length < 10) return null
    // 取出最早的时间戳。
    const first = this.#pipe.shift()
    // 超过 10 秒则未解锁（清空队列头）。
    if (nowTs - first > 10000) return null
    // 解锁：返回占位对象。
    return { unique: true, generate: false }
  }

  // #unique setter
  // 保存唯一"我"到 storage。
  // @param {object} data - 唯一"我"数据
  set #unique(data) {
    // 深拷贝。
    this.#uniqueWaTaShi = this.#clone(data)
    // 标记唯一。
    this.#uniqueWaTaShi.unique = true
    // 标记已生成。
    this.#uniqueWaTaShi.generate = true
    // 持久化。
    this.#storage.setItem('uniqueWaTaShi', JSON.stringify(this.#uniqueWaTaShi))
  }

  // #generateUnique
  // 生成唯一"我"：随机属性 + 随机天赋。
  //
  // @returns {object|null} 生成的唯一"我"
  generateUnique() {
    // 已存在直接返回。
    if (this.#uniqueWaTaShi) return this.#unique
    // 随机属性值（从权重表抽 CHR/INT/STR/MNY）。
    // 注意：直接用 this.#weightRandom(...)，不能先解构后调用（私有方法会丢 this）。
    const property = {
      CHR: this.#weightRandom(this.#propertyWeight),
      INT: this.#weightRandom(this.#propertyWeight),
      STR: this.#weightRandom(this.#propertyWeight),
      MNY: this.#weightRandom(this.#propertyWeight),
    }
    // 随机天赋数量。
    const talentCount = this.#weightRandom(this.#talentWeight)
    // 随机天赋。
    const talent = this.#getTalentRandom(Number(talentCount))
    // 组装唯一"我"。
    this.#unique = { property, talent }
    // 返回。
    return this.#unique
  }

  // #random
  // 随机名人：返回唯一"我" + 普通名人列表。
  //
  // @returns {{unique: object|null, normal: Array<object>}}
  random() {
    // 返回组合。
    return {
      // 唯一"我"。
      unique: this.#unique,
      // 普通名人。
      normal: this.#rateable(),
    }
  }

  // #rateable
  // 按权重抽取普通名人（带保底机制）。
  // 内部实现。
  // @returns {Array<object>} 名人对象列表
  #rateable() {
    // 首次初始化权重表：每个名人均重 1。
    if (!this.#rate) {
      // 初始化。
      this.#rate = {}
      // 逐名人设权重。
      for (const id in this.#characters) this.#rate[id] = 1
    }

    // 抽取结果 ID 列表。
    const r = []
    // 抽取 characterPullCount 个。
    new Array(this.#characterPullCount).fill(0).forEach(() => {
      // 从未抽中的名人里按权重抽。
      const picked = this.#weightRandom(
        // 过滤已抽中。
        Object.keys(this.#rate).filter(id => !r.includes(id))
          // 转 [id, weight]。
          .map(id => ([id, this.#rate[id]]))
      )
      // 候选耗尽时（抽取数 > 名人数）跳过，不 push undefined。
      if (picked !== null) r.push(picked)
    })

    // 保底：未抽中的名人权重 +1，防止永远抽不到某些名人。
    let min = Infinity
    // 遍历权重表。
    for (const id in this.#rate) {
      // 已抽中：只更新最小值。
      if (r.includes(id)) {
        // 更新最小值。
        min = Math.min(min, this.#rate[id])
        // 跳过。
        continue
      }
      // 未抽中：权重 +1。
      min = Math.min(min, ++this.#rate[id])
    }
    // 最小权重超过阈值：全部减去阈值（回落到基线）。
    if (min > this.#rateableKnife) {
      // 逐名人减。
      for (const id in this.#rate) this.#rate[id] -= this.#rateableKnife
    }
    // 返回抽中的名人对象。
    return r.map(id => this.#clone(this.#characters[id]))
  }
}

export default Character
