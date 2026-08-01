/**
 * talent 天赋系统模块
 *
 * 从原版 lifeRestart-old/src/modules/talent.js 移植，按新项目约束改造：
 *   1. 去掉 #system 依赖：构造注入 { clone, check, random }。
 *   2. 字符串 ID：talent.id 不再转 Number，replacement 键保留字符串。
 *   3. maxTriggers 显式化：不再用 extractMaxTriggers 从条件里算，
 *      Data Mod 打包时写入 maxTriggers 字段（缺省 1）。
 *   4. 条件用新语法：check(condition) 直接求值，不再走旧解析器。
 *
 * 公开 API（供 Life 编排器与 gameAPI 调用）：
 *   initial / count / check / get / information / exclude
 *   getAddition / getRate / talentRandom / random / allocationAddition
 *   do / replace / forEach
 */

class Talent {
  // 构造函数：注入依赖，替代原版的 #system。
  // @param {object} deps
  // @param {Function} [deps.clone]  - 深拷贝函数
  // @param {Function} [deps.check]  - 条件求值函数 check(condition, props)
  // @param {() => number} [deps.random] - 随机源
  constructor({ clone = (v) => v, check = () => false, random = Math.random } = {}) {
    // 保存注入的克隆函数。
    this.#clone = clone
    // 保存注入的条件求值函数。
    this.#check = check
    // 保存注入的随机源。
    this.#random = random
  }

  // 私有字段。
  #clone        // 克隆函数
  #check        // 条件求值函数
  #random       // 随机源
  #talents      // 天赋数据
  #talentPullCount   // 天赋抽取池大小
  #talentRate   // 天赋等级概率
  #additions    // 额外加成配置

  // #initial
  // 初始化天赋数据，处理 replacement 结构。
  // 原版在此把 id/grade 转 Number、用 extractMaxTriggers 算 max_triggers，
  // 新项目：ID 保持字符串、maxTriggers 读显式字段（缺省 1）。
  //
  // @param {object} params
  // @param {object} params.talents - 天赋数据 { id: { ... } }
  // @returns {number} 天赋总数
  initial({ talents }) {
    // 保存天赋数据。
    this.#talents = talents
    // 遍历每个天赋。
    for (const id in talents) {
      // 取出天赋对象。
      const talent = talents[id]
      // ID 保持字符串（原版 Number(id) 已移除）。
      talent.id = id
      // 等级转数字（等级是数值）。
      talent.grade = Number(talent.grade)
      // maxTriggers：读显式字段，缺省 1（原版用 extractMaxTriggers 计算，已移除）。
      talent.maxTriggers = talent.maxTriggers || 1
      // 处理 replacement（替换链）。
      if (talent.replacement) {
        // 幂等保护：replacement 已是对象映射形式（initial 被多次调用），跳过。
        const needsParse = (key) => Array.isArray(talent.replacement[key])
        // 只有 grade/talent 仍是数组才需解析。
        if (needsParse('grade') || needsParse('talent')) {
          // 遍历 replacement 的每个键（grade / talent）。
          for (const key in talent.replacement) {
            // 非数组跳过（已解析）。
            if (!Array.isArray(talent.replacement[key])) continue
            // 转换结果对象：{ 目标ID: 权重 }。
            const obj = {}
            // 遍历该键下的目标数组。
            for (const value of talent.replacement[key]) {
              // 支持 "ID*权重" 形式。
              const parts = `${value}`.split('*')
              // 目标 ID 保留字符串（原版 Number(value[0]) 已移除）。
              const targetId = parts[0] || ''
              // 权重：缺省 1。
              const weight = Number(parts[1]) || 1
              // 写入映射。
              obj[targetId] = weight
            }
            // 覆盖原 replacement 键为转换后的映射。
            talent.replacement[key] = obj
          }
        }
      }
    }
    // 返回天赋总数。
    return this.count
  }

  // #count
  // 天赋总数。
  get count() {
    // 返回对象键数量。
    return Object.keys(this.#talents).length
  }

  // #config
  // 注入配置。
  // @param {object} params
  // @param {number} [params.talentPullCount] - 天赋抽取池大小
  // @param {object} [params.talentRate] - 各等级概率
  // @param {object} [params.additions] - 额外加成
  // @returns {void}
  config({
    talentPullCount = 10, // 天赋抽取池大小
    talentRate = { 1: 100, 2: 10, 3: 1, total: 1000 }, // 各等级概率
    additions = {}, // 额外加成
  } = {}) {
    // 保存配置。
    this.#talentPullCount = talentPullCount
    // 保存概率配置。
    this.#talentRate = talentRate
    // 保存加成配置。
    this.#additions = additions
  }

  // #check
  // 检查天赋条件是否满足。
  //
  // @param {string} talentId - 天赋 ID
  // @returns {boolean} 条件是否满足
  check(talentId) {
    // 取天赋对象。
    const { condition } = this.get(talentId)
    // 无条件则满足。
    if (!condition) return true
    // 用注入的 check 求值（新语法条件）。
    return this.#check(condition)
  }

  // #get
  // 读取天赋（深拷贝）。不存在则抛错。
  //
  // @param {string} talentId - 天赋 ID
  // @returns {object} 天赋对象副本
  get(talentId) {
    // 取天赋。
    const talent = this.#talents[talentId]
    // 不存在报错。
    if (!talent) throw new Error(`[ERROR] No Talent[${talentId}]`)
    // 返回深拷贝。
    return this.#clone(talent)
  }

  // #information
  // 读取天赋的展示信息。
  //
  // @param {string} talentId - 天赋 ID
  // @returns {{grade: number, name: string, description: string}}
  information(talentId) {
    // 取关键字段。
    const { grade, name, description } = this.get(talentId)
    // 返回。
    return { grade, name, description }
  }

  // #exclude
  // 排除链：检查 talents 列表里是否有与 excludeId 互斥的天赋。
  // 双向检查：excludeId 的 exclude 列表，或候选天赋的 exclude 反向列表。
  //
  // @param {Array<string>} talents - 候选天赋 ID 列表
  // @param {string} excludeId - 要检查的天赋 ID
  // @returns {string|null} 冲突的天赋 ID；无冲突返回 null
  exclude(talents, excludeId) {
    // 取 excludeId 的排除列表。
    const { exclude } = this.get(excludeId)
    // 遍历候选天赋。
    for (const talent of talents) {
      // 正向：excludeId 排除了 talent。
      if (exclude) {
        // 遍历排除列表。
        for (const e of exclude) {
          // 命中则冲突。
          if (talent == e) return talent
        }
      }
      // 反向：talent 排除了 excludeId。
      const excludeReverse = this.get(talent).exclude
      // 若候选天赋有排除列表。
      if (excludeReverse) {
        // 遍历。
        for (const e of excludeReverse) {
          // 命中则冲突。
          if (excludeId == e) return talent
        }
      }
    }
    // 无冲突。
    return null
  }

  // #getAddition
  // 根据属性值取加成：additions[type] 是 [[min, addition], ...] 从高到低。
  //
  // @param {string} type - 加成类型（如 TMS）
  // @param {number} value - 属性值
  // @returns {object} 加成对象
  getAddition(type, value) {
    // 无该类型加成返回空。
    if (!this.#additions[type]) return {}
    // 遍历分档。
    for (const [min, addition] of this.#additions[type]) {
      // 值达到下限则返回该档加成。
      if (value >= min) return addition
    }
    // 无命中返回空。
    return {}
  }

  // #getRate
  // 计算各等级的实际抽取概率（基础概率 × 加成）。
  //
  // @param {object} additionValues - 加成属性值，如 { TMS: 5 }
  // @returns {object} { 1: p, 2: p, 3: p, total: n }
  getRate(additionValues = {}) {
    // 克隆基础概率。
    const rate = this.#clone(this.#talentRate)
    // 加成倍率（默认 1）。
    const addition = { 1: 1, 2: 1, 3: 1 }
    // 遍历加成属性值。
    Object.keys(additionValues).forEach(key => {
      // 取该属性的加成。
      const addi = this.getAddition(key, additionValues[key])
      // 累加每个等级的倍率。
      for (const grade in addi) addition[grade] += addi[grade]
    })
    // 应用倍率到基础概率。
    for (const grade in addition) rate[grade] *= addition[grade]
    // 返回调整后的概率。
    return rate
  }

  // #talentRandom
  // 随机抽取天赋池：根据等级概率生成 talentPullCount 个天赋。
  // include 会占第一格（继承天赋）。
  //
  // @param {object|null} include - 继承的天赋（占第一格）
  // @param {object} additionValues - 加成属性值
  // @returns {Array<object>} 天赋对象数组
  talentRandom(include, additionValues) {
    // 计算各等级概率。
    const rate = this.getRate(additionValues)

    // 按等级概率随机选一个等级。
    const randomGrade = () => {
      // 在 [0, total) 内取随机数。
      let randomNumber = Math.floor(this.#random() * rate.total)
      // 落入等级 3 区间。
      if ((randomNumber -= rate[3]) < 0) return 3
      // 落入等级 2 区间。
      if ((randomNumber -= rate[2]) < 0) return 2
      // 落入等级 1 区间。
      if ((randomNumber - rate[1]) < 0) return 1
      // 落入等级 0。
      return 0
    }

    // 按等级分组的候选天赋。
    const talentList = {}
    // 遍历所有天赋。
    for (const talentId in this.#talents) {
      // 取出天赋字段。
      const { id, grade, name, description, exclusive } = this.#talents[talentId]
      // exclusive 天赋不入池。
      if (!!exclusive) continue
      // 继承天赋：单独拿出占第一格。
      if (id == include) {
        // 记录为 include 对象。
        include = { grade, name, description, id }
        // 跳过。
        continue
      }
      // 按等级分组。
      if (!talentList[grade]) talentList[grade] = [{ grade, name, description, id }]
      else talentList[grade].push({ grade, name, description, id })
    }

    // 从数组中按随机下标取出一个并移除（splice 去重）。
    const pickFrom = (pool) => {
      // 该池长度。
      const len = pool.length
      // 随机下标。
      const random = Math.floor(this.#random() * len) % len
      // 取出并移除。
      return pool.splice(random, 1)[0]
    }

    // 生成结果：逐格抽取，池空即停（返回实际抽到的数量，不用 null 占位）。
    const result = []
    // 第一格放继承天赋。
    if (include) result.push(include)
    // 逐格抽取直到满额或池空。
    while (result.length < this.#talentPullCount) {
      // 随机等级。
      let grade = randomGrade()
      // 该等级池为空（或不存在）则降级。
      while (grade > 0 && (talentList[grade] || []).length == 0) grade--
      // 取该等级池（可能为空数组）。
      const pool = talentList[grade] || []
      // 所有等级池都空了 → 停止抽取。
      if (pool.length === 0) break
      // 抽出一个。
      result.push(pickFrom(pool))
    }
    // 返回结果。
    return result
  }

  // #random
  // 随机抽取 count 个非 exclusive 天赋 ID（用于名人模式）。
  //
  // @param {number} count - 抽取数量
  // @returns {Array<string>} 天赋 ID 数组
  random(count) {
    // 非 exclusive 天赋 ID 列表。
    const talents = Object.keys(this.#talents).filter(id => !this.#talents[id].exclusive)
    // 逐个随机抽取。
    return new Array(count).fill(1).map(() => talents.splice(
      // 随机下标。
      Math.floor(this.#random() * talents.length) % talents.length,
      // 移除。
      1
    )[0])
  }

  // #allocationAddition
  // 计算天赋带来的额外分配点（status 字段）。
  // 递归支持数组。
  //
  // @param {string|Array<string>} talents - 天赋 ID 或数组
  // @returns {number} 额外分配点数
  allocationAddition(talents) {
    // 数组：递归求和。
    if (Array.isArray(talents)) {
      // 累加器。
      let addition = 0
      // 逐个递归。
      for (const talent of talents) addition += this.allocationAddition(talent)
      // 返回总和。
      return addition
    }
    // 单个：取 status 字段。
    return Number(this.get(talents).status) || 0
  }

  // #do
  // 触发天赋：条件满足则返回效果。
  //
  // @param {string} talentId - 天赋 ID
  // @returns {{effect, grade, name, description}|null} 触发结果；条件不满足返回 null
  do(talentId) {
    // 取天赋字段。
    const { effect, condition, grade, name, description } = this.get(talentId)
    // 有条件且不满足 → 不触发。
    if (condition && !this.#check(condition)) return null
    // 返回触发结果。
    return { effect, grade, name, description }
  }

  // #replace
  // 替换链：把 talents 中的天赋按 replacement 规则替换。
  // 结果形如 { 原ID: 替换后ID }。
  //
  // @param {Array<string>} talents - 天赋 ID 列表
  // @returns {object} 替换映射
  replace(talents) {
    // 生成某个天赋的替换候选列表。
    // @param {string} talent - 天赋 ID
    // @param {Array<string>} talents - 当前已选列表（用于排除检查）
    // @returns {Array<[string, number]>|null} [目标ID, 权重] 列表
    const getReplaceList = (talent, talents) => {
      // 取替换配置。
      const { replacement } = this.get(talent)
      // 无配置返回 null。
      if (!replacement) return null
      // 候选列表。
      const list = []
      // 按等级替换：replacement.grade 形如 { 等级: 权重 }。
      if (replacement.grade) {
        // 遍历所有天赋。
        this.forEach(({ id, grade, exclusive }) => {
          // exclusive 不入。
          if (exclusive) return
          // 该等级不在替换配置中。
          if (!replacement.grade[grade]) return
          // 与已选冲突则跳过。
          if (this.exclude(talents, id)) return
          // 加入候选。
          list.push([id, replacement.grade[grade]])
        })
      }
      // 按具体天赋替换：replacement.talent 形如 { 目标ID: 权重 }。
      if (replacement.talent) {
        // 遍历目标。
        for (const id in replacement.talent) {
          // 与已选冲突则跳过。
          if (this.exclude(talents, id)) continue
          // 加入候选。
          list.push([id, replacement.talent[id]])
        }
      }
      // 返回候选列表。
      return list
    }

    // 随机替换函数：递归走替换链直到无可替换。
    const wr = (list) => {
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
    // 递归替换。
    const replace = (talent, talents) => {
      // 取候选列表。
      const replaceList = getReplaceList(talent, talents)
      // 无可替换则返回自身。
      if (!replaceList) return talent
      // 随机选一个目标。
      const rand = wr(replaceList)
      // 递归继续（替换结果也可能被替换）。
      return replace(rand, talents.concat(rand))
    }

    // 克隆输入列表（避免修改调用方数组）。
    const newTalents = this.#clone(talents)
    // 结果映射。
    const result = {}
    // 遍历每个天赋。
    for (const talent of talents) {
      // 求替换结果。
      const replaceId = replace(talent, newTalents)
      // 若被替换。
      if (replaceId != talent) {
        // 记录映射。
        result[talent] = replaceId
        // 替换结果加入已选列表（防重复替换链）。
        newTalents.push(replaceId)
      }
    }
    // 返回映射。
    return result
  }

  // #forEach
  // 遍历所有天赋（深拷贝副本）。
  //
  // @param {(talent: object, id: string) => void} callback - 回调
  // @returns {void}
  forEach(callback) {
    // 非函数直接返回。
    if (typeof callback !== 'function') return
    // 遍历。
    for (const id in this.#talents) callback(this.#clone(this.#talents[id]), id)
  }
}

export default Talent
