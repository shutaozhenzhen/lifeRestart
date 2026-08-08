/**
 * AI Mod 核心（Step 16/17/18/19）
 *
 * AI Mod 是一个普通 Mod，只是默认安装且负责暴露 gameAPI.ai 增强能力。
 * 通过 createAIMod() 工厂把 AI 客户端 + 校验器 + 钩子逻辑组装进 gameAPI。
 *
 * 职责：
 *   1. 把 manifest.ai（baseUrl/apiKey/model）注入 gameAPI.ai。
 *   2. 注册生成钩子：onTalentPoolGenerate / onYearAdvance。
 *   3. 生成结果经校验器校验，失败自动重试 N 次，最终 fallback。
 */

// 引擎共享模块。
import { createAIClient } from 'game-engine/src/ai/ai-client.js'
import { validateTalentJSON, validateEventJSON } from 'game-engine/src/ai/ai-validate.js'

// #createAIMod
// 创建 AI Mod 增强器：注入 gameAPI + 注册钩子。
//
// @param {object} params
// @param {object} params.gameAPI - 游戏的 gameAPI 实例
// @param {object} params.config - AI 配置 { baseUrl, apiKey, model }
// @param {object} [params.fetch] - fetch 实现（注入式，测试用 mock）
// @param {Function} [params.generateTalent] - 自定义天赋生成函数（可覆盖默认）
// @param {Function} [params.generateEvent] - 自定义事件生成函数（可覆盖默认）
// @param {object} [params.log] - 日志器
// @returns {object} AI Mod 控制句柄 { register, unregister, generateTalent, generateEvent }
export function createAIMod({ gameAPI, config, fetch, generateTalent, generateEvent, log }) {
  // 日志器。
  const logger = log || { debug: () => {}, warn: () => {}, error: () => {} }
  // 客户端（配置了 Key 才创建）。
  const client = config && config.apiKey
    ? createAIClient({ fetch, log: logger })
    : null
  // 默认重试次数。
  const MAX_RETRY = 3
  // 已注册的移除函数列表。
  const unregisterFns = []

  // #buildSystemPrompt
  // 生成系统提示（定义输出 JSON 结构）。
  //
  // @param {string} type - 'talent' | 'event'
  // @returns {string} 系统提示
  function buildSystemPrompt(type) {
    // 天赋结构。
    if (type === 'talent') {
      return '你是人生重开模拟器的天赋设计器。输出 JSON，结构：{"id":"字符串ID","name":"天赋名","description":"描述","condition":"条件表达式，用 params.XXX 访问属性，如 params.CHR > 5","effect":{"属性键":数值增量},"grade":数字}。只输出 JSON。'
    }
    // 事件结构。
    return '你是人生重开模拟器的剧情生成器。输出 JSON，结构：{"id":"字符串ID","event":"事件描述","effect":{"属性键":数值增量},"include":"可选触发条件，params.XXX"}。只输出 JSON。'
  }

  // #generateTalentWithAI
  // 用 AI 生成天赋（含校验 + 重试）。
  //
  // @param {object} [hint] - 生成提示（当前状态等）
  // @returns {Promise<object|null>} 校验通过的天赋；失败返回 null
  async function generateTalentWithAI(hint = {}) {
    // 无客户端。
    if (!client) return null
    // 重试。
    for (let i = 0; i < MAX_RETRY; i++) {
      // 调用 AI。
      try {
        // 生成 JSON。
        const item = await client.generateJSON({
          ...config,
          system: buildSystemPrompt('talent'),
          user: `请生成一个天赋。参考当前属性：${JSON.stringify(hint.props || {})}`,
        })
        // 校验。
        const v = validateTalentJSON(item)
        // 通过。
        if (v.ok) return item
        // 失败记录（下次重试喂错误信息）。
        logger.warn(`AI 天赋校验失败(第${i + 1}次): ${v.error}`)
      } catch (e) {
        // 记录。
        logger.warn(`AI 天赋生成失败(第${i + 1}次): ${e.message}`)
      }
    }
    // 重试耗尽。
    logger.warn('AI 天赋生成重试耗尽，fallback 到原版数据')
    // 返回 null（调用方 fallback）。
    return null
  }

  // #generateEventWithAI
  // 用 AI 生成事件（含校验 + 重试）。
  //
  // @param {object} [hint] - 生成提示
  // @returns {Promise<object|null>} 校验通过的事件；失败返回 null
  async function generateEventWithAI(hint = {}) {
    // 无客户端。
    if (!client) return null
    // 重试。
    for (let i = 0; i < MAX_RETRY; i++) {
      // 调用 AI。
      try {
        // 生成 JSON。
        const item = await client.generateJSON({
          ...config,
          system: buildSystemPrompt('event'),
          user: `请生成一个事件。当前年龄 ${hint.age}，属性：${JSON.stringify(hint.props || {})}`,
        })
        // 校验。
        const v = validateEventJSON(item)
        // 通过。
        if (v.ok) return item
        // 失败记录。
        logger.warn(`AI 事件校验失败(第${i + 1}次): ${v.error}`)
      } catch (e) {
        // 记录。
        logger.warn(`AI 事件生成失败(第${i + 1}次): ${e.message}`)
      }
    }
    // 重试耗尽。
    logger.warn('AI 事件生成重试耗尽，fallback 到原版数据')
    // 返回 null。
    return null
  }

  // #register
  // 注册 AI 钩子（幂等：重复调用先注销）。
  //
  // @returns {object} 本实例
  function register() {
    // 先注销旧的。
    unregister()
    // 无客户端不注册。
    if (!client) return this
    // 注册：天赋池生成时注入 AI 天赋。
    unregisterFns.push(gameAPI.on('onTalentPoolGenerate', async (payload) => {
      // 生成。
      const t = await generateTalentWithAI()
      // 成功注入。
      if (t) payload.pool.push(t)
    }))
    // 注册：翻年时注入 AI 事件（异步生成补充事件）。
    unregisterFns.push(gameAPI.on('onYearAdvance', async (payload) => {
      // 生成。
      const e = await generateEventWithAI({ age: payload.age })
      // 成功注入。
      if (e) payload.content.push({ type: 'EVT', description: e.event, grade: 0 })
    }))
    // 返回。
    return this
  }

  // #unregister
  // 注销全部钩子。
  //
  // @returns {void}
  function unregister() {
    // 逐个注销。
    for (const fn of unregisterFns) fn()
    // 清空。
    unregisterFns.length = 0
  }

  // 返回控制句柄。
  return {
    register,
    unregister,
    // 暴露生成函数（可注入自定义实现覆盖）。
    generateTalent: generateTalent || generateTalentWithAI,
    generateEvent: generateEvent || generateEventWithAI,
  }
}

// 默认导出。
export default createAIMod
