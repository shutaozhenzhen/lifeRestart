/**
 * condition 引擎 CLI 原型
 *
 * 运行方式：node src/condition/cli.js
 *
 * 展示新旧两种语法的求值过程，输出可视化结果。
 * 用于验证 condition 引擎在命令行交互场景下的正确性。
 * 同时也是将游戏逻辑从 LayaAir 中剥离后的第一个可运行原型。
 */

import { check } from './index.js'
import { convertLegacy } from './compat.js'

/**
 * 测试用的虚拟属性数据。模拟游戏中的属性面板数据：
 *   CHR（颜值）、INT（智力）、STR（体质）、MNY（财富）、
 *   SPR（快乐）、LIF（寿命）、AGE（年龄）、
 *   TLT（已获天赋ID列表）、EVT（已触事件ID列表）
 */
const DEMO_PROPS = {
  CHR: 10,
  INT: 8,
  STR: 5,
  MNY: 1000,
  SPR: 60,
  LIF: 1,
  AGE: 25,
  TLT: ['talent_001', 'talent_002'],
  EVT: ['event_001'],
  ZERO: 0,
  NEG: -5,
}

function runDemo() {
  console.log('=== condition 引擎 CLI 原型 ===\n')

  // 测试用例定义
  // legacy = 旧语法字符串，通过 compat 转换后求值
  // expr   = 新语法字符串，直接求值
  // types  = propTypes 映射，告知旧语法转换器哪些属性是数组
  // expected = 期望结果
  const cases = [
    // 旧语法兼容用例
    { name: '原版: CHR>5', legacy: 'CHR>5', types: {}, expected: true },
    { name: '原版: CHR>5&AGE?[18,25,30]', legacy: 'CHR>5&AGE?[18,25,30]', types: { CHR: 'scalar', AGE: 'scalar' }, expected: true },
    { name: '原版: TLT?[talent_001,talent_003]', legacy: 'TLT?[talent_001,talent_003]', types: { TLT: 'array' }, expected: true },

    // 新语法用例
    { name: '新: 直接比较', expr: 'params.CHR > 5 && params.INT > 3', expected: true },
    { name: '新: 数组中包含', expr: 'params.TLT.includes("talent_001")', expected: true },
    { name: '新: Math.max', expr: 'Math.max(params.CHR, params.INT, params.STR) === 10', expected: true },
    { name: '新: 算术', expr: 'params.CHR + params.INT > 15', expected: true },
    { name: '新: 复杂组合', expr: '(params.CHR > 15 || params.INT > 5) && params.MNY > 500', expected: true },
    { name: '新: 错误条件不满足', expr: 'params.CHR > 15', expected: false },
  ]

  let passed = 0
  let failed = 0

  for (const c of cases) {
    let result
    let displayExpr

    if ('expr' in c) {
      // 新语法：直接求值
      displayExpr = c.expr
      result = check(c.expr, DEMO_PROPS)
    } else if ('legacy' in c) {
      // 旧语法：先转换再求值，显示屏显转换过程
      const converted = convertLegacy(c.legacy, c.types)
      displayExpr = `${c.legacy}  →  ${converted}`
      result = check(converted, DEMO_PROPS)
    }

    const ok = result === c.expected
    const icon = ok ? '✓' : '✗'
    console.log(`  ${icon} ${c.name}`)
    console.log(`     条件: ${displayExpr}`)
    console.log(`     结果: ${result} (期望: ${c.expected})`)

    if (ok) passed++
    else failed++
  }

  console.log(`\n  通过: ${passed}, 失败: ${failed}, 总计: ${cases.length}\n`)

  if (failed === 0) {
    console.log('All checks passed!')
  }
}

runDemo()
