/**
 * property 属性系统模块
 *
 * 从原版 lifeRestart-old/src/modules/property.js 移植，按新项目约束做了注入化改造：
 *   1. 去掉 #system 依赖：构造函数注入 { clone, storage }，不再依赖 Life 实例。
 *   2. localStorage 硬编码 → 注入式 storage 适配器（默认内存实现，浏览器可传 localStorage）。
 *   3. 字符串 ID 约束：initial() 不再把天赋/事件 ID 转 Number，原样保留字符串。
 *   4. change() 数组删除不再用 value<0 负值标记，改为显式前缀 '-' 标记。
 *   5. 移除 extractMaxTriggers 相关逻辑（max_triggers 由数据层显式提供）。
 *
 * 公开 API（供 Life 编排器与 gameAPI 调用）：
 *   TYPES / SPECIAL / initial / config / restart / restartLastStep
 *   get / set / change / effect / hookSpecial / judge / isEnd
 *   ageNext / getAgeData / getPropertys / achieve / lsget / lsset
 */

// 导入 util 工具函数（克隆、min/max 等）。
import { clone, min, max, sum, listRandom } from '../functions/util.js'

// #defaultStorage
// 默认内存 storage 适配器。
// Node/CLI/测试环境无 localStorage，用对象模拟 getItem/setItem 接口。
// 浏览器环境可通过构造注入传入真实 localStorage。
const defaultStorage = {
  // 内存数据。
  _data: {},
  // 读取：存在则返回，否则返回 null（与 localStorage 一致）。
  getItem(key) {
    return key in this._data ? this._data[key] : null
  },
  // 写入：存为字符串。
  setItem(key, value) {
    this._data[key] = String(value)
  },
}

class Property {
  // 构造函数：注入依赖，替代原版的 #system。
  // @param {object} deps
  // @param {Function} [deps.clone]  - 深拷贝函数，默认 util.clone
  // @param {object}   [deps.storage] - storage 适配器，默认内存实现
  // @param {() => number} [deps.random] - 随机源，默认 Math.random
  constructor({ clone: cloneFn = clone, storage = defaultStorage, random = Math.random } = {}) {
    // 保存注入的克隆函数。
    this.#clone = cloneFn
    // 保存注入的 storage。
    this.#storage = storage
    // 保存注入的随机源。
    this.#random = random
  }

  // #TYPES
  // 属性类型常量。
  // 分为四类：
  //   本局（AGE/CHR/.../EVT/TMS）—— 直接存储
  //   派生（LAGE/HAGE/SUM）       —— get() 时实时计算
  //   统计（ATLT/CTLT/TTLT/比率） —— 跨局累计，走 storage
  //   特殊（EXT/RDM）             —— 特殊逻辑
  TYPES = {
    // 本局属性。
    AGE: 'AGE', // 年龄
    CHR: 'CHR', // 颜值
    INT: 'INT', // 智力
    STR: 'STR', // 体质
    MNY: 'MNY', // 家境
    SPR: 'SPR', // 快乐
    LIF: 'LIF', // 生命
    TLT: 'TLT', // 已获天赋
    EVT: 'EVT', // 已触事件
    TMS: 'TMS', // 重开次数

    // 派生属性（Auto calc）。
    LAGE: 'LAGE', // 最低年龄
    HAGE: 'HAGE', // 最高年龄
    LCHR: 'LCHR', // 最低颜值
    HCHR: 'HCHR', // 最高颜值
    LINT: 'LINT', // 最低智力
    HINT: 'HINT', // 最高智力
    LSTR: 'LSTR', // 最低体质
    HSTR: 'HSTR', // 最高体质
    LMNY: 'LMNY', // 最低家境
    HMNY: 'HMNY', // 最高家境
    LSPR: 'LSPR', // 最低快乐
    HSPR: 'HSPR', // 最高快乐

    SUM: 'SUM', // 总评

    EXT: 'EXT', // 继承天赋

    // 总计（Achievement Total）。
    ATLT: 'ATLT', // 拥有过的天赋
    AEVT: 'AEVT', // 触发过的事件
    ACHV: 'ACHV', // 达成的成就

    // 计数（Count）。
    CTLT: 'CTLT', // 天赋选择数
    CEVT: 'CEVT', // 事件收集数
    CACHV: 'CACHV', // 成就达成数

    // 总数（Total）。
    TTLT: 'TTLT', // 总天赋数
    TEVT: 'TEVT', // 总事件数
    TACHV: 'TACHV', // 总成就数

    // 比率（Rate）。
    REVT: 'REVT', // 事件收集率
    RTLT: 'RTLT', // 天赋选择率
    RACHV: 'RACHV', // 成就达成率

    // 特殊。
    RDM: 'RDM', // 随机属性
  }

  // #SPECIAL
  // 特殊类型映射。
  SPECIAL = {
    RDM: [ // 随机属性：从这五个中随机选一个。
      this.TYPES.CHR,
      this.TYPES.INT,
      this.TYPES.STR,
      this.TYPES.MNY,
      this.TYPES.SPR,
    ],
  }

  // 私有字段。
  #clone        // 克隆函数
  #storage      // storage 适配器
  #random       // 随机源
  #ageData      // 年龄数据（initial 注入）
  #total        // 各类型总数（initial 注入）
  #data = {}    // 本局属性数据
  #judge        // 评价配置（config 注入）

  // #initial
  // 初始化年龄数据与总数。
  // age 数据格式：{ 年龄: { event: [...], talent: [...] } }
  // event 条目可能带概率权重："10069*0.03" 表示事件 10069 权重 0.03。
  // 原版在此把 ID 转 Number，新项目改为保留字符串 ID。
  //
  // @param {object} params
  // @param {object} params.age   - 年龄数据
  // @param {object} params.total - 各类型总数 {TACHV, TEVT, TTLT}
  // @returns {void}
  initial({ age, total }) {
    // 保存年龄数据引用。
    this.#ageData = age
    // 遍历每个年龄的数据。
    for (const a in age) {
      // 取出该年龄的事件与天赋列表。
      let { event, talent } = age[a]
      // 事件：非数组时按逗号拆分（支持字符串形式）。
      if (!Array.isArray(event)) event = event?.split(',') || []
      // 解析每条事件：可能带 *权重 后缀。
      event = event.map(v => {
        // 按 * 拆分成 [id, weight]。
        const value = `${v}`.split('*')
        // ID 原样保留（字符串）。
        const id = value[0]
        // 权重：第二个元素转数字，缺失时默认 1。
        const weight = value.length > 1 ? Number(value[1]) : 1
        // 返回 [id, weight] 对。
        return [id, weight]
      })
      // 天赋：非数组时按逗号拆分。
      if (!Array.isArray(talent)) talent = talent?.split(',') || []
      // 天赋 ID 原样保留字符串（原版 Number(v) 已移除）。
      talent = talent.map(v => `${v}`)
      // 写回处理后的数据。
      age[a] = { event, talent }
    }
    // 保存总数。
    this.#total = total
  }

  // #config
  // 注入评价配置。judge 形如 { CHR: [[min, grade, judge], ...], ... }。
  //
  // @param {object} params
  // @param {object} [params.judge] - 各属性评价分档
  // @returns {void}
  config({ judge = {} } = {}) {
    // 保存评价配置。
    this.#judge = judge
  }

  // #restart
  // 开始新一局：重置本局数据并应用初始分配。
  // data 是玩家分配后的初始属性（含 TLT 天赋）。
  //
  // @param {object} data - 初始属性
  // @returns {void}
  restart(data) {
    // 初始化本局数据：标量属性为 0/1，数组为空，派生低/高为 ±Infinity。
    this.#data = {
      // 年龄从 0 前开始（-1 表示出生前）。
      [this.TYPES.AGE]: -1,
      // 五项基础属性从 0 开始。
      [this.TYPES.CHR]: 0,
      [this.TYPES.INT]: 0,
      [this.TYPES.STR]: 0,
      [this.TYPES.MNY]: 0,
      [this.TYPES.SPR]: 0,
      // 生命默认 1（存活）。
      [this.TYPES.LIF]: 1,
      // 天赋/事件列表为空。
      [this.TYPES.TLT]: [],
      [this.TYPES.EVT]: [],
      // 派生低值从正无穷开始（取 min 才有意义）。
      [this.TYPES.LAGE]: Infinity,
      [this.TYPES.LCHR]: Infinity,
      [this.TYPES.LINT]: Infinity,
      [this.TYPES.LSTR]: Infinity,
      [this.TYPES.LSPR]: Infinity,
      [this.TYPES.LMNY]: Infinity,
      // 派生高值从负无穷开始（取 max 才有意义）。
      [this.TYPES.HAGE]: -Infinity,
      [this.TYPES.HCHR]: -Infinity,
      [this.TYPES.HINT]: -Infinity,
      [this.TYPES.HSTR]: -Infinity,
      [this.TYPES.HMNY]: -Infinity,
      [this.TYPES.HSPR]: -Infinity,
    }
    // 逐项应用初始分配。
    for (const key in data) this.change(key, data[key])
  }

  // #restartLastStep
  // 记录开局时刻的派生高/低值（开局即视为"当前最高/最低"）。
  // 让开局属性直接成为 HXX/LXX 的初始基准。
  //
  // @returns {void}
  restartLastStep() {
    // 记录五个基础属性的当前值到 L/H 派生值。
    this.#data[this.TYPES.LAGE] = this.get(this.TYPES.AGE)
    this.#data[this.TYPES.LCHR] = this.get(this.TYPES.CHR)
    this.#data[this.TYPES.LINT] = this.get(this.TYPES.INT)
    this.#data[this.TYPES.LSTR] = this.get(this.TYPES.STR)
    this.#data[this.TYPES.LSPR] = this.get(this.TYPES.SPR)
    this.#data[this.TYPES.LMNY] = this.get(this.TYPES.MNY)
    this.#data[this.TYPES.HAGE] = this.get(this.TYPES.AGE)
    this.#data[this.TYPES.HCHR] = this.get(this.TYPES.CHR)
    this.#data[this.TYPES.HINT] = this.get(this.TYPES.INT)
    this.#data[this.TYPES.HSTR] = this.get(this.TYPES.STR)
    this.#data[this.TYPES.HMNY] = this.get(this.TYPES.MNY)
    this.#data[this.TYPES.HSPR] = this.get(this.TYPES.SPR)
  }

  // #get
  // 读取属性值。这是属性系统的核心分发器。
  // 处理四类属性：本局直接读、派生实时算、统计走 storage、特殊逻辑。
  //
  // @param {string} prop - 属性类型（TYPES 中的键）
  // @returns {*} 属性值
  get(prop) {
    // 按属性类型分发。
    switch (prop) {
      // 本局标量/数组属性：直接返回深拷贝（防止外部篡改内部数据）。
      case this.TYPES.AGE:
      case this.TYPES.CHR:
      case this.TYPES.INT:
      case this.TYPES.STR:
      case this.TYPES.MNY:
      case this.TYPES.SPR:
      case this.TYPES.LIF:
      case this.TYPES.TLT:
      case this.TYPES.EVT:
        // 返回深拷贝。
        return this.#clone(this.#data[prop])
      // 派生低值：min(存储值, 对应基础属性的当前值)。
      // 例如 LCHR = min(LCHR, CHR)。
      case this.TYPES.LAGE:
      case this.TYPES.LCHR:
      case this.TYPES.LINT:
      case this.TYPES.LSTR:
      case this.TYPES.LMNY:
      case this.TYPES.LSPR:
        return min(
          // 存储的低值。
          this.#data[prop],
          // 当前基础值（经由 fallback 映射）。
          this.get(this.fallback(prop))
        )
      // 派生高值：max(存储值, 对应基础属性的当前值)。
      case this.TYPES.HAGE:
      case this.TYPES.HCHR:
      case this.TYPES.HINT:
      case this.TYPES.HSTR:
      case this.TYPES.HMNY:
      case this.TYPES.HSPR:
        return max(
          // 存储的高值。
          this.#data[prop],
          // 当前基础值。
          this.get(this.fallback(prop))
        )
      // SUM 总评：五项最高属性 ×2 + 最高年龄 /2，向下取整。
      case this.TYPES.SUM:
        // 取各派生最高值。
        const HAGE = this.get(this.TYPES.HAGE)
        const HCHR = this.get(this.TYPES.HCHR)
        const HINT = this.get(this.TYPES.HINT)
        const HSTR = this.get(this.TYPES.HSTR)
        const HMNY = this.get(this.TYPES.HMNY)
        const HSPR = this.get(this.TYPES.HSPR)
        // 总评公式。
        return Math.floor(sum(HCHR, HINT, HSTR, HMNY, HSPR) * 2 + HAGE / 2)
      // TMS 重开次数：走 storage。
      case this.TYPES.TMS:
        // 读取 storage，缺失为 0。
        return this.lsget('times') || 0
      // EXT 继承天赋：走 storage。
      case this.TYPES.EXT:
        // 读取 storage，缺失为 null。
        return this.lsget('extendTalent') || null
      // ATLT/AEVT/ACHV 累计：走 storage，缺失为空数组。
      case this.TYPES.ATLT:
      case this.TYPES.AEVT:
      case this.TYPES.ACHV:
        return this.lsget(prop) || []
      // CTLT/CEVT/CACHV 计数：对应累计数组的长度。
      case this.TYPES.CTLT:
      case this.TYPES.CEVT:
      case this.TYPES.CACHV:
        return this.get(this.fallback(prop)).length
      // TTLT/TEVT/TACHV 总数：从 initial 注入的 total 读取。
      case this.TYPES.TTLT:
      case this.TYPES.TEVT:
      case this.TYPES.TACHV:
        return this.#total[prop]
      // RTLT/REVT/RACHV 比率：计数 / 总数。
      case this.TYPES.RTLT:
      case this.TYPES.REVT:
      case this.TYPES.RACHV:
        // fallback 返回 [计数属性, 总数属性]。
        const fb = this.fallback(prop)
        // 计数除以总数。
        return this.get(fb[0]) / this.get(fb[1])
      // 未知属性：返回 0。
      default:
        return 0
    }
  }

  // #fallback
  // 派生属性的回退映射：告诉我某派生属性基于哪个基础属性/哪对属性。
  //
  // @param {string} prop - 属性类型
  // @returns {string|string[]} 基础属性名；比率类返回 [计数, 总数]
  fallback(prop) {
    // 按属性分发。
    switch (prop) {
      // 年龄高低 → AGE。
      case this.TYPES.LAGE:
      case this.TYPES.HAGE: return this.TYPES.AGE
      // 颜值高低 → CHR。
      case this.TYPES.LCHR:
      case this.TYPES.HCHR: return this.TYPES.CHR
      // 智力高低 → INT。
      case this.TYPES.LINT:
      case this.TYPES.HINT: return this.TYPES.INT
      // 体质高低 → STR。
      case this.TYPES.LSTR:
      case this.TYPES.HSTR: return this.TYPES.STR
      // 家境外高 → MNY。
      case this.TYPES.LMNY:
      case this.TYPES.HMNY: return this.TYPES.MNY
      // 快乐高值 → SPR。
      case this.TYPES.LSPR:
      case this.TYPES.HSPR: return this.TYPES.SPR
      // 计数 → 累计。
      case this.TYPES.CTLT: return this.TYPES.ATLT
      case this.TYPES.CEVT: return this.TYPES.AEVT
      case this.TYPES.CACHV: return this.TYPES.ACHV
      // LIF 自身。
      case this.TYPES.LIF: return this.TYPES.LIF
      // 比率 → [计数, 总数]。
      case this.TYPES.RTLT: return [this.TYPES.CTLT, this.TYPES.TTLT]
      case this.TYPES.REVT: return [this.TYPES.CEVT, this.TYPES.TEVT]
      case this.TYPES.RACHV: return [this.TYPES.CACHV, this.TYPES.TACHV]
      // 默认无回退。
      default: return
    }
  }

  // #set
  // 覆盖设置属性值（本局属性走 #data + 派生更新，storage 属性直接写）。
  //
  // @param {string} prop - 属性类型
  // @param {*} value - 新值
  // @returns {void}
  set(prop, value) {
    // 按属性分发。
    switch (prop) {
      // 本局属性：克隆赋值 + 派生高/低更新 + 累计记录。
      case this.TYPES.AGE:
      case this.TYPES.CHR:
      case this.TYPES.INT:
      case this.TYPES.STR:
      case this.TYPES.MNY:
      case this.TYPES.SPR:
      case this.TYPES.LIF:
      case this.TYPES.TLT:
      case this.TYPES.EVT:
        // 克隆赋值，并用 hl() 更新派生高/低值。
        this.hl(prop, this.#data[prop] = this.#clone(value))
        // 记录累计（天赋/事件进 ATLT/AEVT）。
        this.achieve(prop, value)
        // 完成。
        return
      // TMS：写 storage（重开次数）。
      case this.TYPES.TMS:
        // 转整数，非数字为 0。
        this.lsset('times', parseInt(value) || 0)
        return
      // EXT：写 storage（继承天赋）。
      case this.TYPES.EXT:
        this.lsset('extendTalent', value)
        return
      // 其余（只读/计算）属性：忽略。
      default:
        return
    }
  }

  // #getPropertys
  // 返回玩家可见的六个基础属性快照（用于前端属性面板）。
  //
  // @returns {object} { AGE, CHR, INT, STR, MNY, SPR }
  getPropertys() {
    // 克隆打包六个属性。
    return this.#clone({
      [this.TYPES.AGE]: this.get(this.TYPES.AGE),
      [this.TYPES.CHR]: this.get(this.TYPES.CHR),
      [this.TYPES.INT]: this.get(this.TYPES.INT),
      [this.TYPES.STR]: this.get(this.TYPES.STR),
      [this.TYPES.MNY]: this.get(this.TYPES.MNY),
      [this.TYPES.SPR]: this.get(this.TYPES.SPR),
    })
  }

  // #change
  // 增量修改属性值（游戏中的加减变化都走这里）。
  // 数组属性（TLT/EVT）：
  //   正数/正常 ID → 添加（去重）
  //   负数（数字属性）或 '-' 前缀（字符串 ID）→ 移除
  //
  // @param {string} prop - 属性类型
  // @param {*} value - 增量或 ID
  // @returns {void}
  change(prop, value) {
    // 数组值：递归逐项处理。
    if (Array.isArray(value)) {
      // 对每个元素递归调用自身。
      for (const v of value) this.change(prop, v)
      // 全部处理完。
      return
    }
    // 按属性分发。
    switch (prop) {
      // 标量属性：数字累加。
      case this.TYPES.AGE:
      case this.TYPES.CHR:
      case this.TYPES.INT:
      case this.TYPES.STR:
      case this.TYPES.MNY:
      case this.TYPES.SPR:
      case this.TYPES.LIF:
        // 累加并更新派生高/低值。
        this.hl(prop, this.#data[prop] += Number(value))
        return
      // 数组属性：添加/移除 ID。
      case this.TYPES.TLT:
      case this.TYPES.EVT:
        // 取当前数组（引用，直接操作）。
        const v = this.#data[prop]
        // 字符串化 ID 便于统一判断。
        const id = `${value}`
        // 移除标记：数字负值或 '-' 前缀。
        const isRemove = (typeof value === 'number' && value < 0) || id.startsWith('-')
        // 需要移除的 ID。
        const targetId = isRemove ? id.replace(/^-/, '') : id
        // 移除：找到并删除。
        if (isRemove) {
          // 定位下标。
          const index = v.indexOf(targetId)
          // 存在则删除。
          if (index !== -1) v.splice(index, 1)
        } else {
          // 添加：去重。
          if (!v.includes(id)) v.push(id)
        }
        // 记录累计。
        this.achieve(prop, value)
        return
      // TMS：走 set（storage）。
      case this.TYPES.TMS:
        this.set(prop, this.get(prop) + parseInt(value))
        return
      // 其余忽略。
      default:
        return
    }
  }

  // #hookSpecial
  // 特殊属性钩子：把 RDM 映射为随机的基础属性。
  //
  // @param {string} prop - 属性类型
  // @returns {string} 映射后的真实属性
  hookSpecial(prop) {
    // RDM：从候选里随机取一个。
    if (prop === this.TYPES.RDM) {
      // 注入的随机源。
      const random = this.#random
      return listRandom(this.SPECIAL.RDM, random)
    }
    // 其余原样返回。
    return prop
  }

  // #effect
  // 批量应用效果（一组属性增量）。
  // effects 形如 { CHR: 10, RDM: -1, ... }。
  //
  // @param {object} effects - 效果对象
  // @returns {void}
  effect(effects) {
    // 遍历每个属性增量。
    for (const prop in effects) {
      // RDM 等特殊属性先映射，再累加。
      this.change(this.hookSpecial(prop), Number(effects[prop]))
    }
  }

  // #judge
  // 对某个属性做分档评价，返回 { prop, value, judge, grade, progress }。
  // judge 配置形如 { CHR: [[min, grade, judge], ...] }，从高档到低档。
  //
  // @param {string} prop - 属性类型
  // @returns {object|undefined} 评价结果；未配置返回 undefined
  judge(prop) {
    // 取当前值。
    const value = this.get(prop)
    // 取该属性的分档配置。
    const d = this.#judge[prop]
    // 无配置直接返回。
    if (!d) return undefined
    // 分档数量。
    let length = d.length
    // 进度：值裁剪到 [0,10] 后 /10。
    const progress = () => Math.max(Math.min(value, 10), 0) / 10
    // 从高到低遍历分档。
    while (length--) {
      // 取一档：[min, grade, judge]。
      const [minValue, grade, judge] = d[length]
      // 命中条件：最后一档 或 无下限 或 值达到下限。
      if (!length || minValue === undefined || value >= minValue) {
        // 返回评价结果。
        return { prop, value, judge, grade, progress: progress() }
      }
    }
  }

  // #isEnd
  // 生命是否结束。
  //
  // @returns {boolean} LIF < 1
  isEnd() {
    // 生命值小于 1 即结束。
    return this.get(this.TYPES.LIF) < 1
  }

  // #ageNext
  // 年龄+1，返回该年龄的事件/天赋列表。
  //
  // @returns {{age: number, event: Array, talent: Array}}
  ageNext() {
    // 年龄自增。
    this.change(this.TYPES.AGE, 1)
    // 读取新年龄。
    const age = this.get(this.TYPES.AGE)
    // 读取该年龄数据。
    const { event, talent } = this.getAgeData(age)
    // 返回。
    return { age, event, talent }
  }

  // #getAgeData
  // 读取指定年龄的事件/天赋数据（深拷贝）。
  //
  // @param {number} age - 年龄
  // @returns {{event: Array, talent: Array}}
  getAgeData(age) {
    // 深拷贝该年龄的数据。
    return this.#clone(this.#ageData[age])
  }

  // #hl
  // high/low：更新某个基础属性对应的派生高/低值。
  //
  // @param {string} prop - 基础属性（AGE/CHR/INT/STR/MNY/SPR）
  // @param {number} value - 当前值
  // @returns {void}
  hl(prop, value) {
    // 各属性对应的 [低值, 高值] 键。
    let keys
    // 映射基础属性 → 派生键对。
    switch (prop) {
      case this.TYPES.AGE: keys = [this.TYPES.LAGE, this.TYPES.HAGE]; break
      case this.TYPES.CHR: keys = [this.TYPES.LCHR, this.TYPES.HCHR]; break
      case this.TYPES.INT: keys = [this.TYPES.LINT, this.TYPES.HINT]; break
      case this.TYPES.STR: keys = [this.TYPES.LSTR, this.TYPES.HSTR]; break
      case this.TYPES.MNY: keys = [this.TYPES.LMNY, this.TYPES.HMNY]; break
      case this.TYPES.SPR: keys = [this.TYPES.LSPR, this.TYPES.HSPR]; break
      // 其余属性无派生。
      default: return
    }
    // 解构出低值键和高值键。
    const [l, h] = keys
    // 低值取 min。
    this.#data[l] = min(this.#data[l], value)
    // 高值取 max。
    this.#data[h] = max(this.#data[h], value)
  }

  // #achieve
  // 记录累计数据：
  //   ACHV：追加 [id, 时间戳] 到成就列表。
  //   TLT/EVT：把新 ID 合并进 ATLT/AEVT（去重）。
  //
  // @param {string} prop - 属性类型
  // @param {*} newData - 新数据
  // @returns {void}
  achieve(prop, newData) {
    // 按属性分发。
    switch (prop) {
      // 成就：追加 [id, 时间戳]。
      case this.TYPES.ACHV:
        // 读已有列表。
        const lastData = this.lsget(prop)
        // 追加新条目并写回。
        this.lsset(prop, (lastData || []).concat([[newData, Date.now()]]))
        return
      // 天赋 → ATLT。
      case this.TYPES.TLT: {
        // 记录到 ATLT 的键。
        const key = this.TYPES.ATLT
        // 读已有 + 合并新数据 + 去重 + 写回。
        this.#mergeSet(key, newData)
        return
      }
      // 事件 → AEVT。
      case this.TYPES.EVT: {
        // 记录到 AEVT 的键。
        const key = this.TYPES.AEVT
        // 合并写回。
        this.#mergeSet(key, newData)
        return
      }
      // 其余忽略。
      default:
        return
    }
  }

  // #mergeSet
  // 把新 ID 合并进 storage 中的累计集合（去重）。
  //
  // @param {string} key - storage 键（ATLT/AEVT）
  // @param {*} newData - 新 ID（单个或数组）
  // @returns {void}
  #mergeSet(key, newData) {
    // 读已有列表。
    const lastData = this.lsget(key) || []
    // 合并并去重后写回。
    this.lsset(
      key,
      Array.from(new Set(lastData.concat(newData || []).flat()))
    )
  }

  // #lsget
  // 从 storage 读取并 JSON.parse。
  //
  // @param {string} key - 键
  // @returns {*} 解析后的值；缺失返回 undefined
  lsget(key) {
    // 读取原始字符串。
    const data = this.#storage.getItem(key)
    // null/undefined 字符串表示缺失。
    if (data === null || data === 'undefined') return undefined
    // JSON 解析返回。
    return JSON.parse(data)
  }

  // #lsset
  // 序列化后写入 storage。
  //
  // @param {string} key - 键
  // @param {*} value - 值
  // @returns {void}
  lsset(key, value) {
    // JSON 序列化后写入。
    this.#storage.setItem(key, JSON.stringify(value))
  }
}

export default Property
