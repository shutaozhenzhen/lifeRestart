/**
 * mod/modules — 运行时模块注册表（seam #4）
 *
 * ## 硬约束（需求方明确要求）
 *
 * **所有 Mod 都是运行期的；禁止编译器静态提供依赖。** 所以依赖**不做任何构建期内联**，
 * 而是由引擎在**加载该 Mod 时**解析。流程：
 *
 *   1. Mod 把一个依赖作为**自包含单文件**随包分发（约定放 `vendor/`）
 *   2. 在 `manifest.modules` 里声明：`{ "lodash": "vendor/lodash.mjs" }`
 *   3. 引擎读这些文件 → 变成模块命名空间 → 填进本注册表
 *   4. `code.js` 通过**注入的 `require(id)` 同步取**（取的时候已经加载完了）
 *
 * ## 为什么"自包含单文件"是硬要求（不是风格偏好）
 *
 * `import()` 是**语法**，无法被注入的同名函数覆盖；而且浏览器里裸说明符需要 import map。
 * 因此运行时只能走"引擎自己加载好、mod 用 `require` 取"这条路。而"引擎自己加载"在两个源上都要求单文件：
 *
 * | Mod 来源 | 引擎拿到的模块形态 | 为什么必须自包含 |
 * |----------|-------------------|------------------|
 * | HTTP（服务器目录） | 一个 URL 一次 `import()` | 单文件无需知道依赖图 |
 * | IndexedDB（zip 安装） | **只有 `blob:` URL** | `blob:http://…/uuid` 解析 `./dep.js` 会得到不存在的 `blob:http://…/dep.js`；**相对导入必断**，所以依赖内部不能有相对导入 |
 *
 * Node 侧的 `server.js` 是原生 ESM，最自然的写法是**相对路径**导入（`import x from './vendor/x.mjs'`）——
 * 那本来就能用，不需要本模块；本模块主要服务浏览器侧 `code.js`。
 *
 * ## 深度
 *
 * 调用方只需要 `createModuleRegistry({ manifest, source, load })` → `{ require, ids, errors }`：
 * 声明读取、缺文件报错、`load` 注入（平台差异）、`require` 的错误提示全在里面。
 */

// manifest 取值助手（默认值与校验同源）。
import { manifestModules } from './manifest.js'

// #createDenyRequire
// 没有模块时的 `require`：给可读错误，而不是 "require is not defined"。
//
// 为什么要有它：`code.js` 会**无条件**被注入一个 `require` 参数（保持注入面稳定），
// 所以必须有一个"说明为什么不能用"的实现。
//
// @param {string} [modName] - Mod 名（用于错误信息）
// @returns {Function} require
export function createDenyRequire(modName) {
  // 返回一个总是抛错的 require。
  return function denyRequire(id) {
    // 报错（点明两条可能：没声明 / 声明了但没放文件）。
    throw new Error(
      `Mod ${modName || '(未知)'} 不能 require('${id}')：` +
        `它没有在 manifest.modules 里声明任何运行时模块。` +
        `（依赖要作为自包含单文件随包分发，例如 vendor/${String(id).replace(/[^\w.-]/g, '_')}.mjs，并在 manifest.modules 里登记）`
    )
  }
}

// #createModuleRegistry
// 按 manifest 声明，把随包分发的依赖加载成可同步取用的注册表。
//
// @param {object} params
// @param {string} params.modName - Mod 名（source 用它定位文件）
// @param {object} params.manifest - 该 Mod 的 manifest（读 modules 声明）
// @param {object} params.source - 文件源（listMods/listFiles/readText，见 source-node/source-fetch）
// @param {Function} params.load - **平台适配器**：async ({ id, path, code }) => 模块命名空间
//   · Node：`import(pathToFileURL(abs).href)`（真模块语义）
//   · 浏览器：`import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))`
// @param {object} [params.log] - 日志器
// @returns {Promise<{ids: string[], has: Function, require: Function, errors: string[]}>} 注册表
export async function createModuleRegistry({ modName, manifest, source, load, log } = {}) {
  // 日志器。
  const logger = log || { debug: () => {}, warn: () => {}, error: () => {} }
  // 声明（模块名 → 相对路径）。
  const declared = manifestModules(manifest)
  // 模块名列表。
  const ids = Object.keys(declared)
  // 已加载的命名空间。
  const registry = new Map()
  // 错误（缺文件 / 加载失败；逐条隔离，不影响其它模块）。
  const errors = []
  // 没有声明 → 直接给出 deny 版 require（注入面保持一致）。
  if (ids.length === 0) {
    // 返回空注册表。
    return { ids, has: () => false, require: createDenyRequire(modName), errors }
  }
  // 参数校验（调用方接线错误要能一眼看出）。
  if (typeof source?.readText !== 'function') {
    // 报错但返回可用对象（require 会给出可读错误）。
    errors.push('缺少 source（无法读取随包分发的模块文件）')
    // 返回。
    return { ids, has: () => false, require: createDenyRequire(modName), errors }
  }
  if (typeof load !== 'function') {
    // 报错。
    errors.push('缺少 load 适配器（无法把模块文件变成可执行的模块）')
    // 返回。
    return { ids, has: () => false, require: createDenyRequire(modName), errors }
  }
  // 逐个声明加载。
  for (const id of ids) {
    // 相对路径。
    const rel = declared[id]
    // 读文件（不存在返回 null）。
    let code = null
    try {
      // 读。
      code = await source.readText(modName, rel)
    } catch (e) {
      // 读失败也归一化成一条错误。
      errors.push(`模块 ${id} 读取失败（${rel}）：${e.message}`)
      // 下一个。
      continue
    }
    // 文件不存在。
    if (code === null || code === undefined) {
      // 报错（点明声明与实际不符）。
      errors.push(`模块 ${id} 声明为 ${rel}，但该文件不存在`)
      // 下一个。
      continue
    }
    // 交给平台适配器加载。
    try {
      // 加载（Node 用真模块；浏览器用 blob）。
      const ns = await load({ id, path: rel, code, modName })
      // 登记。
      registry.set(id, ns)
      // 日志。
      logger.debug(`  运行时模块已加载: ${modName} → ${id}（${rel}）`)
    } catch (e) {
      // 记录（含成因：多半不是自包含单文件）。
      errors.push(`模块 ${id} 加载失败（${rel}）：${e.message}`)
    }
  }
  // 返回注册表。
  return {
    // 声明过的模块名（含加载失败的）。
    ids,
    // 是否可用。
    has: (id) => registry.has(id),
    // #require：同步取（此时已加载完）。
    require: (id) => {
      // 命中。
      if (registry.has(id)) return registry.get(id)
      // 没命中：区分"声明过但加载失败"与"根本没声明"，给出不同提示。
      const declaredButFailed = ids.includes(id)
      // 可用清单。
      const available = [...registry.keys()]
      // 报错。
      throw new Error(
        declaredButFailed
          ? `Mod ${modName} 的模块 '${id}' 声明了但加载失败（见加载日志）：${errors.filter((e) => e.includes(`模块 ${id} `)).join('；') || '原因未记录'}`
          : `Mod ${modName} 没有声明模块 '${id}'（可用：${available.length > 0 ? available.join(', ') : '无'}）`
      )
    },
    // 错误。
    errors,
  }
}
