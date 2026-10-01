/**
 * life-storage 单元测试 — 引擎存储适配器
 *
 * 覆盖：
 *   1. 键前缀（不污染前端自己的 localStorage 键）
 *   2. 读写往返与缺失返回 null（引擎 lsget 依赖该语义）
 *   3. 主存储抛错时退回内存（配额超限 / 隐私模式不能崩）
 *   4. 无 localStorage 环境（Node）仍可用
 */

// 导入 vitest DSL。
import { describe, test, expect, vi } from 'vitest'
// 被测模块。
import { createLifeStorage, DEFAULT_PREFIX } from './life-storage.js'

// #fakeStorage
// 造一个底层存储替身（记录调用）。
function fakeStorage() {
  // 数据。
  const data = {}
  // 替身。
  return {
    data,
    // 读取。
    getItem: vi.fn((k) => (k in data ? data[k] : null)),
    // 写入。
    setItem: vi.fn((k, v) => { data[k] = String(v) }),
  }
}

describe('life-storage - createLifeStorage', () => {
  test('prefixes keys so it does not clash with frontend keys', () => {
    // 底层替身。
    const store = fakeStorage()
    // 适配器。
    const storage = createLifeStorage({ storage: store })
    // 写「重开次数」。
    storage.setItem('times', '3')
    // 底层收到带前缀的键。
    expect(store.data[`${DEFAULT_PREFIX}times`]).toBe('3')
    // 前端自己的键不受影响。
    expect(store.data.times).toBeUndefined()
  })

  test('round-trips values and returns null when missing', () => {
    // 适配器（自定义前缀）。
    const storage = createLifeStorage({ storage: fakeStorage(), prefix: 'lr:' })
    // 缺失 → null（引擎据此判断"没有存档"）。
    expect(storage.getItem('ACHV')).toBe(null)
    // 写入后读回。
    storage.setItem('ACHV', '[[153,1]]')
    expect(storage.getItem('ACHV')).toBe('[[153,1]]')
  })

  test('falls back to memory when the primary storage throws', () => {
    // 底层替身：读取抛错、写入抛错（模拟配额超限）。
    const broken = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('quota') },
    }
    // 适配器。
    const storage = createLifeStorage({ storage: broken })
    // 写入不抛。
    expect(() => storage.setItem('times', '5')).not.toThrow()
    // 读取回退到内存副本。
    expect(storage.getItem('times')).toBe('5')
  })

  test('works without any storage available (Node)', () => {
    // 显式传 null：不使用全局 localStorage。
    const storage = createLifeStorage({ storage: null, prefix: 'x:' })
    // 无底层时读为 null。
    expect(storage.getItem('times')).toBe(null)
    // 内存仍可写读。
    storage.setItem('times', '1')
    expect(storage.getItem('times')).toBe('1')
  })

  test('uses injected storage over globals', () => {
    // 注入优先。
    const store = fakeStorage()
    const storage = createLifeStorage({ storage: store })
    storage.setItem('k', 'v')
    // 只写注入的替身。
    expect(store.setItem).toHaveBeenCalledWith(`${DEFAULT_PREFIX}k`, 'v')
  })
})
