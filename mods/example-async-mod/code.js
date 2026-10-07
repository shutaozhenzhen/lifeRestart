/**
 * example-async-mod / code.js —— 「Mod 能异步介入逐岁流程」的最小样板
 *
 * 这是**唯一**需要 `manifest.async = true` 的能力。以前做不到的那件事在这里只需几行：
 *   某一年去"后端"（这里用 setTimeout 模拟）取一句剧情，`await` 完塞进**当年**轨迹，
 *   于是轨迹页那一年就真的出现这句话。
 *
 * 为什么以前做不到（历史边界 ②）：
 *   `life.next()` 是同步函数，三个逐岁钩子走 `emitSync` —— async 回调返回的 Promise 被直接
 *   丢弃，UI 早在 `next()` 返回时就做了轨迹快照，晚到的改动**不会进当年**。
 *
 * 现在的契约：
 *   · `manifest.async: true` = **opt-in**。没有它，引擎/前端一切照旧（同步 `life.next()`）。
 *   · 声明了它，前端就会改用 `life.nextAsync()`：`onBeforeYear` / `onYearAdvance` / `onAfterYear`
 *     里本 Mod 的回调会被 **await**（`asyncHooks` 可以只挑其中几个）。
 *   · 单个异步钩子超过 **3 秒**（可配）→ 记一条 warn（带 Mod 名与钩子名）并**继续推进**；
 *     抛错/超时都不会污染轨迹（要么整段生效、要么整段不生效）。
 *   · 批量模拟与跨平台一致性检查会**跳过** `async: true` 的 Mod（异步 = 不可逐位复现），
 *     并在产物里写明"跳过了谁、为什么"。
 */

// #delay
// 模拟"调一次后端"（真实 Mod 里换成 gameAPI.host.call / gameAPI.ai.generate 等）。
//
// @param {number} ms - 毫秒
// @returns {Promise<void>}
function delay(ms) {
  // 返回一个真 Promise（await 点）。
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 逐岁：翻年**之前**异步准备这一年要用的内容。
// 引擎在天赋/事件之后把 `payload.pending` 里的条目并进当年轨迹。
gameAPI.on('onBeforeYear', async (payload) => {
  // 只演示第 1、2 岁（免得刷屏；真实 Mod 可以按条件/按状态决定）。
  // 注意 payload 的语义：`age` = 当前年龄、`nextAge` = 这一岁推进后会变成的年龄。
  if (payload.nextAge < 1 || payload.nextAge > 2) return
  // ⚠️ 这一行是**关键**：await 真的会被等到（同步路径里这个 Promise 会被丢弃）。
  await delay(5)
  // 塞进当年轨迹。
  payload.pending.push({
    // 条目类型（EVT/TLT/talentReplace，其它值界面会显示成"信息"）。
    type: 'EVT',
    // 主文本。
    description: `【异步示例】后端在第 ${payload.nextAge} 岁送来一句话：今天天气不错。`,
  })
  // 出声（gameAPI.log 会带上 `[mod:example-async-mod]` 前缀，进日志面板与日志报告）。
  gameAPI.log.info(`异步示例：已为第 ${payload.nextAge} 岁取回一句剧情`)
})

// 逐岁：翻年**之后**收尾（可往当年轨迹追加结算类条目）。
gameAPI.on('onAfterYear', async (payload) => {
  // 只演示第 3 岁（证明 onAfterYear 也能 await 并影响当年）。
  if (payload.age !== 3) return
  // 再等一次（同样会被等到）。
  await delay(5)
  // 追加。
  payload.content.push({
    // 类型。
    type: 'EVT',
    // 文本（**直接改真属性**的演示在 example-mod 里，这里只演示异步时机）。
    description: '【异步示例】三岁这年，后端在岁末又补了一句：明年也要好好的。',
  })
  // 出声。
  gameAPI.log.info('异步示例：第 3 岁的岁末追加已完成')
})
