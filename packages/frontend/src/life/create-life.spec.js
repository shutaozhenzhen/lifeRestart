/**
 * create-life 契约测试 —— 守护"应用侧到底怎么构造/驱动引擎"这条接线
 *
 * 为什么单独有这一层（真实故障复盘）：
 *   属性页崩溃（remake 前读点数）、总结页空值（judge 缺省）、重开次数恒 0（storage 未注入）
 *   这三类问题的共同点是：**引擎模块各自没问题，前端少传/错序才出问题**。
 *   本文件把"应用标准装配"下必须成立的四条契约钉死：
 *     1. config() 空参 → summary/statistics 必须有值（judge 默认表生效）
 *     2. remake 之前就能读 getPropertyPoints（属性页先读数）
 *     3. 注入 storage → 数据跨实例保留（重开次数/成就）
 *     4. 不传 logger / 不传 storage 也不能崩（安全默认）
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测对象（应用侧唯一构造入口）。
import { createAppLife } from './create-life.js'
// 存储适配器（契约 3 用）。
import { createLifeStorage } from '../utils/life-storage.js'
// 工具与 fixture。
import { clone } from 'game-engine/src/functions/util.js'
import { AGE_DATA, TOTAL } from 'game-engine/src/fixtures/property.fixture.js'
import { TALENTS, EVENTS } from 'game-engine/src/fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from 'game-engine/src/fixtures/achievement-character.fixture.js'

// #buildData
// 组装 fixture 数据。
function buildData() {
  // 返回数据对象。
  return {
    age: clone(AGE_DATA),
    total: TOTAL,
    talents: clone(TALENTS),
    events: clone(EVENTS),
    achievements: clone(ACHIEVEMENTS),
    characters: {},
  }
}

// #memoryStorage
// 内存存储替身（模拟 localStorage）。
function memoryStorage() {
  // 数据。
  const data = {}
  // 替身。
  return {
    data,
    getItem(k) { return k in data ? data[k] : null },
    setItem(k, v) { data[k] = String(v) },
  }
}

// #makeStarted
// 按前端真实顺序造一局（initial → config 空参 → remake → start）。
//
// @param {object} [deps] - 透传给 createAppLife 的依赖
// @returns {Promise<object>} Life 实例
async function makeStarted(deps = {}) {
  // 构造。
  const life = createAppLife({ data: buildData(), ...deps })
  // 初始化。
  await life.initial()
  // 配置（**空参**：与 store.init 完全一致，这是关键）。
  life.config()
  // 选天赋 + 开局。
  life.remake([])
  life.start({ CHR: 5 })
  // 返回。
  return life
}

describe('create-life 接线契约', () => {
  test('契约 1：config() 空参下 summary/statistics 必须有值（judge 默认表生效）', async () => {
    // 造一局。
    const life = await makeStarted()
    // 推进一年（让 H* 派生值有真实数据）。
    life.next()
    // 七个总结项。
    for (const key of ['SUM', 'HAGE', 'HCHR', 'HINT', 'HSTR', 'HMNY', 'HSPR']) {
      expect(life.summary[key], `${key} 缺少评价`).toBeDefined()
      expect(life.summary[key].judge, `${key} 评价键`).toMatch(/^J_/)
    }
    // 四个统计项。
    for (const key of ['TMS', 'CACHV', 'RTLT', 'REVT']) {
      expect(life.statistics[key], `${key} 缺少评价`).toBeDefined()
      expect(life.statistics[key].judge, `${key} 评价键`).toMatch(/^J_/)
    }
  })

  test('契约 2：remake 之前可读 getPropertyPoints（属性页先读数）', () => {
    // 只构造 + 配置，不 remake（属性分配页的真实场景）。
    const life = createAppLife({ data: buildData() })
    // 返回 promise：initial 需要 await，这里单独处理。
    return life.initial().then(() => {
      // 配置。
      life.config()
      // 不抛。
      expect(() => life.getPropertyPoints()).not.toThrow()
      // 尚无天赋加成 → 等于默认点数。
      expect(life.getPropertyPoints()).toBe(20)
    })
  })

  test('契约 3：注入 storage → 重开次数跨实例保留', async () => {
    // 共享同一存储（模拟 localStorage）。
    const storage = createLifeStorage({ storage: memoryStorage() })
    // 第一局：写入次数。
    const a = createAppLife({ data: buildData(), storage })
    await a.initial()
    a.config()
    a.times = 2
    // 第二局（新实例，模拟刷新后重新开始）。
    const b = createAppLife({ data: buildData(), storage })
    await b.initial()
    b.config()
    // 读回（未注入 storage 时恒为 0）。
    expect(b.times).toBe(2)
  })

  test('契约 4：不传 logger/storage 也不能崩（安全默认）', async () => {
    // 最小装配。
    const life = createAppLife({ data: buildData() })
    // 初始化 + 配置 + 开局 + 推进：全程不抛。
    await life.initial()
    life.config()
    life.remake([])
    life.start({})
    expect(() => life.next()).not.toThrow()
    // 且 summary 仍可用（默认 judge 生效）。
    expect(life.summary.SUM).toBeDefined()
  })

  test('契约 5：emit 透传到引擎（成就达成 → 界面才能弹提示）', async () => {
    // 收集事件。
    const events = []
    // 装配时注入总线。
    const life = createAppLife({ data: buildData(), emit: (tag, payload) => events.push([tag, payload]) })
    // 初始化 + 配置。
    await life.initial()
    life.config()
    // 开局（START 时机会检测成就）。
    life.remake([])
    life.start({ CHR: 5 })
    // 至少收到一个 achievement 事件，且负载是可展示的成就对象。
    const achievementEvents = events.filter(([tag]) => tag === 'achievement')
    expect(achievementEvents.length).toBeGreaterThan(0)
    // 负载含 id 与 name（页面直接渲染）。
    expect(achievementEvents[0][1].id).toBeTruthy()
    expect(achievementEvents[0][1].name).toBeTruthy()
  })
})
