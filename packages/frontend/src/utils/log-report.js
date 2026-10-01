/**
 * log-report — 日志格式化与「问题报告」构建（纯函数，可测试）
 *
 * 背景：
 *   引擎与前端全链路日志都汇入 gameStore.logBuffer，但此前只能在一个
 *   「设置页」里看，遇到问题（尤其页面渲染崩溃）时无法带出浏览器。
 *   本模块把「日志行格式」「环境信息采集」「报告文本拼装」「文件名生成」
 *   抽成无副作用的纯函数，供悬浮窗（LogDock）与单元测试共用。
 *
 * 设计约束：
 *   - 不直接访问 window/navigator（Node 测试环境没有）：环境对象由调用方注入。
 *   - 缺字段一律降级为「（未知）」，不能因为拿不到 UA 就抛错——报告工具本身必须最稳。
 */

// 日志级别（与 logger.js 五级一致）。
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error']

// #pad
// 数字左补零。
//
// @param {number} n - 数字
// @param {number} [len] - 目标长度（默认 2）
// @returns {string} 补零后的字符串
function pad(n, len = 2) {
  // 转字符串后补零。
  return String(n).padStart(len, '0')
}

// #formatLogLine
// 生成日志行文本：`[HH:MM:SS.mmm] [LEVEL] 消息`。
// 时间戳是「导出报告」定位问题发生顺序的关键，故进入缓冲时就带上。
//
// @param {string} level - trace/debug/info/warn/error
// @param {string} msg - 消息
// @param {Date} [date] - 时间（默认当前）
// @returns {string} 日志行
export function formatLogLine(level, msg, date = new Date()) {
  // 时分秒毫秒。
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  // 拼装。
  return `[${time}] [${String(level).toUpperCase()}] ${msg}`
}

// #countByLevel
// 统计各等级条数（悬浮窗角标 / 报告头部用）。
// 级别取行内第一个 `[LEVEL]`：带时间戳的行级别在时间之后，仍是第一个。
//
// @param {string[]} logs - 日志行数组
// @returns {{trace: number, debug: number, info: number, warn: number, error: number, total: number}} 统计
export function countByLevel(logs) {
  // 初始化计数。
  const counts = { trace: 0, debug: 0, info: 0, warn: 0, error: 0, total: 0 }
  // 逐行匹配。
  for (const line of logs || []) {
    // 首个级别标记。
    const matched = /\[(TRACE|DEBUG|INFO|WARN|ERROR)\]/.exec(String(line))
    // 命中则累加（未命中的行只计入 total）。
    if (matched) counts[matched[1].toLowerCase()]++
    // 总数。
    counts.total++
  }
  // 返回。
  return counts
}

// #formatDateTime
// 格式化导出时间：`YYYY-MM-DD HH:mm:ss (+08:00)`。
//
// @param {Date} date - 时间
// @returns {string} 文本
export function formatDateTime(date = new Date()) {
  // 本地时区偏移（分钟 → ±HH:MM）。
  const offsetMin = -date.getTimezoneOffset()
  // 符号。
  const sign = offsetMin >= 0 ? '+' : '-'
  // 绝对值。
  const abs = Math.abs(offsetMin)
  // 摘要文本。
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ` +
    `(${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`
  )
}

// #buildLogFileName
// 生成下载文件名：`liferestart-log-YYYYMMDD-HHmmss.txt`。
//
// @param {Date} [date] - 时间（默认当前）
// @returns {string} 文件名
export function buildLogFileName(date = new Date()) {
  // 紧凑时间戳。
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  // 拼装。
  return `liferestart-log-${stamp}.txt`
}

// #collectLogMeta
// 采集运行环境信息（注入式：Node 测试无 window/navigator）。
//
// @param {object} [deps]
// @param {object} [deps.location] - location 对象（href/hash/pathname）
// @param {object} [deps.navigatorLike] - navigator 对象（userAgent）
// @param {object} [deps.screenLike] - screen 对象（width/height）
// @param {number} [deps.devicePixelRatio] - 设备像素比
// @returns {{pageUrl: string|null, route: string|null, userAgent: string|null, viewport: string|null}} 环境信息
export function collectLogMeta({ location, navigatorLike, screenLike, devicePixelRatio } = {}) {
  // 完整地址。
  const pageUrl = location && location.href ? String(location.href) : null
  // Hash 路由（如 #/property → /property）；无 hash 时退化为 pathname。
  const hash = location && location.hash ? String(location.hash).replace(/^#/, '') : ''
  // 当前路由。
  const route = hash || (location && location.pathname ? String(location.pathname) : null)
  // UA。
  const userAgent = navigatorLike && navigatorLike.userAgent ? String(navigatorLike.userAgent) : null
  // 视口尺寸（拿不到就是 null，报告里显示「未知」）。
  let viewport = null
  // 宽高都有效才拼装。
  if (screenLike && Number(screenLike.width) > 0 && Number(screenLike.height) > 0) {
    // 基础尺寸 + 可选 dpr。
    viewport = `${Number(screenLike.width)}x${Number(screenLike.height)}`
    // 设备像素比有效则追加。
    if (Number(devicePixelRatio) > 0) viewport += ` @${Number(devicePixelRatio)}dppx`
  }
  // 返回。
  return { pageUrl, route, userAgent, viewport }
}

// #buildLogReport
// 拼装可直接粘贴进 issue 的报告文本：头部环境 + 全部日志。
//
// @param {object} params
// @param {string[]} [params.logs] - 日志行
// @param {object} [params.meta] - 报告头字段（level/pageUrl/route/userAgent/viewport/game/mods/dataSource）
// @param {Date} [params.now] - 导出时间
// @returns {string} 报告文本
export function buildLogReport({ logs = [], meta = {}, now = new Date() } = {}) {
  // 级别统计。
  const counts = countByLevel(logs)
  // 「未知」占位。
  const UNKNOWN = '（未知）'
  // 头部行（键对齐，方便人眼扫）。
  const head = [
    '===== 人生重开模拟器 日志报告 =====',
    `导出时间 : ${formatDateTime(now)}`,
    `日志级别 : ${meta.level || UNKNOWN}`,
    `日志条数 : ${counts.total}（error ${counts.error} / warn ${counts.warn} / info ${counts.info} / debug ${counts.debug} / trace ${counts.trace}）`,
    `页面地址 : ${meta.pageUrl || UNKNOWN}`,
    `当前路由 : ${meta.route || UNKNOWN}`,
    `运行环境 : ${meta.userAgent || UNKNOWN}`,
    `视口尺寸 : ${meta.viewport || UNKNOWN}`,
    `游戏状态 : ${meta.game || UNKNOWN}`,
    `数据源   : ${meta.dataSource || UNKNOWN}`,
    `Mod 状态 : ${meta.mods || UNKNOWN}`,
    '===== 日志开始（最旧 → 最新） =====',
  ]
  // 日志主体（空则给一行提示，避免报告看起来像被截断）。
  const body = counts.total > 0 ? logs.map((l) => String(l)) : ['（暂无日志）']
  // 收尾。
  const tail = ['===== 日志结束 =====', '']
  // 拼装（末尾保留空行，方便继续粘贴）。
  return [...head, ...body, ...tail].join('\n')
}
