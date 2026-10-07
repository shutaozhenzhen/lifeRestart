/**
 * gameAPI 小缺口补齐回归（2026-10 能力补齐 ⑤）
 *
 * 这几条都是"以前没有、只能绕路"的能力，所以用例刻意断言**绕路也能被替代**：
 *   · `log.*`  —— 接宿主日志器（Node / 打包环境里 console 不进日志面板）
 *   · `storage.*` —— 跨局存储，命名空间 `mod:<Mod 名>:`，与引擎键隔离
 *   · characters / age / achievement 的 CRUD（含 remove）
 *   · `list(table)` —— 列举条目（以前只能 Object.keys(gameAPI.data.xxx)）
 *   · `dispose()` —— 一次性摘掉本 Mod 注册的全部钩子（防"幽灵钩子"）
 */
import { describe, test, expect } from 'vitest'
// gameAPI 工厂。
import { createGameAPI, createHookBus } from './gameapi.js'

// #memStorage
// 内存 storage（带 keys 枚举，模拟 localStorage 适配器）。
function memStorage() {
  // 底层。
  const m = new Map()
  // 适配器。
  return {
    // 读。
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    // 写。
    setItem: (k, v) => { m.set(k, String(v)) },
    // 删。
    removeItem: (k) => { m.delete(k) },
    // 枚举（「重置数据」按前缀扫 Mod 键要用）。
    keys: () => [...m.keys()],
    // 测试直查。
    __map: m,
  }
}

// #makeLog
// 收集日志调用的假日志器。
function makeLog() {
  // 收集。
  const lines = []
  // 四个级别都记。
  return { lines, debug: (m) => lines.push(['debug', m]), info: (m) => lines.push(['info', m]), warn: (m) => lines.push(['warn', m]), error: (m) => lines.push(['error', m]) }
}

describe('gameAPI - log / storage / dispose（2026-10 补齐）', () => {
  test('log.* 走宿主日志器并带 Mod 名前缀', () => {
    // 假日志器 + API。
    const log = makeLog()
    const api = createGameAPI({ data: {}, log, modName: 'demo' })
    // 打四种。
    api.log.debug('a', 1)
    api.log.info('b')
    api.log.warn('c')
    api.log.error('d')
    // 每条都带前缀，且级别正确。
    expect(log.lines.map(([lv]) => lv)).toEqual(['debug', 'info', 'warn', 'error'])
    expect(log.lines[0][1]).toBe('[mod:demo] a 1')
    expect(log.lines[3][1]).toBe('[mod:demo] d')
  })

  test('log 在缺级别的日志器上也不炸（缺省实现只有 debug/error）', () => {
    // 只有 debug/error 的日志器。
    const api = createGameAPI({ data: {}, log: { debug: () => {}, error: () => {} }, modName: 'x' })
    // info/warn 回落到 debug，不抛。
    expect(() => { api.log.info('i'); api.log.warn('w') }).not.toThrow()
  })

  test('storage.* 命名空间隔离 + JSON 往返 + 缺省值', () => {
    // 存储 + API。
    const storage = memStorage()
    const api = createGameAPI({ data: {}, storage, modName: 'demo' })
    // 缺失给 fallback。
    expect(api.storage.get('score', 0)).toBe(0)
    // 写读往返（对象）。
    api.storage.set('score', { a: 1 })
    expect(api.storage.get('score')).toEqual({ a: 1 })
    // 底层键带命名空间（与引擎键隔离）。
    expect(storage.__map.has('mod:demo:score')).toBe(true)
    // 不同 Mod 互不干扰。
    const other = createGameAPI({ data: {}, storage, modName: 'other' })
    expect(other.storage.get('score', 'none')).toBe('none')
    // keys 只看自己的。
    api.storage.set('k2', 2)
    expect(api.storage.keys().sort()).toEqual(['k2', 'score'])
    // 删除。
    api.storage.remove('score')
    expect(api.storage.get('score', 'gone')).toBe('gone')
  })

  test('storage：坏数据 / 无 storage 的行为都是明确的', () => {
    // 存储里塞坏 JSON。
    const storage = memStorage()
    storage.setItem('mod:demo:bad', '{oops')
    const api = createGameAPI({ data: {}, storage, modName: 'demo' })
    // 坏数据 → fallback（不炸）。
    expect(api.storage.get('bad', 'fb')).toBe('fb')
    // 没有 storage：读给 fallback、**写给可读错误**（静默丢弃是最难查的）。
    const api2 = createGameAPI({ data: {}, modName: 'demo' })
    expect(api2.storage.get('x', 'fb')).toBe('fb')
    expect(() => api2.storage.set('x', 1)).toThrow(/没有可用的 storage/)
    expect(api2.storage.keys()).toEqual([])
  })

  test('dispose() 摘掉本 Mod 注册的全部钩子，且不影响别人的', () => {
    // 共享总线（两个 Mod 各注册一个）。
    const bus = createHookBus()
    const a = createGameAPI({ data: {}, hooks: bus, modName: 'a' })
    const b = createGameAPI({ data: {}, hooks: bus, modName: 'b' })
    // 各注册两个。
    a.on('onYearAdvance', () => {})
    a.on('propertyChange', () => {})
    b.on('onYearAdvance', () => {})
    // 总线计数。
    expect(bus.list().onYearAdvance).toBe(2)
    // 卸载 a。
    expect(a.dispose()).toBe(2)
    // a 的没了，b 的还在。
    expect(bus.list().onYearAdvance).toBe(1)
    expect(bus.list().propertyChange).toBe(0)
    // 再卸载一次是 0（幂等）。
    expect(a.dispose()).toBe(0)
  })

  test('off() 会把登记表也清掉（dispose 不会重复摘）', () => {
    // 总线 + API。
    const bus = createHookBus()
    const api = createGameAPI({ data: {}, hooks: bus, modName: 'a' })
    // 注册后手动注销。
    const fn = () => {}
    api.on('onYearAdvance', fn)
    api.off('onYearAdvance', fn)
    // 登记表已空 → dispose 摘 0 个。
    expect(api.dispose()).toBe(0)
  })
})

describe('gameAPI - 数据 CRUD 缺口（characters / age / achievement / list）', () => {
  test('成就可以 remove 了（以前只有 add/get）', () => {
    // API。
    const api = createGameAPI({ data: { achievements: {} } })
    // 加。
    api.addAchievement({ id: 'a1', name: '成就一' })
    expect(api.getAchievement('a1').name).toBe('成就一')
    // 删（2026-10 补齐）。
    api.removeAchievement('a1')
    expect(api.getAchievement('a1')).toBeUndefined()
    // 删不存在的也不炸。
    expect(() => api.removeAchievement('nope')).not.toThrow()
  })

  test('名人 CRUD：主键是条目自己的 id', () => {
    // API。
    const api = createGameAPI({ data: {} })
    // 加（带 id）。
    api.addCharacter({ id: 'c1', name: '张三', property: '{"CHR":5}', talent: ['1001'] })
    expect(api.getCharacter('c1').name).toBe('张三')
    // 删。
    api.removeCharacter('c1')
    expect(api.getCharacter('c1')).toBeUndefined()
  })

  test('年龄表 CRUD：键是年龄字符串，addAge 是整键替换', () => {
    // API（原表里有 1 岁）。
    const api = createGameAPI({ data: { age: { 1: { age: 1, event: [['10009', 20]] } } } })
    // 读（数字键也认）。
    expect(api.getAge(1).event).toEqual([['10009', 20]])
    // 加/替换（整键替换：原条目不在新值里就没了 —— 这是真语义，不是 bug）。
    api.addAge(1, { age: 1, event: [['90001', 20], ['10009', 20]] })
    expect(api.getAge('1').event.length).toBe(2)
    // 删。
    api.removeAge(1)
    expect(api.getAge(1)).toBeUndefined()
  })

  test('list(table)：列举条目，未知表名给空数组', () => {
    // API。
    const api = createGameAPI({ data: { talents: { t1: { id: 't1' }, t2: { id: 't2' } }, events: { e1: { id: 'e1' } } } })
    // 天赋。
    expect(api.list('talents').map((t) => t.id).sort()).toEqual(['t1', 't2'])
    // 事件。
    expect(api.list('events').length).toBe(1)
    // 未知表名。
    expect(api.list('nope')).toEqual([])
    // 缺失表。
    expect(api.list('characters')).toEqual([])
  })
})
