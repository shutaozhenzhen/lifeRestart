/**
 * mod-github 单测 —— 从 GitHub 链接拉源码当 Mod
 *
 * 覆盖（**全部注入 fetch 替身，不碰真实网络** —— 真实网络只用于人工验证：
 * `raw.githubusercontent.com` 在国内会间歇性连接超时，测试依赖它必然是脆的）：
 *   1. parseGitHubUrl：六种链接形态、`?ref=`、省 scheme、SSH、简写、`.git`/`#`/尾部斜杠，
 *      以及必须拒绝的（非 github 站点、zipball/archive、Release 资产、issues 等动词）
 *   2. attemptsFor：分支名含斜杠时的回退序列（只在 404 后才多花调用）
 *   3. candidateDirs / pickRoot：候选目录计算、单候选自动定位、多候选交回用户、深度与 node_modules 过滤
 *   4. collectFiles：只收文本、**下载前**就用树里的 size 拦下超限
 *   5. fetchGitHubMod：调用顺序与数量（即配额消耗）、钉 commit、私有仓库/404/限流错误、
 *      树被截断、大小不符、取消、**raw 失败时走 git/blobs 兜底**
 *   6. installModFromGitHub：落到本地存储、系统 Mod 名二次确认（**重试不再拉一次**）
 *   7. base64ToText：含中文的 UTF-8 内容解码不能坏
 */
import { describe, test, expect, vi } from 'vitest'
import {
  parseGitHubUrl,
  attemptsFor,
  candidateDirs,
  pickRoot,
  collectFiles,
  fetchGitHubMod,
  installModFromGitHub,
  base64ToText,
  httpError,
  GITHUB_API,
  GITHUB_RAW,
  MAX_CANDIDATES,
  MAX_CANDIDATE_DEPTH,
} from './mod-github.js'
import { createMemoryModStore } from './mod-store.js'
import { MAX_ENTRIES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from 'game-engine/src/mod/zip.js'

// 固定的 commit / tree sha（40 位十六进制）。
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
// tree sha。
const TREE_SHA = '99887766554433221100ffeeddccbbaa99887766'

// #makeGitHub
// 造一个 GitHub 替身（按 URL 路由），并记录每一次请求（用于断言配额消耗）。
//
// @param {object} [opts]
// @param {string} [opts.owner] - 所有者
// @param {string} [opts.repo] - 仓库
// @param {string} [opts.defaultBranch] - 默认分支
// @param {object[]} [opts.tree] - 树条目（{ path, type, size, sha }）
// @param {object} [opts.blobs] - 路径 → 文本
// @param {object} [opts.shaOf] - blob sha → 路径（API 兜底用）
// @param {boolean} [opts.truncated] - 树是否被截断
// @param {boolean} [opts.privateRepo] - 私有仓库
// @param {number} [opts.repoStatus] - 仓库元数据状态码
// @param {number} [opts.commitStatus] - commit 状态码
// @param {number} [opts.treeStatus] - 树状态码
// @param {boolean} [opts.rateLimited] - 是否模拟限流（403 + 剩余 0）
// @param {string} [opts.rawMode] - raw 行为：ok / throw（连接超时）/ 404
// @returns {{fetchImpl: Function, calls: object[]}} 替身
function makeGitHub({
  owner = 'o',
  repo = 'r',
  defaultBranch = 'main',
  tree = [],
  blobs = {},
  shaOf = {},
  truncated = false,
  privateRepo = false,
  repoStatus = 200,
  commitStatus = 200,
  treeStatus = 200,
  rateLimited = false,
  rawMode = 'ok',
} = {}) {
  // 请求记录。
  const calls = []
  // 构造响应。
  const res = (body, { status = 200, json = true, headers = {} } = {}) => ({
    // 成功与否。
    ok: status >= 200 && status < 300,
    // 状态码。
    status,
    // 状态文本。
    statusText: '',
    // 头（只实现 get）。
    headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
    // JSON 体。
    json: async () => body,
    // 文本体。
    text: async () => (json ? JSON.stringify(body) : String(body)),
  })
  // 替身。
  const fetchImpl = async (url, init) => {
    // 记录。
    calls.push({ url: String(url), init })
    // 当前地址。
    const u = String(url)
    // 限流：所有 API 请求都 403。
    if (rateLimited && u.startsWith(GITHUB_API)) {
      return res({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } })
    }
    // 仓库元数据。
    if (u === `${GITHUB_API}/repos/${owner}/${repo}`) {
      // 指定状态。
      if (repoStatus !== 200) return res({ message: 'Not Found' }, { status: repoStatus })
      // 正常。
      return res({ default_branch: defaultBranch, private: privateRepo, full_name: `${owner}/${repo}` })
    }
    // commit。
    if (u.includes(`/repos/${owner}/${repo}/commits/`)) {
      // 指定状态。
      if (commitStatus !== 200) return res({ message: 'Not Found' }, { status: commitStatus })
      // 正常（带 tree sha）。
      return res({ sha: COMMIT, commit: { tree: { sha: TREE_SHA } } })
    }
    // 递归树。
    if (u.includes(`/repos/${owner}/${repo}/git/trees/`)) {
      // 指定状态。
      if (treeStatus !== 200) return res({ message: 'Not Found' }, { status: treeStatus })
      // 正常。
      return res({ tree, truncated })
    }
    // blob（raw 失败时的 API 兜底）。
    if (u.includes(`/repos/${owner}/${repo}/git/blobs/`)) {
      // blob sha。
      const sha = u.split('/').pop()
      // 不存在。
      if (!(sha in shaOf)) return res({ message: 'Not Found' }, { status: 404 })
      // base64 内容。
      return res({ content: Buffer.from(blobs[shaOf[sha]] ?? '', 'utf8').toString('base64'), encoding: 'base64' })
    }
    // raw。
    if (u.startsWith(GITHUB_RAW)) {
      // 连接层失败（国内访问 raw 的典型形态）。
      if (rawMode === 'throw') throw Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
      // HTTP 404。
      if (rawMode === '404') return res({ message: 'Not Found' }, { status: 404 })
      // 路径（commit 之后的部分）。
      const rel = u.split(`/${COMMIT}/`)[1]
      // 没有该文件。
      if (!(rel in blobs)) return res({ message: 'Not Found' }, { status: 404 })
      // 文本。
      return res(blobs[rel], { json: false })
    }
    // 未覆盖的地址：直接报错（替身漏了路由会立刻暴露，而不是静默成功）。
    throw new Error(`stub 未覆盖的 URL: ${u}`)
  }
  // 返回。
  return { fetchImpl, calls }
}

// #makeRepo
// 由"路径 → 文本"直接造出树 + sha 映射（多数用例只关心文件内容）。
//
// @param {object} files - 路径 → 文本
// @param {object} [opts] - 透传给 makeGitHub 的其它项（extraTree 可追加树条目）
// @returns {object} 替身（额外带 tree）
function makeRepo(files = {}, { extraTree = [], ...opts } = {}) {
  // 树。
  const tree = []
  // sha → 路径。
  const shaOf = {}
  // 逐个。
  for (const [path, text] of Object.entries(files)) {
    // 稳定的假 sha。
    const sha = `sha_${path.replace(/[^a-zA-Z0-9]/g, '_')}`
    // 记录。
    shaOf[sha] = path
    // 树条目。
    tree.push({ path, type: 'blob', size: Buffer.byteLength(text, 'utf8'), sha })
  }
  // 追加额外条目。
  tree.push(...extraTree)
  // 组装。
  return { ...makeGitHub({ tree, blobs: files, shaOf, ...opts }), tree }
}

// 一个合法的 Mod 包（manifest + 行为文件）。
const MOD_FILES = {
  'manifest.json': JSON.stringify({ name: 'gh-mod', version: '1.0.0', author: 'tester', permissions: ['hooks'] }),
  'code.js': 'export default () => {}',
}

describe('parseGitHubUrl', () => {
  test('仓库链接：owner/repo，分支与目录都为空', () => {
    expect(parseGitHubUrl('https://github.com/o/r')).toMatchObject({ ok: true, owner: 'o', repo: 'r', ref: '', path: '', kind: 'repo' })
  })

  test('/tree/ 链接：第一段当分支，其余当目录，并留下歧义回退段', () => {
    expect(parseGitHubUrl('https://github.com/o/r/tree/main/mods/fun-mod')).toMatchObject({
      ok: true,
      ref: 'main',
      path: 'mods/fun-mod',
      kind: 'tree',
      segments: ['main', 'mods', 'fun-mod'],
      refFromQuery: false,
    })
  })

  test('/tree/ + ?ref=：分支显式给出，路径不再有歧义', () => {
    const p = parseGitHubUrl('https://github.com/o/r/tree/feature/x/mods/a?ref=release/1.0')
    expect(p).toMatchObject({ ok: true, ref: 'release/1.0', path: 'feature/x/mods/a', refFromQuery: true, segments: [] })
  })

  test('/blob/ 链接：取文件所在目录（最后一段是文件名）', () => {
    expect(parseGitHubUrl('https://github.com/o/r/blob/main/mods/a/manifest.json')).toMatchObject({
      ok: true,
      ref: 'main',
      path: 'mods/a',
      kind: 'blob',
      segments: ['main', 'mods', 'a'],
    })
  })

  test('raw 链接：取所在目录；refs/heads/x 形态也认', () => {
    expect(parseGitHubUrl('https://raw.githubusercontent.com/o/r/main/mods/a/code.js')).toMatchObject({ ok: true, ref: 'main', path: 'mods/a', kind: 'raw' })
    expect(parseGitHubUrl('https://raw.githubusercontent.com/o/r/refs/heads/main/mods/a/code.js')).toMatchObject({ ok: true, ref: 'refs/heads/main', path: 'mods/a', segments: [] })
  })

  test('api contents 链接：路径取自 contents 之后，分支取自 ?ref=', () => {
    expect(parseGitHubUrl('https://api.github.com/repos/o/r/contents/mods/a?ref=main')).toMatchObject({ ok: true, ref: 'main', path: 'mods/a', kind: 'contents' })
    // 不是 contents 形态的 api 链接要拒绝（别猜）。
    expect(parseGitHubUrl('https://api.github.com/repos/o/r/pulls').ok).toBe(false)
  })

  test('省 scheme / SSH / owner-repo 简写 / .git 后缀 / #片段 / 尾部斜杠', () => {
    expect(parseGitHubUrl('github.com/o/r')).toMatchObject({ ok: true, owner: 'o', repo: 'r' })
    expect(parseGitHubUrl('git@github.com:o/r.git')).toMatchObject({ ok: true, owner: 'o', repo: 'r' })
    expect(parseGitHubUrl('o/r')).toMatchObject({ ok: true, owner: 'o', repo: 'r' })
    expect(parseGitHubUrl('https://github.com/o/r.git/')).toMatchObject({ ok: true, repo: 'r' })
    expect(parseGitHubUrl('https://github.com/o/r#readme')).toMatchObject({ ok: true, repo: 'r' })
    expect(parseGitHubUrl('  <https://github.com/o/r>  ')).toMatchObject({ ok: true, owner: 'o' })
  })

  test('拒绝：非 github 站点、空输入、看不懂的字符串', () => {
    expect(parseGitHubUrl('https://gitlab.com/o/r').errors[0]).toContain('只支持 github.com')
    expect(parseGitHubUrl('').errors[0]).toContain('请输入')
    expect(parseGitHubUrl('随便写点什么').ok).toBe(false)
  })

  test('拒绝 zipball / archive / Release 资产，并讲清为什么（CORS）', () => {
    // 这条错误信息是用户唯一能看到的解释：必须指出是跨域做不到，而不是"链接不合法"。
    const zip = parseGitHubUrl('https://github.com/o/r/archive/refs/heads/main.zip')
    expect(zip.ok).toBe(false)
    expect(zip.errors[0]).toContain('codeload.github.com')
    expect(zip.errors[0]).toContain('跨域')
    // 其它 zip 形态同样拒绝。
    expect(parseGitHubUrl('https://github.com/o/r/zipball/main').ok).toBe(false)
    expect(parseGitHubUrl('https://github.com/o/r/tarball/main').ok).toBe(false)
    // Release 资产。
    expect(parseGitHubUrl('https://github.com/o/r/releases/download/v1/mod.zip').errors[0]).toContain('Release')
  })

  test('拒绝 issues/pulls 这类动词（不猜用户想装哪个目录）', () => {
    const r = parseGitHubUrl('https://github.com/o/r/issues/3')
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('/issues/')
  })

  test('webUrl：人能直接打开的地址', () => {
    expect(parseGitHubUrl('https://github.com/o/r/tree/main/mods/a').webUrl).toBe('https://github.com/o/r/tree/main/mods/a')
    expect(parseGitHubUrl('o/r').webUrl).toBe('https://github.com/o/r')
  })
})

describe('attemptsFor', () => {
  test('分支名可能含斜杠：依次把下一段并进分支名（第一猜测优先）', () => {
    const p = parseGitHubUrl('https://github.com/o/r/tree/feature/foo/mods/a/manifest.json')
    // tree 形态：段 = ['feature','foo','mods','a','manifest.json']。
    const a = attemptsFor(p, 'main')
    expect(a[0]).toEqual({ ref: 'feature', path: 'foo/mods/a/manifest.json' })
    expect(a[1]).toEqual({ ref: 'feature/foo', path: 'mods/a/manifest.json' })
    // 最多 3 次尝试。
    expect(a.length).toBeLessThanOrEqual(3)
  })

  test('?ref= 或仓库链接：只有一次尝试（不浪费配额）', () => {
    const p = parseGitHubUrl('https://github.com/o/r/tree/x/y?ref=main')
    expect(attemptsFor(p, 'main')).toEqual([{ ref: 'main', path: 'x/y' }])
    const repo = parseGitHubUrl('https://github.com/o/r')
    expect(attemptsFor(repo, 'dev')).toEqual([{ ref: 'dev', path: '' }])
  })
})

describe('candidateDirs / pickRoot', () => {
  // 一个多 Mod 仓库的树。
  const multiTree = [
    { path: 'README.md', type: 'blob', size: 10, sha: 's1' },
    { path: 'mods/a/manifest.json', type: 'blob', size: 10, sha: 's2' },
    { path: 'mods/b/manifest.json', type: 'blob', size: 10, sha: 's3' },
    { path: 'node_modules/dep/manifest.json', type: 'blob', size: 10, sha: 's4' },
    { path: 'a/b/c/d/e/f/manifest.json', type: 'blob', size: 10, sha: 's5' },
  ]

  test('候选 = 含 manifest.json 的目录；过滤 node_modules 与过深的目录', () => {
    const { dirs, truncated } = candidateDirs(multiTree)
    expect(dirs).toEqual(['mods/a', 'mods/b'])
    // 过深的那个被截掉，并**如实标记**（否则"找不到"会看起来像仓库里真没有）。
    expect(truncated).toBe(true)
    expect(MAX_CANDIDATE_DEPTH).toBe(5)
  })

  test('仓库根就是 Mod → 直接用根，不需要用户选', () => {
    const r = pickRoot({ blobs: [{ path: 'manifest.json' }, { path: 'code.js' }] })
    expect(r.root).toBe('')
    expect(r.candidates).toBeUndefined()
  })

  test('只有一个 Mod 目录 → 自动定位并给一句提示（不静默改用户的意思）', () => {
    const r = pickRoot({ blobs: [{ path: 'mods/a/manifest.json' }] })
    expect(r.root).toBe('mods/a')
    expect(r.warnings[0]).toContain('已自动定位到 mods/a')
  })

  test('多个 Mod → 交回候选（不替用户猜）', () => {
    const r = pickRoot({ blobs: multiTree })
    expect(r.root).toBeUndefined()
    expect(r.candidates).toEqual(['mods/a', 'mods/b'])
    expect(r.errors[0]).toContain('2 个 Mod')
  })

  test('用户指定目录：精确命中直接用', () => {
    expect(pickRoot({ blobs: multiTree, wanted: 'mods/b' }).root).toBe('mods/b')
  })

  test('用户指定的目录里没有 manifest，但下一层恰好一个 → 自动下钻并提示', () => {
    // 单独造一份树：`mods` 下只有 a 一个 Mod（multiTree 下有两个，那是"要用户选"的情形）。
    const blobs = [{ path: 'mods/a/manifest.json' }, { path: 'other/manifest.json' }]
    const r = pickRoot({ blobs, wanted: 'mods' })
    expect(r.root).toBe('mods/a')
    expect(r.warnings[0]).toContain('没有 manifest.json')
  })

  test('用户指定的目录完全找不到 → 报错并把全仓库候选一并给出（路径写错时的出路）', () => {
    const r = pickRoot({ blobs: multiTree, wanted: 'nope' })
    expect(r.root).toBeUndefined()
    expect(r.candidates).toEqual(['mods/a', 'mods/b'])
    expect(r.errors[0]).toContain('nope')
  })

  test('一个 manifest 都没有 → 明确报错（不是"需要你选"，而是真的没有）', () => {
    const r = pickRoot({ blobs: [{ path: 'README.md' }] })
    expect(r.root).toBeUndefined()
    expect(r.candidates).toEqual([])
    expect(r.errors[0]).toContain('没找到 manifest.json')
  })

  test('候选数量上限：超过 MAX_CANDIDATES 时截断', () => {
    const blobs = []
    for (let i = 0; i < MAX_CANDIDATES + 5; i++) blobs.push({ path: `m${i}/manifest.json` })
    expect(pickRoot({ blobs }).candidates.length).toBe(MAX_CANDIDATES)
  })
})

describe('collectFiles', () => {
  test('只收文本文件（JSON/JS/MJS/MD/TXT），非文本只提示不报错', () => {
    const r = collectFiles({
      blobs: [
        { path: 'm/manifest.json', size: 10 },
        { path: 'm/code.js', size: 10 },
        { path: 'm/vendor/x.mjs', size: 10 },
        { path: 'm/README.md', size: 10 },
        { path: 'm/icon.png', size: 10 },
      ],
      root: 'm',
    })
    expect(r.files.map((f) => f.rel)).toEqual(['manifest.json', 'code.js', 'vendor/x.mjs', 'README.md'])
    expect(r.warnings[0]).toContain('已跳过非文本文件：icon.png')
  })

  test('node_modules 直接忽略（依赖应放 vendor/ 单文件，与 zip 安装同一约定）', () => {
    const r = collectFiles({ blobs: [{ path: 'm/manifest.json', size: 10 }, { path: 'm/node_modules/x/index.js', size: 10 }], root: 'm' })
    expect(r.files.map((f) => f.rel)).toEqual(['manifest.json'])
  })

  test('超限在**下载之前**就拒绝（用树里的 size，不浪费流量）', () => {
    // 单文件超限。
    expect(collectFiles({ blobs: [{ path: 'm/manifest.json', size: MAX_FILE_BYTES + 1 }], root: 'm' }).errors[0]).toContain('单文件上限')
    // 累计超限（5 个 7MB 的文件：每个都在单文件上限之内，累计才超）。
    const many7 = [{ path: 'm/manifest.json', size: 10 }]
    for (let i = 1; i <= 5; i++) many7.push({ path: `m/f${i}.json`, size: 7 * 1024 * 1024 })
    const big = collectFiles({ blobs: many7, root: 'm' })
    expect(big.errors[0]).toContain('累计体积')
    expect(MAX_TOTAL_BYTES).toBe(32 * 1024 * 1024)
    // 条目数超限。
    const many = []
    for (let i = 0; i < MAX_ENTRIES + 2; i++) many.push({ path: `m/f${i}.json`, size: 1 })
    many.push({ path: 'm/manifest.json', size: 1 })
    expect(collectFiles({ blobs: many, root: 'm' }).errors[0]).toContain('文件数超过上限')
  })

  test('缺 manifest.json → 明确报错（Mod 包根目录必须有它）', () => {
    expect(collectFiles({ blobs: [{ path: 'm/code.js', size: 10 }], root: 'm' }).errors[0]).toContain('没有 manifest.json')
  })
})

describe('fetchGitHubMod', () => {
  test('正常拉取：2 次 API（commit+树）+ N 次 raw，文件按包内相对路径归位', async () => {
    const gh = makeRepo({ 'mods/a/manifest.json': MOD_FILES['manifest.json'], 'mods/a/code.js': MOD_FILES['code.js'] })
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r/tree/main/mods/a', fetchImpl: gh.fetchImpl })
    // 成功。
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    // 包内路径是**相对**的。
    expect(Object.keys(r.files).sort()).toEqual(['code.js', 'manifest.json'])
    // 元数据。
    expect(r.meta).toMatchObject({ owner: 'o', repo: 'r', ref: 'main', commit: COMMIT, path: 'mods/a', count: 2, apiCalls: 2 })
    // 请求序列：commit → 树 → raw（raw 用 commit sha 与**仓库内完整路径**）。
    const urls = gh.calls.map((c) => c.url)
    expect(urls[0]).toBe(`${GITHUB_API}/repos/o/r/commits/main`)
    expect(urls[1]).toBe(`${GITHUB_API}/repos/o/r/git/trees/${TREE_SHA}?recursive=1`)
    expect(urls.filter((u) => u.startsWith(GITHUB_RAW)).sort()).toEqual([
      `${GITHUB_RAW}/o/r/${COMMIT}/mods/a/code.js`,
      `${GITHUB_RAW}/o/r/${COMMIT}/mods/a/manifest.json`,
    ])
  })

  test('链接没带分支：多一次仓库元数据调用，并提示按默认分支拉取', async () => {
    const gh = makeRepo({ 'manifest.json': MOD_FILES['manifest.json'] }, { defaultBranch: 'dev' })
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: gh.fetchImpl })
    expect(r.ok).toBe(true)
    expect(r.meta.ref).toBe('dev')
    expect(r.meta.apiCalls).toBe(3)
    expect(r.warnings[0]).toContain('默认分支 dev')
    expect(gh.calls[0].url).toBe(`${GITHUB_API}/repos/o/r`)
  })

  test('分支名含斜杠：第一次 404 后自动回退（多花调用但能成功）', async () => {
    // commits 端点在 ref 不含斜杠时 404（替身按"是否含 %2F"模拟）。
    const gh = makeRepo({ 'mods/a/manifest.json': MOD_FILES['manifest.json'] })
    const raw = gh.fetchImpl
    const seen = []
    const fetchImpl = async (url, init) => {
      seen.push(String(url))
      // 只有把整段 feature/foo 编码进来的那次才成功。
      if (String(url).includes('/commits/')) {
        if (!String(url).includes('feature%2Ffoo')) return { ok: false, status: 404, statusText: 'Not Found', headers: { get: () => null }, json: async () => ({}), text: async () => '' }
      }
      return raw(url, init)
    }
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r/tree/feature/foo/mods/a', fetchImpl })
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(r.meta.ref).toBe('feature/foo')
    expect(seen.filter((u) => u.includes('/commits/')).length).toBe(2)
  })

  test('私有仓库：明确拒绝并说明不支持鉴权（只拉公开仓库）', async () => {
    const gh = makeRepo({}, { privateRepo: true })
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: gh.fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('私有仓库')
    expect(r.errors[0]).toContain('B3')
    // 私有仓库连 commit 都不该请求。
    expect(gh.calls.length).toBe(1)
  })

  test('仓库/分支不存在（404）：错误里点明"私有仓库也不支持"', async () => {
    const gh = makeRepo({}, { repoStatus: 404 })
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: gh.fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('404')
    expect(r.errors[0]).toContain('私有仓库')
  })

  test('匿名配额用尽（403 + 剩余 0）：给出配额与恢复时间，而不是一句"失败"', async () => {
    const gh = makeRepo({}, { rateLimited: true })
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r/tree/main/mods/a', fetchImpl: gh.fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('限流')
    expect(r.errors[0]).toContain('60 次/小时')
  })

  test('仓库里有多个 Mod：交回候选（**钉在 commit 上**，且根本不下载文件）', async () => {
    const gh = makeRepo({ 'mods/a/manifest.json': MOD_FILES['manifest.json'], 'mods/b/manifest.json': MOD_FILES['manifest.json'] })
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: gh.fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.needsChoice).toBe(true)
    expect(r.candidates.map((c) => c.path)).toEqual(['mods/a', 'mods/b'])
    // 候选用 commit（不是分支）：用户点选后重跑同一个快照，结果确定。
    expect(r.candidates[0].url).toBe(`https://github.com/o/r/tree/${COMMIT}/mods/a`)
    // 没有任何 raw 请求（还没定目录，不该拉文件）。
    expect(gh.calls.filter((c) => c.url.startsWith(GITHUB_RAW)).length).toBe(0)
  })

  test('树被截断（超大仓库）：如实提示，否则"找不到 manifest"会误导', async () => {
    const gh = makeRepo({ 'manifest.json': MOD_FILES['manifest.json'] }, { truncated: true })
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: gh.fetchImpl })
    expect(r.ok).toBe(true)
    expect(r.warnings.some((w) => w.includes('部分文件树'))).toBe(true)
  })

  test('raw 连接失败 → 自动走 git/blobs 兜底（含中文的 UTF-8 也要解对）', async () => {
    // 中文内容：base64 兜底必须按 UTF-8 解码，不能解成乱码。
    const files = { 'manifest.json': JSON.stringify({ name: 'gh-mod', description: '中文描述：原版数据' }) }
    const gh = makeRepo(files, { rawMode: 'throw' })
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: gh.fetchImpl })
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    // 内容完好。
    expect(JSON.parse(r.files['manifest.json']).description).toBe('中文描述：原版数据')
    // 兜底被记下来（配额多花了，用户有权知道）。
    expect(r.meta.viaApi).toBe(1)
    // 4 次 = 仓库元数据（链接没带分支）+ commit + 树 + 兜底的 blob。
    expect(r.meta.apiCalls).toBe(4)
    expect(r.warnings.some((w) => w.includes('API 兜底'))).toBe(true)
    // 确实打了 blobs 端点。
    expect(gh.calls.some((c) => c.url.includes('/git/blobs/sha_manifest_json'))).toBe(true)
  })

  test('raw 返回 404（文件在该 commit 里真没有）：不兜底，直接失败', async () => {
    const gh = makeRepo({ 'manifest.json': MOD_FILES['manifest.json'] }, { rawMode: '404' })
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: gh.fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('404')
    // 404 是确定性的，不该再花一次配额。
    expect(gh.calls.some((c) => c.url.includes('/git/blobs/'))).toBe(false)
  })

  test('有文件下载不到 → 整个包拒绝（半包 Mod 比装不上更难查）', async () => {
    const gh = makeRepo({ 'manifest.json': MOD_FILES['manifest.json'], 'code.js': 'x' })
    // 让 code.js 的 raw 与 blobs 都不存在。
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: gh.fetchImpl })
    expect(r.ok).toBe(true)
    // 再造一个：raw 直接 404 且不止一个文件。
    const gh2 = makeRepo({ 'manifest.json': MOD_FILES['manifest.json'], 'code.js': 'x' }, { rawMode: '404' })
    const r2 = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: gh2.fetchImpl })
    expect(r2.ok).toBe(false)
    expect(r2.errors[0]).toContain('2 个文件下载失败')
    expect(r2.errors[0]).toContain('manifest.json')
  })

  test('取消（AbortSignal）：报"已取消"，不报成下载失败', async () => {
    const gh = makeRepo({ 'manifest.json': MOD_FILES['manifest.json'] })
    const ac = new AbortController()
    // 一进 raw 就取消。
    const fetchImpl = async (url, init) => {
      if (String(url).startsWith(GITHUB_RAW)) {
        ac.abort()
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      }
      return gh.fetchImpl(url, init)
    }
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl, signal: ac.signal })
    expect(r.ok).toBe(false)
    expect(r.aborted).toBe(true)
    expect(r.errors[0]).toContain('已取消')
  })

  test('进度回调：逐个文件报 done/total', async () => {
    const gh = makeRepo({ 'manifest.json': MOD_FILES['manifest.json'], 'code.js': 'x' })
    const seen = []
    await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: gh.fetchImpl, onProgress: (p) => seen.push(`${p.done}/${p.total}`) })
    expect(seen).toEqual(['1/2', '2/2'])
  })

  test('大小与文件树不符：记警告（不许静默）；中文内容按字节比对不误报', async () => {
    // 树里写错 size。
    const gh = makeRepo({ 'manifest.json': '中文' }, { extraTree: [] })
    // 手动改掉树里的 size。
    const wrong = gh.tree.map((t) => ({ ...t, size: 999 }))
    const gh2 = makeGitHub({ tree: wrong, blobs: { 'manifest.json': '中文' }, shaOf: { sha_manifest_json: 'manifest.json' } })
    const r = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: gh2.fetchImpl })
    expect(r.ok).toBe(true)
    expect(r.warnings.some((w) => w.includes('实际大小与文件树不一致'))).toBe(true)
    // 正确的字节数（中文 6 字节）不误报 —— 这条挡住"用 text.length（UTF-16 码元数）去比"的写法。
    const ok = makeRepo({ 'manifest.json': '中文' })
    const r2 = await fetchGitHubMod({ input: 'https://github.com/o/r', fetchImpl: ok.fetchImpl })
    expect(r2.ok).toBe(true)
    expect(r2.warnings.filter((w) => w.includes('实际大小'))).toEqual([])
  })
})

describe('installModFromGitHub', () => {
  test('装到本地存储：文件可读回，来源（owner/repo@commit）一路带回', async () => {
    const gh = makeRepo({ 'mods/a/manifest.json': MOD_FILES['manifest.json'], 'mods/a/code.js': MOD_FILES['code.js'] })
    const store = createMemoryModStore()
    const r = await installModFromGitHub({ input: 'https://github.com/o/r/tree/main/mods/a', store, fetchImpl: gh.fetchImpl })
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(r.name).toBe('gh-mod')
    expect(r.files).toBe(2)
    expect(r.source).toMatchObject({ owner: 'o', repo: 'r', commit: COMMIT, path: 'mods/a' })
    // 真的进了存储（能读回原文）。
    expect(await store.readText('gh-mod', 'code.js')).toBe('export default () => {}')
    expect((await store.list()).map((m) => m.name)).toEqual(['gh-mod'])
  })

  test('系统 Mod 名：默认拒绝并给出 prefetched；确认后重试**不再拉一次**', async () => {
    // 这是本模块最要紧的一条契约：用户的"确定"不该再花掉 2~3 次 API 配额。
    const files = { 'mods/d/manifest.json': JSON.stringify({ name: 'lifeRestart-data', version: '1.0.0' }), 'mods/d/age.json': '[]' }
    const gh = makeRepo(files)
    const store = createMemoryModStore()
    // 第一次：拒绝。
    const r1 = await installModFromGitHub({ input: 'https://github.com/o/r/tree/main/mods/d', store, fetchImpl: gh.fetchImpl })
    expect(r1.ok).toBe(false)
    expect(r1.system).toBe(true)
    expect(r1.name).toBe('lifeRestart-data')
    expect(r1.prefetched?.ok).toBe(true)
    // 记录调用数。
    const callsAfterFirst = gh.calls.length
    // 第二次：用 prefetched 重试（用户点了"确定"）。
    const r2 = await installModFromGitHub({ prefetched: r1.prefetched, store, allowSystem: true })
    expect(r2.ok).toBe(true)
    expect(r2.system).toBe(true)
    expect(r2.source.commit).toBe(COMMIT)
    // **没有任何新的网络请求**。
    expect(gh.calls.length).toBe(callsAfterFirst)
    // 已落库。
    expect((await store.list()).map((m) => m.name)).toEqual(['lifeRestart-data'])
  })

  test('拉取失败原样带出（不会伪装成安装成功）', async () => {
    const gh = makeRepo({}, { repoStatus: 404 })
    const store = createMemoryModStore()
    const r = await installModFromGitHub({ input: 'https://github.com/o/r', store, fetchImpl: gh.fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('404')
    expect((await store.list()).length).toBe(0)
  })

  test('需要选目录时原样带出候选（界面据此渲染选择项）', async () => {
    const gh = makeRepo({ 'mods/a/manifest.json': MOD_FILES['manifest.json'], 'mods/b/manifest.json': MOD_FILES['manifest.json'] })
    const store = createMemoryModStore()
    const r = await installModFromGitHub({ input: 'https://github.com/o/r', store, fetchImpl: gh.fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.needsChoice).toBe(true)
    expect(r.candidates.length).toBe(2)
  })
})

describe('base64ToText / httpError', () => {
  test('base64 → UTF-8 文本（中文不能解坏）', () => {
    expect(base64ToText(Buffer.from('你好，人生重开', 'utf8').toString('base64'))).toBe('你好，人生重开')
    expect(base64ToText('')).toBe('')
    // 带换行的 base64（GitHub 会按 60 字符折行）。
    const b64 = Buffer.from('中文测试内容', 'utf8').toString('base64')
    expect(base64ToText(`${b64.slice(0, 8)}\n${b64.slice(8)}`)).toBe('中文测试内容')
  })

  test('httpError：限流/404/其它各自可读', () => {
    const headers = (o) => ({ get: (k) => o[k] ?? null })
    expect(httpError({ status: 403, headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }) }, 'x')).toContain('限流')
    expect(httpError({ status: 403, headers: headers({}) }, 'x')).toContain('403')
    expect(httpError({ status: 404, headers: headers({}) }, 'x')).toContain('404')
    expect(httpError({ status: 500, headers: headers({}) }, 'x')).toContain('500')
    expect(httpError({ error: 'boom' }, 'x')).toContain('boom')
  })

  test('httpError 不吞掉状态文本', () => {
    expect(httpError({ status: 502, statusText: 'Bad Gateway', headers: { get: () => null } }, '树')).toContain('Bad Gateway')
  })
})

// vi 仅用于保持与其它 spec 一致的风格（本文件不需要替身计时器）。
void vi
