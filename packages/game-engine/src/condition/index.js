/**
 * condition 引擎核心 — check()
 *
 * 核心理念：
 * 条件表达式就是标准的 JS 表达式，通过 new Function 执行。
 * 唯一注入的参数是 `params`，所有游戏属性挂在其下。
 *
 * 示例：
 *   check('params.CHR > 5 && params.TLT.includes("talent_001")', { CHR: 10, TLT: ['t_001'] })
 *   → true
 *
 * Math、Date、JSON 等 JS 内置对象天然可用，无需额外注入。
 *
 * @param {string} condition - JS 条件表达式，访问属性用 params.XXX
 * @param {object} properties - 游戏属性对象，如 { CHR: 10, INT: 8, TLT: [...] }
 * @returns {boolean} 条件求值结果
 * @throws {Error} 表达式语法错误或运行时错误
 */
export function check(condition, properties) {
  try {
    // new Function('params', '"use strict"; return (expr)')
    // 以 'params' 为形参名，保证表达式里所有属性通过 params.XXX 访问。
    // "use strict" 避免 this 泄漏到全局。
    const fn = new Function('params', `"use strict"; return (${condition})`)
    // 传入整个 properties 对象作为 params 的值
    return Boolean(fn(properties))
  } catch (e) {
    // 包装错误信息，带上原始条件字符串方便调试
    throw new Error(`Condition evaluation failed: ${e.message}\n  Condition: ${condition}`)
  }
}
