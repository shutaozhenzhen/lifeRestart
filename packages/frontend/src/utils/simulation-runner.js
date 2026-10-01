/**
 * simulation-runner — 前端批量模拟驱动器（分批 + 进度 + 可取消）
 *
 * 为什么需要独立一层（而不是直接在页面里 for 循环）：
 *   真实数据下单局 0.3~1.5 秒（老年阶段每年要判几百个条件），跑几十局就是几十秒。
 *   必须：① 分批执行并在批间让出主线程（否则页面全程冻结）；
 *        ② 汇报进度（进度条 / 每局速度 / 预计剩余）；
 *        ③ 支持取消（用户等不下去要能停）。
 *   把这段编排抽出来，就能用注入的 yieldTo/onProgress 精确测试，不必依赖真实计时。
 *
 * 与 CLI 的关系：两者都基于引擎的 src/sim/simulator.js，内核只有一份实现。
 */

// 引擎模拟内核。
import { createSimulator } from 'game-engine/src/sim/simulator.js'
// 种子随机源（可复现）。
import { createRng } from 'game-engine/src/functions/util.js'
// 应用侧唯一 Life 构造入口 + 纯内存存储（模拟不落盘，避免写脏玩家存档）。
import { createAppLife } from '../life/create-life.js'
import { createMemoryStorage } from './life-storage.js'

// #defaultYield
// 默认让出主线程：宏任务（setTimeout 0）→ 浏览器有机会刷新界面。
function defaultYield() {
  // 返回 promise。
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// #runSimulation
// 跑一批模拟。
//
// @param {object} params
// @param {object} params.data - 游戏数据（与主页同一份）
// @param {number} [params.runs] - 局数
// @param {number|null} [params.seed] - 随机种子（null → 不可复现）
// @param {number} [params.chunk] - 每批局数（越小越"跟手"，但批间开销略增）
// @param {Function} [params.onProgress] - (done, total, lastResult) => void
// @param {Function} [params.shouldStop] - 返回 true 则中止（取消）
// @param {Function} [params.yieldTo] - 让出主线程的实现（测试注入）
// @param {object} [params.log] - 日志器
// @returns {Promise<{stats: object, results: Array, elapsedMs: number, cancelled: boolean}>} 结果
export async function runSimulation({
  data,
  runs = 30,
  seed = null,
  chunk = 1,
  onProgress,
  shouldStop,
  yieldTo,
  log,
} = {}) {
  // 随机源：给种子则可复现；同一个 RNG 同时驱动游戏内随机与策略随机（否则不可复现）。
  const rng = seed === null || seed === undefined ? Math.random : createRng(seed)
  // 独立 Life（内存存储：不污染玩家存档）。
  const life = createAppLife({ data, storage: createMemoryStorage(), random: rng, logger: log })
  // 初始化 + 配置（空参走引擎内置 judge，summary/statistics 才有值）。
  await life.initial()
  life.config()
  // 模拟器。
  const simulator = createSimulator({ life, random: rng })
  // 计时。
  const startedAt = Date.now()
  // 取消标记。
  let cancelled = false
  // 每批局数（至少 1）。
  const step = Math.max(1, Math.floor(chunk) || 1)
  // 分批执行。
  for (let done = 0; done < runs; done += step) {
    // 取消检查（在每批开始前）。
    if (typeof shouldStop === 'function' && shouldStop()) {
      // 标记取消。
      cancelled = true
      // 停止。
      break
    }
    // 跑一批。
    simulator.run(Math.min(step, runs - done))
    // 进度回调。
    if (typeof onProgress === 'function') onProgress(simulator.progress(), runs, simulator.results[simulator.results.length - 1])
    // 还有后续批次：让出主线程。
    if (done + step < runs) {
      // 注入的让出实现优先。
      await (typeof yieldTo === 'function' ? yieldTo() : defaultYield())
    }
  }
  // 聚合（含收集统计与种子）。
  const stats = simulator.summarize({ seed })
  // 返回。
  return { stats, results: simulator.results, elapsedMs: Date.now() - startedAt, cancelled }
}
