/**
 * condition 引擎 CLI 原型
 *
 * 运行方式：node src/condition/cli.js
 *
 * 展示新旧两种语法的求值过程，输出可视化结果。
 * 用于验证 condition 引擎在命令行交互场景下的正确性。
 * 同时也是将游戏逻辑从 LayaAir 中剥离后的第一个可运行原型。
 */

// #imports
// 从同一目录导入核心函数。
// 使用相对路径，保持 ES module 兼容。
import { check } from './index.js'      // check() — 条件求值
import { convertLegacy } from './compat.js' // convertLegacy() — 旧语法转换

// #DEMO_PROPS
// 测试用的虚拟属性数据。
// 模拟游戏中的属性面板数据：
//   CHR（颜值）、INT（智力）、STR（体质）、MNY（财富）、
//   SPR（快乐）、LIF（寿命）、AGE（年龄）、
//   TLT（已获天赋ID列表）、EVT（已触事件ID列表）。
const DEMO_PROPS = {
  CHR: 10,                      // 颜值 10
  INT: 8,                       // 智力 8
  STR: 5,                       // 体质 5
  MNY: 1000,                    // 财富 1000
  SPR: 60,                      // 快乐 60
  LIF: 1,                       // 寿命 1（存活状态）
  AGE: 25,                      // 年龄 25 岁
  TLT: ['talent_001', 'talent_002'], // 已获取天赋的 ID 列表
  EVT: ['event_001'],           // 已触发事件的 ID 列表
  ZERO: 0,                      // 值为 0
  NEG: -5,                      // 值为 -5
}

// #runDemo
// 执行全部演示用例，打印结果。
function runDemo() {
  // 输出标题。
  console.log('=== condition 引擎 CLI 原型 ===\n')

  // #cases
  // 测试用例数组。
  // 两种条件形式：
  //   legacy: 旧语法字符串，通过 compat 转换后求值。
  //   expr:   新语法字符串，直接求值。
  // types: propTypes 映射，告知旧语法转换器哪些属性是数组。
  // expected: 期望结果（true 或 false）。
  const cases = [
    // 旧语法兼容用例
    // 简单数值比较。
    { name: '原版: CHR>5', legacy: 'CHR>5', types: {}, expected: true },
    // 复合条件：逻辑与 + 成员判断。
    // AGE=25 在列表 [18,25,30] 中，所以结果为 true。
    { name: '原版: CHR>5&AGE?[18,25,30]', legacy: 'CHR>5&AGE?[18,25,30]', types: { CHR: 'scalar', AGE: 'scalar' }, expected: true },
    // 数组属性成员判断。
    // TLT 包含 talent_001，所以结果为 true。
    { name: '原版: TLT?[talent_001,talent_003]', legacy: 'TLT?[talent_001,talent_003]', types: { TLT: 'array' }, expected: true },

    // 新语法用例
    // 直接使用 JS 比较操作符。
    { name: '新: 直接比较', expr: 'params.CHR > 5 && params.INT > 3', expected: true },
    // 数组方法 .includes()。
    { name: '新: 数组中包含', expr: 'params.TLT.includes("talent_001")', expected: true },
    // Math 函数：求三个属性的最大值并比较。
    { name: '新: Math.max', expr: 'Math.max(params.CHR, params.INT, params.STR) === 10', expected: true },
    // 算术运算：加法。
    { name: '新: 算术', expr: 'params.CHR + params.INT > 15', expected: true },
    // 括号分组 + 混合逻辑。
    { name: '新: 复杂组合', expr: '(params.CHR > 15 || params.INT > 5) && params.MNY > 500', expected: true },
    // 条件不满足的场景。
    { name: '新: 错误条件不满足', expr: 'params.CHR > 15', expected: false },
  ]

  // 计数器：记录通过和失败的用例数。
  let passed = 0
  let failed = 0

  // 遍历所有测试用例。
  for (const c of cases) {
    // 求值结果和显示屏显表达式。
    let result
    let displayExpr

    // 根据用例类型选择不同的求值路径。
    if ('expr' in c) {
      // 新语法用例：直接调用 check()。
      displayExpr = c.expr
      result = check(c.expr, DEMO_PROPS)
    } else if ('legacy' in c) {
      // 旧语法用例：先调用 convertLegacy() 转换，再调用 check()。
      // 显示屏显转换过程（旧语法 → 新语法）。
      const converted = convertLegacy(c.legacy, c.types)
      displayExpr = `${c.legacy}  →  ${converted}`
      result = check(converted, DEMO_PROPS)
    }

    // 判断结果是否符合预期。
    const ok = result === c.expected
    // 通过用 ✓，失败用 ✗。
    const icon = ok ? '✓' : '✗'
    console.log(`  ${icon} ${c.name}`)
    console.log(`     条件: ${displayExpr}`)
    console.log(`     结果: ${result} (期望: ${c.expected})`)

    // 累加计数器。
    if (ok) passed++
    else failed++
  }

  // 输出汇总结果。
  console.log(`\n  通过: ${passed}, 失败: ${failed}, 总计: ${cases.length}\n`)

  // 全部通过时输出祝贺信息。
  if (failed === 0) {
    console.log('All checks passed!')
  }
}

// #entryPoint
// 执行演示函数。
runDemo()
