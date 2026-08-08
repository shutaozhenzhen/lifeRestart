/**
 * property 属性系统模块（param 注册表驱动版）
 *
 * 从原版 lifeRestart-old/src/modules/property.js 移植，按新项目约束做了注入化改造：
 *   1. 去掉 #system 依赖：构造函数注入 { clone, storage }，不再依赖 Life 实例。
 *   2. localStorage 硬编码 → 注入式 storage 适配器（默认内存实现，浏览器可传 localStorage）。
 *   3. 字符串 ID 约束：initial() 不再把天赋/事件 ID 转 Number，原样保留字符串。
 *   4. change() 数组删除不再用 value<0 负值标记，改为显式前缀 '-' 标记。
 *   5. 移除 extractMaxTriggers 相关逻辑（max_triggers 由数据层显式提供）。
 *   6. **参数即配置**：get/set/change/getAll 委托给 param 注册表
 *      （src/params/param-registry.js + params.js），参数种类/类型/来源全部由 JSON 定义。
 *
 * 公开 API（供 Life 编排器与 gameAPI 调用）：
 *   TYPES / SPECIAL / initial / config / restart / restartLastStep
 *   get / set / change / effect / hookSpecial / judge / isEnd
 *   ageNext / getAgeData / getPropertys / achieve / lsget / lsset / getAll
 */

// 导入 util 工具函数（克隆、listRandom）。
import { clone, listRandom } from '../functions/util.js'
// param 注册表。
import { createParamRegistry } from '../params/param-registry.js'
// 内置参数定义。
import { BUILTIN_PARAMS } from '../params/params.js'

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
  // @param {object}   [deps.params]  - 自定义参数定义（合并进内置）
  constructor({ clone: cloneFn = clone, storage = defaultStorage, random = Math.random, params } = {}) {
    // 保存注入的克隆函数。
    this.#clone = cloneFn
    // 保存注入的 storage。
    this.#storage = storage
    // 保存注入的随机源。
    this.#random = random
    // 创建 param 注册表（注入 clone 供数组参数深拷贝）。
    this.#registry = createParamRegistry({ storage, cloneFn: cloneFn, random })
    // 注册内置参数。
    this.#registry.defineAll(BUILTIN_PARAMS)
    // 合并自定义参数（Mod/运行时扩展）。
    if (params) this.#registry.defineAll(params)
  }

  // #TYPES
  // 属性类型常量（由注册表参数名派生，保持向后兼容）。
  // 供 Life/外部模块引用，实际读写走注册表。
  get TYPES() {
    // 从注册表参数名生成 { NAME: 'NAME' }。
    const types = {}
    // 逐个。
    for (const name of this.#registry.names) types[name] = name
    // 返回。
    return types
  }

  // #SPECIAL
  // 特殊类型映射。
  SPECIAL = {
    RDM: [ // 随机属性：从这五个中随机选一个。
      'CHR',
      'INT',
      'STR',
      'MNY',
      'SPR',
    ],
  }

  // 私有字段。
  #clone        // 克隆函数
  #storage      // storage 适配器
  #random       // 随机源
  #registry     // param 注册表
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
      // 幂等保护：event 已是解析后的 [id, weight] 二维数组时跳过。
      if (Array.isArray(event) && Array.isArray(event[0])) {
        // 已解析，保留原样。
        continue
      }
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
    // 保存总数并注入注册表。
    this.#total = total
    this.#registry.setTotal(total)
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
      AGE: -1,
      // 五项基础属性从 0 开始。
      CHR: 0,
      INT: 0,
      STR: 0,
      MNY: 0,
      SPR: 0,
      // 生命默认 1（存活）。
      LIF: 1,
      // 天赋/事件列表为空。
      TLT: [],
      EVT: [],
      // 派生低值从正无穷开始（取 min 才有意义）。
      LAGE: Infinity,
      LCHR: Infinity,
      LINT: Infinity,
      LSTR: Infinity,
      LSPR: Infinity,
      LMNY: Infinity,
      // 派生高值从负无穷开始（取 max 才有意义）。
      HAGE: -Infinity,
      HCHR: -Infinity,
      HINT: -Infinity,
      HSTR: -Infinity,
      HMNY: -Infinity,
      HSPR: -Infinity,
    }
    // 注册表引用本局 data（local 参数读写它）。
    this.#registry.reset(this.#data)
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
    this.#data.LAGE = this.get('AGE')
    this.#data.LCHR = this.get('CHR')
    this.#data.LINT = this.get('INT')
    this.#data.LSTR = this.get('STR')
    this.#data.LSPR = this.get('SPR')
    this.#data.LMNY = this.get('MNY')
    this.#data.HAGE = this.get('AGE')
    this.#data.HCHR = this.get('CHR')
    this.#data.HINT = this.get('INT')
    this.#data.HSTR = this.get('STR')
    this.#data.HMNY = this.get('MNY')
    this.#data.HSPR = this.get('SPR')
  }

  // #get
  // 读取属性值。委托 param 注册表。
  //
  // @param {string} prop - 属性类型（TYPES 中的键）
  // @returns {*} 属性值
  get(prop) {
    // 委托注册表。
    return this.#registry.get(prop)
  }

  // #getPropertys
  // 返回玩家可见的六个基础属性快照（用于前端属性面板）。
  //
  // @returns {object} { AGE, CHR, INT, STR, MNY, SPR }
  getPropertys() {
    // 克隆打包六个属性。
    return this.#clone({
      AGE: this.get('AGE'),
      CHR: this.get('CHR'),
      INT: this.get('INT'),
      STR: this.get('STR'),
      MNY: this.get('MNY'),
      SPR: this.get('SPR'),
    })
  }

  // #getAll
  // 返回全部本局属性快照（供 condition 引擎作为 params 求值）。
  // 委托注册表展开全部参数（含派生/统计/特殊，RDM 等 special 跳过）。
  //
  // @returns {object} 全部属性对象
  getAll() {
    // 委托注册表。
    return this.#registry.getAll()
  }

  // #set
  // 覆盖设置属性值。委托 param 注册表。
  // 对 TLT/EVT 等累计参数，set 后触发 achieve（记录 ATLT/AEVT），与原版一致。
  //
  // @param {string} prop - 属性类型
  // @param {*} value - 新值
  // @returns {void}
  set(prop, value) {
    // 委托注册表。
    this.#registry.set(prop, value)
    // 数组累计参数：set 后触发 achieve。
    if (prop === 'TLT' || prop === 'EVT') {
      // 记录累计（数组逐项）。
      this.achieve(prop, value)
    }
  }

  // #change
  // 增量修改属性值（游戏中的加减变化都走这里）。
  // 数组属性（TLT/EVT）：添加/移除 ID（'-' 前缀或负数移除）。
  // 委托 param 注册表（数组参数的自定义 change 处理添加/移除语义）。
  //
  // @param {string} prop - 属性类型
  // @param {*} value - 增量或 ID
  // @returns {void}
  change(prop, value) {
    // 委托注册表。
    this.#registry.change(prop, value)
  }

  // #hookSpecial
  // 特殊属性钩子：把 RDM 映射为随机的基础属性。
  //
  // @param {string} prop - 属性类型
  // @returns {string} 映射后的真实属性
  hookSpecial(prop) {
    // RDM：从候选里随机取一个。
    if (prop === 'RDM') {
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
    const d = this.#judge && this.#judge[prop]
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
    return this.get('LIF') < 1
  }

  // #ageNext
  // 年龄+1，返回该年龄的事件/天赋列表。
  // 缺失的年龄（age 数据未覆盖）返回空列表，游戏继续推进。
  //
  // @returns {{age: number, event: Array, talent: Array}}
  ageNext() {
    // 年龄自增。
    this.change('AGE', 1)
    // 读取新年龄。
    const age = this.get('AGE')
    // 读取该年龄数据（缺失返回空）。
    const data = this.getAgeData(age)
    // 事件列表（缺失年龄用空数组）。
    const event = data ? data.event : []
    // 天赋列表（缺失年龄用空数组）。
    const talent = data ? data.talent : []
    // 返回。
    return { age, event, talent }
  }

  // #getAgeData
  // 读取指定年龄的事件/天赋数据（深拷贝）。
  // 缺失的年龄返回 undefined（调用方需自行处理）。
  //
  // @param {number} age - 年龄
  // @returns {{event: Array, talent: Array}|undefined} 该年龄数据；缺失返回 undefined
  getAgeData(age) {
    // 深拷贝该年龄的数据。
    return this.#clone(this.#ageData[age])
  }

  // #achieve
  // 记录累计数据（委托注册表参数 change）：
  //   ACHV：追加 [id, 时间戳] 到成就列表。
  //   TLT/EVT：把新 ID 合并进 ATLT/AEVT（去重）——由注册表 TLT/EVT 的 change 联动。
  //
  // @param {string} prop - 属性类型
  // @param {*} newData - 新数据
  // @returns {void}
  achieve(prop, newData) {
    // 委托注册表（ACHV/ATLT/AEVT 的 change 处理累计语义）。
    this.#registry.change(prop, newData)
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
