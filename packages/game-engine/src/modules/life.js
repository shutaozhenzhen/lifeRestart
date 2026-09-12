/**
 * Life 游戏主控制器（编排器）
 *
 * 从原版 lifeRestart-old/src/modules/life.js 移植，整合全部模块：
 *   Property / Talent / Event / Achievement / Character
 *
 * 新项目改造：
 *   1. 不再持有全局 #system：模块改为构造注入，Life 负责组装。
 *   2. 条件引擎改为新语法 check()，模块共享同一属性快照。
 *   3. maxTriggers 从天赋数据显式读取（原版用 extractMaxTriggers 计算）。
 *   4. 事件总线 $$event → 注入 emit(tag, data)。
 *
 * 公开 API（供前端/CLI/gameAPI 调用）：
 *   initial / config / remake / start / next / summary / statistics / achievements
 *   request / check / clone / random / talentRandom / characterRandom / format
 */

// 导入模块与工具。
import Property from './property.js'
import Talent from './talent.js'
import Event from './event.js'
import Achievement from './achievement.js'
import Character from './character.js'
import { clone as cloneUtil, weightRandom } from '../functions/util.js'
import { check as checkCondition } from '../condition/index.js'
import { SILENT_LOGGER } from '../functions/logger.js'

class Life {
  // 构造函数：注入依赖。
  // @param {object} deps
  // @param {object} [deps.data] - 数据 { age, talents, events, achievements, characters }
  // @param {() => number} [deps.random] - 随机源
  // @param {object} [deps.storage] - storage 适配器
  // @param {() => number} [deps.now] - 时间戳函数
  // @param {(tag: string, data: *) => void} [deps.emit] - 事件总线（成就通知等业务事件）
  // @param {object} [deps.hooks] - Mod 钩子总线（{ emit }），AI Mod 等通过它介入游戏流程
  // @param {object} [deps.logger] - 日志器（functions/logger.js 的 createLogger 产物）；缺省全静默
  constructor({ data, random = Math.random, storage, now, emit = () => {}, hooks, logger } = {}) {
    // 保存数据。
    this.#data = data || {}
    // 保存随机源。
    this.#random = random
    // 保存事件总线。
    this.#emit = emit
    // 保存 Mod 钩子总线（缺省空操作）。
    this.#hooks = hooks || { emit: () => [], emitSync: () => [] }
    // 保存日志器（缺省静默，不干扰测试/无配置场景）。
    this.#log = logger || SILENT_LOGGER
    // 子模块日志器：继承级别/输出目标，追加模块前缀。
    const propertyLog = this.#log.child('property')
    const talentLog = this.#log.child('talent')
    const eventLog = this.#log.child('event')
    const achievementLog = this.#log.child('achievement')
    const characterLog = this.#log.child('character')
    // 属性实例。
    this.#property = new Property({ clone: cloneUtil, storage, random, logger: propertyLog })
    // 条件求值闭包：用当前属性快照（所有模块共享）。
    const checkNow = (condition) => checkCondition(condition, this.#property.getAll())
    // 天赋实例。
    this.#talent = new Talent({ clone: cloneUtil, check: checkNow, random, logger: talentLog })
    // 事件实例。
    this.#event = new Event({ clone: cloneUtil, check: checkNow, logger: eventLog })
    // 成就实例：绑定属性系统的 ACHV 读写。
    this.#achievement = new Achievement({
      clone: cloneUtil, check: checkNow, emit, logger: achievementLog,
      // 达成检查：ACHV 累计列表是否含该 ID。
      isAchieved: (id) => (this.#property.get('ACHV') || []).some(([a]) => a == id),
      // 记录达成：写入属性系统 ACHV（含时间戳）。
      record: (id) => this.#property.achieve('ACHV', id),
    })
    // 名人实例。
    this.#character = new Character({
      clone: cloneUtil, random, storage, now, logger: characterLog,
      getTalentRandom: (count) => this.#talent.random(count),
    })
    // 全部日志器（自身 + 各子模块），供 setLogLevel 动态切换。
    this.#loggers = [this.#log, propertyLog, talentLog, eventLog, achievementLog, characterLog]
    // 记录构造摘要。
    this.#log.debug(`Life 构造: data=${Object.keys(this.#data).join(',') || '(空)'} logger=${logger ? '注入' : '静默'}`)
  }

  // 模块枚举。
  Module = {
    PROPERTY: 'PROPERTY',
    TALENT: 'TALENT',
    EVENT: 'EVENT',
    ACHIEVEMENT: 'ACHIEVEMENT',
    CHARACTER: 'CHARACTER',
  }

  // 私有字段。
  #property
  #event
  #talent
  #achievement
  #character
  #data
  #random
  #emit
  #hooks
  #log                // 日志器（引擎编排层）
  #loggers            // 全部日志器集合（含子模块，供动态切换级别）
  #triggerTalents      // 天赋触发计数
  #defaultPropertyPoints // 默认属性点数
  #talentSelectLimit   // 天赋选择上限
  #propertyAllocateLimit // 属性分配范围
  #defaultPropertys    // 默认属性
  #specialThanks       // 特别鸣谢
  #initialData         // 初始数据

  // #initial
  // 初始化全部模块数据。
  //
  // @returns {Promise<object>} 各模块总数
  async initial() {
    // 从数据源解构。
    const { age, talents, events, achievements, characters } = this.#data
    // 规模摘要（info）。
    this.#log.info(
      `initial: age=${Object.keys(age || {}).length} talents=${Object.keys(talents || {}).length} ` +
      `events=${Object.keys(events || {}).length} achievements=${Object.keys(achievements || {}).length} ` +
      `characters=${Object.keys(characters || {}).length}`
    )
    // 各模块初始化并记录总数。
    const total = {
      [this.PropertyTypes.TACHV]: this.#achievement.initial({ achievements }),
      [this.PropertyTypes.TEVT]: this.#event.initial({ events }),
      [this.PropertyTypes.TTLT]: this.#talent.initial({ talents }),
    }
    // 属性初始化（age 数据 + 总数）。
    this.#property.initial({ age, total })
    // 名人初始化。
    this.#character.initial({ characters })
    // 完成摘要（debug）。
    this.#log.debug(`initial 完成: TACHV=${total[this.PropertyTypes.TACHV]} TEVT=${total[this.PropertyTypes.TEVT]} TTLT=${total[this.PropertyTypes.TTLT]}`)
    // 返回总数。
    return total
  }

  // #config
  // 注入游戏配置。
  //
  // @param {object} params
  // @param {number} [params.defaultPropertyPoints] - 默认属性点数
  // @param {number} [params.talentSelectLimit] - 天赋选择上限
  // @param {Array} [params.propertyAllocateLimit] - 属性分配范围
  // @param {object} [params.defaultPropertys] - 默认属性
  // @param {object} [params.propertyConfig] - 属性配置（含 judge 分档）
  // @returns {void}
  config({
    defaultPropertyPoints = 20,
    talentSelectLimit = 3,
    propertyAllocateLimit = [0, 10],
    defaultPropertys = {},
    propertyConfig,
  } = {}) {
    // 保存配置。
    this.#defaultPropertyPoints = defaultPropertyPoints
    // 天赋选择上限。
    this.#talentSelectLimit = talentSelectLimit
    // 属性分配范围。
    this.#propertyAllocateLimit = propertyAllocateLimit
    // 默认属性。
    this.#defaultPropertys = defaultPropertys
    // 天赋配置（抽取池大小 + 概率）。
    this.#talent.config()
    // 属性配置（judge 分档）。
    this.#property.config(propertyConfig)
    // 记录配置摘要。
    this.#log.debug(`config: 点数=${defaultPropertyPoints} 天赋上限=${talentSelectLimit} 分配范围=${JSON.stringify(propertyAllocateLimit)}`)
  }

  // #request
  // 获取模块实例。
  //
  // @param {string} module - 模块枚举值
  // @returns {object|null} 模块实例
  request(module) {
    // 按模块返回。
    switch (module) {
      case this.Module.ACHIEVEMENT: return this.#achievement
      case this.Module.CHARACTER: return this.#character
      case this.Module.EVENT: return this.#event
      case this.Module.PROPERTY: return this.#property
      case this.Module.TALENT: return this.#talent
      // 未知模块。
      default: return null
    }
  }

  // #clone
  // 深拷贝（对模块暴露 util.clone）。
  //
  // @param {*} value - 任意值
  // @returns {*} 深拷贝
  clone(value) {
    // 调用工具克隆。
    return cloneUtil(value)
  }

  // #check
  // 用当前属性快照求值条件。
  //
  // @param {string} condition - 新语法条件
  // @returns {boolean} 结果
  check(condition) {
    // 用当前属性快照求值。
    const result = checkCondition(condition, this.#property.getAll())
    // trace：条件求值结果。
    this.#log.trace(`check(${condition}) → ${result}`)
    // 返回。
    return result
  }

  // #setLogLevel
  // 动态切换日志级别：同步到自身与全部子模块日志器，全链路实时生效。
  //
  // @param {string} level - trace/debug/info/warn/error
  // @returns {void}
  setLogLevel(level) {
    // 遍历全部日志器。
    this.#loggers.forEach(l => l.setLevel(level))
    // 记录。
    this.#log.info(`日志级别切换为 ${level}`)
  }

  // #remake
  // 重新开始（保留天赋选择）。
  //
  // @param {Array<string>} talents - 已选天赋 ID
  // @returns {Array} 天赋替换流水
  remake(talents) {
    // 初始化初始数据：默认属性 + 已选天赋。
    this.#initialData = cloneUtil(this.#defaultPropertys)
    // 写入天赋。
    this.#initialData.TLT = cloneUtil(talents)
    // 重置触发计数。
    this.#triggerTalents = {}
    // 记录开局准备（info）。
    this.#log.info(`remake: 已选天赋 ${talents.length} 个（${talents.join(',') || '无'}）`)
    // 触发替换链。
    return this.talentReplace(this.#initialData.TLT)
  }

  // #start
  // 开局：应用分配属性并触发初始成就检测。
  //
  // @param {object} allocation - 属性分配
  // @returns {void}
  start(allocation) {
    // 应用分配属性。
    for (const key in allocation) {
      // 覆盖初始数据。
      this.#initialData[key] = cloneUtil(allocation[key])
    }
    // 记录开局（info）。
    this.#log.info(`start: 属性分配 ${JSON.stringify(allocation)}`)
    // 重启属性系统。
    this.#property.restart(this.#initialData)
    // 触发天赋（初始天赋）。
    this.doTalent()
    // 记录开局基准。
    this.#property.restartLastStep()
    // 初始成就检测。
    this.#achievement.achieve(this.AchievementOpportunity.START)
    // 完成摘要（debug）。
    this.#log.debug(`start 完成: 初始属性 ${JSON.stringify(this.#property.getPropertys())}`)
  }

  // #getPropertyPoints
  // 计算可用属性点数（默认 + 天赋加成）。
  //
  // @returns {number} 可用点数
  getPropertyPoints() {
    // 默认点数 + 已选天赋的 status 加成。
    return this.#defaultPropertyPoints + this.#talent.allocationAddition(this.#initialData.TLT)
  }

  // #getTalentCurrentTriggerCount
  // 读取天赋当前触发次数。
  //
  // @param {string} talentId - 天赋 ID
  // @returns {number} 触发次数
  getTalentCurrentTriggerCount(talentId) {
    // 返回计数。
    return this.#triggerTalents[talentId] || 0
  }

  // #next
  // 推进一年：触发天赋 + 随机事件。
  // 触发 onYearAdvance 钩子（payload 引用传递，钩子可向 content 注入额外内容）。
  //
  // @returns {{age: number, content: Array, isEnd: boolean}}
  next() {
    // trace 入口。
    this.#log.trace('→ next()')
    // 年龄+1，读取该年数据。
    const { age, event, talent } = this.#property.ageNext()
    // 触发天赋。
    const talentContent = this.doTalent(talent)
    // 触发随机事件。
    const eventContent = this.doEvent(this.random(event))
    // 是否结束。
    const isEnd = this.#property.isEnd()
    // 汇总流水。
    const content = [talentContent, eventContent].flat()
    // Mod 钩子：翻年时机（可注入 AI 生成事件/天赋）。
    this.#hooks.emitSync('onYearAdvance', { age, content, isEnd })
    // 轨迹成就检测。
    this.#achievement.achieve(this.AchievementOpportunity.TRAJECTORY)
    // 本岁产出摘要（debug）。
    this.#log.debug(`[${age}岁] 天赋 ${talentContent.length} 条 / 事件 ${eventContent.length} 条 / isEnd=${isEnd}`)
    // 返回。
    const result = { age, content, isEnd }
    // trace 退出（摘要，content 只记条数防刷屏）。
    this.#log.trace(`← next → ${JSON.stringify({ age, content: content.length, isEnd })}`)
    return result
  }

  // #talentReplace
  // 天赋替换：返回替换流水。
  //
  // @param {Array<string>} talents - 天赋 ID 列表（会就地追加替换结果）
  // @returns {Array} 替换流水
  talentReplace(talents) {
    // 执行替换。
    const result = this.#talent.replace(talents)
    // 流水。
    const contents = []
    // 遍历替换映射。
    for (const id in result) {
      // 追加替换结果到列表。
      talents.push(result[id])
      // 源天赋。
      const source = this.#talent.get(id)
      // 目标天赋。
      const target = this.#talent.get(result[id])
      // 记录流水。
      contents.push({ type: 'talentReplace', source, target })
    }
    // 返回流水。
    return contents
  }

  // #doTalent
  // 触发天赋：条件满足且未超限则应用效果。
  //
  // @param {Array<string>|null} talents - 新增天赋 ID；null 表示用已获天赋
  // @returns {Array} 触发流水
  doTalent(talents) {
    // 有新增天赋则加入属性。
    if (talents) {
      // 记录新增天赋（debug）。
      this.#log.debug(`doTalent: 新增天赋 ${talents.join(',')}`)
      // 加入属性。
      this.#property.change(this.PropertyTypes.TLT, talents)
    }
    // 待检查天赋：过滤未超触发上限的。
    talents = this.#property.get(this.PropertyTypes.TLT)
      .filter(talentId => this.getTalentCurrentTriggerCount(talentId) < this.#talent.get(talentId).maxTriggers)

    // 触发流水。
    const contents = []
    // 遍历待检查天赋。
    for (const talentId of talents) {
      // 触发。
      const result = this.#talent.do(talentId)
      // 未触发跳过。
      if (!result) {
        // trace：未触发（条件不满足）。
        this.#log.trace(`doTalent: ${talentId} 未触发`)
        continue
      }
      // 触发成功（debug）。
      this.#log.debug(`doTalent: ${talentId} 触发（效果 ${JSON.stringify(result.effect || {})}）`)
      // 触发次数 +1。
      this.#triggerTalents[talentId] = this.getTalentCurrentTriggerCount(talentId) + 1
      // 取结果字段。
      const { effect, name, description, grade } = result
      // 记录流水。
      contents.push({
        type: this.PropertyTypes.TLT,
        name,
        grade,
        description: this.format(description),
      })
      // 无效果跳过。
      if (!effect) continue
      // 应用效果。
      this.#property.effect(effect)
    }
    // 返回流水。
    return contents
  }

  // #doEvent
  // 执行事件：应用效果，处理分支递归。
  //
  // @param {string} eventId - 事件 ID
  // @returns {Array} 事件流水
  doEvent(eventId) {
    // trace 入口。
    this.#log.trace(`→ doEvent(${eventId})`)
    // 事件不存在则跳过。
    try {
      // 记录执行（debug）。
      this.#log.debug(`doEvent: 执行事件 ${eventId}`)
      // 执行事件。
      const { effect, next, description, postEvent, grade } = this.#event.do(eventId)
      // 记录事件到已触列表。
      this.#property.change(this.PropertyTypes.EVT, eventId)
      // 应用效果。
      this.#property.effect(effect)
      // 流水条目。
      const content = {
        type: this.PropertyTypes.EVT,
        description: this.format(description),
        postEvent: postEvent && this.format(postEvent),
        grade,
      }
      // 有分支：递归执行下一事件。
      if (next) return [content, ...this.doEvent(next)].flat()
      // 无分支。
      return [content]
    } catch (e) {
      // 事件缺失返回空流水（warn：可恢复异常）。
      this.#log.warn(`doEvent: 事件缺失或异常（${e.message}），跳过`)
      return []
    }
  }

  // #random
  // 从候选事件里按条件过滤后权重随机选一个。
  //
  // @param {Array<[string, number]>} events - [事件ID, 权重] 列表
  // @returns {string|null} 选中的事件 ID
  random(events) {
    // 过滤可触发事件（跳过不存在的事件）。
    const candidates = events.filter(([eventId]) => {
      // 事件缺失时跳过（原型数据可能不一致）。
      try { return this.#event.check(eventId) } catch { return false }
    })
    // 无可选事件。
    if (candidates.length === 0) {
      // trace：无候选。
      this.#log.trace('random: 无候选事件')
      return null
    }
    // 候选规模（debug）。
    this.#log.debug(`random: ${events.length} 候选 → ${candidates.length} 可触发`)
    // 权重随机。
    return weightRandom(candidates, this.#random)
  }

  // #talentRandom
  // 随机天赋池。
  // 触发 onTalentPoolGenerate 钩子（payload.pool 引用传递，钩子可追加 AI 天赋）。
  //
  // @returns {Array<object>} 天赋对象列表
  talentRandom() {
    // 调用天赋模块。
    const pool = this.#talent.talentRandom(
      // 继承天赋。
      this.lastExtendTalent,
      // 加成属性值。
      this.#getPropertys(this.PropertyTypes.TMS, this.PropertyTypes.CACHV)
    )
    // Mod 钩子：天赋池生成（AI 可向 pool 注入生成的天赋）。
    this.#hooks.emitSync('onTalentPoolGenerate', { pool })
    // 记录池规模（info）。
    this.#log.info(`talentRandom: 天赋池 ${pool.length} 个`)
    // 返回。
    return pool
  }

  // #characterRandom
  // 随机名人：把名人数据里的天赋 ID 替换为天赋对象。
  //
  // @returns {{unique: object|null, normal: Array<object>}}
  characterRandom() {
    // 随机名人。
    const characters = this.#character.random()
    // 替换天赋 ID 为对象。
    const replaceTalent = v => (v.talent = v.talent.map(id => this.#talent.get(id)))
    // 处理普通名人。
    characters.normal.forEach(replaceTalent)
    // 处理唯一"我"。
    if (characters.unique && characters.unique.talent) replaceTalent(characters.unique)
    // 记录（debug）。
    this.#log.debug(`characterRandom: 普通 ${characters.normal.length} 个 / 唯一 ${characters.unique ? '有' : '无'}`)
    // 返回。
    return characters
  }

  // #talentExtend
  // 设置继承天赋。
  //
  // @param {string} talentId - 天赋 ID
  // @returns {void}
  talentExtend(talentId) {
    // 写入属性系统 EXT。
    this.#property.set(this.PropertyTypes.EXT, talentId)
  }

  // #exclude
  // 天赋互斥检查（暴露给 UI）。
  //
  // @param {Array<string>} talents - 候选天赋
  // @param {string} exclusive - 要检查的天赋
  // @returns {string|null} 冲突天赋
  exclude(talents, exclusive) {
    // 调用天赋模块。
    return this.#talent.exclude(talents, exclusive)
  }

  // #generateUnique
  // 生成唯一"我"（暴露给 UI）。
  //
  // @returns {object|null} 唯一"我"
  generateUnique() {
    // 调用名人模块。
    return this.#character.generateUnique()
  }

  // #getPropertys
  // 读取多个属性的映射。
  //
  // @param {...string} types - 属性类型
  // @returns {object} 属性映射
  #getPropertys(...types) {
    // 构建映射。
    const map = {}
    // 遍历属性类型。
    for (const key of types.flat()) map[key] = this.#property.get(key)
    // 返回。
    return map
  }

  // #format
  // 格式化模板字符串（{age} {charm} 等占位符）。
  // 触发 onEventRender 钩子：AI 可在占位符替换后润色描述文本。
  // 钩子返回值若为字符串，则覆盖格式化结果。
  //
  // @param {string} description - 含占位符的文本
  // @returns {string} 格式化结果
  format(description) {
    // trace 入口。
    this.#log.trace(`→ format(${description})`)
    // 替换所有 {xxx} 占位符。
    const formatted = `${description}`.replaceAll(/\{\s*[0-9a-zA-Z_-]+\s*?\}/g, (match) => {
      // 取占位符内部键名。
      const key = match.slice(1, -1).trim().toLowerCase()
      // 按键名映射为属性值。
      switch (key) {
        case 'currentyear': return new Date().getFullYear()
        case 'age': return this.#property.get(this.PropertyTypes.AGE)
        case 'charm': return this.#property.get(this.PropertyTypes.CHR)
        case 'intelligence': return this.#property.get(this.PropertyTypes.INT)
        case 'strength': return this.#property.get(this.PropertyTypes.STR)
        case 'money': return this.#property.get(this.PropertyTypes.MNY)
        case 'spirit': return this.#property.get(this.PropertyTypes.SPR)
        // 未知占位符原样保留。
        default: return match
      }
    })
    // Mod 钩子：渲染时机（AI 可润色描述）。返回字符串则覆盖。
    const results = this.#hooks.emitSync('onEventRender', { text: formatted })
    // 首个返回字符串的钩子覆盖结果。
    for (const r of results) {
      // 钩子返回字符串。
      if (typeof r === 'string') return r
    }
    // 返回格式化结果（trace 退出）。
    this.#log.trace(`← format → ${formatted}`)
    return formatted
  }

  // #getters
  // 只读属性。
  get lastExtendTalent() {
    // 继承天赋。
    return this.#property.get(this.PropertyTypes.EXT)
  }

  // 人生总结：各属性分档评价。
  get summary() {
    // 总结成就检测。
    this.#achievement.achieve(this.AchievementOpportunity.SUMMARY)
    // 读取各属性评价。
    return this.#getJudges(this.PropertyTypes.SUM,
      this.PropertyTypes.HAGE, this.PropertyTypes.HCHR, this.PropertyTypes.HINT,
      this.PropertyTypes.HSTR, this.PropertyTypes.HMNY, this.PropertyTypes.HSPR)
  }

  // 统计信息。
  get statistics() {
    // 读取统计属性评价。
    return this.#getJudges(this.PropertyTypes.TMS,
      this.PropertyTypes.CACHV, this.PropertyTypes.RTLT, this.PropertyTypes.REVT)
  }

  // 成就列表（按达成时间排序）。
  get achievements() {
    // 已达成时间映射。
    const ticks = {}
    // 从 ACHV 累计提取 [id, tick]。
    this.#property.get(this.PropertyTypes.ACHV).forEach(([id, tick]) => { ticks[id] = tick })
    // 列出成就并按时间/等级排序。
    return this.#achievement.list().sort((
      { id: a, grade: ag, hide: ah },
      { id: b, grade: bg, hide: bh }
    ) => {
      // 双方达成时间。
      a = ticks[a]
      b = ticks[b]
      // 都达成：按时间倒序。
      if (a && b) return b - a
      // 都未达成：隐藏的排后面，等级降序。
      if (!a && !b) {
        // 都隐藏按等级。
        if (ah && bh) return bg - ag
        // 仅 a 隐藏：a 靠后。
        if (ah) return 1
        // 仅 b 隐藏：b 靠后。
        if (bh) return -1
        // 按等级降序。
        return bg - ag
      }
      // a 未达成：a 靠后。
      if (!a) return 1
      // b 未达成：b 靠后。
      if (!b) return -1
    })
  }

  // #getJudges
  // 读取多个属性的分档评价。
  //
  // @param {...string} types - 属性类型
  // @returns {object} 评价映射
  #getJudges(...types) {
    // 构建映射。
    const map = {}
    // 遍历属性类型。
    for (const key of types.flat()) map[key] = this.#property.judge(key)
    // 返回。
    return map
  }

  // 属性类型常量。
  get PropertyTypes() { return this.#property.TYPES }
  // 成就时机常量。
  get AchievementOpportunity() { return this.#achievement.Opportunity }
  // 天赋选择上限。
  get talentSelectLimit() { return this.#talentSelectLimit }
  // 属性分配范围。
  get propertyAllocateLimit() { return cloneUtil(this.#propertyAllocateLimit) }
  // 玩家可见属性。
  get propertys() { return this.#property.getPropertys() }
  // 重开次数。
  get times() { return this.#property.get(this.PropertyTypes.TMS) || 0 }
  set times(v) {
    // 写入重开次数。
    this.#property.set(this.PropertyTypes.TMS, v)
    // 结束成就检测。
    this.#achievement.achieve(this.AchievementOpportunity.END)
  }
  // 特别鸣谢。
  get specialThanks() { return this.#specialThanks }
}

export default Life
