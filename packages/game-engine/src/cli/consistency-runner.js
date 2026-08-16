/**
 * 一致性 runner（Step 26 子进程执行体）
 *
 * 由 consistency.cli.js 以子进程方式启动（node 或 electron -- ELECTRON_RUN_AS_NODE）。
 * 从环境变量读取输入，跑同一局后向 stdout 输出轨迹 JSON（唯一输出，不含日志）。
 *
 * 环境变量：
 *   CONSISTENCY_SEED      种子
 *   CONSISTENCY_YEARS     年数
 *   CONSISTENCY_MODS      mods 目录（空 = fixture）
 *   CONSISTENCY_MOCK_AI   1 = 启用确定性 mock AI
 */

// 重要：stdout 必须只含轨迹 JSON。loader 执行 mod 的 code.js 会 console.log
// （如 ai-mod 的「增强器已注册」），全部重定向到 stderr，避免污染输出。
console.log = (...a) => console.error('[runner]', ...a)
console.warn = (...a) => console.error('[runner]', ...a)

// 复用 consistency.cli.js 的单次运行（输入构造与进程内完全一致）。
import { runOnce } from './consistency.cli.js'

// 读取环境。
const seed = Number(process.env.CONSISTENCY_SEED || 7)
// 年数。
const years = Number(process.env.CONSISTENCY_YEARS || 20)
// mods。
const modsDir = process.env.CONSISTENCY_MODS || undefined
// mock。
const mockAi = process.env.CONSISTENCY_MOCK_AI === '1'
// 跑局。
const out = await runOnce({ seed, years, modsDir, mockAi })
// 输出（唯一 stdout）。
process.stdout.write(out)
