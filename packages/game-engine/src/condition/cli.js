import { check } from './index.js'
import { convertLegacy } from './compat.js'

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

  const cases = [
    // 原版兼容
    { name: '原版: CHR>5', legacy: 'CHR>5', types: {}, expected: true },
    { name: '原版: CHR>5&AGE?[18,25,30]', legacy: 'CHR>5&AGE?[18,25,30]', types: { CHR: 'scalar', AGE: 'scalar' }, expected: true },
    { name: '原版: TLT?[talent_001,talent_003]', legacy: 'TLT?[talent_001,talent_003]', types: { TLT: 'array' }, expected: true },

    // 新语法
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
      displayExpr = c.expr
      result = check(c.expr, DEMO_PROPS)
    } else if ('legacy' in c) {
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
