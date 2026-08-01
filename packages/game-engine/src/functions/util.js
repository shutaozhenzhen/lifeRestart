/**
 * util 工具函数集
 *
 * 从原版 lifeRestart-old/src/functions/util.js 移植（零依赖，可直接复用），
 * 按新项目约束做了两点增强：
 *   1. 随机函数（weightRandom/listRandom）支持注入随机源 random，
 *      默认 Math.random，测试/跨平台对比时注入固定 seed 的 RNG。
 *   2. 新增 createRng(seed)：mulberry32 种子随机数生成器，
 *      供 Step 4 全生命周期模拟、Step 11 新旧引擎对比、Step 26 跨平台一致性使用。
 *
 * 全部函数为纯函数（除随机函数外），无副作用。
 */

// #clone
// 深拷贝任意值。
// 处理 object（含 null 与数组）与原始值两种情况。
//
// @param {*} value - 任意值
// @returns {*} 深拷贝结果
export function clone(value) {
  // 按类型分发。
  switch (typeof value) {
    // 对象或数组：递归拷贝。
    case 'object':
      // null 直接返回（typeof null === 'object' 的特例）。
      if (value === null) return null
      // 数组：逐元素递归 clone。
      if (Array.isArray(value)) return value.map(v => clone(v))
      // 普通对象：逐键递归 clone，构建新对象。
      const newObj = {}
      for (const key in value) newObj[key] = clone(value[key])
      // 返回拷贝后的对象。
      return newObj
    // 其他类型（number/string/boolean/undefined/function/bigint/symbol）：原样返回。
    default:
      return value
  }
}

// #max
// 求一组数（含嵌套数组）的最大值。
// ...arr 收集所有参数，.flat() 摊平一层数组。
//
// @param {...(number|number[])} arr - 数字或数字数组
// @returns {number} 最大值
export function max(...arr) {
  // Math.max 展开扁平化后的数组。
  return Math.max(...arr.flat())
}

// #min
// 求一组数（含嵌套数组）的最小值。
//
// @param {...(number|number[])} arr - 数字或数字数组
// @returns {number} 最小值
export function min(...arr) {
  // Math.min 展开扁平化后的数组。
  return Math.min(...arr.flat())
}

// #sum
// 求一组数（含嵌套数组）的总和。
//
// @param {...(number|number[])} arr - 数字或数字数组
// @returns {number} 总和
export function sum(...arr) {
  // 累加器。
  let s = 0
  // 遍历扁平化后的每个数字累加。
  arr.flat().forEach(v => { s += v })
  // 返回总和。
  return s
}

// #average
// 求一组数（含嵌套数组）的平均值。
//
// @param {...(number|number[])} arr - 数字或数字数组
// @returns {number} 平均值
export function average(...arr) {
  // 用 sum 求总和，除以扁平化后的元素个数。
  const s = sum(...arr)
  // 返回平均值。
  return s / arr.flat().length
}

// #weightRandom
// 带权重的随机抽取：按权重比例随机返回列表中的某一项 id。
//
// @param {Array<[string, number]>} list - [id, weight] 数组
// @param {() => number} random - 随机源，返回 [0,1) 的随机数，默认 Math.random
// @returns {string} 被抽中的 id
export function weightRandom(list, random = Math.random) {
  // 计算总权重。
  let totalWeights = 0
  // 累加每个 [id, weight] 的权重。
  for (const [, weight] of list) totalWeights += weight

  // 在 [0, totalWeights) 内取一个随机数。
  let r = random() * totalWeights
  // 依次减去每个权重，首次减成负数的那个项即被抽中。
  for (const [id, weight] of list) {
    // 减去当前项权重。
    r -= weight
    // 减成负数 → 落在这项的区间内，返回其 id。
    if (r < 0) return id
  }
  // 理论上不可达（浮点误差兜底），返回最后一项。
  return list[list.length - 1][0]
}

// #listRandom
// 从数组中均匀随机抽取一个元素。
//
// @param {Array} list - 任意数组
// @param {() => number} random - 随机源，返回 [0,1) 的随机数，默认 Math.random
// @returns {*} 被抽中的元素
export function listRandom(list, random = Math.random) {
  // Math.floor(random() * length) 得到合法下标，返回对应元素。
  return list[Math.floor(random() * list.length)]
}

// #getListValuesMap
// 用数组的每个元素作为键，fn(key) 作为值，构建对象映射。
//
// @param {Array} list - 键数组
// @param {(key: *) => *} fn - 值生成函数
// @returns {object} 生成的映射对象
export function getListValuesMap(list, fn) {
  // 结果对象。
  const map = {}
  // 遍历每个键，调用 fn 生成值。
  list.forEach(key => { map[key] = fn(key) })
  // 返回映射。
  return map
}

// #mapConvert
// 就地转换对象的每个值（原地修改）。
//
// @param {object} map - 目标对象
// @param {(key: string, value: *) => *} fn - 转换函数
// @returns {void} 无返回值，原地修改
export function mapConvert(map, fn) {
  // 遍历所有键，用 fn(key, map[key]) 覆盖原值。
  for (const key in map) map[key] = fn(key, map[key])
}

// #getConvertedMap
// 返回转换后的新对象（不修改原对象）。
//
// @param {object} map - 源对象
// @param {(key: string, value: *) => *} fn - 转换函数
// @returns {object} 新对象
export function getConvertedMap(map, fn) {
  // 新对象。
  const newMap = {}
  // 遍历所有键，用 fn(key, map[key]) 写入新对象。
  for (const key in map) newMap[key] = fn(key, map[key])
  // 返回新对象。
  return newMap
}

// #mapSet
// 把 source 的所有属性浅拷贝到 target（就地合并）。
//
// @param {object} target - 目标对象
// @param {object} source - 源对象
// @returns {void} 无返回值，就地修改
export function mapSet(target, source) {
  // 遍历 source 的键，逐键赋值给 target。
  for (const key in source) target[key] = source[key]
}

// #deepMapSet
// 深合并：把 source 递归合并进 target。
// 规则：
//   - 值为函数：先执行函数取结果，再按结果处理
//   - 结果为对象（非数组）：递归合并到 target[key]
//   - 其他（数组/原始值/对象结果之外）：直接覆盖 target[key]
// 注意：原版用 switch fallthrough（function → object），函数返回原始值时
// 会落入 object 分支导致丢失。新版改为先解函数、再统一按结果类型分发。
//
// @param {object} target - 目标对象
// @param {object} source - 源对象
// @returns {object} 合并后的 target
export function deepMapSet(target, source) {
  // 遍历 source 的键。
  for (const key in source) {
    // 取出源值。
    let value = source[key]
    // 函数值：先执行，把结果作为待合并值。
    if (typeof value === 'function') value = value()
    // 对象结果（非数组，且非 null）：递归合并。
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // 目标当前不是对象时，先建空对象再递归。
      if (!target[key] || typeof target[key] !== 'object') target[key] = {}
      // 递归合并。
      deepMapSet(target[key], value)
    } else {
      // 数组/原始值/函数返回的原始值：直接覆盖。
      target[key] = value
    }
  }
  // 返回合并后的 target，保持调用链。
  return target
}

// #deepGet
// 用点路径安全地读取嵌套对象属性。
//
// @param {object} obj - 目标对象
// @param {string} path - 点路径，如 "a.b.c"
// @returns {*} 值；路径任一段不存在或中途不是对象返回 undefined
export function deepGet(obj, path) {
  // 按 . 拆分路径，逐层深入。
  for (const key of path.split('.')) {
    // 当前值不是对象（含 null）时无法继续 → 返回 undefined。
    // 注意：in 运算符用于原始值（数字/字符串）会抛 TypeError，必须先判类型。
    if (obj === null || typeof obj !== 'object') return undefined
    // 当前层没有该键 → 返回 undefined。
    if (!(key in obj)) return undefined
    // 深入下一层。
    obj = obj[key]
  }
  // 返回最终值。
  return obj
}

// #format
// 模板字符串格式化。
// 支持两种占位：
//   {key}    用一个对象做参数，取对象的深层属性
//   {0}/{1}  用多个参数做数组，按下标取参
//
// @param {string} str - 模板字符串
// @param {...*} args - 参数（一个对象或多个参数）
// @returns {string} 格式化结果
export function format(str, ...args) {
  // 生成替换函数：给定一个集合，把 {key} 替换为集合中对应值。
  // set 是对象或参数数组。
  // match 是完整匹配串，key 是花括号内的键名。
  const replace = set => (match, key) => {
    // 从集合中深取键对应的值。
    const value = deepGet(set, key)
    // 按类型格式化：
    switch (typeof value) {
      // 对象 → JSON 字符串。
      case 'object': return JSON.stringify(value)
      // 原始值 → 直接返回。
      case 'boolean':
      case 'number':
      case 'string': return value
      // undefined 等 → 尝试 toString，失败则保留原占位符。
      default: return value?.toString?.() || match
    }
  }

  // 分情况处理：
  switch (args.length) {
    // 无参数：原样返回。
    case 0: return str
    // 一个参数且为对象：用 {key} 形式替换。
    case 1:
      // 不是对象则跳出 switch 走下标分支。
      if (typeof (args[0]) !== 'object') break
      // 用 {key} 正则 + 对象集合替换。
      return str.replace(/{(.+?)}/g, replace(args[0]))
  }
  // 多个参数：用 {n} 下标形式替换（set 是参数数组）。
  return str.replace(/{(\d+)}/g, replace(args))
}

// #createRng
// mulberry32 种子随机数生成器。
// 相同 seed 产生完全相同的随机数序列，用于可复现的测试/对比。
//
// @param {number} seed - 种子（任意 32 位整数）
// @returns {() => number} 随机函数，每次调用返回 [0,1) 的伪随机数
export function createRng(seed) {
  // 状态变量：把 seed 规范化为 32 位无符号整数。
  let a = seed >>> 0
  // 返回随机函数（闭包持有状态 a）。
  return function random() {
    // 状态变换：标准 mulberry32 算法。
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    // 返回 [0,1) 的伪随机数。
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
