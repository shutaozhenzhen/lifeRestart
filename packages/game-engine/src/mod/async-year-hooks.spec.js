/**
 * 异步逐岁介入（2026-10 能力补齐 ④）—— `life.nextAsync()` / `onBeforeYear` / `onAfterYear`
 *
 * 这条能力以前是**硬边界**（`AGENTS.md` 边界 ②）：`life.next()` 是同步函数，三个逐岁钩子走
 * `emitSync`，async 回调返回的 Promise 被直接丢弃 —— 于是"某年去后端取一句剧情塞进当年轨迹"
 * 做不到（晚到的改动不会进当年，store 已经在 `next()` 返回时做了快照）。
 *
 * 本能力的**第一约束**是"没有异步 Mod 时一切照旧"，所以这里有两组用例：
 *   A. 异步路径真的能 await（内容进当年轨迹、慢钩子被等、超时/抛错被隔离）；
 *   B. **同步路径一个字不变**（`next()` 仍同步：返回值不是 Promise、不触发 onBeforeYear /
 *      onAfterYear、随机数消耗顺序与 nextAsync 完全一致）。
 */
import { describe, test, expect, beforeEach } from 'vitest'
// Node 内置：路径 / 文件读取（教学样板与真实数据）+ 临时目录（跳过策略用例）。
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
// 引擎：Life 主体。
import Life from '../modules/life.js'
// 钩子总线 + 异步分发（**唯一实现**）。
import { createHookBus, createGameAPI, emitYearHooksAsync, resolveWithTimeout, DEFAULT_ASYNC_TIMEOUT_MS } from './gameapi.js'
// Mod 加载器 / Node 文件源（跳过策略的接线）。
import { createModLoader } from './loader.js'
import { createNodeSource } from './source-node.js'
// 批量场景的跳过策略（sim 与 consistency 共用同一处实现）。
import { modsToSkip } from './manifest.js'
import { skipPolicyWarning } from '../sim/simulator.js'
import { simulateCli } from '../cli/simulate.cli.js'
import { consistencySkipPolicy, runConsistency } from '../cli/consistency.cli.js'
// manifest：`async` / `asyncHooks` 的校验与取值助手。
import { validateManifest, manifestAsync, manifestAsyncHooks, hooksToAwait, YEAR_HOOKS } from './manifest.js'
// 种子 RNG（同种子可复现）。
import { createRng } from '../functions/util.js'

// #makeLogger
// 记录日志的替身（断言"有没有出声"必须能读到内容；真实 logger 也能用，但不便于断言）。
//
// @returns {{warn: Function, error: Function, debug: Function, trace: Function, info: Function, lines: string[]}}
function makeLogger() {
  // 收集到的行。
  const lines = []
  // 统一格式：级别前缀 + 消息。
  const push = (level) => (msg, ...rest) => { lines.push(`[${level}] ${[msg, ...rest].join(' ')}`) }
  // 返回（含 child：Life 会给各子模块建子日志器）。
  const logger = { lines, warn: push('warn'), error: push('error'), debug: push('debug'), trace: push('trace'), info: push('info') }
  // 子日志器（与父共享 lines，便于断言）。
  logger.child = () => logger
  // 级别切换（Life.setLogLevel 会调）。
  logger.setLevel = () => {}
  // 返回。
  return logger
}

// #makeData
// 极小的、**完全确定**的数据集（fast 单测；真实数据留给复现性回归）。
//
// ⚠️ 引擎的年龄从 **0 岁**开始（`start()` 后 AGE=-1，第一次 `ageNext()` 变 0），
// 所以这里覆盖 0~4 岁。
//
// @returns {object} Life 数据
function makeData() {
  // 年龄表（0~4 岁各一个必中事件）。
  const age = {}
  // 逐岁。
  for (let a = 0; a <= 4; a++) {
    // 唯一候选（权重 100）。
    age[String(a)] = { age: a, event: [[`e${a}`, 100]], talent: [] }
  }
  // 返回。
  return {
    // 年龄表。
    age,
    // 天赋表（空，避免抽卡随机）。
    talents: {},
    // 事件表（**不要写 NoRandom**：写了就禁止随机触发，当岁抽不到它 —— 这正是示例 Mod
    // 注释里反复强调的那个字段）。
    events: {
      // 逐岁事件（固定 ID 与描述）。
      e0: { id: 'e0', event: '零岁的事', effect: { SPR: 1 } },
      e1: { id: 'e1', event: '一岁的事', effect: { SPR: 1 } },
      e2: { id: 'e2', event: '两岁的事', effect: { SPR: 1 } },
      e3: { id: 'e3', event: '三岁的事', effect: { SPR: 1 } },
      e4: { id: 'e4', event: '四岁的事', effect: { SPR: 1 } },
    },
    // 成就 / 名人（空）。
    achievements: {},
    characters: {},
    // 总量（条件里的比率参数分母）。
    total: { TACHV: 0, TEVT: 5, TTLT: 0 },
  }
}

// #makeLife
// 造一个就绪的 Life（`initial → config → start`），返回 { life, bus, log }。
//
// @param {object} [params]
// @param {object} [params.hooks] - 钩子总线（缺省新建）
// @param {number} [params.seed] - 种子
// @returns {Promise<{life: object, bus: object, log: object}>}
async function makeLife({ hooks, seed = 42 } = {}) {
  // 总线。
  const bus = hooks || createHookBus()
  // 日志器（断言 warn 用）。
  const log = makeLogger()
  // Life。
  const life = new Life({ data: makeData(), random: createRng(seed), hooks: bus, logger: log })
  // 初始化 + 配置 + 开局。
  await life.initial()
  // 配置（空参 → 内置 judge 分档）。
  life.config()
  // 开局（固定分配，排除随机）。
  life.start({ CHR: 5, INT: 5, STR: 5, MNY: 5, SPR: 5 })
  // 生命给足（避免 5 岁前死掉，影响逐年断言）。
  life.request('PROPERTY').set('LIF', 100)
  // 返回。
  return { life, bus, log }
}

// #ids
// 把一年轨迹压成"可比较的描述数组"。
//
// @param {Array} content - 本岁轨迹
// @returns {string[]} 描述
function ids(content = []) {
  // 逐条取描述。
  return content.map((c) => String(c?.description ?? c?.name ?? ''))
}

describe('nextAsync：异步逐岁钩子真能 await 并影响当年轨迹', () => {
  // 每个用例前重置（无共享状态，保持风格一致）。
  beforeEach(() => {})

  test('① onBeforeYear / onAfterYear 能 await 到真 Promise，且内容进**当年**轨迹', async () => {
    // 总线。
    const bus = createHookBus()
    // Life。
    const { life } = await makeLife({ hooks: bus })
    // 标记：两个钩子都真的跑过。
    const ran = []
    // onBeforeYear：await 一个宏任务后往 pending 里塞一条（"某年去后端取一句剧情"）。
    bus.on('onBeforeYear', async (p) => {
      // 等一个真实异步点（微任务 + 宏任务都覆盖）。
      await new Promise((r) => setTimeout(r, 5))
      // 记下运行与看到的年龄。
      ran.push(`before:${p.age}->${p.nextAge}`)
      // 塞进当年轨迹（pending 由 nextAsync 并入 content）。
      p.pending.push({ type: 'EVT', description: '后端取来的剧情' })
    }, { modName: 'async-demo', async: true })
    // onAfterYear：await 之后往 content 追加一条结算。
    bus.on('onAfterYear', async (p) => {
      // 等一个微任务。
      await Promise.resolve()
      // 记下。
      ran.push(`after:${p.age}`)
      // 追加。
      p.content.push({ type: 'EVT', description: '岁末结算' })
    }, { modName: 'async-demo', async: true })
    // 推进一年（**await 到真 Promise**：这是以前做不到的事）。
    const year = await life.nextAsync()
    // 两个钩子都跑了，且看到的年龄正确（第一岁之前：age=-1 → nextAge=0）。
    expect(ran).toEqual(['before:-1->0', 'after:0'])
    // 引擎自己的事件仍在（0 岁的事）。
    expect(ids(year.content)).toContain('零岁的事')
    // **异步注入进了当年**（而不是"晚于引擎读取"）。
    expect(ids(year.content)).toContain('后端取来的剧情')
    expect(ids(year.content)).toContain('岁末结算')
    // 顺序：引擎条目在前，pending 随后，onAfterYear 追加的在最后。
    expect(ids(year.content)).toEqual(['零岁的事', '后端取来的剧情', '岁末结算'])
  })

  test('② onBeforeYear 改数据 → 当年就能抽到它（"提前准备下一年"）', async () => {
    // 总线。
    const bus = createHookBus()
    // Life。
    const { life } = await makeLife({ hooks: bus })
    // 钩子：等到第 1 岁时，往当年轨迹里注入一条。
    bus.on('onBeforeYear', async (p) => {
      // 只在将要进入 1 岁时动手。
      if (p.nextAge !== 1) return
      // 等一个异步点（模拟"从后端取数据"）。
      await new Promise((r) => setTimeout(r, 1))
      // 塞进当年轨迹（`pending` 由 nextAsync 并入 content）。
      p.pending.push({ type: 'EVT', description: '来自后端的一岁祝福' })
    }, { modName: 'async-demo', async: true })
    // 第 0 岁（钩子此时 nextAge=0，不动手）。
    const y0 = await life.nextAsync()
    // 第 1 岁（钩子在 ageNext 之前跑，所以 pending 一定进这一年）。
    const y1 = await life.nextAsync()
    // 年龄正确。
    expect(y0.age).toBe(0)
    expect(y1.age).toBe(1)
    // 注入的内容在第 1 岁（不是第 0 岁、也不是第 2 岁）。
    expect(ids(y1.content)).toContain('来自后端的一岁祝福')
    expect(ids(y0.content)).not.toContain('来自后端的一岁祝福')
  })

  test('③ 慢钩子会被真的等（不是 fire-and-forget）', async () => {
    // 总线。
    const bus = createHookBus()
    // Life。
    const { life } = await makeLife({ hooks: bus })
    // 一个"慢"钩子（30ms）。
    bus.on('onYearAdvance', async (p) => {
      // 慢。
      await new Promise((r) => setTimeout(r, 30))
      // 注入。
      p.content.push({ type: 'EVT', description: '慢后端的内容' })
    }, { modName: 'slow-mod', async: true })
    // 计时（必须 ≥ 30ms —— 这正是"以前做不到"的证明：同步路径会立刻返回）。
    const t0 = Date.now()
    // 推进。
    const year = await life.nextAsync({ timeoutMs: 500 })
    // 耗时下界。
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25)
    // 慢钩子的内容**在返回时已经在轨迹里**（同步路径拿不到）。
    expect(ids(year.content)).toContain('慢后端的内容')
  })

  test('④ 异步钩子抛错被隔离：继续推进 + 一条 warn（带 Mod 名与钩子名）', async () => {
    // 总线。
    const bus = createHookBus()
    // Life。
    const { life, log } = await makeLife({ hooks: bus })
    // 会抛的异步钩子。
    bus.on('onYearAdvance', async () => {
      // 抛。
      throw new Error('后端 500')
    }, { modName: 'broken-mod', async: true })
    // 后面还有一条正常钩子（必须照样执行 —— 异常隔离）。
    bus.on('onYearAdvance', async (p) => {
      // 注入。
      p.content.push({ type: 'EVT', description: '后面的钩子照样跑' })
    }, { modName: 'ok-mod', async: true })
    // 推进（**不抛**）。
    const year = await life.nextAsync()
    // 那一年照样成立。
    expect(year.age).toBe(0)
    expect(ids(year.content)).toContain('零岁的事')
    // 正常钩子没被前一个的异常挡住。
    expect(ids(year.content)).toContain('后面的钩子照样跑')
    // 出声（warn 里指名 Mod 与钩子）。
    const warned = log.lines.filter((l) => l.startsWith('[warn]'))
    expect(warned.some((l) => l.includes('onYearAdvance') && l.includes('broken-mod') && l.includes('后端 500'))).toBe(true)
  })

  test('⑤ 超时：永不 resolve 的 Promise 被中断，游戏继续推进（记 warn）', async () => {
    // 总线。
    const bus = createHookBus()
    // Life。
    const { life, log } = await makeLife({ hooks: bus })
    // 永不 resolve 的钩子（"慢后端把游戏卡死"的最小复刻）。
    bus.on('onBeforeYear', () => new Promise(() => {}), { modName: 'never-mod', async: true })
    // 正常钩子（超时后仍要跑）。
    bus.on('onYearAdvance', async (p) => { p.content.push({ type: 'EVT', description: '超时之后照样推进' }) }, { modName: 'ok-mod', async: true })
    // 小超时（10ms）。
    const t0 = Date.now()
    // 推进（必须在有限时间内返回）。
    const year = await life.nextAsync({ timeoutMs: 10 })
    // 快（远小于"卡死"）。
    expect(Date.now() - t0).toBeLessThan(1500)
    // 这一年成立。
    expect(year.age).toBe(0)
    expect(ids(year.content)).toContain('零岁的事')
    expect(ids(year.content)).toContain('超时之后照样推进')
    // 超时出声（指名 Mod 与钩子 + 超时毫秒）。
    const warned = log.lines.filter((l) => l.startsWith('[warn]'))
    expect(warned.some((l) => l.includes('onBeforeYear') && l.includes('never-mod') && l.includes('超时'))).toBe(true)
  })

  test('⑥ asyncHooks 细化：没声明的钩子仍是同步调用（晚到的改动不进当年）', async () => {
    // 总线。
    const bus = createHookBus()
    // Life。
    const { life } = await makeLife({ hooks: bus })
    // onBeforeYear 被标记异步（会等）。
    bus.on('onBeforeYear', async (p) => {
      // 等一个宏任务。
      await new Promise((r) => setTimeout(r, 5))
      // 注入。
      p.pending.push({ type: 'EVT', description: '被等的钩子' })
    }, { modName: 'async-demo', async: true })
    // onYearAdvance **没有** async 标记 → nextAsync 里也是同步调用。
    bus.on('onYearAdvance', (p) => {
      // 起一个异步任务后立刻返回（返回值没人等，也不能等）。
      setTimeout(() => { p.content.push({ type: 'EVT', description: '晚到的注入' }) }, 5)
    }, { modName: 'sync-part', async: false })
    // 推进。
    const year = await life.nextAsync()
    // 被等的那个进来了。
    expect(ids(year.content)).toContain('被等的钩子')
    // 晚到的那个**不在**返回结果里（与 next() 的语义一致：Promise 被丢弃）。
    expect(ids(year.content)).not.toContain('晚到的注入')
    // 等一会儿再看：它其实写进了那个已经被快照的 content 数组（说明"晚到"这件事本身没变）。
    await new Promise((r) => setTimeout(r, 20))
    expect(ids(year.content)).toContain('晚到的注入')
  })

  test('⑦ 随机数消耗顺序：next() 与 nextAsync() 逐次一致（同种子同一局）', async () => {
    // 记录随机序列的 RNG（同一个种子、两条路径各记一遍）。
    const recorder = () => {
      // 底层种子 RNG（固定的种子，保证两次的"原始序列"相同）。
      const base = createRng(20261006)
      // 记录。
      const calls = []
      // 返回记录器。
      return {
        calls,
        // 每次调用都记下"第几次 + 值"。
        random: () => {
          // 取。
          const v = base()
          // 记。
          calls.push(v)
          // 返回。
          return v
        },
      }
    }
    // 同步路径。
    const sync = recorder()
    // 用记录器建 Life（hooks 缺省空操作）。
    const lifeSync = new Life({ data: makeData(), random: sync.random, hooks: createHookBus() })
    // 初始化链路。
    await lifeSync.initial()
    lifeSync.config()
    lifeSync.start({ CHR: 5, INT: 5, STR: 5, MNY: 5, SPR: 5 })
    lifeSync.request('PROPERTY').set('LIF', 100)
    // 异步路径。
    const asyn = recorder()
    const lifeAsync = new Life({ data: makeData(), random: asyn.random, hooks: createHookBus() })
    await lifeAsync.initial()
    lifeAsync.config()
    lifeAsync.start({ CHR: 5, INT: 5, STR: 5, MNY: 5, SPR: 5 })
    lifeAsync.request('PROPERTY').set('LIF', 100)
    // 逐年对比（含内容与随机调用序列）。
    for (let i = 0; i < 5; i++) {
      // 同步。
      const a = lifeSync.next()
      // 异步。
      const b = await lifeAsync.nextAsync()
      // 年龄 / 结束标志一致。
      expect(b.age).toBe(a.age)
      expect(b.isEnd).toBe(a.isEnd)
      // **内容逐字节一致**（同种子同一局）。
      expect(JSON.stringify(b.content)).toBe(JSON.stringify(a.content))
      // **随机数调用序列逐次一致**（这是复现契约的实质）。
      expect(asyn.calls.slice(0, sync.calls.length)).toEqual(sync.calls.slice(0, asyn.calls.length))
    }
    // 最终：整个序列等长（两条路径消耗的随机数个数完全相同）。
    expect(asyn.calls.length).toBe(sync.calls.length)
  })

  test('⑧ 没有异步 Mod：nextAsync() 里所有钩子都是同步调用（同步路径不受影响）', async () => {
    // 总线。
    const bus = createHookBus()
    // Life。
    const { life } = await makeLife({ hooks: bus })
    // 一条**同步**回调（没有 async 标记 = 普通 Mod 的注册方式）。
    bus.on('onYearAdvance', (p) => { p.content.push({ type: 'EVT', description: '同步注入' }) }, { modName: 'plain-mod', async: false })
    // 推进。
    const year = await life.nextAsync()
    // 照样生效（没人被 await，但同步回调该跑的照跑）。
    expect(ids(year.content)).toContain('同步注入')
  })
})

describe('nextAsync：同步路径一个字没变（opt-in 的第一约束）', () => {
  test('⑨ next() 仍是同步：返回值不是 Promise，且不触发 onBeforeYear / onAfterYear', async () => {
    // 总线。
    const bus = createHookBus()
    // Life。
    const { life } = await makeLife({ hooks: bus })
    // 计数。
    const called = { before: 0, after: 0 }
    // 挂上两个新钩子（**只有 nextAsync 才会触发它们**）。
    bus.on('onBeforeYear', () => { called.before++ }, { modName: 'async-demo', async: true })
    bus.on('onAfterYear', () => { called.after++ }, { modName: 'async-demo', async: true })
    // 同步推进。
    const result = life.next()
    // **不是 Promise**（`next()` 的同步语义是复现与 auto-play 的前提）。
    expect(typeof result?.then).toBe('undefined')
    // 形状与历史一致。
    expect(result.age).toBe(0)
    expect(Array.isArray(result.content)).toBe(true)
    expect(typeof result.isEnd).toBe('boolean')
    // 两个新钩子一次都没被触发。
    expect(called.before).toBe(0)
    expect(called.after).toBe(0)
  })

  test('⑩ next() 里 onYearAdvance 仍走 emitSync（async 回调的 Promise 照旧被丢弃）', async () => {
    // 总线。
    const bus = createHookBus()
    // Life。
    const { life } = await makeLife({ hooks: bus })
    // 异步回调（在同步路径里注定晚到）。
    bus.on('onYearAdvance', async (p) => {
      // 等一个宏任务。
      await new Promise((r) => setTimeout(r, 5))
      // 注入。
      p.content.push({ type: 'EVT', description: '晚到的异步注入' })
    }, { modName: 'async-demo', async: true })
    // 同步推进（立刻返回）。
    const result = life.next()
    // 返回时**还没有**它（Promise 被丢弃 —— 这正是本能力诞生前的老行为）。
    expect(ids(result.content)).not.toContain('晚到的异步注入')
  })
})

describe('异步逐岁钩子的底层原语（超时 / 异常隔离）', () => {
  test('⑪ resolveWithTimeout：超时返回 timedOut，正常返回值，抛错返回 error（永不 reject）', async () => {
    // 记录警告。
    const warned = []
    // 日志器。
    const log = { warn: (m) => warned.push(m) }
    // 正常。
    await expect(resolveWithTimeout(Promise.resolve(7), 100, { name: 'h', modName: 'm', log })).resolves.toEqual({ ok: true, value: 7 })
    // 同步值。
    await expect(resolveWithTimeout(9, 100, { name: 'h', modName: 'm', log })).resolves.toEqual({ ok: true, value: 9 })
    // 超时（永不 resolve + 10ms）。
    const timed = await resolveWithTimeout(new Promise(() => {}), 10, { name: 'hookName', modName: 'modName', log })
    expect(timed.timedOut).toBe(true)
    expect(timed.ms).toBe(10)
    // 出声（指名）。
    expect(warned.some((m) => m.includes('hookName') && m.includes('modName'))).toBe(true)
    // 抛错（不 reject）。
    const failed = await resolveWithTimeout(Promise.reject(new Error('boom')), 100, { name: 'h2', modName: 'm2', log })
    expect(String(failed.error?.message)).toBe('boom')
    // 缺省超时常量是个正数（文档里写的 3 秒就是它）。
    expect(DEFAULT_ASYNC_TIMEOUT_MS).toBe(3000)
  })

  test('⑫ emitYearHooksAsync：标记 async 的才 await，同步的照旧同步调用且异常被隔离', async () => {
    // 总线。
    const bus = createHookBus()
    // 顺序记录。
    const order = []
    // 同步回调（抛错）。
    bus.on('onYearAdvanced', () => { throw new Error('sync-boom') }, { modName: 's', async: false })
    // 异步回调。
    bus.on('onYearAdvanced', async () => { await Promise.resolve(); order.push('async') }, { modName: 'a', async: true })
    // 日志。
    const log = { error: (m) => order.push(`error:${m.includes('sync-boom')}`), warn: () => {} }
    // 触发（钩子名随意 —— 分发器不校验名字）。
    const results = await emitYearHooksAsync({ bus, name: 'onYearAdvanced', payload: {}, log, timeoutMs: 100 })
    // 异步那条跑完了。
    expect(order).toContain('async')
    // 同步那条抛错被隔离成一条 error。
    expect(order).toContain('error:true')
    // 结果里只有成功的那条（抛错的没进）。
    expect(results).toEqual([undefined])
  })

  test('⑬ 没有 meta 的替身总线：退回同步广播（钩子照样会被调用）', async () => {
    // 极简替身（CLI 里传进来的形态）。
    const calls = []
    const bus = { emitSync: (name, payload) => { calls.push([name, payload]) } }
    // 触发。
    const results = await emitYearHooksAsync({ bus, name: 'onYearAdvance', payload: { age: 1 } })
    // 走了同步。
    expect(calls).toEqual([['onYearAdvance', { age: 1 }]])
    // 没有结果。
    expect(results).toEqual([])
  })
})

describe('manifest：async / asyncHooks 的校验与取值助手', () => {
  test('⑭ async 必须是布尔值（字符串 / 数字 / 数组都是硬错误）', () => {
    // 合法。
    expect(validateManifest({ name: 'a', version: '1', async: true }).ok).toBe(true)
    expect(validateManifest({ name: 'a', version: '1', async: false }).ok).toBe(true)
    expect(manifestAsync({ async: true })).toBe(true)
    expect(manifestAsync({})).toBe(false)
    expect(manifestAsync(undefined)).toBe(false)
    // 非法（`"true"` 这种写法最坑：引擎按 falsy 处理 → 异步静默失效）。
    expect(validateManifest({ name: 'a', version: '1', async: 'true' }).errors).toContain('async 必须是布尔值')
    expect(validateManifest({ name: 'a', version: '1', async: 1 }).errors).toContain('async 必须是布尔值')
    expect(validateManifest({ name: 'a', version: '1', async: [] }).errors).toContain('async 必须是布尔值')
  })

  test('⑮ asyncHooks 必须是已知钩子名数组（未知名 / 空数组 / 重复项都是硬错误）', () => {
    // 合法。
    expect(validateManifest({ name: 'a', version: '1', async: true, asyncHooks: ['onBeforeYear'] }).ok).toBe(true)
    // 未知钩子名（错误信息里要列出合法值）。
    const bad = validateManifest({ name: 'a', version: '1', async: true, asyncHooks: ['onYear'] })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join('\n')).toContain('asyncHooks 含未知钩子名: onYear')
    expect(bad.errors.join('\n')).toContain('onBeforeYear')
    // 渲染/抽卡时机**不属于**逐岁钩子（写了就是错的：它们在 nextAsync 里也只走 emitSync）。
    expect(validateManifest({ name: 'a', version: '1', asyncHooks: ['onEventRender'] }).ok).toBe(false)
    // 非数组 / 空数组 / 重复。
    expect(validateManifest({ name: 'a', version: '1', asyncHooks: 'onYearAdvance' }).errors).toContain('asyncHooks 必须是数组')
    expect(validateManifest({ name: 'a', version: '1', asyncHooks: [] }).errors.join()).toContain('asyncHooks 不能是空数组')
    expect(validateManifest({ name: 'a', version: '1', asyncHooks: ['onBeforeYear', 'onBeforeYear'] }).errors).toContain('asyncHooks 不能有重复项')
    // 合法的逐岁钩子名单就是这三个。
    expect(YEAR_HOOKS).toEqual(['onBeforeYear', 'onYearAdvance', 'onAfterYear'])
  })

  test('⑯ hooksToAwait：非异步 Mod 一个都不等；异步 Mod 缺省等全部逐岁钩子；细化时只等声明的', () => {
    // 非异步 → 空（于是 nextAsync 里它的回调全是同步调用）。
    expect(hooksToAwait({})).toEqual([])
    expect(hooksToAwait({ async: false, asyncHooks: ['onBeforeYear'] })).toEqual([])
    // 异步但没细化 → 全部逐岁钩子。
    expect(hooksToAwait({ async: true })).toEqual(['onBeforeYear', 'onYearAdvance', 'onAfterYear'])
    // 细化。
    expect(hooksToAwait({ async: true, asyncHooks: ['onAfterYear'] })).toEqual(['onAfterYear'])
    // 取值助手返回拷贝（外部改不到 manifest）。
    const m = { async: true, asyncHooks: ['onBeforeYear'] }
    manifestAsyncHooks(m).push('onAfterYear')
    expect(m.asyncHooks).toEqual(['onBeforeYear'])
  })
})

// #MODS_DIR
// 仓库真实 mods/ 目录（教学样板就在里面）。
const MODS_DIR = fileURLToPath(new URL('../../../../mods/', import.meta.url))
// #DATA_DIR
// 仓库真实数据目录（跑一局要有内容）。
const DATA_DIR = fileURLToPath(new URL('../../../frontend/public/data/', import.meta.url))

describe('example-async-mod：教学样板真跑一局（异步注入进当年轨迹）', () => {
  test('⑰ 声明 async 的示例 Mod：两句话都真的进了当年轨迹', async () => {
    // manifest（**过校验**：样板必须自己先合法）。
    const manifest = JSON.parse(readFileSync(join(MODS_DIR, 'example-async-mod', 'manifest.json'), 'utf8'))
    expect(validateManifest(manifest)).toEqual({ ok: true, errors: [] })
    // 语义：异步 + 只等这两个钩子。
    expect(manifestAsync(manifest)).toBe(true)
    expect(hooksToAwait(manifest)).toEqual(['onBeforeYear', 'onAfterYear'])
    // 数据（真实数据表；裁剪过的仓库里跳过本用例）。
    const dataPath = join(DATA_DIR, 'age.json')
    if (!existsSync(dataPath)) return
    // 数据对象（真实表）。
    const data = {
      // 年龄表。
      age: JSON.parse(readFileSync(dataPath, 'utf8')),
      // 天赋。
      talents: JSON.parse(readFileSync(join(DATA_DIR, 'talents.json'), 'utf8')),
      // 事件。
      events: JSON.parse(readFileSync(join(DATA_DIR, 'events.json'), 'utf8')),
      // 成就。
      achievements: JSON.parse(readFileSync(join(DATA_DIR, 'achievements.json'), 'utf8')),
      // 名人。
      characters: JSON.parse(readFileSync(join(DATA_DIR, 'characters.json'), 'utf8')),
    }
    // 总线 + Life（种子固定）。
    const bus = createHookBus()
    const life = new Life({ data, random: createRng(20261006), hooks: bus, storage: { getItem: () => null, setItem: () => {} } })
    await life.initial()
    life.config()
    life.start({ CHR: 5, INT: 5, STR: 5, MNY: 5, SPR: 5 })
    // 生命给足（保证能推进到第 3 岁）。
    life.request('PROPERTY').set('LIF', 100)
    // 执行示例 Mod 的 code.js（**与浏览器侧同一形态**：把 manifest 交给 createGameAPI，
    // 它据此给钩子打上 async 标记）。
    const api = createGameAPI({ data, hooks: bus, params: life.params, manifest, modName: 'example-async-mod' })
    // 执行。
    new Function('gameAPI', 'require', '"use strict";\n' + readFileSync(join(MODS_DIR, 'example-async-mod', 'code.js'), 'utf8'))(api, () => {})
    // 逐岁取描述。
    const years = []
    for (let i = 0; i < 4; i++) years.push((await life.nextAsync()).content.map((c) => String(c.description)))
    // 第 1 / 2 岁：`onBeforeYear` 里 await 出来的那句**在当年**（以前做不到）。
    expect(years[1].some((d) => d.includes('后端在第 1 岁送来一句话'))).toBe(true)
    expect(years[2].some((d) => d.includes('后端在第 2 岁送来一句话'))).toBe(true)
    // 第 3 岁：`onAfterYear` 里 await 出来的那句也在当年。
    expect(years[3].some((d) => d.includes('三岁这年，后端在岁末又补了一句'))).toBe(true)
    // 第 0 岁（`nextAge = 0`，示例的 onBeforeYear 只在 nextAge 1~2 时注入 → 这一年没有它的东西）。
    expect(years[0].some((d) => d.includes('异步示例'))).toBe(false)
    // 反证：第 0 岁**不是空年**（引擎自己的事件在），所以上一条不是因为"这一年啥都没有"而侥幸通过。
    expect(years[0].length).toBeGreaterThan(0)
    // 超时上限也够宽松（5ms 的 await 远小于缺省 3 秒）。
    expect(DEFAULT_ASYNC_TIMEOUT_MS).toBe(3000)
  })

  test('⑱ 同一个 code.js 走**同步**路径：异步注入一个字都不进轨迹（老行为没变）', async () => {
    // manifest。
    const manifest = JSON.parse(readFileSync(join(MODS_DIR, 'example-async-mod', 'manifest.json'), 'utf8'))
    // 数据（真实数据表；裁剪过的仓库里跳过本用例）。
    const dataPath = join(DATA_DIR, 'age.json')
    if (!existsSync(dataPath)) return
    // 数据对象。
    const data = {
      // 年龄表。
      age: JSON.parse(readFileSync(dataPath, 'utf8')),
      // 天赋。
      talents: JSON.parse(readFileSync(join(DATA_DIR, 'talents.json'), 'utf8')),
      // 事件。
      events: JSON.parse(readFileSync(join(DATA_DIR, 'events.json'), 'utf8')),
      // 成就。
      achievements: JSON.parse(readFileSync(join(DATA_DIR, 'achievements.json'), 'utf8')),
      // 名人。
      characters: JSON.parse(readFileSync(join(DATA_DIR, 'characters.json'), 'utf8')),
    }
    // 总线 + Life。
    const bus = createHookBus()
    const life = new Life({ data, random: createRng(20261006), hooks: bus, storage: { getItem: () => null, setItem: () => {} } })
    await life.initial()
    life.config()
    life.start({ CHR: 5, INT: 5, STR: 5, MNY: 5, SPR: 5 })
    life.request('PROPERTY').set('LIF', 100)
    // 执行 code.js。
    const api = createGameAPI({ data, hooks: bus, params: life.params, manifest, modName: 'example-async-mod' })
    new Function('gameAPI', 'require', '"use strict";\n' + readFileSync(join(MODS_DIR, 'example-async-mod', 'code.js'), 'utf8'))(api, () => {})
    // **同步**推进（`next()` 一个 await 点都没有）。
    const y1 = life.next()
    // 返回时还没有它（Promise 被丢弃 —— 这就是本能力诞生前的老行为，现在依然如此）。
    expect(y1.content.map((c) => String(c.description)).some((d) => d.includes('异步示例'))).toBe(false)
    // 而且 `onBeforeYear` 在同步路径里**根本不会被调用**（它是异步专用时机）。
    const y2 = life.next()
    expect(y2.content.map((c) => String(c.description)).some((d) => d.includes('异步示例'))).toBe(false)
  })
})

describe('批量场景的跳过策略（sim / consistency）：跳过 async 与非确定性 Mod，并说明理由', () => {
  test('⑲ modsToSkip：async: true 与 deterministic: false 都被列出（含理由）；同步确定的不动', () => {
    // 真实 manifest（教学样板）。
    const asyncManifest = JSON.parse(readFileSync(join(MODS_DIR, 'example-async-mod', 'manifest.json'), 'utf8'))
    // 混合清单。
    const policy = modsToSkip([
      // 普通数据 Mod（同步确定）。
      { name: 'lifeRestart-data', manifest: { name: 'lifeRestart-data', version: '1.0.0' } },
      // 同步的示例 Mod（有钩子，但没声明 async）。
      { name: 'example-mod', manifest: { name: 'example-mod', version: '1.0.0' } },
      // 异步 Mod。
      { name: 'example-async-mod', manifest: asyncManifest },
      // 显式声明不确定（Mod 架构 v2 的 deterministic 字段 —— **本项顺手让它真的被消费**）。
      { name: 'non-det-mod', manifest: { name: 'non-det-mod', version: '1.0.0', deterministic: false } },
      // 面向 node（缺省推导 = 不确定）。
      { name: 'node-mod', manifest: { name: 'node-mod', version: '1.0.0', targets: ['browser', 'node'] } },
    ])
    // 被跳过的就是后三个。
    expect(policy.skipped).toEqual(['example-async-mod', 'non-det-mod', 'node-mod'])
    // 理由里要写清"为什么"（异步 Mod 连它被 await 的钩子名都写出来）。
    const asyncEntry = policy.notReproducible.find((x) => x.name === 'example-async-mod')
    expect(asyncEntry.reasons.join()).toContain('async: true')
    expect(asyncEntry.reasons.join()).toContain('onBeforeYear')
    // deterministic: false 也被消费（以前这个字段只有界面在读）。
    expect(policy.notReproducible.find((x) => x.name === 'non-det-mod').reasons.join()).toContain('deterministic: false')
    // 同步确定的 Mod 不在名单里。
    expect(policy.skipped).not.toContain('lifeRestart-data')
    expect(policy.skipped).not.toContain('example-mod')
    // 异步清单（报告的另一半信息）。
    expect(policy.async.map((x) => x.name)).toEqual(['example-async-mod'])
  })

  test('⑳ 加载器 skip：被跳过的 Mod 数据不合并、code.js 不执行；其它照旧', async () => {
    // 加载器（skip 名单 = 教学异步样板）。
    const loader = await createModLoader({ source: createNodeSource(MODS_DIR), skip: ['example-async-mod'] })
    // 跳过名单被如实带出（**带 manifest**：报告要据此说明"为什么跳过"，不该让调用方反查）。
    expect(loader.skipped.map((x) => x.name)).toEqual(['example-async-mod'])
    expect(loader.skipped[0].manifest.async).toBe(true)
    // 它没参与加载。
    expect(loader.order).not.toContain('example-async-mod')
    // 被 skip 的**不**混进 `disabled`（那个字段是"用户禁用"；报告里两者含义不同）。
    expect(loader.disabled).not.toContain('example-async-mod')
    // 加载数据（真实数据 Mod 仍在）。
    const { data, errors } = await loader.loadAll()
    // 没有错误。
    expect(errors).toEqual([])
    // 真实数据在。
    expect(Object.keys(data.age).length).toBeGreaterThan(400)
    // 对照：**不 skip** 时它会被加载（证明上面那条不是因为"它本来就加载不到"）。
    const all = await createModLoader({ source: createNodeSource(MODS_DIR) })
    expect(all.order).toContain('example-async-mod')
    // 同步的示例 Mod 也没被误伤。
    expect(all.order).toContain('example-mod')
  })

  test('㉑ simulateCli：跳过理由是 stats.warnings 里的**可见文本**（不是静默丢弃）', async () => {
    // 真实数据表存在才跑（裁剪仓库里跳过）。
    if (!existsSync(join(DATA_DIR, 'age.json'))) return
    // 跑一局（fixture 太快：直接给 data，但要把"跳过清单"喂进去 —— 这正是 simulateCli 的 --mods 路径做的事）。
    const { stats } = await simulateCli({
      // 一局就够（结论只关心 warnings）。
      runs: 1,
      // 固定种子。
      seed: 7,
      // 数据（用公开数据目录的 5 张表拼一份，与前端同源）。
      data: {
        // 年龄表。
        age: JSON.parse(readFileSync(join(DATA_DIR, 'age.json'), 'utf8')),
        // 天赋。
        talents: JSON.parse(readFileSync(join(DATA_DIR, 'talents.json'), 'utf8')),
        // 事件。
        events: JSON.parse(readFileSync(join(DATA_DIR, 'events.json'), 'utf8')),
        // 成就。
        achievements: JSON.parse(readFileSync(join(DATA_DIR, 'achievements.json'), 'utf8')),
        // 名人。
        characters: JSON.parse(readFileSync(join(DATA_DIR, 'characters.json'), 'utf8')),
      },
    })
    // 一局跑完（数据路径没给 skipped → 没有跳过警告；这里验证"没有跳过时不产生噪声"）。
    expect(stats.runs).toBe(1)
    // 跳过策略的警告函数在**有**跳过时给出可读文本（真正的断言在下一组）。
    const { skipPolicyWarning } = await import('../sim/simulator.js')
    // 造一条跳过记录。
    const warnings = skipPolicyWarning({ skipped: [{ name: 'example-async-mod', reasons: ['声明了 async: true'] }] })
    // 文本要指名 Mod 与理由。
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('example-async-mod')
    expect(warnings[0]).toContain('async: true')
    // 没有跳过 → 空（不产生噪声）。
    expect(skipPolicyWarning({ skipped: [] })).toEqual([])
  })

  test('㉒ consistency：被跳过的 Mod 会出现在返回值的 skipped 里（报告脚注的来源）', async () => {
    // 临时目录（写两个"不可复现"的 Mod，**不碰真实仓库数据**）。
    const tmp = mkdtempSync(join(tmpdir(), 'lr-consistency-skip-'))
    // 目录 1：异步 Mod。
    mkdirSync(join(tmp, 'async-mod'))
    writeFileSync(join(tmp, 'async-mod', 'manifest.json'), JSON.stringify({ name: 'async-mod', version: '1.0.0', async: true }))
    // 目录 2：声明不确定的 Mod。
    mkdirSync(join(tmp, 'nondet-mod'))
    writeFileSync(join(tmp, 'nondet-mod', 'manifest.json'), JSON.stringify({ name: 'nondet-mod', version: '1.0.0', deterministic: false }))
    // 目录 3：普通同步 Mod（不该被跳过）。
    mkdirSync(join(tmp, 'plain-mod'))
    writeFileSync(join(tmp, 'plain-mod', 'manifest.json'), JSON.stringify({ name: 'plain-mod', version: '1.0.0' }))
    // 策略。
    const skipped = await consistencySkipPolicy({ modsDir: tmp })
    // 名单（按扫描顺序）。
    expect(skipped.map((x) => x.name).sort()).toEqual(['async-mod', 'nondet-mod'])
    // 理由如实。
    expect(skipped.find((x) => x.name === 'async-mod').reasons.join()).toContain('async: true')
    // 清理。
    rmSync(tmp, { recursive: true, force: true })
    // runConsistency 的返回值里也有这个字段（报告脚注就是它渲染的）—— 用真 mods/ 目录跑一次。
    // 真仓库 mods/ 里**只有一个**不可复现的 Mod：教学样板 example-async-mod
    // （它默认禁用，但一致性检查看的是"启用集合"= 全目录，所以它会被跳过并进脚注）。
    const res = await runConsistency({ seed: 3, runs: 1, years: 3, modsDir: MODS_DIR, log: { info: () => {}, warn: () => {}, error: () => {} } })
    // 跳过不影响判定（"不适用"不是"不一致"）。
    expect(res.ok).toBe(true)
    // 脚注来源：名字 + 理由都在（**不许静默丢**）。
    expect(res.skipped.map((x) => x.name)).toEqual(['example-async-mod'])
    expect(res.skipped[0].reasons.join()).toContain('async: true')
  }, 120000)
})
