/**
 * Mod 加载引擎
 *
 * 实现设计文档 6.6 启动加载序列：
 *   1. 扫描 mods/ 目录（排除 disabled/）
 *   2. 读取所有 manifest.json
 *   3. 解析依赖 → 缺失/循环报错
 *   4. 拓扑排序确定加载顺序
 *   5. 按序加载每个 Mod 的 code/ 入口与数据
 *   6. 合并所有 Mod 的数据（后加载覆盖）
 *
 * 数据文件约定（Mod 包结构 6.2）：
 *   age.json / talents.json / events.json / achievements.json / characters.json
 *   manifest.json / code.js（可选入口）
 */

// Node 内置：文件系统。
import { readFileSync, existsSync, readdirSync } from 'node:fs'
// Node 内置：路径拼接。
import { join } from 'node:path'
// manifest 校验与排序。
import { validateManifest, resolveOrder } from './manifest.js'

// #scanMods
// 扫描 mods 目录，读取所有 manifest。
//
// @param {string} modsDir - mods 目录路径
// @param {object} [log] - 日志器
// @returns {{mods: Array<{name: string, manifest: object, dir: string}>, errors: string[]}}
export function scanMods(modsDir, log) {
  // 日志器。
  const logger = log || { debug: () => {}, info: () => {}, error: () => {} }
  // 结果。
  const mods = []
  // 错误。
  const errors = []
  // 目录不存在。
  if (!existsSync(modsDir)) {
    // 记录。
    errors.push(`mods 目录不存在: ${modsDir}`)
    // 返回。
    return { mods, errors }
  }
  // 列出所有子目录。
  for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
    // 只处理目录。
    if (!entry.isDirectory()) continue
    // 排除 disabled。
    if (entry.name === 'disabled') continue
    // 目录名 = Mod 名。
    const name = entry.name
    // manifest 路径。
    const manifestPath = join(modsDir, name, 'manifest.json')
    // manifest 不存在。
    if (!existsSync(manifestPath)) {
      // 记录。
      errors.push(`Mod ${name} 缺少 manifest.json`)
      // 跳过。
      continue
    }
    // 读取 manifest。
    try {
      // 解析 JSON。
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      // 校验。
      const check = validateManifest(manifest)
      // 非法。
      if (!check.ok) {
        // 记录。
        errors.push(`Mod ${name} manifest 非法: ${check.errors.join('; ')}`)
        // 跳过。
        continue
      }
      // 记录 Mod。
      mods.push({ name, manifest, dir: join(modsDir, name) })
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
// 加载单个 Mod 的数据文件。
//
// @param {object} mod - { name, manifest, dir }
// @param {object} [log] - 日志器
// @returns {{data: object, code: string|null}} 数据与代码入口
export function loadMod(mod, log) {
  // 日志器。
  const logger = log || { debug: () => {} }
  // 数据结果。
  const data = {}
  // 数据文件名列表。
  const files = ['age.json', 'talents.json', 'events.json', 'achievements.json', 'characters.json']
  // 逐个读取。
  for (const file of files) {
    // 文件路径。
    const path = join(mod.dir, file)
    // 不存在跳过。
    if (!existsSync(path)) continue
    // 读取。
    try {
      // 解析 JSON。
      data[file.replace('.json', '')] = JSON.parse(readFileSync(path, 'utf8'))
      // 日志。
      logger.debug(`  加载 ${mod.name}/${file}`)
    } catch (e) {
      // 记录。
      logger.error(`  ${mod.name}/${file} 解析失败: ${e.message}`)
    }
  }
  // code 入口。
  const codePath = join(mod.dir, 'code.js')
  // 存在则读取。
  const code = existsSync(codePath) ? readFileSync(codePath, 'utf8') : null
  // 返回。
  return { data, code }
}

// #createModLoader
// 创建 Mod 加载器：扫描 + 排序 + 按序加载。
//
// @param {object} params
// @param {string} params.modsDir - mods 目录
// @param {object} [params.log] - 日志器
// @returns {{loadAll: Function, mods: Array, order: string[], errors: string[]}}
export function createModLoader({ modsDir, log }) {
  // 日志器。
  const logger = log || { debug: () => {}, info: () => {}, error: () => {} }
  // 扫描结果。
  const { mods, errors: scanErrors } = scanMods(modsDir, logger)
  // 排序。
  const { order, errors: orderErrors } = resolveOrder(mods)
  // 全部错误。
  const errors = [...scanErrors, ...orderErrors]
  // 返回加载器。
  return {
    // 元信息。
    mods,
    // 加载顺序（无错误时有效）。
    order,
    // 错误。
    errors,

    // #loadAll
    // 按序加载所有 Mod，合并数据（后加载覆盖）。
    // 可选执行每个 Mod 的 code.js：传 createAPI(name, data) 回调，返回该 Mod 的 gameAPI。
    // code.js 通过 gameAPI 注册钩子/操作数据；执行异常被隔离（不影响其他 Mod）。
    //
    // @param {object} [deps]
    // @param {(name: string, data: object) => object} [deps.createAPI] - 创建 gameAPI 的回调
    // @returns {{data: object, codeList: Array<{name: string, code: string|null}>}} 合并数据
    loadAll({ createAPI } = {}) {
      // 合并数据。
      const merged = {}
      // 代码列表。
      const codeList = []
      // 按序加载。
      for (const name of order) {
        // 找 Mod。
        const mod = mods.find(m => m.name === name)
        // 加载。
        const { data, code } = loadMod(mod, logger)
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
          // 执行代码（异常隔离）。
          try {
            // new Function 编译并执行，注入 gameAPI（作用域隔离）。
            new Function('gameAPI', '"use strict";\n' + code)(gameAPI)
            // 日志。
            logger.debug(`执行 ${name}/code.js`)
          } catch (e) {
            // 记录。
            logger.error(`执行 ${name}/code.js 失败: ${e.message}`)
          }
        }
      }
      // 返回。
      return { data: merged, codeList }
    },
  }
}
