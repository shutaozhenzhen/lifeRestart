/**
 * asset-bridge — `gameAPI.asset` 的**唯一实现**（Mod 包内二进制资源的读取门面）
 *
 * 背景（2026-10 能力补齐 ②，硬边界解除）：
 *   以前 Mod 包**只能带文本**（zip 安装时二进制被丢弃并给警告），`AGENTS.md` 的边界 ④
 *   就写着"不能带资源文件进 zip"。现在包能带图片/音频/字体，字节逐字节保留，
 *   由这里交给 Mod 代码 —— `gameAPI.asset.bytes()/url()/text()`。
 *
 * 为什么做成"桥"（与 `property-bridge.js` 同一个思路）：
 *   1. **唯一实现**：浏览器与 CLI/Node 共用这一份，靠注入 `listFiles` / `readBytes`
 *      适配（前端 `createSourceAssetReader`、Node 文件源、测试替身）。同一件事
 *      写两遍必然分叉（本仓库反复踩过）。
 *   2. **惰性**：构造时就只是存两个函数引用，**不预下载任何字节** —— 只有 Mod 真的
 *      调 `bytes()/url()` 时才发生一次 IO（图片可能几 MB，开局全读是浪费）。
 *   3. **可读的失败**：读不到时抛带路径与原因的 Error，而不是静默返回空
 *      （"我明明包里有图，为什么是空白"是最难查的一类问题）。
 *   4. **降级明确**：宿主没有资源能力（`listFiles`/`readBytes` 没注入）时
 *      `available: false`，`list()` 给空数组，其余方法抛可读错误 —— 与 `property` /
 *      `storage` 的降级风格一致。
 *
 * 路径安全：`path` 是**外部输入**（Mod 作者写的字符串，或 Mod 代码里的拼接结果），
 * 所以这里拒绝 `..`、绝对路径、反斜杠与盘符（`isSafeAssetPath`）。真正的"只读本 Mod
 * 包内"由注入的 `readBytes(modName, path)` 保证 —— 它只认本 Mod 的文件清单与目录。
 *
 * 平台差异（`url()` 的返回值）：
 *   · 浏览器：`URL.createObjectURL(new Blob([bytes], { type: mime }))` → `blob:...`，
 *     可直接当 `<img src>`；**按路径缓存**（同路径恒同 URL），`dispose()` 时
 *     `URL.revokeObjectURL` 释放 —— 不释放就是内存泄漏（每个 URL 都会把字节钉在内存里）。
 *   · Node：没有 `createObjectURL`（Node 的 `Blob` 也没有），所以**降级为绝对文件路径**
 *     （由注入的 `baseDir` 拼出）。**取舍**：路径不是 `<img src>` 能直接用的东西
 *     （CLI/服务端场景里本来也没有 `<img>`），但它也不需要拷贝几 MB 字节，
 *     且明确指向"Mod 目录里的这个文件"，比造一个 `data:` URL 更省内存也更可诊断。
 *     若要"能在浏览器里直接显示"的形态，请在浏览器环境使用本桥。
 */

// 资源后缀清单与 MIME 表（与 zip 包**共用一份** —— 否则"zip 认得的资源"与
// "asset.list() 列出的资源"迟早分叉）。
import { ASSET_EXT, getMimeType } from './zip.js'

// #isSafeAssetPath
// 判断资源相对路径是否安全（防路径穿越 / 绝对路径 / 反斜杠）。
//
// 允许：`icon.png`、`assets/a/b.png`、`assets/..hidden.png`（点是文件名的一部分）。
// 拒绝：空、`../x`、`a/../../x`、`/etc/passwd`、`C:/x`、`a\b.png`、`.`、`..`。
//
// @param {string} path - 相对路径
// @returns {boolean} 是否安全
export function isSafeAssetPath(path) {
  // 必须是字符串。
  if (typeof path !== 'string') return false
  // 空。
  if (path === '') return false
  // 反斜杠（Windows 分隔符；归一化会掩盖"作者以为在往上跳一层"的意图，直接拒绝）。
  if (path.includes('\\')) return false
  // 前导斜杠（绝对路径）。
  if (path.startsWith('/')) return false
  // 盘符（C:/x）。
  if (/^[a-zA-Z]:/.test(path)) return false
  // 逐段检查：`.`（当前目录）与 `..`（上级目录）都拒绝。
  for (const seg of path.split('/')) {
    // 空段（`a//b`、结尾 `/`）。
    if (seg === '') return false
    // 点段与点点段。
    if (seg === '.' || seg === '..') return false
  }
  // 通过。
  return true
}

// #createAssetBridge
// 创建资源桥。
//
// @param {object} params
// @param {string} [params.modName] - Mod 名（错误信息与清单前缀用）
// @param {Function} [params.listFiles] - `async (mod) => string[]|null`（**完整**文件清单；
//   桥会用 ASSET_EXT 过滤出资源。返回 null 视为"未知 → 无资源"）
// @param {Function} [params.readBytes] - `async (mod, path) => Uint8Array|null`
// @param {string} [params.baseDir] - Node 降级形态下拼绝对路径的根目录（浏览器不需要）
// @param {object} [params.urlApi] - 注入的 URL 原语（测试用）：
//   `{ createObjectURL, revokeObjectURL, Blob }`；缺省取全局
// @returns {object} 资源桥
export function createAssetBridge({ modName = 'anonymous', listFiles, readBytes, baseDir, urlApi } = {}) {
  // 两个依赖缺任何一个 → 降级桥（缺失的 IO 能力不能靠"猜"补上）。
  if (typeof listFiles !== 'function' || typeof readBytes !== 'function') {
    // 降级。
    return createUnavailableAssetBridge(modName)
  }
  // URL 原语（可注入，便于在 Node/happy-dom 下单测缓存与 revoke）。
  const api = urlApi || globalThis
  // Blob 构造器（浏览器全局；Node 18+ 也有，但不支持 createObjectURL）。
  const BlobCtor = api.Blob
  // 造 URL 的函数（浏览器才有）。
  //
  // ⚠️ 这里刻意要求 **`Blob` 也存在**：Node 20+ 其实有 `URL.createObjectURL`，但它只接受
  //    Node 自己的 `Blob` —— 用别的 Blob 实现（或环境被替换过）会抛 `TypeError`。
  //    带上这个条件，实现就会**确定性地**落到"绝对路径"那条分支（见文件头的取舍说明），
  //    而不是"有时造 blob、有时抛"。
  const makeUrl = typeof api.createObjectURL === 'function' && typeof BlobCtor === 'function'
    // 用箭头包一层：保留 `this`（有些实现要求 `this` 是 URL 构造器）。
    ? (blob) => api.createObjectURL(blob)
    : null
  // 释放 URL 的函数。
  const dropUrl = typeof api.revokeObjectURL === 'function' ? (url) => api.revokeObjectURL(url) : () => {}
  // 路径 → 已造的 URL（**缓存**：同路径同一个 URL；dispose 时逐个释放）。
  const urlCache = new Map()
  // 是否已 dispose（释放后再调用要给出可读原因，而不是返回已失效的 URL）。
  let disposed = false

  // #ensureLive
  // dispose 之后再用 → 可读错误（静默返回失效的 blob URL 会让页面显示破图）。
  function ensureLive() {
    // 已释放。
    if (disposed) throw new Error(`Mod ${modName} 的资源桥已 dispose()：blob URL 已释放，不能再读资源`)
  }

  // #guard
  // 路径安全检查 + 统一拒绝信息。
  //
  // @param {string} path - 相对路径
  // @returns {void}
  function guard(path) {
    // 越界/非法。
    if (!isSafeAssetPath(path)) {
      // 可读错误（带上原因：绝对路径 / `..` / 反斜杠都会被这里挡住）。
      throw new Error(`Mod ${modName} 的资源路径不合法（拒绝绝对路径、\`..\` 与反斜杠）：${JSON.stringify(String(path))}`)
    }
  }

  // #bytesOrThrow
  // 读字节；读不到给可读错误（不静默返回空）。
  //
  // @param {string} path - 相对路径
  // @returns {Promise<Uint8Array>} 字节
  async function bytesOrThrow(path) {
    // 先查路径。
    guard(path)
    // dispose 之后不许再用。
    ensureLive()
    // 读（注入的 readBytes 只认本 Mod 包内的路径）。
    const bytes = await readBytes(modName, path)
    // 读不到。
    if (!bytes) {
      // 可读错误（提示"用 list() 看有哪些资源"）。
      throw new Error(`Mod ${modName} 里没有资源 ${path}（用 gameAPI.asset.list() 看这个包里的资源清单；注意路径要与包内相对路径完全一致）`)
    }
    // 返回（统一成 Uint8Array；注入的实现可能给 Buffer）。
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  }

  // 返回桥。
  return {
    // 有资源能力（Mod 应当先判断它，再决定要不要走资源分支）。
    available: true,

    // #list
    // 本 Mod 的**资源**路径数组（只含 ASSET_EXT 里的后缀：图片/音频/字体）。
    //
    // 为什么不把所有文件都列出来：`manifest.json` / `code.js` / 五张数据表**不是资源**
    // （它们走引擎自己的加载链路），列进来只会让人以为"可以拿 asset.url('code.js')"。
    // 想读文本资源用 `text(path)`；`.svg` 等既是图片又是文本的后缀按资源保留。
    //
    // @returns {Promise<string[]>} 路径数组（无资源 → 空数组；顺序同文件清单）
    async list() {
      // 已释放 → 空（list 不抛：它是"探测"语义，dispose 后调用方通常只想收尾）。
      if (disposed) return []
      // 读清单。
      const files = await listFiles(modName)
      // 未知/空。
      if (!Array.isArray(files)) return []
      // 过滤出资源后缀（大小写不敏感）。
      return files.filter((f) => ASSET_EXT.some((ext) => String(f).toLowerCase().endsWith(ext)))
    },

    // #has
    // 是否有某个资源。
    //
    // **会做一次轻量判断（读清单，不读字节）** —— 选这个语义是因为"只看路径像不像资源"
    // 会把包内不存在的路径判成 true，而 Mod 作者问 `has()` 通常正是想知道"我能不能用"。
    // 清单本身在源里是有缓存的（fetch 源缓存 files.json、store 源读一条记录），
    // 所以这里的代价是可控的。
    //
    // @param {string} path - 相对路径
    // @returns {Promise<boolean>} 是否存在
    async has(path) {
      // 非法路径 → false（不抛：探测语义）。
      if (!isSafeAssetPath(path)) return false
      // 已释放 → false。
      if (disposed) return false
      // 查清单。
      const files = await listFiles(modName)
      // 清单未知 → false（"我不知道"按"没有"回答，避免误报）。
      if (!Array.isArray(files)) return false
      // 命中（大小写敏感：路径就是键）。
      return files.includes(path)
    },

    // #bytes
    // 读资源的**原始字节**。
    //
    // @param {string} path - 相对路径
    // @returns {Promise<Uint8Array>} 字节（读不到 → 抛可读错误）
    bytes: (path) => bytesOrThrow(path),

    // #url
    // 拿一个**可直接用**的资源 URL。
    //
    // 浏览器：`blob:` URL（按路径缓存，同路径恒同 URL；dispose() 时 revoke）。
    // Node：没有 createObjectURL → 降级为绝对文件路径（见文件头的取舍说明）。
    //
    // @param {string} path - 相对路径
    // @returns {Promise<string>} URL（浏览器）或绝对路径（Node）
    async url(path) {
      // 命中缓存：路径在缓存里就说明它已经过 guard + 读到过字节（同路径同一个 URL）。
      if (urlCache.has(path)) return urlCache.get(path)
      // 浏览器：造 blob URL（bytesOrThrow 负责路径检查 / dispose 检查 / 读不到报错）。
      if (makeUrl && BlobCtor) {
        // 读字节。
        const bytes = await bytesOrThrow(path)
        // 按后缀判 MIME（`<img>`/`<audio>`/字体都需要正确的 type）。
        const url = makeUrl(new BlobCtor([bytes], { type: getMimeType(path) }))
        // 缓存（dispose 时释放）。
        urlCache.set(path, url)
        // 返回。
        return url
      }
      // Node 降级：绝对文件路径（baseDir 没给时退化成相对路径，仍然可读/可诊断）。
      // 先过路径检查与 dispose 检查（与浏览器分支保持同一套拒绝规则）。
      guard(path)
      // dispose 之后不许再用。
      ensureLive()
      // 拼绝对路径。
      const abs = baseDir ? `${String(baseDir).replace(/[\\/]+$/, '')}/${path}` : path
      // 缓存（没有 blob 需要释放，但保持"同路径同 URL"的一致语义）。
      urlCache.set(path, abs)
      // 返回。
      return abs
    },

    // #text
    // 读**文本**资源（例如 `.svg`、`.json` 形式的素材、字幕文件）。
    //
    // 用 `TextDecoder` 解码 UTF-8（与 `strFromU8` 同一语义）。
    //
    // @param {string} path - 相对路径
    // @returns {Promise<string>} 文本（读不到 → 抛可读错误）
    async text(path) {
      // 字节。
      const bytes = await bytesOrThrow(path)
      // 解码。
      return new TextDecoder().decode(bytes)
    },

    // #dispose
    // 释放全部 blob URL（**不释放就是内存泄漏**：每个 URL 都把字节钉在内存里）。
    //
    // 幂等（重复调用返回 0）。释放后 `bytes/url/text` 抛可读错误、`list/has` 给空/false。
    //
    // @returns {number} 释放掉的 URL 数量
    dispose() {
      // 收集。
      const urls = [...urlCache.values()]
      // 清缓存。
      urlCache.clear()
      // 标记（后续调用给可读错误，而不是拿到已失效的 URL）。
      disposed = true
      // 真的释放（Node 降级形态下 dropUrl 是空实现）。
      let n = 0
      // 逐个。
      for (const url of urls) {
        // 只释放 blob URL（绝对路径没有可释放的东西）。
        if (String(url).startsWith('blob:')) {
          // 释放。
          dropUrl(url)
          // 计数。
          n++
        }
      }
      // 返回真正释放的数量。
      return n
    },
  }
}

// #createUnavailableAssetBridge
// 降级桥：宿主**没有**资源能力时用（`listFiles` / `readBytes` 没注入，
// 例如所有 CLI 原型、只做目录检查的场景）。
//
// 为什么不像 `host` 那样悄悄 no-op：资源读不到却返回空字节，会让 Mod 拿到一张
// 破图或一段静音，而错误现场早已过去。这里统一**明确报错**，把原因写进信息里 ——
// 与 `createUnavailablePropertyBridge` 的风格一致。
//
// @param {string} [modName] - Mod 名（错误信息用）
// @returns {object} 降级桥
export function createUnavailableAssetBridge(modName = 'anonymous') {
  // 统一的错误。
  const fail = () => {
    // 抛出可读原因。
    throw new Error(`Mod ${modName} 的资源能力不可用（gameAPI.asset.available === false）：当前宿主没有注入资源文件源（浏览器里是 Mod 文件源，CLI 需要 mods 目录）。请先判断 available 再用`)
  }
  // 返回。
  return {
    // 不可用。
    available: false,
    // 空清单（不抛：探测语义）。
    list: async () => [],
    // 没有（不抛：探测语义）。
    has: async () => false,
    // 其余操作明确报错。
    bytes: fail,
    url: fail,
    text: fail,
    // 无事可做（幂等）。
    dispose: () => 0,
  }
}
