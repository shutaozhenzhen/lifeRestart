/**
 * ui-actions — Mod 界面里的**动作按钮**（块类型 `{ t: 'action', id, label }`）的查找与触发
 *
 * 谁提供动作：`code.js` 里的 `gameAPI.ui.onAction(id, fn)`（运行期注册）。宿主侧把每个
 * Mod 的 `gameAPI.ui` 桥收在 `stores/game.js` 的 `modUiBridges` 里，本模块负责"按 id 查"。
 *
 * 两条不许退让的规则（见任务书 D6）：
 *   1. **没注册过 → 按钮禁用 + 可读提示**（不是"点了没反应"）；
 *   2. **异常隔离**：回调抛错 / Promise 拒绝只记日志，绝不炸页面。
 *
 * ⚠️ 动作是**运行期**能力：静态声明（manifest.ui 里的 blocks）可以在启动时就渲染，
 *    但`onAction` 注册只会在开一局之后发生 —— 所以启动阶段看到的动作按钮是**禁用**的，
 *    这是正确表现（不是 bug）。
 */

// #findAction
// 在本局所有 Mod 的界面桥里找一个动作。
//
// @param {object} bridges - `modUiBridges`（Mod 名 → gameAPI.ui）
// @param {string} id - 动作 id
// @returns {{mod: string, bridge: object}|null} 命中项
export function findAction(bridges, id) {
  // 非空字符串才查。
  if (!id || typeof id !== 'string' || !bridges) return null
  // 逐个 Mod（顺序 = 加载顺序；同 id 先加载者胜 —— 与"后加载覆盖"不同，这里是**查找**语义，
  // 先注册的 Mod 先被问到；重复 id 在引擎侧已经是校验错误，正常不会出现）。
  for (const [mod, bridge] of Object.entries(bridges)) {
    // 桥可能不完整（降级桥）。
    if (typeof bridge?.hasAction !== 'function') continue
    // 命中。
    if (bridge.hasAction(id)) return { mod, bridge }
  }
  // 没有。
  return null
}

// #hasAction
// 某个动作 id 现在能不能点（渲染器据此决定 disabled）。
//
// @param {object} bridges - `modUiBridges`
// @param {string} id - 动作 id
// @returns {boolean} 是否已注册
export function hasAction(bridges, id) {
  // 复用查找。
  return findAction(bridges, id) !== null
}

// #triggerAction
// 触发一个动作（**异步 + 异常隔离**：回调抛错只记日志）。
//
// @param {object} bridges - `modUiBridges`
// @param {object} block - 动作块（{ t:'action', id, label }）
// @param {object} [log] - 日志器（需有 warn/error；缺省用 console）
// @returns {Promise<{ok: boolean, reason?: string}>} 结果
export async function triggerAction(bridges, block, log) {
  // 日志器（缺省 console：宿主没给日志器时也不能静默）。
  const logger = log || console
  // id。
  const id = block?.id
  // 查。
  const hit = findAction(bridges, id)
  // 没注册。
  if (!hit) {
    // 出声（不静默）。
    logger.warn?.(`[UI][mod-ui] 动作 ${id} 没有注册处理函数（Mod 需在 code.js 里 gameAPI.ui.onAction 注册）`)
    // 返回（按钮本应禁用；这里再兜一层）。
    return { ok: false, reason: 'not-registered' }
  }
  // 调用（桥自己会抛"没注册"；这里统一接住）。
  try {
    // 执行（await 支持异步回调）。
    await hit.bridge.trigger(id, block)
    // 记录（trace/debug 级：动作点击是用户行为，日志面板里能看到）。
    logger.debug?.(`[UI][mod-ui] 动作 ${id}（Mod ${hit.mod}）已执行`)
    // 成功。
    return { ok: true }
  } catch (e) {
    // 只记日志（回调是 Mod 提供的，出错不该让宿主页面崩）。
    logger.error?.(`[UI][mod-ui] 动作 ${id}（Mod ${hit.mod}）执行失败：${e?.message || e}`)
    // 返回。
    return { ok: false, reason: `error: ${e?.message || e}` }
  }
}
