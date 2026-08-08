/**
 * param 注册表单元测试 — param-registry.spec.js
 *
 * 覆盖范围：
 *   1. local 参数（本局数据 + low/high 派生联动）
 *   2. derived 参数（from/op、formula）
 *   3. storage 参数（持久化 + 默认值）
 *   4. function 参数（JSON 函数体编译）
 *   5. getAll / 循环依赖
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// 注册表。
import { createParamRegistry } from './param-registry.js'

// #makeStorage
// 内存 storage。
function makeStorage() {
  return { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null }, setItem(k, v) { this._d[k] = String(v) } }
}

// ========== 测试组 1：local ==========
describe('param-registry - local', () => {
  test('stores and reads local value', () => {
    // 注册表。
    const r = createParamRegistry()
    // 定义。
    r.define('CHR', { type: 'local' })
    // reset。
    r.reset({ CHR: 10 })
    // 读。
    expect(r.get('CHR')).toBe(10)
    // 写。
    r.set('CHR', 15)
    expect(r.get('CHR')).toBe(15)
  })

  test('change accumulates with low/high link', () => {
    // 注册表。
    const r = createParamRegistry()
    // 定义（带派生联动）。
    r.define('CHR', { type: 'local', low: 'LCHR', high: 'HCHR' })
    // 定义派生参数。
    r.define('LCHR', { type: 'derived', from: 'CHR', op: 'min' })
    r.define('HCHR', { type: 'derived', from: 'CHR', op: 'max' })
    // reset 含派生初始值。
    r.reset({ CHR: 0, LCHR: Infinity, HCHR: -Infinity })
    // 累加。
    r.change('CHR', 5)
    // 值。
    expect(r.get('CHR')).toBe(5)
    // 高值。
    expect(r.get('HCHR')).toBe(5)
    // 累加。
    r.change('CHR', 3)
    expect(r.get('CHR')).toBe(8)
    expect(r.get('HCHR')).toBe(8)
    expect(r.get('LCHR')).toBe(5)
  })

  test('array change adds and removes id', () => {
    // 注册表。
    const r = createParamRegistry()
    // 定义数组参数（含 ATLT 联动用占位）。
    r.define('TLT', {
      type: 'array',
      change: "if (Array.isArray(v)) { v.forEach(x => ctx.change('TLT', x)); return; } const id = String(v); const isRemove = id.startsWith('-'); const target = isRemove ? id.slice(1) : id; const arr = ctx.data.TLT; if (isRemove) { const i = arr.indexOf(target); if (i !== -1) arr.splice(i, 1); } else if (!arr.includes(id)) { arr.push(id); }",
    })
    // reset。
    r.reset({ TLT: [] })
    // 添加。
    r.change('TLT', 't1')
    expect(r.get('TLT')).toContain('t1')
    // 去重。
    r.change('TLT', 't1')
    expect(r.get('TLT')).toHaveLength(1)
    // 移除。
    r.change('TLT', '-t1')
    expect(r.get('TLT')).toHaveLength(0)
  })
})

// ========== 测试组 2：derived ==========
describe('param-registry - derived', () => {
  test('from/op max/min', () => {
    // 注册表。
    const r = createParamRegistry()
    // 定义。
    r.define('CHR', { type: 'local' })
    r.define('HCHR', { type: 'derived', from: 'CHR', op: 'max' })
    // reset。
    r.reset({ CHR: 5, HCHR: 3 })
    // 当前值取 max(存储, 基础)。
    expect(r.get('HCHR')).toBe(5)
    // 改基础。
    r.set('CHR', 2)
    expect(r.get('HCHR')).toBe(3)
  })

  test('formula computes derived value', () => {
    // 注册表。
    const r = createParamRegistry()
    // 定义。
    r.define('CHR', { type: 'local' })
    r.define('INT', { type: 'local' })
    r.define('SUM', { type: 'derived', formula: 'CHR + INT * 2' })
    // reset。
    r.reset({ CHR: 3, INT: 4 })
    // 公式。
    expect(r.get('SUM')).toBe(11)
  })
})

// ========== 测试组 3：storage ==========
describe('param-registry - storage', () => {
  test('persists via storage adapter', () => {
    // storage。
    const storage = makeStorage()
    // 注册表。
    const r = createParamRegistry({ storage })
    // 定义。
    r.define('TMS', { type: 'storage', storeKey: 'times', default: 0 })
    // 默认。
    expect(r.get('TMS')).toBe(0)
    // 写。
    r.set('TMS', 3)
    // 读。
    expect(r.get('TMS')).toBe(3)
    // storage 里持久化。
    expect(JSON.parse(storage.getItem('times'))).toBe(3)
  })

  test('array storage default', () => {
    // 注册表。
    const r = createParamRegistry({ storage: makeStorage() })
    // 定义。
    r.define('ATLT', { type: 'storage', array: true, default: [] })
    // 默认数组。
    expect(r.get('ATLT')).toEqual([])
  })
})

// ========== 测试组 4：function ==========
describe('param-registry - function', () => {
  test('compiles JSON function body with ctx', () => {
    // 注册表。
    const r = createParamRegistry()
    // 定义基础。
    r.define('CHR', { type: 'local' })
    r.define('TMS', { type: 'local' })
    // 定义 function 参数。
    r.define('MOD_X', {
      type: 'function',
      get: "return ctx.get('CHR') * ctx.get('TMS')",
    })
    // reset。
    r.reset({ CHR: 5, TMS: 2 })
    // 函数体求值。
    expect(r.get('MOD_X')).toBe(10)
  })

  test('function set writes value', () => {
    // 注册表。
    const r = createParamRegistry()
    // 定义。
    r.define('X', {
      type: 'function',
      get: "return ctx.data._x || 0",
      set: "ctx.data._x = v",
    })
    // reset。
    r.reset({})
    // 写。
    r.set('X', 42)
    // 读。
    expect(r.get('X')).toBe(42)
  })
})

// ========== 测试组 5：getAll / 循环 ==========
describe('param-registry - getAll & cycle', () => {
  test('getAll expands all non-special params', () => {
    // 注册表。
    const r = createParamRegistry()
    // 定义。
    r.define('CHR', { type: 'local' })
    r.define('RDM', { type: 'special' })
    // reset。
    r.reset({ CHR: 7 })
    // 展开（不含 special）。
    const all = r.getAll()
    expect(all.CHR).toBe(7)
    expect('RDM' in all).toBe(false)
  })

  test('cycle detection returns undefined', () => {
    // 注册表。
    const r = createParamRegistry()
    // 循环 A→B→A。
    r.define('A', { type: 'function', get: "return ctx.get('B')" })
    r.define('B', { type: 'function', get: "return ctx.get('A')" })
    // reset。
    r.reset({})
    // 求值不抛错。
    expect(r.get('A')).toBeUndefined()
  })
})
