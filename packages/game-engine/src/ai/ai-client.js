/**
 * AI 客户端（OpenAI 协议，Step 16/17）
 *
 * 统一使用 OpenAI 协议（/v1/chat/completions），兼容 DeepSeek、GLM、
 * 通义千问、OpenAI 等。fetch 注入式（浏览器原生 fetch / Node 代理 / 测试 mock）。
 *
 * 职责：
 *   1. chatCompletion：单轮对话（生成 JSON 响应）。
 *   2. 错误处理：401（Key 无效）、429（限流）、500（服务端错误）、超时。
 *   3. 响应 JSON 解析（容忍 markdown 代码块包裹）。
 */

// #createAIClient
// 创建 AI 客户端。
//
// @param {object} deps
// @param {Function} deps.fetch - fetch 实现（默认全局 fetch，Node 18+ 自带）
// @param {object} [deps.log] - 日志器
// @returns {object} AI 客户端
export function createAIClient({ fetch: fetchImpl, log } = {}) {
  // fetch 实现（缺省用全局）。
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  // 日志器。
  const logger = log || { debug: () => {}, warn: () => {}, error: () => {} }

  // #chatCompletion
  // 调用 OpenAI 协议对话接口。
  //
  // @param {object} params
  // @param {string} params.baseUrl - 服务商 API 根地址（如 https://api.openai.com/v1）
  // @param {string} params.apiKey - API Key
  // @param {string} params.model - 模型名
  // @param {Array<{role: string, content: string}>} params.messages - 对话消息
  // @param {number} [params.maxTokens] - 最大生成 token
  // @param {number} [params.timeout] - 超时毫秒（默认 30000）
  // @param {object} [params.fetch] - 本次调用覆盖的 fetch
  // @returns {Promise<string>} AI 回复文本
  // @throws {Error} 带状态码的错误（401/429/500/超时）
  async function chatCompletion({ baseUrl, apiKey, model, messages, maxTokens = 1024, timeout = 30000 }) {
    // 无 fetch 实现（老 Node 环境）。
    if (!doFetch) throw new Error('当前环境无 fetch（Node 18+ 或注入 fetch）')
    // 无 Key。
    if (!apiKey) {
      // 记录。
      logger.warn('AI 调用缺少 API Key')
      // 抛错。
      throw Object.assign(new Error('缺少 API Key'), { status: 401 })
    }
    // 请求体。
    const body = { model, messages, max_tokens: maxTokens }
    // 超时控制：AbortController 取消请求。
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    // 超时定时器。
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null
    // 记录请求。
    logger.debug(`AI 请求 ${model}: ${messages.length} 条消息`)
    // 发起请求。
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    })
    // 清理定时器。
    if (timer) clearTimeout(timer)
    // 按状态码分发错误。
    if (!res.ok) {
      // 错误信息（尝试读取响应体）。
      let detail = ''
      // 尝试解析错误体。
      try { detail = (await res.json()).error?.message || '' } catch { /* 忽略 */ }
      // 状态码。
      const status = res.status
      // 记录。
      logger.error(`AI 请求失败 ${status}: ${detail}`)
      // 抛出带状态码的错误。
      throw Object.assign(new Error(`AI 请求失败(${status}): ${detail}`), { status })
    }
    // 解析响应。
    const data = await res.json()
    // 提取回复文本。
    const text = data.choices?.[0]?.message?.content || ''
    // 记录。
    logger.debug(`AI 响应: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`)
    // 返回。
    return text
  }

  // #generateJSON
  // 调用 AI 并要求返回 JSON（自动剥离 markdown 代码块）。
  //
  // @param {object} params - 同 chatCompletion
  // @param {string} params.system - 系统提示（定义输出 JSON 结构）
  // @param {string} params.user - 用户提示
  // @returns {Promise<object>} 解析后的 JSON 对象
  // @throws {Error} JSON 解析失败（带 aiParseError 标记）
  async function generateJSON({ baseUrl, apiKey, model, system, user, maxTokens, timeout }) {
    // 调用对话（chatCompletion 为模块内函数，直接调用）。
    const text = await chatCompletion({
      baseUrl, apiKey, model, maxTokens, timeout,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })
    // 剥离 markdown 代码块（```json ... ```）。
    const clean = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim()
    // 解析 JSON。
    try {
      // 返回解析结果。
      return JSON.parse(clean)
    } catch (e) {
      // 记录。
      logger.warn(`AI JSON 解析失败: ${e.message}\n原始: ${text.slice(0, 200)}`)
      // 抛带标记错误。
      throw Object.assign(new Error(`AI JSON 解析失败: ${e.message}`), { aiParseError: true })
    }
  }

  // 返回客户端。
  return {
    chatCompletion,
    generateJSON,
  }
}

// #openAIConfig
// 生成默认的 OpenAI 协议配置（各服务商 baseUrl 对照）。
// 供 ai-mod 的 manifest.ai 参考。
export const OPENAI_CONFIG = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}
