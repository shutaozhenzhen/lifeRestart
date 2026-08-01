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

// #check
// 将字符串形式的 JS 条件表达式编译为函数并求值。
// 输入是字符串，输出是布尔值——这是整个 condition 引擎的唯一对外入口。
//
// 【允许修改 params】设计约定（有意为之，非缺陷）：
//   params 直接引用调用方传入的 properties 对象，不做拷贝、不冻结。
//   条件表达式可以在求值的同时改写游戏属性（如 params.CHR += 10），
//   这允许"触发型效果"直接内嵌在 condition 里，无需单独 effect 机制。
//   代价：条件不再纯函数、有副作用，调用方需自行保证求值顺序与重复调用安全。
//   注意：这仍是"无沙箱"设计——params 是整个对象引用，可触达其原型链。
export function check(condition, properties) {
  // try...catch 包裹整个求值过程，将 JS 引擎的原始错误包装为更友好的消息。
  try {
    // new Function 是 JS 的"编译期"调用——将字符串源代码编译为可调用的函数对象。
    // 第一个参数 'params' 是函数形参名。
    // 第二个参数是函数体字符串：
    //   "use strict" 启用严格模式，防止误用全局 this；
    //   return (condition) 将条件表达式的结果返回。
    //   condition 两侧的括号 () 使 return 后面可以跟多行表达式或逗号表达式。
    const fn = new Function('params', `"use strict"; return (${condition})`)
    // Boolean() 将求值结果强制转换为布尔值，处理 truthy/falsy 值。
    // fn(properties) 将调用方传入的 properties 对象原引用作为 params 传入。
    // 属性对象中的键（如 CHR、INT）在函数体内通过 params.CHR、params.INT 访问。
    // 由于传的是原引用，条件里的写入（params.CHR = 0）会真实改写调用方对象。
    return Boolean(fn(properties))
  } catch (e) {
    // 捕获 SyntaxError（语法错误）和 TypeError（运行时类型错误）等。
    // 原始错误信息可能不包含输入条件，重新包装后方便调试定位。
    throw new Error(`Condition evaluation failed: ${e.message}\n  Condition: ${condition}`)
  }
}
