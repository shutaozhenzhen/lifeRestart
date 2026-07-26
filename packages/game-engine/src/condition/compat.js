/**
 * condition 兼容层 — convertLegacy()
 *
 * 用途：将原版 lifeRestart 的旧语法（CHR>5&AGE?[18,30]）转换为 JS 表达式。
 *
 * 注意：这是一个构建期一次性转换工具，不出现在运行时。
 * Data Mod 打包时运行一次，之后所有条件都是纯 JS。
 *
 * @param {string} condition - 旧语法条件字符串
 * @param {object} propTypes - 属性类型映射，如 { CHR: 'scalar', TLT: 'array' }
 * @returns {string} 转换后的 JS 表达式
 */

// #BUILTINS
// 白名单：这些内置名称不需要加 params. 前缀。
// 出现在条件字符串中时保持原样。
// new Function 执行时，Math/JSON/Date 等是 JS 引擎提供的全局对象，
// 不是游戏属性，所以不能加 params. 前缀。
const BUILTINS = new Set([
  'Math',       // 数学函数：Math.random()、Math.max()、Math.floor() 等
  'true',       // 布尔字面量
  'false',      // 布尔字面量
  'null',       // 空值字面量
  'undefined',  // 未定义字面量
  'NaN',        // 非数值
  'Infinity',   // 无穷大
  'Date',       // 日期对象
  'JSON',       // JSON 序列化/反序列化
  'Array',      // 数组构造函数
  'Object',     // 对象构造函数
  'String',     // 字符串构造函数
  'Number',     // 数字构造函数
  'Boolean',    // 布尔构造函数
  'RegExp',     // 正则表达式构造函数
  'Map',        // ES6 Map
  'Set',        // ES6 Set
  'parseInt',   // 全局函数：转整数
  'parseFloat', // 全局函数：转浮点
  'isNaN',      // 全局函数：判断非数值
  'isFinite',   // 全局函数：判断有限数
])

// #quoteIfNeeded
// 判断一个值是否需要加双引号。
// 纯数字（含负数和浮点）→ 不加引号，JS 引擎直接按数字解析。
// 非数字（如 talent_001、spring）→ 加双引号成为字符串字面量。
//
// @param {string} val - 原始值字符串
// @returns {string} 处理后的值字符串
function quoteIfNeeded(val) {
  // 去掉两端的空白字符。
  const trimmed = val.trim()
  // 空字符串直接返回，不处理。
  if (!trimmed) return ''
  // 正则匹配纯数字格式：
  //   ^        字符串开头
  //   -?       可选负号
  //   \d+      至少一位数字
  //   (\.\d+)? 可选小数部分
  //   $        字符串结尾
  // 匹配到纯数字就不加引号。
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  // 非数字值用双引号包裹，使其在 JS 中成为字符串字面量。
  return `"${trimmed}"`
}

// #parseValues
// 将逗号分隔的值列表字符串拆分为数组，逐项处理后再拼合。
// 输入："1001,talent_001,1002"
// 输出：'1001,"talent_001",1002'
//
// @param {string} values - 逗号分隔的原始值字符串
// @returns {string} 处理后的值列表字符串
function parseValues(values) {
  // split(',') 按逗号拆分。
  // filter(Boolean) 过滤掉空字符串（如尾部多余逗号产生的）。
  // map(quoteIfNeeded) 逐项判断是否需要加引号。
  // join(',') 重新拼合为逗号分隔字符串。
  return values.split(',').filter(Boolean).map(quoteIfNeeded).join(',')
}

// #convertLegacy
// 主转换函数。依次应用多条正则替换规则。
// 【重要】替换顺序有依赖关系：?[ 必须在 = 之前（避免损坏箭头函数 =>）。
export function convertLegacy(condition, propTypes = {}) {
  // 从原始条件字符串开始，逐步替换。
  let result = condition

  // === 规则 1：?[values] — 成员判断（IN） ===
  // 匹配模式：PROP?[val1,val2,...]
  //   (\w+)  捕获属性名（如 AGE、TLT）
  //   \?\[    匹配 ?[ 字面量
  //   ([^\]]*) 捕获方括号内的值列表
  //   \]      匹配 ] 字面量
  // "g" 标志：全局替换（一条件字符串中可能出现多个）。替换发生在 = 之前，避免损坏 .some(id => ...) 中的 =。
  result = result.replace(/(\w+)\?\[([^\]]*)\]/g, (_m, prop, values) => {
    // 将原始值列表解析为 JS 数组元素格式（含引号处理）。
    const parsed = parseValues(values)
    // 根据 propTypes 中声明的属性类型，选择不同的转换策略。
    if (propTypes[prop] === 'array') {
      // 数组属性（如 TLT、EVT）：用 .some() 方法判断交集。
      // some() 对数组的每个元素执行回调，只要有一个返回 true 则整体为 true。
      return `${prop}.some(id => [${parsed}].includes(id))`
    }
    // 标量属性（默认）：直接用 .includes() 判断成员关系。
    return `[${parsed}].includes(${prop})`
  })

  // === 规则 2：![values] — 非成员判断（NOT IN） ===
  // 逻辑与规则 1 相同，只是在整个结果前加 ! 取反。
  result = result.replace(/(\w+)\!\[([^\]]*)\]/g, (_m, prop, values) => {
    // 同样解析值列表。
    const parsed = parseValues(values)
    if (propTypes[prop] === 'array') {
      // 数组属性：!some() — 没有任何一个元素在目标列表中。
      return `!${prop}.some(id => [${parsed}].includes(id))`
    }
    // 标量属性：!includes() — 不在列表中。
    return `![${parsed}].includes(${prop})`
  })

  // === 规则 3：& → && （逻辑与） ===
  // 旧语法用单个 & 表示逻辑与，JS 需要双 &&。
  result = result.replace(/&/g, ' && ')

  // === 规则 4：| → || （逻辑或） ===
  // 旧语法用单个 | 表示逻辑或，JS 需要双 ||。
  result = result.replace(/\|/g, ' || ')

  // === 规则 5：!= → !== （不相等） ===
  // 匹配大写属性名（含可选的 !? 后缀，用于已转换的表达式）后紧接 !=。
  // 捕获操作符和操作数，重组为 !==。
  result = result.replace(/([A-Z][A-Z0-9!?]*) *!= *(\d+|true|false)/g, '$1 !== $2')

  // === 规则 6：>=、<= — 只加空格，不改变操作符 ===
  // 匹配大写属性名后接 >= 或 <= 再接数字。加空格使表达式可读。
  result = result.replace(/([A-Z][A-Z0-9!?]*) *(>=|<=) *(\d+)/g, '$1 $2 $3')

  // === 规则 7：= → ===（相等判断） ===
  // 匹配大写属性名后接 = 再前瞻数字，排除 >=、<=、!= 等。
  // (?=\d+) 前瞻保证只匹配 = 后面是数字的简单相等情况。
  result = result.replace(/([A-Z][A-Z0-9!?]*) *= *(?=\d+)/g, '$1 === ')

  // === 规则 8：> 和 < — 加空格 ===
  // 为 > 和 < 操作符周围添加空格，确保表达式可读。
  // 仅在操作符后跟数字时匹配，避免误处理箭头函数 -> 中的 >。
  result = result.replace(/([A-Z][A-Z0-9]*) *> *(\d+)/g, '$1 > $2')
  result = result.replace(/([A-Z][A-Z0-9]*) *< *(\d+)/g, '$1 < $2')

  // === 规则 9：添加 params. 前缀 ===
  // 将所有大写开头的标识符（游戏属性名）替换为 params.XXX 形式。
  // \b 单词边界保证不会匹配到单词中间的部分。
  // 注意：白名单中的 JS 内置对象和代码关键字（id、return）被跳过。
  result = result.replace(/\b([A-Z][A-Z0-9_]*)\b/g, (match) => {
    // 如果 match 在白名单中（如 Math、JSON），不加前缀，保持原样。
    if (BUILTINS.has(match)) return match
    // 如果 match 是数组方法中的回调形参 id 或函数声明关键字 return，不加前缀。
    if (match === 'id' || match === 'return') return match
    // 其他所有大写标识符统一加 params. 前缀。
    return `params.${match}`
  })

  // === 规则 10：清理多余空白 ===
  // 替换连续的多个空格为单个空格。
  result = result.replace(/  +/g, ' ')
  // 去掉首尾空白。
  result = result.trim()

  // 返回最终转换结果。
  return result
}
