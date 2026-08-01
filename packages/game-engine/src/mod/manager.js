/**
 * Mod 管理模块（Step 14）
 *
 * 功能：
 *   1. zip 导入：解压到 mods/（注入式解压器，Node/浏览器各自实现）。
 *   2. 权限匹配：manifest 权限与请求的权限比对，首次加载需授权。
 *   3. 启用/禁用/删除：改文件名或移动目录。
 *   4. 排序：记录用户自定义加载顺序。
 *
 * 权限模型（设计文档 6.3）：manifest 声明 permissions，
 * 加载时与用户授权集合比对，未授权需弹窗确认。
 */

// Node 内置：文件系统。
import { readFileSync, existsSync, readdirSync, renameSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
// Node 内置：路径。
import { join } from 'node:path'
// manifest 校验。
import { validateManifest } from './manifest.js'
// 权限常量。
export { PERMISSION_LABELS, VALID_PERMISSIONS } from './permissions.js'

// #checkPermissions
// 权限匹配：Mod 声明的权限是否都已被授权。
//
// @param {object} manifest - Mod manifest
// @param {Array<string>} granted - 已授权的权限集合
// @returns {{ok: boolean, missing: string[]}} 匹配结果
export function checkPermissions(manifest, granted = []) {
  // 声明的权限。
  const declared = manifest.permissions || []
  // 未授权的权限。
  const missing = declared.filter(p => !granted.includes(p))
  // 返回。
  return { ok: missing.length === 0, missing }
}

// #importZip
// 导入 zip Mod：解压到 mods 目录。
// 注入式 unzip 函数（Node 用 yauzl/系统，浏览器用 JSZip）。
//
// @param {object} params
// @param {Buffer|string} params.zipData - zip 内容
// @param {string} params.modsDir - mods 目录
// @param {Function} params.unzip - 解压函数 (zipData) => { [path]: content }
// @param {object} [params.log] - 日志器
// @returns {{ok: boolean, name?: string, errors: string[]}}
export function importZip({ zipData, modsDir, unzip, log }) {
  // 日志器。
  const logger = log || { info: () => {}, error: () => {} }
  // 错误。
  const errors = []
  // 解压。
  let files
  try {
    // 解压。
    files = unzip(zipData)
  } catch (e) {
    // 记录。
    return { ok: false, errors: [`zip 解压失败: ${e.message}`] }
  }
  // 找 manifest。
  const manifestEntry = Object.keys(files).find(f => f.endsWith('manifest.json'))
  // 无 manifest。
  if (!manifestEntry) {
    // 记录。
    return { ok: false, errors: ['zip 缺少 manifest.json'] }
  }
  // 解析 manifest。
  let manifest
  try {
    // 解析。
    manifest = JSON.parse(files[manifestEntry])
  } catch (e) {
    // 记录。
    return { ok: false, errors: [`manifest.json 不是合法 JSON: ${e.message}`] }
  }
  // 校验 manifest。
  const check = validateManifest(manifest)
  // 非法。
  if (!check.ok) {
    // 记录。
    return { ok: false, errors: [`manifest 非法: ${check.errors.join('; ')}`] }
  }
  // Mod 名。
  const name = manifest.name
  // 目标目录。
  const targetDir = join(modsDir, name)
  // 已存在。
  if (existsSync(targetDir)) {
    // 记录。
    return { ok: false, errors: [`Mod ${name} 已存在`] }
  }
  // 创建目录。
  try {
    // 建目录。
    mkdirSync(targetDir, { recursive: true })
    // 写入文件。
    for (const [path, content] of Object.entries(files)) {
      // 只写 Mod 目录下的文件。
      if (!path.includes('/')) {
        // 写文件。
        writeFileSync(join(targetDir, path), content)
      }
    }
    // 日志。
    logger.info(`导入 Mod: ${name}`)
    // 返回。
    return { ok: true, name, errors }
  } catch (e) {
    // 记录。
    return { ok: false, errors: [`导入失败: ${e.message}`] }
  }
}

// #listMods
// 列出 mods 目录所有 Mod（含启用状态）。
//
// @param {string} modsDir - mods 目录
// @returns {Array<{name: string, enabled: boolean, manifest: object}>}
export function listMods(modsDir) {
  // 目录不存在。
  if (!existsSync(modsDir)) return []
  // 结果。
  const result = []
  // 扫描。
  for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
    // 只处理目录。
    if (!entry.isDirectory()) continue
    // 跳过禁用目录（.disabled 后缀）。
    if (entry.name.endsWith('.disabled')) continue
    // manifest 路径。
    const manifestPath = join(modsDir, entry.name, 'manifest.json')
    // 无 manifest 跳过。
    if (!existsSync(manifestPath)) continue
    // 读取。
    try {
      // 解析。
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      // 记录。
      result.push({ name: entry.name, enabled: true, manifest })
    } catch {
      // 跳过。
      continue
    }
  }
  // 返回。
  return result
}

// #toggleMod
// 启用/禁用 Mod（通过重命名目录，加 .disabled 后缀）。
//
// @param {string} modsDir - mods 目录
// @param {string} name - Mod 名
// @param {boolean} enabled - 是否启用
// @returns {{ok: boolean, error?: string}}
export function toggleMod(modsDir, name, enabled) {
  // 原始路径。
  const from = join(modsDir, enabled ? `${name}.disabled` : name)
  // 目标路径。
  const to = join(modsDir, enabled ? name : `${name}.disabled`)
  // 源不存在。
  if (!existsSync(from)) return { ok: false, error: `Mod ${name} 不存在` }
  // 目标已存在。
  if (existsSync(to)) return { ok: false, error: `Mod ${name} 目标已存在` }
  // 重命名。
  renameSync(from, to)
  // 成功。
  return { ok: true }
}

// #removeMod
// 删除 Mod。
//
// @param {string} modsDir - mods 目录
// @param {string} name - Mod 名
// @returns {{ok: boolean, error?: string}}
export function removeMod(modsDir, name) {
  // 路径（含禁用态）。
  const path = join(modsDir, name)
  const pathDisabled = join(modsDir, `${name}.disabled`)
  // 都不存在。
  if (!existsSync(path) && !existsSync(pathDisabled)) return { ok: false, error: `Mod ${name} 不存在` }
  // 删除。
  rmSync(existsSync(path) ? path : pathDisabled, { recursive: true, force: true })
  // 成功。
  return { ok: true }
}
