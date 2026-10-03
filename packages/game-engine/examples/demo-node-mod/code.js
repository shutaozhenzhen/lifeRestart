/**
 * demo-node-mod / code.js —— 浏览器侧入口（只拿 gameAPI）
 *
 * 与 server.js 配合演示 Mod 架构 v2 的**双目标**：
 *   本文件（浏览器）= 游戏内逻辑 / 钩子；server.js（Node）= 重活。
 *   两侧用命名处理器连接：`gameAPI.host.call('demo-node-mod', '<名字>', args)`。
 *
 * ⚠️ 为什么这里只做同步的事（本文件最重要的知识点）：
 *   逐岁钩子（onYearAdvance / onTalentPoolGenerate / onEventRender）走 `emitSync`，
 *   **async 回调返回的 Promise 会被丢弃**。所以"在钩子里 await 宿主"当前做不到，
 *   宿主调用只能放在已异步的生命周期点上（Phase A：loadBundle / onBeforeLife /
 *   onAfterLife / Mod 命令）。文件末尾留了反面示例（注释掉的），别照抄那条路。
 */

// 允许"注册失败"时不炸：所有用法都包在 try 里（与其它内置 Mod 一致的做法）。
try {
  // 1) 能力探测（**同步**，任何时候都能做）：本 Mod 的后端入口是否在线。
  //    这是"环境探测"，不是"权限申请"——静态站上恒为 false，Mod 必须据此降级。
  const backendOnline = gameAPI.host.has('demo-node-mod')

  // 2) 挂一个逐岁钩子：只做同步操作（把探测结果写进当年轨迹，第一年提示一次）。
  gameAPI.on('onYearAdvance', (payload) => {
    // 只在第 1 年提示，避免刷屏。
    if (payload.age !== 1) return
    // 写入本岁轨迹（同步安全）。
    payload.content.push({
      // 条目类型：事件。
      type: 'EVT',
      // 文案（区分两种环境，演示降级契约）。
      description: backendOnline
        ? 'demo-node-mod：后端在线 —— 可用 gameAPI.host.call 异步取 Node 侧数据'
        : 'demo-node-mod：后端不在线（纯静态站）—— 已走降级分支',
      // 评分（0 = 中性）。
      grade: 0,
    })
  })

  // 3) 上下文日志：把在线清单写进引擎日志（LogDock 可见）。
  gameAPI.emit('demo-node-mod:ready', { backendOnline, hosts: gameAPI.host.available })
} catch (e) {
  // 示例 Mod 不应影响游戏：失败只记录。
  gameAPI.emit('demo-node-mod:error', { message: e.message })
}

/* ---------------------------------------------------------------------------
 * 反面示例（**故意注释掉**，别照抄）：在同步钩子里 await 宿主
 *
 *   gameAPI.on('onYearAdvance', async (payload) => {
 *     // emitSync 不 await 回调 → 这个 Promise 被直接丢弃：
 *     const info = await gameAPI.host.call('demo-node-mod', 'nodeInfo')
 *     // 下面这行执行时，store 早就在 next() 返回时做完轨迹快照了 → 玩家看不到
 *     payload.content.push({ type: 'EVT', description: info.platform, grade: 0 })
 *   })
 *
 * 正确做法：等 Phase A 的异步生命周期点（loadBundle / onBeforeLife / onAfterLife /
 * Mod 命令）落地后，在那里 await；或用第六节的"物化为数据"通道。
 * ------------------------------------------------------------------------- */
