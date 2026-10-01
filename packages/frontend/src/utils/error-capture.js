/**
 * error-capture — 全局异常捕获（让「页面崩了」也能留下日志）
 *
 * 背景（真实故障复盘）：
 *   属性分配页渲染崩溃时，异常只出现在浏览器控制台，
 *   应用自己的日志缓冲里**一条都没有**——悬浮窗/日志导出就无从下手。
 *   原因：Vue 渲染期异常与 window 级未捕获异常都没有接进日志链路。
 *
 * 处理：
 *   1. 捕获 window 的 `error` 与 `unhandledrejection`（如资源加载/异步失败）。
 *   2. 由 main.js 另外接管 Vue 的 app.config.errorHandler（渲染/生命周期异常）。
 *   两者统一走 formatErrorLog 格式化后写入日志缓冲。
 *
 * target / pushLog 全部注入，Node 测试无需真实 window。
 */

// #formatErrorLog
// 把任意异常整理成一条（可含换行的）日志文本。
//
// @param {object} params
// @param {string} [params.kind] - 异常种类（未捕获错误 / 未处理的 Promise 拒绝 / Vue 错误 …）
// @param {*} [params.error] - Error 对象或任意抛出物
// @param {string} [params.location] - 位置（文件:行:列 或 路由）
// @param {string} [params.extra] - 附加信息（如 Vue 的 info）
// @returns {string} 日志文本
export function formatErrorLog({ kind = '异常', error, location, extra } = {}) {
  // 正文：优先 message，其次字符串化。
  let text
  // Error 或类 Error 对象。
  if (error && typeof error.message === 'string' && error.message) {
    text = error.message
  } else if (typeof error === 'string' && error) {
    text = error
  } else if (error === undefined || error === null) {
    text = '（无异常详情）'
  } else {
    // 兜底：JSON（循环引用等失败则退化为 String）。
    try {
      text = JSON.stringify(error)
    } catch {
      text = String(error)
    }
  }
  // 位置信息。
  const where = location ? ` @ ${location}` : ''
  // 附加信息。
  const note = extra ? `（${extra}）` : ''
  // 堆栈：最多保留 5 行，避免报告被堆栈淹没。
  const stack = error && typeof error.stack === 'string' && error.stack
    ? '\n' + error.stack.split('\n').slice(0, 5).map((l) => `    ${l.trim()}`).join('\n')
    : ''
  // 拼装（首行带 [异常] 前缀，便于悬浮窗/报告里一眼看到）。
  return `[异常] ${kind}: ${text}${where}${note}${stack}`
}

// #installErrorCapture
// 安装全局异常捕获：window 的 error / unhandledrejection → pushLog('error', ...)。
//
// @param {object} params
// @param {object} params.target - 事件源（浏览器传 window；测试传替身）
// @param {Function} params.pushLog - 写入日志的函数（level, msg）
// @returns {Function} 卸载函数（移除监听；无可监听对象时为空操作）
export function installErrorCapture({ target, pushLog } = {}) {
  // 事件源不可用 / 不支持监听：返回空操作（不能让报告工具本身成为新的故障点）。
  if (!target || typeof target.addEventListener !== 'function' || typeof pushLog !== 'function') {
    return () => {}
  }
  // 未捕获错误（同步抛错、资源加载失败等）。
  const onError = (event) => {
    // 位置：文件:行:列。
    const location = event && event.filename
      ? `${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}`
      : null
    // 写入日志（error 级：悬浮窗会亮角标并自动展开）。
    pushLog('error', formatErrorLog({
      kind: '未捕获错误',
      // 优先真实 Error（有堆栈），否则用 message 文本。
      error: (event && event.error) || (event && event.message),
      location,
    }))
  }
  // 未处理的 Promise 拒绝。
  const onRejection = (event) => {
    // 写入日志。
    pushLog('error', formatErrorLog({
      kind: '未处理的 Promise 拒绝',
      error: event ? event.reason : undefined,
    }))
  }
  // 注册。
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  // 卸载函数。
  return () => {
    // 移除监听。
    if (typeof target.removeEventListener === 'function') {
      target.removeEventListener('error', onError)
      target.removeEventListener('unhandledrejection', onRejection)
    }
  }
}
