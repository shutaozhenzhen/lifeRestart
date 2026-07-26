/**
 * condition 兼容层 — convertLegacy()
 *
 * 用途：将原版 lifeRestart 的旧语法（CHR>5&AGE?[18,30]）转换为 JS 表达式。
 *
 * 转换规则（按优先级，?[ 必须在 = 之前）：
 *   1. PROP?[a,b] →  [a,b].includes(PROP)           （标量属性）
 *                  →  PROP.some(id => [a,b].incl...(id)) （数组属性）
 *   2. PROP![a,b] →  ![a,b].includes(PROP)           （标量）
 *                  →  !PROP.some(id => [a,b].incl...(id)) （数组）
 *   3. &  →  &&
 *   4. |  →  ||
 *   5. != → !==
 *   6. >=、<= → （加空格）
 *   7. = → === （仅限 PROP=数字 模式）
 *   8. >、< → （加空格）
 *   9. 给大写属性名加 params. 前缀
 *
 * 注意：这是一个构建期一次性转换工具，不出现在运行时。
 * Data Mod 打包时运行一次，之后所有条件都是纯 JS。
 *
 * @param {string} condition - 旧语法条件字符串
 * @param {object} propTypes - 属性类型映射，如 { CHR: 'scalar', TLT: 'array' }
 * @returns {string} 转换后的 JS 表达式
 */

// 不需要加 params. 前缀的 JS 内置对象白名单。
// 这些名称出现在条件字符串中时不加 params. 前缀。
const BUILTINS = new Set([
  'Math', 'true', 'false', 'null', 'undefined',
  'NaN', 'Infinity', 'Date', 'JSON', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'RegExp', 'Map', 'Set',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
])

/**
 * 为数组中的单个值按需添加引号。
 * 数字 → 不加引号（如 1001、18）
 * 非数字 → 加双引号（如 "talent_001"）
 *
 * @param {string} val - 原始值字符串
 * @returns {string} 处理后的值
 */
function quoteIfNeeded(val) {
  const trimmed = val.trim()
  if (!trimmed) return ''
  // 纯数字（含负数和浮点）不加引号
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  // 非数字加双引号，使 JS 中成为字符串字面量
  return `"${trimmed}"`
}

/**
 * 将逗号分隔的值列表逐项处理并重新拼接。
 *
 * @param {string} values - "1001,talent_001,1002"
 * @returns {string} '1001,"talent_001",1002'
 */
function parseValues(values) {
  return values.split(',').filter(Boolean).map(quoteIfNeeded).join(',')
}

export function convertLegacy(condition, propTypes = {}) {
  let result = condition

  // 1. PROP?[val1,val2,...] — 成员判断（IN）
  //    注意：必须在 = 替换之前执行，否则 => 箭头函数写法会被 = 替换损坏。
  //    标量属性：AGE?[18,30] → [18,30].includes(AGE)
  //    数组属性：TLT?[1001] → TLT.some(id => [1001].includes(id))
  result = result.replace(/(\w+)\?\[([^\]]*)\]/g, (_m, prop, values) => {
    // 根据属性类型决定生成的 JS 代码
    const parsed = parseValues(values)
    if (propTypes[prop] === 'array') {
      // 数组属性：用 .some() 判断交集
      return `${prop}.some(id => [${parsed}].includes(id))`
    }
    // 标量属性：用 .includes() 判断成员
    return `[${parsed}].includes(${prop})`
  })

  // 2. PROP![val1,val2,...] — 非成员判断（NOT IN）
  //    逻辑同上，只是在表达式前加 !
  result = result.replace(/(\w+)\!\[([^\]]*)\]/g, (_m, prop, values) => {
    const parsed = parseValues(values)
    if (propTypes[prop] === 'array') {
      return `!${prop}.some(id => [${parsed}].includes(id))`
    }
    return `![${parsed}].includes(${prop})`
  })

  // 3. & → &&（逻辑与）
  result = result.replace(/&/g, ' && ')

  // 4. | → ||（逻辑或）
  result = result.replace(/\|/g, ' || ')

  // 5. != → !==（不等于，加空格）
  result = result.replace(/([A-Z][A-Z0-9!?]*) *!= *(\d+|true|false)/g, '$1 !== $2')

  // 6. >=、≤ — 保留原操作符，只加空格
  result = result.replace(/([A-Z][A-Z0-9!?]*) *(>=|<=) *(\d+)/g, '$1 $2 $3')

  // 7. = → ===（仅匹配 PROP=数字 模式的相等判断）
  //    注意：(?=\d+）前瞻保证不匹配 >=、<=、!= 等情况
  result = result.replace(/([A-Z][A-Z0-9!?]*) *= *(?=\d+)/g, '$1 === ')

  // 8. 为 > 和 < 添加空格（仅当操作符后跟数字，避免误处理箭头函数 ->）
  result = result.replace(/([A-Z][A-Z0-9]*) *> *(\d+)/g, '$1 > $2')
  result = result.replace(/([A-Z][A-Z0-9]*) *< *(\d+)/g, '$1 < $2')

  // 9. 给所有大写属性名添加 params. 前缀。
  //    跳过 JS 内置对象（Math、JSON 等）和代码中已存在的关键字（id、return）。
  result = result.replace(/\b([A-Z][A-Z0-9_]*)\b/g, (match) => {
    // 跳过白名单
    if (BUILTINS.has(match)) return match
    // 跳过回调函数中的形参和语句关键字
    if (match === 'id' || match === 'return') return match
    // 其他大写标识符视为游戏属性，加 params. 前缀
    return `params.${match}`
  })

  // 10. 清理多余空格
  result = result.replace(/  +/g, ' ').trim()

  return result
}
