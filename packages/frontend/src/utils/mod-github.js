/**
 * mod-github — 从 GitHub 拉取源码当作 Mod 安装（浏览器侧）
 *
 * 用户输入一个 GitHub 链接，本模块把那个仓库（或其中某个目录）的文件拉下来，
 * 打成 zip 交给 `installModFromZip()` —— 也就是**和「上传 zip 安装」同一条落地链路**。
 *
 * ## 为什么不是"下载 zipball 解包"（最直觉的做法，但浏览器里做不到）
 * GitHub 的 zipball / `archive/*.zip` 真实端点是 `codeload.github.com`，它只回
 * `Access-Control-Allow-Origin: https://render.githubusercontent.com`（2026-10 实测），
 * 浏览器 fetch 会被 CORS 直接挡死。Node 侧没有 CORS，所以 CLI 可以走它（本模块不涉及）。
 *
 * 浏览器能用的只有两个"允许任意来源"（`ACAO: *`，实测）的端点：
 *   - `api.github.com`            → 列目录/取元数据（**占匿名限流配额：60 次/小时/IP**）
 *   - `raw.githubusercontent.com` → 取文件内容（**不占 API 配额**）
 *
 * ## 取包顺序（一次安装 2~3 次 API 调用，其余走 raw）
 *   1. 链接没带分支   → `GET /repos/{o}/{r}`                    取 default_branch（1 次）
 *   2. 总是           → `GET /repos/{o}/{r}/commits/{ref}`       取 commit sha + **它的 tree sha**（1 次）
 *   3. 总是           → `GET /repos/{o}/{r}/git/trees/{tree}`？recursive=1  整棵树（含每个文件大小）（1 次）
 *   4. 每个文本文件   → `GET raw.githubusercontent.com/{o}/{r}/{commit}/{path}`（并发，不占配额）
 *
 * 第 2 步不是多余的：① tree 端点要的是 **tree sha**，commit 响应里正好带着它（比"拿 commit sha
 * 去撞 tree 端点"这种依赖未文档化行为更可靠）；② 拿到 commit sha 后，第 4 步的 raw 请求全部钉在
 * **同一个 commit** 上 —— 否则并发拉取期间分支被推送，会拼出"半个旧版半个新版"的撕裂包；
 * ③ commit 会记进日志/提示（"这包到底是哪一版"）。
 *
 * ## raw 连不上时必须有兜底（否则这功能在一大片网络里等于不可用）
 * 实测（2026-10，本机）：`raw.githubusercontent.com` **间歇性** `UND_ERR_CONNECT_TIMEOUT`
 * —— 同一轮 5 个文件里 3 个成功、2 个连接超时；而 `api.github.com` 每次都通。raw 在国内网络
 * 基本就是这个状态。所以每个文件是**两级**取法：
 *   - 一级：raw（不占配额，正常情况够用）
 *   - 二级：`GET /repos/{o}/{r}/git/blobs/{blob_sha}`（base64；**可靠但每个文件算 1 次 API 调用**，
 *     会吃掉 60 次/小时的匿名配额 —— 所以只在一级失败时用，并且把"N 个文件走了兜底"报出来）
 * blob sha 来自第 3 步的树（树里每个文件都带 sha），不需要额外请求。
 *
 * ## 装包语义完全复用 zip 安装
 * 拉到的文件表 → `createModZip()` → `installModFromZip()`。于是路径穿越防护、条目数上限（512）、
 * 单文件上限（8MB）、累计上限（32MB）、manifest 校验、系统 Mod 名保护（默认拒绝 + 二次确认）
 * **全都只有一份实现**：不可能出现"上传 zip 装"与"从 GitHub 装"两套规则。
 * 额外的三道闸门在下载之前就用树里的 size 拦下（超限直接拒绝，不浪费流量）。
 */

// 引擎共用：文本后缀表 + 尺寸/条目上限 + 打包（安装语义的唯一来源）。
import { createModZip, MAX_ENTRIES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, TEXT_EXT } from 'game-engine/src/mod/zip.js'
// 落地链路（zip 安装入口）。
import { installModFromZip } from './mod-runtime.js'

// GitHub API（`ACAO: *`；占匿名限流配额）。
export const GITHUB_API = 'https://api.github.com'
// 原始文件（`ACAO: *`；**不占** API 配额）。
export const GITHUB_RAW = 'https://raw.githubusercontent.com'
// 一次安装的 API 调用数上限（界面提示配额时用；实测 2~3 次，raw 连不上时每个文件再加 1 次）。
export const API_CALLS_PER_INSTALL = 3
// 候选 Mod 目录的最大深度（`packages/mods/foo/manifest.json` = 3；examples 里的 = 4）。
export const MAX_CANDIDATE_DEPTH = 5
// 候选最多列几个（再多就让用户直接粘 `/tree/<分支>/<目录>` 链接，别把界面刷爆）。
export const MAX_CANDIDATES = 12
// 并行下载数（raw 很宽容，但也别把浏览器连接数打满）。
export const DOWNLOAD_CONCURRENCY = 5
// 字节长度测量（比对"树里的 size"与"实际下载到的字节"时必须按字节，不能按 JS 字符串长度）。
const TEXT_ENCODER = new TextEncoder()
// 分支名里带斜杠时，最多试着把它当"多段分支"拼几次（GitHub 的 URL 本身无法区分 `tree/ref/path`）。
export const MAX_REF_ATTEMPTS = 3

// #stripGit
// 去掉仓库名末尾的 `.git`。
//
// @param {string} s - 仓库名
// @returns {string} 归一化后的仓库名
function stripGit(s) {
  // 后缀。
  return String(s || '').replace(/\.git$/i, '')
}

// #dirnameOf
// 取路径的目录部分（没有斜杠时返回空串 = 仓库根）。
//
// @param {string} p - 路径
// @returns {string} 目录
function dirnameOf(p) {
  // 归一化。
  const s = String(p || '').replace(/^\/+|\/+$/g, '')
  // 无斜杠 → 根目录。
  if (!s.includes('/')) return ''
  // 截断。
  return s.slice(0, s.lastIndexOf('/'))
}

// #depthOf
// 目录深度（`''` = 0，`a` = 1，`a/b` = 2）。
//
// @param {string} p - 目录
// @returns {number} 深度
function depthOf(p) {
  // 空 = 0。
  return p ? p.split('/').length : 0
}

// #parseGitHubUrl
// 解析用户输入的 GitHub 链接（纯函数，不发请求）。
//
// 支持：
//   - `https://github.com/<owner>/<repo>`（可带 `?ref=<分支>`）
//   - `https://github.com/<owner>/<repo>/tree/<分支>[/<目录>…]`
//   - `https://github.com/<owner>/<repo>/blob/<分支>/<文件>`（取它所在目录）
//   - `https://raw.githubusercontent.com/<owner>/<repo>/<分支>/<文件>`（取它所在目录）
//   - `https://api.github.com/repos/<owner>/<repo>/contents[/<目录>][?ref=<分支>]`
//   - `git@github.com:<owner>/<repo>.git`、`github.com/...`（省 scheme）、`<owner>/<repo>`（简写）
//
// @param {string} input - 用户输入
// @returns {{ok: boolean, owner?: string, repo?: string, ref?: string, path?: string, kind?: string, segments?: string[], refFromQuery?: boolean, webUrl?: string, errors: string[]}} 解析结果
export function parseGitHubUrl(input) {
  // 原文（去掉首尾空白与尖括号：从聊天/终端复制常带它们）。
  const raw = String(input ?? '').trim().replace(/^<+|>+$/g, '')
  // 空输入。
  if (!raw) return { ok: false, errors: ['请输入 GitHub 链接'] }
  // 先摘掉 #fragment 与 ?query（`?ref=` 是 GitHub 官方指定分支的方式，要留下来）。
  let s = raw
  // fragment。
  const hashAt = s.indexOf('#')
  if (hashAt >= 0) s = s.slice(0, hashAt)
  // query。
  let refFromQuery = ''
  // 问号位置。
  const qAt = s.indexOf('?')
  if (qAt >= 0) {
    // 解析查询串。
    try {
      // ref 参数。
      const q = new URLSearchParams(s.slice(qAt + 1))
      // 取值。
      if (q.get('ref')) refFromQuery = q.get('ref')
    } catch {
      // 查询串不合法就忽略（下面的主流程会给出更可读的错误）。
    }
    // 去掉查询串。
    s = s.slice(0, qAt)
  }
  // SSH 形态：git@github.com:owner/repo.git。
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(s)
  if (ssh) return buildParsed(ssh[1], stripGit(ssh[2]), refFromQuery, '', 'repo', [], !!refFromQuery)
  // 省 scheme 的 github.com/... 与 raw/api 主机。
  if (/^(www\.)?github\.com\//i.test(s) || /^raw\.githubusercontent\.com\//i.test(s) || /^api\.github\.com\//i.test(s)) s = `https://${s}`
  // 还没有 scheme → 只可能是 `owner/repo` 简写。
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    // 简写匹配。
    const short = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(s)
    // 不匹配 → 给可读错误（列出支持的形态，别只说"看不懂"）。
    if (!short) {
      return { ok: false, errors: [`看不懂这个链接：${raw}（支持 https://github.com/<owner>/<repo>[/tree/<分支>/<目录>]、raw 链接、owner/repo 简写）`] }
    }
    // 简写。
    return buildParsed(short[1], stripGit(short[2]), refFromQuery, '', 'repo', [], !!refFromQuery)
  }
  // 解析 URL。
  let u
  try {
    // 构造。
    u = new URL(s)
  } catch {
    // 失败。
    return { ok: false, errors: [`不是合法的 URL：${raw}`] }
  }
  // 主机（小写）。
  const host = u.hostname.toLowerCase()
  // 路径段（去掉空段）。
  const segs = u.pathname.split('/').filter(Boolean)
  // github.com。
  if (host === 'github.com' || host === 'www.github.com') {
    // 至少 owner/repo。
    if (segs.length < 2) return { ok: false, errors: ['链接里至少要包含 owner/repo'] }
    // 基本字段。
    const owner = segs[0]
    // 仓库名。
    const repo = stripGit(segs[1])
    // 动词之后的段。
    const rest = segs.slice(2)
    // 只有 owner/repo。
    if (rest.length === 0) return buildParsed(owner, repo, refFromQuery, '', 'repo', [], !!refFromQuery)
    // 动词。
    const verb = rest[0]
    // 仓库根的树。
    if (verb === 'tree') {
      // 少了分支名。
      if (rest.length < 2) return { ok: false, errors: ['/tree/ 链接少了分支名（形如 /tree/main/mods/xxx）'] }
      // 段（不带动词）。
      const tail = rest.slice(1)
      // 显式 ?ref= 时没有歧义：后面全是路径。
      if (refFromQuery) return buildParsed(owner, repo, refFromQuery, tail.join('/'), 'tree', [], true)
      // 否则按"第一段是分支"解析，并把歧义留给请求层回退（分支名可能含斜杠）。
      return buildParsed(owner, repo, tail[0], tail.slice(1).join('/'), 'tree', tail, false)
    }
    // 指向文件：取它所在目录。
    if (verb === 'blob') {
      // 至少要 分支 + 文件名。
      if (rest.length < 3) return { ok: false, errors: ['/blob/ 链接要指到一个文件（形如 /blob/main/mods/xxx/manifest.json）'] }
      // 段。
      const tail = rest.slice(1)
      // ?ref= 时 tail 全是路径（没有歧义，也不需要回退用的段）。
      if (refFromQuery) return buildParsed(owner, repo, refFromQuery, dirnameOf(tail.join('/')), 'blob', [], true)
      // 常见形态：第一段是分支；回退段 = 分支+目录（最后一段是文件名，去掉）。
      return buildParsed(owner, repo, tail[0], dirnameOf(tail.slice(1).join('/')), 'blob', tail.slice(0, -1), false)
    }
    // zipball / archive：浏览器做不到，给出**为什么**（否则用户只会看到"CORS 错误"）。
    if (verb === 'archive' || verb === 'zipball' || verb === 'tarball') {
      // 明确拒绝 + 指路。
      return { ok: false, errors: ['不能直接用 zip 下载链接：GitHub 的 zipball 端点（codeload.github.com）不允许跨域，浏览器里必然失败。请改用仓库链接或 /tree/<分支>/<目录> 链接（走 api.github.com + raw）'] }
    }
    // Release 资产同理（会 302 到 objects.githubusercontent.com）。
    if (verb === 'releases') {
      // 拒绝。
      return { ok: false, errors: ['不支持 Release 资产链接（会重定向到受 CORS 限制的域名）。请用仓库链接或 /tree/<分支>/<目录> 链接'] }
    }
    // 其它动词（issues / pulls / commits / settings…）。
    return { ok: false, errors: [`不支持的链接形态：/${verb}/（请用仓库链接或 /tree/<分支>/<目录> 链接）`] }
  }
  // raw.githubusercontent.com/<owner>/<repo>/<分支>/<路径>。
  if (host === 'raw.githubusercontent.com') {
    // 至少 owner/repo/分支。
    if (segs.length < 3) return { ok: false, errors: ['raw 链接至少要包含 owner/repo/分支'] }
    // 基本字段。
    const owner = segs[0]
    // 仓库名。
    const repo = stripGit(segs[1])
    // 分支+路径段。
    const tail = segs.slice(2)
    // `refs/heads/main/...` 形态（raw 也认这种 ref）。
    if (tail[0] === 'refs' && tail.length >= 3) {
      // 完整 ref。
      const ref = tail.slice(0, 3).join('/')
      // 文件路径。
      const filePath = tail.slice(3).join('/')
      // 返回（取所在目录；ref 已完整 → 无需回退段）。
      return buildParsed(owner, repo, ref, dirnameOf(filePath), 'raw', [], true)
    }
    // 常规：第一段是分支。
    const filePath = tail.slice(1).join('/')
    // 返回（回退段 = 分支+目录，最后一段是文件名）。
    return buildParsed(owner, repo, tail[0], dirnameOf(filePath), 'raw', tail.slice(0, -1), false)
  }
  // api.github.com/repos/<owner>/<repo>/contents/<目录>。
  if (host === 'api.github.com') {
    // 形态校验。
    if (segs[0] !== 'repos' || segs.length < 3) {
      // 拒绝（只支持 contents）。
      return { ok: false, errors: ['api 链接只支持 https://api.github.com/repos/<owner>/<repo>/contents[/<目录>]'] }
    }
    // 基本字段。
    const owner = segs[1]
    // 仓库名。
    const repo = stripGit(segs[2])
    // contents 之后的段 = 目录。
    const tail = segs.slice(3)
    // 只认 `/repos/<o>/<r>` 与 `/repos/<o>/<r>/contents[/<目录>]`：
    // 别的子资源（/pulls、/issues…）要拒绝，**别静默当成仓库根**（那会去装一个用户没指定的东西）。
    if (tail.length > 0 && tail[0] !== 'contents') {
      // 拒绝。
      return { ok: false, errors: [`api 链接不支持 /${tail[0]}/（只支持 /repos/<owner>/<repo>/contents[/<目录>]）`] }
    }
    // 目录（contents 本身不算路径）。
    const path = tail[0] === 'contents' ? tail.slice(1).join('/') : ''
    // contents 端点用 `?ref=` 指定分支，没有歧义。
    return buildParsed(owner, repo, refFromQuery, path, 'contents', [], !!refFromQuery)
  }
  // 其它站点。
  return { ok: false, errors: [`只支持 github.com 链接（当前站点：${host}）`] }
}

// #buildParsed
// 组装解析结果（统一出口，保证字段齐全）。
//
// @param {string} owner - 所有者
// @param {string} repo - 仓库
// @param {string} ref - 分支/标签/commit（可能为空 = 用默认分支）
// @param {string} path - 仓库内目录（空 = 仓库根）
// @param {string} kind - 链接形态（repo/tree/blob/raw/contents）
// @param {string[]} segments - 动词之后的段（分支名含斜杠时用于回退尝试；空 = 无歧义）
// @param {boolean} refFromQuery - 分支是否来自 `?ref=`（来自它就没有歧义，不回退）
// @returns {object} 解析结果
function buildParsed(owner, repo, ref, path, kind, segments, refFromQuery) {
  // 归一化目录（去掉首尾斜杠）。
  const dir = String(path || '').replace(/^\/+|\/+$/g, '')
  // 返回。
  return {
    // 成功。
    ok: true,
    // 所有者。
    owner,
    // 仓库。
    repo,
    // 分支（空 = 请求默认分支）。
    ref: ref || '',
    // 目录（空 = 仓库根）。
    path: dir,
    // 形态。
    kind,
    // 歧义回退用的段（空数组 = 不用回退）。
    segments: Array.isArray(segments) ? segments.filter((x) => x !== '') : [],
    // 分支是否来自 `?ref=`（来自它就没有歧义，不做回退尝试）。
    refFromQuery: !!refFromQuery,
    // 人能直接打开的网页地址（候选目录让用户点选时用）。
    webUrl: `https://github.com/${owner}/${repo}${ref ? `/tree/${ref}` : ''}${dir ? `/${dir}` : ''}`,
    // 错误。
    errors: [],
  }
}

// #rateLimitResetText
// 把 GitHub 的限流重置时间戳变成可读文本。
//
// @param {string|number} reset - `x-ratelimit-reset`（秒）
// @returns {string} 文本（取不到时给空串）
function rateLimitResetText(reset) {
  // 转数字。
  const n = Number(reset)
  // 无效。
  if (!Number.isFinite(n) || n <= 0) return ''
  // 本地时间（用户看的是自己的钟）。
  return new Date(n * 1000).toLocaleTimeString('zh-CN', { hour12: false })
}

// #httpError
// 把一次失败的 HTTP 响应变成可读原因（限流/私有/不存在/网络各不相同）。
//
// @param {object} r - { status, headers, data, error }
// @param {string} what - 请求目标的描述（如 `仓库 owner/repo`）
// @returns {string} 错误文本
export function httpError(r, what) {
  // 网络层失败。
  if (r.error) return `${what}请求失败：${r.error}`
  // 限流（403/429 且剩余为 0）。
  const remaining = r.headers?.get?.('x-ratelimit-remaining')
  // 403/429。
  if ((r.status === 403 || r.status === 429) && remaining === '0') {
    // 重置时间。
    const at = rateLimitResetText(r.headers?.get?.('x-ratelimit-reset'))
    // 文本（讲清是什么配额）。
    return `GitHub API 匿名限流已用尽（60 次/小时/IP）${at ? `，约 ${at} 后恢复` : ''}。一个 Mod 约用 ${API_CALLS_PER_INSTALL} 次，稍后再试或换个网络`
  }
  // 403 但不是限流。
  if (r.status === 403) return `${what}被 GitHub 拒绝（HTTP 403；可能是限流或访问受限）`
  // 401/404。
  if (r.status === 404) return `${what}不存在（HTTP 404；私有仓库也不支持 —— 本功能只拉公开仓库，不引入 token 鉴权）`
  // 其它。
  return `${what}请求失败（HTTP ${r.status}${r.statusText ? ` ${r.statusText}` : ''}）`
}

// #getJson
// 发一次 GitHub API 请求并解析 JSON（错误一律转成可读文本，不抛）。
//
// @param {Function} fetchImpl - fetch 实现
// @param {string} url - 地址
// @param {object} [params]
// @param {AbortSignal} [params.signal] - 取消信号
// @param {object} [params.log] - 日志器
// @param {number} [params.apiCalls] - 计数器（对象，形如 { n: 0 }）
// @returns {Promise<object>} { ok, status, statusText, headers, data, error }
async function getJson(fetchImpl, url, { signal, log, counter } = {}) {
  // 计数（配额可观测）。
  if (counter) counter.n = (counter.n || 0) + 1
  // 日志。
  log?.debug?.(`github: GET ${url}`)
  // 请求。
  try {
    // 发请求（Accept 指定 API 版本，行为稳定）。
    const res = await fetchImpl(url, {
      // 只读。
      method: 'GET',
      // 取消。
      signal,
      // 头。
      headers: { Accept: 'application/vnd.github+json' },
    })
    // 状态。
    if (!res.ok) {
      // 返回失败（带 headers 以便识别限流）。
      return { ok: false, status: res.status, statusText: res.statusText, headers: res.headers, data: null }
    }
    // 解析。
    return { ok: true, status: res.status, headers: res.headers, data: await res.json() }
  } catch (e) {
    // 取消。
    if (e?.name === 'AbortError') return { ok: false, aborted: true, error: '已取消' }
    // 网络错误。
    return { ok: false, error: e?.message || String(e) }
  }
}

// #attemptsFor
// 算出"分支/路径"的尝试序列。
//
// 为什么需要它：`/tree/feature/foo/mods/x` 里 GitHub 自己也分不清 `feature` 是分支、
// 还是 `feature/foo` 是分支 —— URL 语法上就是有歧义。策略：先按"第一段是分支"试，
// 404 就再把下一段并进分支名（最多 MAX_REF_ATTEMPTS 次）。只有 404 才回退，
// 所以正常情况**不会**多花 API 调用。
//
// @param {object} p - parseGitHubUrl 的结果
// @param {string} defaultBranch - 默认分支（链接没带分支时用）
// @returns {Array<{ref: string, path: string}>} 尝试序列
export function attemptsFor(p, defaultBranch) {
  // 显式分支（?ref= 或 repo 链接的默认分支）：没有歧义。
  if (p.refFromQuery || !p.segments || p.segments.length === 0) {
    // 单次尝试。
    return [{ ref: p.ref || defaultBranch, path: p.path }]
  }
  // 段。
  const segs = p.segments
  // 结果。
  const out = []
  // 第一段当分支（最常见）。
  out.push({ ref: segs[0], path: segs.slice(1).join('/') })
  // 回退：多并一段进分支名。
  for (let k = 2; k <= Math.min(MAX_REF_ATTEMPTS, segs.length - 1); k++) {
    // 追加。
    out.push({ ref: segs.slice(0, k).join('/'), path: segs.slice(k).join('/') })
  }
  // 去重（段数不足时可能重复）。
  return out.filter((a, i) => out.findIndex((b) => b.ref === a.ref && b.path === a.path) === i)
}

// #resolveTree
// 把"分支 + 目录"变成"确切的 commit + 整棵树"（这是唯一会花 API 配额的地方）。
//
// @param {object} params
// @param {Function} params.fetchImpl - fetch 实现
// @param {string} params.owner - 所有者
// @param {string} params.repo - 仓库
// @param {Array<{ref: string, path: string}>} params.attempts - 尝试序列
// @param {AbortSignal} [params.signal] - 取消信号
// @param {object} [params.log] - 日志器
// @param {object} [params.counter] - API 调用计数
// @returns {Promise<object>} { ok, commit, treeSha, ref, path, tree, truncated, apiCalls, errors, aborted }
async function resolveTree({ fetchImpl, owner, repo, attempts, signal, log, counter }) {
  // 最后一次失败原因（用于报错）。
  let last = ''
  // 逐个尝试。
  for (const a of attempts) {
    // 1) 分支/标签/commit → commit sha + 它的 tree sha。
    const c = await getJson(fetchImpl, `${GITHUB_API}/repos/${owner}/${repo}/commits/${encodeURIComponent(a.ref)}`, { signal, log, counter })
    // 取消：直接结束。
    if (c.aborted) return { ok: false, aborted: true, errors: ['已取消'], apiCalls: counter.n }
    // 失败：记住原因，试下一个尝试。
    if (!c.ok) {
      // 记录。
      last = httpError(c, `${owner}/${repo}@${a.ref}`)
      // 下一个。
      continue
    }
    // commit sha 与 tree sha（commit 响应里就带着 tree）。
    const commit = c.data?.sha
    // tree sha（取不到就没法继续）。
    const treeSha = c.data?.commit?.tree?.sha
    // 异常响应。
    if (!commit || !treeSha) {
      // 记录。
      last = `${owner}/${repo}@${a.ref} 的 commit 响应缺少 sha/tree`
      // 下一个。
      continue
    }
    // 2) 递归树（一次拿全仓库路径 + 每个文件大小）。
    const t = await getJson(fetchImpl, `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, { signal, log, counter })
    // 取消。
    if (t.aborted) return { ok: false, aborted: true, errors: ['已取消'], apiCalls: counter.n }
    // 失败。
    if (!t.ok) {
      // 记录。
      last = httpError(t, `${owner}/${repo} 的文件树`)
      // 下一个。
      continue
    }
    // 成功。
    return {
      // 成功。
      ok: true,
      // 确切 commit（整包钉在它上面）。
      commit,
      // 树 sha。
      treeSha,
      // 实际用的分支。
      ref: a.ref,
      // 实际用的目录。
      path: String(a.path || '').replace(/^\/+|\/+$/g, ''),
      // 树条目。
      tree: Array.isArray(t.data?.tree) ? t.data.tree : [],
      // 树是否被截断（超大仓库；截断意味着列表不完整，必须提示）。
      truncated: !!t.data?.truncated,
      // 配额消耗。
      apiCalls: counter.n,
    }
  }
  // 全部尝试都失败。
  return { ok: false, errors: [last || `${owner}/${repo} 的 commit/树拉取失败`], apiCalls: counter.n }
}

// #candidateDirs
// 从树里算出"候选 Mod 目录"（含 manifest.json 的目录）—— 仓库里有多个 Mod 时必须让用户选。
//
// @param {object[]} blobs - 树里的 blob 条目（{ path, size }）
// @param {string} [within] - 只在某个目录内找（用户已给了目录时）
// @returns {{dirs: string[], truncated: boolean}} 候选目录（仓库根用空串表示）
export function candidateDirs(blobs, within = '') {
  // 前缀。
  const prefix = within ? `${within.replace(/^\/+|\/+$/g, '')}/` : ''
  // 收集。
  const dirs = []
  // 是否因为深度/数量被截掉。
  let truncated = false
  // 逐个。
  for (const b of blobs) {
    // 只要 manifest.json。
    if (b.path !== 'manifest.json' && !b.path.endsWith('/manifest.json')) continue
    // 前缀过滤。
    if (prefix && !b.path.startsWith(prefix)) continue
    // 相对路径。
    const rel = prefix ? b.path.slice(prefix.length) : b.path
    // 目录（仓库根 = 空串）。
    const dir = dirnameOf(rel)
    // 依赖目录里的 manifest 不算（那多半是别人的示例）。
    if (/(^|\/)node_modules(\/|$)/.test(dir)) continue
    // 深度超限：不作为候选，但记下"被截断了"（否则"没找到"会看起来像仓库里真没有）。
    if (depthOf(dir) > MAX_CANDIDATE_DEPTH) {
      // 记录。
      truncated = true
      // 跳过。
      continue
    }
    // 去重。
    if (!dirs.includes(dir)) dirs.push(dir)
  }
  // 排序（浅的在前 = 更像"这个仓库就是个 Mod"）。
  dirs.sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b))
  // 返回。
  return { dirs, truncated }
}

// #pickRoot
// 定下"要装的 Mod 目录"：能定就定，定不了就交回候选让用户选。
//
// @param {object} params
// @param {object[]} params.blobs - 树里的 blob
// @param {string} params.wanted - 用户链接里指定的目录（可空）
// @returns {{root?: string, candidates?: string[], errors: string[], warnings: string[], truncated: boolean}} 结果
export function pickRoot({ blobs, wanted = '' }) {
  // 警告。
  const warnings = []
  // 用户指定的目录。
  const want = String(wanted || '').replace(/^\/+|\/+$/g, '')
  // 全部候选（不限目录）。
  const all = candidateDirs(blobs)
  // 指定了目录：先精确匹配。
  if (want) {
    // 该目录自己有 manifest.json。
    if (all.dirs.includes(want)) return { root: want, errors: [], warnings, truncated: all.truncated }
    // 该目录下面有（用户指了上一层）。
    const inner = candidateDirs(blobs, want)
    // 恰一个 → 自动下钻（提示一句，别静默改用户的意思）。
    if (inner.dirs.length === 1) {
      // 提示。
      warnings.push(`目录 ${want} 下没有 manifest.json，已自动定位到 ${want}/${inner.dirs[0] || ''}`)
      // 返回。
      return { root: `${want}/${inner.dirs[0]}`.replace(/\/+$/, ''), errors: [], warnings, truncated: inner.truncated }
    }
    // 多个 → 让用户选。
    if (inner.dirs.length > 1) {
      // 候选（带前缀）。
      return { candidates: inner.dirs.map((d) => `${want}/${d}`.replace(/\/+$/, '')), errors: [`目录 ${want} 下有 ${inner.dirs.length} 个 Mod，请选一个`], warnings, truncated: inner.truncated }
    }
    // 一个都没有：把全仓库的候选一并给出（用户可能是路径写错了）。
    return {
      // 候选。
      candidates: all.dirs.slice(0, MAX_CANDIDATES),
      // 错误。
      errors: [`目录 ${want} 下没有 manifest.json${all.dirs.length ? '（这个仓库里有下面这些 Mod，或者换个目录链接）' : ''}`],
      // 警告。
      warnings,
      // 截断标记。
      truncated: all.truncated,
    }
  }
  // 没指定目录：仓库根就是 Mod（最常见）。
  if (all.dirs.includes('')) return { root: '', errors: [], warnings, truncated: all.truncated }
  // 只有一个 → 自动用它。
  if (all.dirs.length === 1) {
    // 提示。
    warnings.push(`仓库根没有 manifest.json，已自动定位到 ${all.dirs[0]}`)
    // 返回。
    return { root: all.dirs[0], errors: [], warnings, truncated: all.truncated }
  }
  // 多个 → 让用户选。
  if (all.dirs.length > 1) {
    // 候选。
    return { candidates: all.dirs.slice(0, MAX_CANDIDATES), errors: [`这个仓库里有 ${all.dirs.length} 个 Mod，请选一个（或直接粘 /tree/<分支>/<目录> 链接）`], warnings, truncated: all.truncated }
  }
  // 一个都没有。
  return { candidates: [], errors: ['这个仓库里没找到 manifest.json（Mod 包根目录必须有它）'], warnings, truncated: all.truncated }
}

// #collectFiles
// 圈出要下载的文件，并**在下载之前**用树里的 size 做限额检查。
//
// @param {object} params
// @param {object[]} params.blobs - 树里的 blob
// @param {string} params.root - Mod 目录（空 = 仓库根）
// @returns {{files: Array<{rel: string, size: number}>, binaries: string[], errors: string[], warnings: string[]}} 结果
export function collectFiles({ blobs, root = '' }) {
  // 前缀。
  const prefix = root ? `${root}/` : ''
  // 待下载。
  const files = []
  // 非文本（只记名字提示）。
  const binaries = []
  // 错误/警告。
  const errors = []
  // 警告。
  const warnings = []
  // 累计字节。
  let total = 0
  // 逐个。
  for (const b of blobs) {
    // 只要在该目录下。
    if (prefix && !b.path.startsWith(prefix)) continue
    // 相对路径。
    const rel = prefix ? b.path.slice(prefix.length) : b.path
    // 空的（目录项）。
    if (!rel) continue
    // 依赖目录：Mod 的依赖以自包含单文件放 vendor/（与 zip 安装同一约定）。
    if (/(^|\/)node_modules\//.test(rel)) continue
    // 文本？
    const lower = rel.toLowerCase()
    // 非文本 → 不进包（与 zip 安装一致：只收文本）。
    if (!TEXT_EXT.some((ext) => lower.endsWith(ext))) {
      // 记录（只留前 5 个，别刷屏）。
      if (binaries.length < 5) binaries.push(rel)
      // 跳过。
      continue
    }
    // 单文件上限。
    if (Number(b.size) > MAX_FILE_BYTES) {
      // 明确拒绝（在下载之前，不浪费流量）。
      errors.push(`${rel} 超过单文件上限（${b.size} > ${MAX_FILE_BYTES} 字节）`)
      // 结束。
      return { files: [], binaries, errors, warnings }
    }
    // 累计。
    total += Number(b.size) || 0
    // 累计上限。
    if (total > MAX_TOTAL_BYTES) {
      // 拒绝。
      errors.push(`累计体积超过上限（> ${MAX_TOTAL_BYTES} 字节）—— 这个目录不像是 Mod 包`)
      // 结束。
      return { files: [], binaries, errors, warnings }
    }
    // 条目数上限。
    if (files.length >= MAX_ENTRIES) {
      // 拒绝。
      errors.push(`文件数超过上限（> ${MAX_ENTRIES}）—— 这个目录不像是 Mod 包`)
      // 结束。
      return { files: [], binaries, errors, warnings }
    }
    // 收下（`full` = 仓库内完整路径（raw 请求要用它），`rel` = 包内相对路径（zip 的键），
    // `sha` = blob sha（raw 连不上时走 `git/blobs/{sha}` 兜底要用它））。
    files.push({ rel, full: b.path, sha: b.sha, size: Number(b.size) || 0 })
  }
  // 非文本提示。
  if (binaries.length) warnings.push(`已跳过非文本文件：${binaries.join('、')}${binaries.length >= 5 ? ' 等' : ''}`)
  // 必须有 manifest.json。
  if (!files.some((f) => f.rel === 'manifest.json')) errors.push('目录里没有 manifest.json（Mod 包根目录必须有它）')
  // 返回。
  return { files, binaries, errors, warnings }
}

// #base64ToText
// 把 base64 解成 UTF-8 文本（`git/blobs` 兜底用）。
//
// 为什么要这么绕：`atob` 给的是"每字符一字节"的二进制字符串，直接当文本用会把
// UTF-8 多字节字符（中文）解坏 —— 必须还原成字节再按 UTF-8 解码。
//
// @param {string} b64 - base64（可含换行）
// @returns {string} 文本
export function base64ToText(b64) {
  // 空。
  if (!b64) return ''
  // 解 base64（去掉 GitHub 可能插入的换行）。
  const bin = atob(String(b64).replace(/\s+/g, ''))
  // 字节。
  const bytes = new Uint8Array(bin.length)
  // 逐字符取字节。
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  // 按 UTF-8 解码。
  return new TextDecoder().decode(bytes)
}

// #mapLimit
// 限定并发的映射（raw 下载用）。
//
// @param {Array} items - 输入
// @param {number} limit - 并发上限
// @param {Function} worker - 处理函数
// @returns {Promise<Array>} 结果（顺序与输入一致）
async function mapLimit(items, limit, worker) {
  // 结果。
  const out = new Array(items.length)
  // 游标。
  let next = 0
  // 工人。
  const runners = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    // 循环取任务。
    while (true) {
      // 取一个。
      const i = next++
      // 没了。
      if (i >= items.length) return
      // 处理。
      out[i] = await worker(items[i], i)
    }
  })
  // 等全部。
  await Promise.all(runners)
  // 返回。
  return out
}

// #fetchGitHubMod
// 拉取一个 GitHub 目录的全部文本文件（**不发安装**，便于单测与预览）。
//
// @param {object} params
// @param {string} [params.input] - 用户输入的链接（与 parsed 二选一）
// @param {object} [params.parsed] - parseGitHubUrl 的结果
// @param {Function} [params.fetchImpl] - fetch 实现（测试注入）
// @param {AbortSignal} [params.signal] - 取消信号
// @param {object} [params.log] - 日志器
// @param {Function} [params.onProgress] - 进度回调（{ done, total }）
// @returns {Promise<object>} { ok, files?, meta?, candidates?, needsChoice?, errors, warnings, aborted }
export async function fetchGitHubMod({ input, parsed, fetchImpl = globalThis.fetch, signal, log, onProgress } = {}) {
  // 解析。
  const p = parsed || parseGitHubUrl(input)
  // 链接不合法。
  if (!p.ok) return { ok: false, errors: p.errors, warnings: [] }
  // 配额计数。
  const counter = { n: 0 }
  // 警告。
  const warnings = []
  // 分支：链接没带就用仓库默认分支（多一次 API 调用）。
  let ref = p.ref
  // 仓库元数据。
  if (!ref) {
    // 取仓库信息。
    const repoRes = await getJson(fetchImpl, `${GITHUB_API}/repos/${p.owner}/${p.repo}`, { signal, log, counter })
    // 取消。
    if (repoRes.aborted) return { ok: false, aborted: true, errors: ['已取消'], warnings }
    // 失败。
    if (!repoRes.ok) return { ok: false, errors: [httpError(repoRes, `仓库 ${p.owner}/${p.repo}`)], warnings }
    // 私有仓库：不支持（不引入 token 鉴权，见 `_准则_Mod设计.md` B3 不做访问控制）。
    if (repoRes.data?.private) {
      // 拒绝。
      return { ok: false, errors: [`${p.owner}/${p.repo} 是私有仓库。本功能只拉公开仓库（不引入 token/鉴权，见准则 B3）`], warnings }
    }
    // 默认分支。
    ref = repoRes.data?.default_branch || 'main'
    // 记一句（用户可能不知道"没写分支"用的是哪个）。
    warnings.push(`链接没带分支，按默认分支 ${ref} 拉取`)
  }
  // 尝试序列（分支名含斜杠时的回退）。
  const attempts = attemptsFor({ ...p, ref }, ref)
  // 取 commit + 树。
  const resolved = await resolveTree({ fetchImpl, owner: p.owner, repo: p.repo, attempts, signal, log, counter })
  // 取消/失败。
  if (!resolved.ok) return { ok: false, errors: resolved.errors, aborted: !!resolved.aborted, warnings, apiCalls: counter.n }
  // 树被截断：列表不完整，必须说出来（否则"没找到 manifest"会误导）。
  if (resolved.truncated) warnings.push('仓库太大，GitHub 只返回了部分文件树：若找不到 manifest.json，请改用直接指向目录的链接')
  // blobs。
  const blobs = resolved.tree.filter((e) => e.type === 'blob')
  // 定根目录。
  const picked = pickRoot({ blobs, wanted: resolved.path || p.path })
  // 警告。
  warnings.push(...(picked.warnings || []))
  // 需要用户选（候选非空才算"需要选"：空候选 = 真的没找到，不该弹一个空的选择框）。
  if (picked.candidates && picked.candidates.length) {
    // 候选（带上"钉在 commit 上的链接"，用户点选后重跑同一个 commit，结果确定）。
    const candidates = picked.candidates.map((dir) => ({
      // 目录。
      path: dir,
      // 直达链接（用 commit 而不是分支：不受后续推送影响）。
      url: `https://github.com/${p.owner}/${p.repo}/tree/${resolved.commit}/${dir}`,
    }))
    // 候选太多时提示用户直接粘链接。
    if (picked.truncated) warnings.push(`候选目录只列了前 ${MAX_CANDIDATES} 个（或深度超过 ${MAX_CANDIDATE_DEPTH} 层）`)
    // 返回。
    return {
      // 没装成（但要用户在候选里选）。
      ok: false,
      // 标记。
      needsChoice: true,
      // 候选。
      candidates,
      // 原因。
      errors: picked.errors,
      // 警告。
      warnings,
      // 元数据（界面展示"这是哪个 commit"）。
      meta: { owner: p.owner, repo: p.repo, ref: resolved.ref, commit: resolved.commit, apiCalls: counter.n },
    }
  }
  // 根目录。
  const root = picked.root
  // 既没候选也没定下目录 → 直接报错（把 pickRoot 更具体的原因带出去）。
  if (root === undefined) {
    // 返回。
    return { ok: false, errors: picked.errors, warnings, meta: { owner: p.owner, repo: p.repo, ref: resolved.ref, commit: resolved.commit, apiCalls: counter.n } }
  }
  // 圈文件 + 限额。
  const collected = collectFiles({ blobs, root })
  // 警告。
  warnings.push(...collected.warnings)
  // 超限/缺 manifest。
  if (collected.errors.length) {
    // 返回。
    return { ok: false, errors: collected.errors, warnings, meta: { owner: p.owner, repo: p.repo, ref: resolved.ref, commit: resolved.commit, path: root, apiCalls: counter.n } }
  }
  // 下载（并发，钉在 commit 上）。
  let done = 0
  // 走 API 兜底的文件（raw 连不上时）。
  let viaApi = 0
  // 逐个取。
  const results = await mapLimit(collected.files, DOWNLOAD_CONCURRENCY, async (f) => {
    // 取消。
    if (signal?.aborted) return { rel: f.rel, aborted: true }
    // 一级：raw（不占配额）。用 commit 而不是分支（整包同一个快照）；
    // 路径用**仓库内完整路径**（子目录 Mod 用相对路径会 404）。
    const rawUrl = `${GITHUB_RAW}/${p.owner}/${p.repo}/${resolved.commit}/${f.full}`
    // 文本（null = 一级没拿到）。
    let text = null
    // 一级失败原因（两级都失败时给用户看的是这个 + 二级的）。
    let rawError = ''
    // 请求。
    try {
      // 发请求。
      const res = await fetchImpl(rawUrl, { signal })
      // 成功。
      if (res.ok) text = await res.text()
      // 404 是确定性的（文件在这个 commit 里真没有），不必兜底。
      else if (res.status === 404) return { rel: f.rel, error: 'HTTP 404（这个 commit 里没有该文件）' }
      // 其它 HTTP 错误：留给兜底。
      else rawError = `HTTP ${res.status}`
    } catch (e) {
      // 取消。
      if (e?.name === 'AbortError') return { rel: f.rel, aborted: true }
      // 网络错误（国内访问 raw 常见 UND_ERR_CONNECT_TIMEOUT，单次约 10 秒）。
      rawError = e?.cause?.code || e?.message || String(e)
    }
    // 二级：`git/blobs/{sha}`（base64；可靠但每个文件 1 次 API 调用，吃匿名配额）。
    if (text === null && f.sha) {
      // 请求。
      const b = await getJson(fetchImpl, `${GITHUB_API}/repos/${p.owner}/${p.repo}/git/blobs/${f.sha}`, { signal, log, counter })
      // 取消。
      if (b.aborted) return { rel: f.rel, aborted: true }
      // 兜底也失败 → 报两级原因。
      if (!b.ok) return { rel: f.rel, error: `raw 失败（${rawError}），API 兜底也失败（${httpError(b, f.rel)}）` }
      // 解码（blobs 端点缺省 base64；显式要 media type 时才可能是 utf-8）。
      text = b.data?.encoding === 'utf-8' ? String(b.data?.content ?? '') : base64ToText(b.data?.content)
      // 记一次兜底。
      viaApi++
    }
    // 两级都没拿到。
    if (text === null) return { rel: f.rel, error: `下载失败（${rawError || 'raw 与 API 兜底都不可用'}）` }
    // 进度。
    done++
    // 回调。
    onProgress?.({ done, total: collected.files.length, rel: f.rel })
    // 大小对不上（树里的 size 与实际字节不一致 → 记警告，不静默）。
    // 注意必须按**字节**比：`text.length` 是 UTF-16 码元数，含中文的 JSON 会永远"对不上"。
    const bytes = TEXT_ENCODER.encode(text).length
    // 比对。
    if (f.size && bytes !== f.size) warnings.push(`${f.rel} 实际大小与文件树不一致（${bytes} ≠ ${f.size}）`)
    // 成功。
    return { rel: f.rel, text }
  })
  // 取消。
  if (results.some((r) => r.aborted)) return { ok: false, aborted: true, errors: ['已取消拉取'], warnings, apiCalls: counter.n }
  // 失败汇总。
  const failed = results.filter((r) => r.error)
  // 有失败：整个包不完整，宁可拒绝（半包 Mod 比装不上更难查）。
  if (failed.length) {
    // 返回。
    return {
      // 失败。
      ok: false,
      // 原因。
      errors: [`${failed.length} 个文件下载失败：${failed.slice(0, 3).map((f) => `${f.rel}（${f.error}）`).join('、')}`],
      // 警告。
      warnings,
      // 元数据。
      meta: { owner: p.owner, repo: p.repo, ref: resolved.ref, commit: resolved.commit, path: root, apiCalls: counter.n },
    }
  }
  // 文件表。
  const files = {}
  // 逐个。
  for (const r of results) files[r.rel] = r.text
  // 有文件走了 API 兜底：说出来（配额消耗与预期不同，用户有权知道）。
  if (viaApi) warnings.push(`${viaApi} 个文件的 raw 拉取失败（网络到 raw 不稳），已用 GitHub API 兜底 —— 每个文件多花 1 次配额`)
  // 日志（可观测：装了什么、从哪一版）。
  log?.debug?.(`github: ${p.owner}/${p.repo}@${resolved.commit.slice(0, 7)} → ${Object.keys(files).length} 个文本文件（API ${counter.n} 次）`)
  // 返回。
  return {
    // 成功。
    ok: true,
    // 文件表（路径 → 文本）。
    files,
    // 元数据。
    meta: {
      // 所有者。
      owner: p.owner,
      // 仓库。
      repo: p.repo,
      // 分支（用户给的或默认的）。
      ref: resolved.ref,
      // 确切 commit。
      commit: resolved.commit,
      // 目录（空 = 仓库根）。
      path: root,
      // 文件数。
      count: Object.keys(files).length,
      // 总字节（按树里的 size）。
      bytes: collected.files.reduce((s, f) => s + f.size, 0),
      // API 配额消耗（含走兜底的那些）。
      apiCalls: counter.n,
      // 其中走 API 兜底的（raw 连不上）。
      viaApi,
    },
    // 错误（非致命）。
    errors: [],
    // 警告。
    warnings,
  }
}

// #installModFromGitHub
// 从 GitHub 链接安装 Mod（**页面用的入口**）。
//
// 返回值与 `installModFromZip` 同形（多了 `source`/`prefetched`），所以界面里
// "系统 Mod 名二次确认"那套逻辑可以原样复用：
//   const r = await installModFromGitHub({ input, store })
//   if (!r.ok && r.system) { …确认… ; await installModFromGitHub({ prefetched: r.prefetched, store, allowSystem: true }) }
// 关键点：**确认后重试不会再拉一次**（`prefetched` 带着已下载的文件表）——否则用户的
// 一次"确定"要再花掉 2~3 次 API 配额。
//
// @param {object} params
// @param {string} [params.input] - GitHub 链接
// @param {object} [params.prefetched] - 已拉好的结果（fetchGitHubMod 的返回；用于免二次拉取）
// @param {object} params.store - mod-store 实例
// @param {object} [params.log] - 日志器
// @param {boolean} [params.allowSystem] - 是否允许覆盖系统 Mod 名
// @param {AbortSignal} [params.signal] - 取消信号
// @param {Function} [params.onProgress] - 进度回调
// @param {Function} [params.fetchImpl] - fetch 实现（测试注入）
// @returns {Promise<object>} 安装结果
export async function installModFromGitHub({ input, prefetched, store, log, allowSystem = false, signal, onProgress, fetchImpl } = {}) {
  // 拉取（除非调用方已经把包拉好了 —— 系统 Mod 二次确认走的就是这条路）。
  const fetched = prefetched || (await fetchGitHubMod({ input, fetchImpl, signal, log, onProgress }))
  // 拉取失败（含"需要选目录"）：原样带出（`needsChoice`/`candidates` 由界面消费）。
  if (!fetched.ok) return { ...fetched }
  // 打包成 zip（level 0 = 不压缩：这只是"过一手"给安装核心，没必要真压）。
  const bytes = createModZip({ files: fetched.files, level: 0 })
  // 走 zip 安装（校验/限额/系统名保护/落库都在那一条链路上）。
  const r = await installModFromZip({ bytes, store, log, allowSystem })
  // 返回（把来源信息与已拉好的包一起带出去）。
  return {
    // 安装结果。
    ...r,
    // 来源（来源可追溯：owner/repo@commit）。
    source: fetched.meta,
    // 已拉好的包（系统 Mod 二次确认时直接复用，不再拉一次）。
    prefetched: fetched,
    // 附带的警告（含 zip 路径安全/尺寸警告）。
    errors: [...(r.errors || []), ...fetched.warnings],
  }
}
