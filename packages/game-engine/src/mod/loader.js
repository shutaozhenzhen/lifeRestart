/**
 * Mod 加载引擎（**平台无关**）
 *
 * 实现设计文档 6.6 启动加载序列：
 *   1. 扫描 Mod 列表（由"文件源"提供：Node 读目录 / 浏览器读 index.json）
 *   2. 读取所有 manifest.json
 *   3. 解析依赖 → 缺失/循环报错
 *   4. 拓扑排序确定加载顺序
 *   5. 按序加载每个 Mod 的数据文件与 code.js 入口
 *   6. 合并所有 Mod 的数据（后加载覆盖）；执行 code.js（异常隔离）
 *
 * 与 Node 的关系（2026-10 重构）：
 *   原先本文件直接 `import node:fs`，浏览器里用不了。现在改为依赖**源接口**
 *   （src/mod/source-node.js / source-fetch.js），Node 与浏览器共用这一份逻辑：
 *   CLI、Electron 主进程、网页版跑的是同一套校验/排序/合并/执行。
 *
 * 数据文件约定（Mod 包结构 6.2）：
 *   age.json / talents.json / events.json / achievements.json / characters.json
 *   manifest.json / code.js（可选入口）
 */

// manifest 校验与排序（纯函数，平台无关）。
import { validateManifest, resolveOrder } from './manifest.js'
// 运行时模块注册表（依赖随包分发；见 modules.js）。
import { createModuleRegistry, createDenyRequire } from './modules.js'

// #DATA_FILES
// 约定的数据文件清单（两个平台一致；源若提供文件清单则只读清单里的）。
export const DATA_FILES = ['age.json', 'talents.json', 'events.json', 'achievements.json', 'characters.json']

// #CODE_FILE
// 代码入口文件名。
export const CODE_FILE = 'code.js'

// #scanMods
// 扫描 Mod：读列表 + 读 manifest + 校验。
//
// @param {object} params
// @param {object} params.source - 文件源（见 source-node/source-fetch）
// @param {object} [params.log] - 日志器
// @returns {Promise<{mods: Array<{name: string, manifest: object}>, errors: string[]}>} 结果
export async function scanMods({ source, log } = {}) {
  // 日志器。
  const logger = log || { debug: () => {}, info: () => {}, error: () => {} }
  // 结果与错误。
  const mods = []
  const errors = []
  // Mod 列表。
  let names = []
  // 读列表（失败不抛：调用方按"无 Mod"处理）。
  try {
    // 读。
    names = (await source.listMods()) || []
  } catch (e) {
    // 记录。
    errors.push(`读取 Mod 列表失败: ${e.message}`)
    // 返回。
    return { mods, errors }
  }
  // 逐个处理。
  for (const name of names) {
    // 读 manifest。
    const text = await source.readText(name, 'manifest.json')
    // 缺失。
    if (text === null) {
      // 记录。
      errors.push(`Mod ${name} 缺少 manifest.json`)
      // 跳过。
      continue
    }
    // 解析 + 校验。
    try {
      // 解析。
      const manifest = JSON.parse(text)
      // 校验。
      const check = validateManifest(manifest)
      // 非法。
      if (!check.ok) {
        // 记录。
        errors.push(`Mod ${name} manifest 非法: ${check.errors.join('; ')}`)
        // 跳过。
        continue
      }
      // 记录。
      mods.push({ name, manifest })
      // 日志。
      logger.debug(`扫描到 Mod: ${name}`)
    } catch (e) {
      // 记录。
      errors.push(`Mod ${name} manifest 解析失败: ${e.message}`)
    }
  }
  // 返回。
  return { mods, errors }
}

// #loadMod
// 加载单个 Mod 的数据文件与代码入口。
//
// @param {object} params
// @param {object} params.mod - { name, manifest }
// @param {object} params.source - 文件源
// @param {object} [params.log] - 日志器
// @returns {Promise<{data: object, code: string|null}>} 数据与代码
export async function loadMod({ mod, source, log } = {}) {
  // 日志器。
  const logger = log || { debug: () => {}, error: () => {} }
  // 数据。
  const data = {}
  // 该 Mod 的文件清单（null = 未知 → 按约定清单探测）。
  let files = null
  // 读清单（源可能不支持/不存在）。
  try {
    // 读。
    files = await source.listFiles(mod.name)
  } catch {
    // 忽略：退回探测模式。
    files = null
  }
  // 逐个数据文件。
  for (const file of DATA_FILES) {
    // 有清单且不在清单里 → 跳过（避免浏览器里一堆 404）。
    if (Array.isArray(files) && !files.includes(file)) continue
    // 读文本。
    const text = await source.readText(mod.name, file)
    // 不存在。
    if (text === null) continue
    // 解析。
    try {
      // 存入（键 = 文件名去后缀）。
      data[file.replace('.json', '')] = JSON.parse(text)
      // 日志。
      logger.debug(`  加载 ${mod.name}/${file}`)
    } catch (e) {
      // 记录。
      logger.error(`  ${mod.name}/${file} 解析失败: ${e.message}`)
    }
  }
  // 代码入口（同样尊重文件清单）。
  const code = Array.isArray(files) && !files.includes(CODE_FILE) ? null : await source.readText(mod.name, CODE_FILE)
  // 返回。
  return { data, code }
}

// #createModLoader
// 创建 Mod 加载器：扫描 + 排序 + 按序加载（异步，两个平台通用）。
//
// @param {object} params
// @param {object} params.source - 文件源
// @param {object} [params.log] - 日志器
// @param {string[]} [params.only] - 只加载这些 Mod（用于"只跑启用的 Mod"；缺省全加载）
// @param {Function} [params.moduleLoader] - 运行时模块的平台加载适配器
//   （async ({ id, path, code, modName }) => 命名空间；Node 用 modules-node，浏览器用 blob）。
//   给了它就自动处理 manifest.modules（Mod 随包分发的依赖），调用方无需手写 createRequire。
// @returns {Promise<{mods: Array, order: string[], errors: string[], loadAll: Function, disabled: string[]}>} 加载器
export async function createModLoader({ source, log, only, moduleLoader } = {}) {
  // 日志器。
  const logger = log || { debug: () => {}, info: () => {}, error: () => {} }
  // 扫描。
  const { mods: scanned, errors: scanErrors } = await scanMods({ source, log: logger })
  // 启用过滤（只跑启用的 Mod；被过滤掉的不参与依赖解析，避免"禁用了依赖项就报缺失"）。
  const enabledFilter = Array.isArray(only) ? new Set(only) : null
  // 过滤后的 Mod。
  const mods = enabledFilter ? scanned.filter((m) => enabledFilter.has(m.name)) : scanned
  // 被过滤掉的（信息性）。
  const disabled = enabledFilter ? scanned.filter((m) => !enabledFilter.has(m.name)).map((m) => m.name) : []
  // 依赖拓扑排序。
  const { order, errors: orderErrors } = resolveOrder(mods)
  // 全部错误（过滤掉被禁用 Mod 的 manifest 错误？错误照样报——非法 manifest 是事实）。
  const errors = [...scanErrors, ...orderErrors]
  // 返回加载器。
  return {
    // 元信息。
    mods,
    // 被启用开关挡掉的 Mod（没参与加载）。
    disabled,
    // 加载顺序。
    order,
    // 错误。
    errors,

    // #loadAll
    // 按序加载所有 Mod，合并数据（后加载覆盖）。
    // 可选执行每个 Mod 的 code.js：传 createAPI(name, data) 回调，返回该 Mod 的 gameAPI。
    // code.js 通过 gameAPI 注册钩子/操作数据；执行异常被隔离（不影响其他 Mod）。
    //
    // 运行时模块（依赖随包分发）：优先用 deps.createRequire(name, manifest)，
    // 缺省则用 loader 级的 moduleLoader 自动处理 manifest.modules。
    // 两者都没有时注入一个"说明为什么不能用"的 require —— 注入面保持一致。
    //
    // @param {object} [deps]
    // @param {(name: string, data: object) => object} [deps.createAPI] - 创建 gameAPI 的回调
    // @param {Function} [deps.createRequire] - 创建 require 的回调：
    //   async (name, manifest) => Function | { require: Function, errors?: string[] }
    // @returns {Promise<{data: object, codeList: Array<{name: string, code: string|null}>, errors: string[]}>} 合并数据
    async loadAll({ createAPI, createRequire } = {}) {
      // 合并数据。
      const merged = {}
      // 代码列表。
      const codeList = []
      // 加载期错误（解析失败/执行失败，逐 Mod 隔离）。
      const loadErrors = []
      // require 构建器：显式回调优先，其次用 loader 级的 moduleLoader。
      const buildRequire =
        createRequire ||
        (moduleLoader
          ? // 用 moduleLoader 自动建注册表（错误一并带出，便于在报告里可见）。
            async (name, manifest) => {
              // 建注册表。
              const reg = await createModuleRegistry({ modName: name, manifest, source, load: moduleLoader, log: logger })
              // 返回 require 与错误。
              return { require: reg.require, errors: reg.errors }
            }
          : null)
      // 按序加载。
      for (const name of order) {
        // 找 Mod。
        const mod = mods.find((m) => m.name === name)
        // 加载。
        const { data, code } = await loadMod({ mod, source, log: logger })
        // 合并（后加载覆盖）。
        for (const key in data) {
          // 覆盖或新建。
          merged[key] = { ...(merged[key] || {}), ...data[key] }
        }
        // 记录代码。
        codeList.push({ name, code })
        // 有代码入口且提供了 createAPI：执行 code.js。
        if (code && createAPI) {
          // 创建该 Mod 的 gameAPI（共享合并数据）。
          const gameAPI = createAPI(name, merged)
          // 该 Mod 的 require（运行时模块；建失败不阻断其它 Mod）。
          let requireFn = createDenyRequire(name)
          // 有构建器就用它。
          if (buildRequire) {
            try {
              // 等它建好（模块加载是异步的）。
              const built = await buildRequire(name, mod.manifest)
              // 两种返回形态都接受：裸 require 函数 / { require, errors }。
              if (typeof built === 'function') {
                // 裸函数。
                requireFn = built
              } else if (built && typeof built.require === 'function') {
                // 带错误清单（注册表形态）—— 错误要能一路带到报告里，不许静默。
                requireFn = built.require
                for (const err of built.errors || []) loadErrors.push(`Mod ${name}: ${err}`)
              }
            } catch (e) {
              // 记录。
              loadErrors.push(`构建 ${name} 的运行时模块失败: ${e.message}`)
              // 日志。
              logger.error(`构建 ${name} 的运行时模块失败: ${e.message}`)
            }
          }
          // 执行代码（异常隔离，单个 Mod 失败不影响其它）。
          try {
            // new Function 编译并执行，注入 gameAPI 与 require（作用域隔离）。
            new Function('gameAPI', 'require', '"use strict";\n' + code)(gameAPI, requireFn)
            // 日志。
            logger.debug(`执行 ${name}/code.js`)
          } catch (e) {
            // 记录。
            loadErrors.push(`执行 ${name}/code.js 失败: ${e.message}`)
            logger.error(`执行 ${name}/code.js 失败: ${e.message}`)
          }
        }
      }
      // 返回。
      return { data: merged, codeList, errors: loadErrors }
    },
  }
}
