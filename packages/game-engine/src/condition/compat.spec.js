import { describe, test, expect } from 'vitest'
import { convertLegacy } from './compat.js'
import { check } from './index.js'

describe('compat.js - legacy conversion', () => {
  test('& → &&', () => {
    expect(convertLegacy('CHR>5&INT>3')).toBe('params.CHR > 5 && params.INT > 3')
  })

  test('| → ||', () => {
    expect(convertLegacy('CHR>5|INT>3')).toBe('params.CHR > 5 || params.INT > 3')
  })

  test('mixed & | with parentheses', () => {
    const result = convertLegacy('(CHR>5|INT>3)&MNY>0')
    expect(result).toBe('(params.CHR > 5 || params.INT > 3) && params.MNY > 0')
  })

  test('? with scalar prop', () => {
    const result = convertLegacy('AGE?[18,25,30]', { AGE: 'scalar' })
    expect(result).toBe('[18,25,30].includes(params.AGE)')
  })

  test('? with array prop', () => {
    const result = convertLegacy('TLT?[1001,1002]', { TLT: 'array' })
    expect(result).toBe('params.TLT.some(id => [1001,1002].includes(id))')
  })

  test('! with scalar prop', () => {
    const result = convertLegacy('CHR![1,2,3]', { CHR: 'scalar' })
    expect(result).toBe('![1,2,3].includes(params.CHR)')
  })

  test('! with array prop', () => {
    const result = convertLegacy('TLT![1001]', { TLT: 'array' })
    expect(result).toBe('!params.TLT.some(id => [1001].includes(id))')
  })

  test('= → ===', () => {
    const result = convertLegacy('CHR=5')
    expect(result).toBe('params.CHR === 5')
  })

  test('!= stays !==', () => {
    const result = convertLegacy('CHR!=5')
    expect(result).toBe('params.CHR !== 5')
  })

  test('>= stays >=', () => {
    const result = convertLegacy('CHR>=5')
    expect(result).toBe('params.CHR >= 5')
  })

  test('Math is not prefixed', () => {
    const result = convertLegacy('CHR>5&&Math.random()<0.5')
    expect(result).toContain('params.CHR')
    expect(result).toContain('Math.random')
  })

  test('full old syntax example', () => {
    const result = convertLegacy('CHR>5&AGE?[18,30]|TLT?[1001]', {
      CHR: 'scalar', AGE: 'scalar', TLT: 'array'
    })
    expect(result).toBe(
      'params.CHR > 5 && [18,30].includes(params.AGE) || params.TLT.some(id => [1001].includes(id))'
    )
  })
})

describe('compat.js - conversion correctness', () => {
  const props = { CHR: 10, AGE: 25, TLT: ['t_001', 't_002'] }

  test('converted condition evaluates correctly', () => {
    // AGE=25, so it IS in [18,25,30]
    const cond = convertLegacy('CHR>5&AGE?[18,25,30]', { CHR: 'scalar', AGE: 'scalar' })
    expect(check(cond, props)).toBe(true)
  })

  test('converted false condition', () => {
    // CHR=10 is NOT >15
    const cond = convertLegacy('CHR>15&AGE?[18,30]', { CHR: 'scalar', AGE: 'scalar' })
    expect(check(cond, props)).toBe(false)
  })

  test('converted array prop', () => {
    const cond = convertLegacy('TLT?[t_001,t_003]', { TLT: 'array' })
    expect(check(cond, props)).toBe(true)
  })
})
