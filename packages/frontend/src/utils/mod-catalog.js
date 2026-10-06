/**
 * mod-catalog — 前端 Mod 目录（原型清单 ↔ 服务器上发现的真实 Mod 合并）
 *
 * 为什么要单独一个模块：
 *   Mod 管理页原先自带一份写死的 4 个 Mod（原型数据），而"浏览器里能不能真的跑"
 *   取决于服务器上有没有这些 Mod（public/mods/index.json）。
 *   这里把两者合并成界面/运行时共用的一份目录：
 *     - 发现的真实 Mod：用 manifest 的 name/version/description/permissions/system
 *     - 只存在于原型清单里的：标记 available=false（界面提示"未在服务器上找到"），运行时跳过
 *     - 启停/删除仍由 localStorage（modsState）决定，复用 mods-state 的纯函数
 */

// 启停/删除状态的纯函数（localStorage 持久化）。
import { applyModsState, loadModsState } from './mods-state.js'

// #DEFAULT_MOD_LIST
// 原型 Mod 清单：既是"发现不到 Mod 时的界面兜底"，也提供**默认启停**（系统 Mod 默认开）。
//
// `dataFrom`（可选）：该 Mod 的**数据不在自己的目录里**，而是在站点上另一个目录。
// 只有系统 Data Mod 用得上：它的数据作为静态产物放在 `<BASE_URL>data/*.json`，
// `scripts/sync-mods.mjs` 刻意不把那 4MB 再复制一份到 `public/mods/<name>/`
// （见该脚本的 `DATA_FROM_PUBLIC`）—— 所以"查看数据"必须知道去哪儿读。
export const DEFAULT_MOD_LIST = [
  // 原版数据（Data Mod）：系统内置、默认启用；数据在 <BASE_URL>data/。
  { name: 'lifeRestart-data', enabled: true, system: true, description: '原版数据（系统内置，可移除/可恢复）', permissions: [], dataFrom: 'data' },
  // 基础 Mod：默认启用（提供 hooks 钩子演示）。
  { name: 'base-mod', enabled: true, system: false, description: '测试基础 Mod', permissions: ['hooks'] },
  // 趣味 Mod：默认禁用。
  { name: 'fun-mod', enabled: false, system: false, description: '测试趣味 Mod', permissions: ['hooks', 'storage'] },
  // 示例 Mod（教学）：默认禁用 —— 它是给人读代码/照抄用的样板，不该悄悄改变所有人的游戏数据。
  // 想试就在「Mod 管理」页启用它（或点「查看数据」看它装了什么）。
  { name: 'example-mod', enabled: false, system: false, description: '示例 Mod（教学）：演示 5 张数据表、三个钩子与 gameAPI 的用法', permissions: ['hooks', 'storage'] },
  // AI Mod：系统内置、默认禁用（需配置 API Key）。
  { name: 'ai-mod', enabled: false, system: true, description: 'AI 增强 Mod（系统内置，可通过 gameAPI.ai 调用生成天赋/事件）', permissions: ['ai', 'network', 'storage', 'hooks'] },
]

// #buildModCatalog
// 合并"发现的 Mod"与"已保存状态"，得到界面用的列表。
//
// @param {object} [params]
// @param {Array<{name: string, manifest: object}>} [params.discovered] - 服务器上发现的 Mod
// @param {object} [params.saved] - localStorage 里的 modsState（{ enabled, removed }）
// @param {Array<object>} [params.defaults] - 原型清单（提供默认启停与兜底展示）
// @returns {Array<object>} 界面用列表
export function buildModCatalog({ discovered = [], saved = {}, defaults = DEFAULT_MOD_LIST } = {}) {
  // 先按保存状态过滤/应用原型清单。
  const base = applyModsState(defaults, saved)
  // 发现表的索引（按目录名/ manifest.name）。
  const found = new Map(discovered.map((m) => [m.name, m]))
  // 结果。
  const list = []
  // 先处理原型清单里的项（保持界面顺序稳定）。
  for (const item of base) {
    // 对应发现项。
    const hit = found.get(item.name)
    // 命中：用 manifest 覆盖展示字段。
    if (hit) {
      // manifest。
      const mf = hit.manifest || {}
      // 推入。
      list.push({
        // 名字（以 manifest 为准）。
        name: mf.name || item.name,
        // 目录名（**读取文件必须用它**：manifest 的 name 允许与目录名不同，
        // 而源（HTTP/本地存储）是按目录名寻址的 —— 详情页靠这个字段）。
        dir: hit.name,
        // 展示。
        version: mf.version || null,
        description: mf.description || item.description || '',
        permissions: Array.isArray(mf.permissions) ? mf.permissions : item.permissions || [],
        // 系统 Mod（manifest.system === true）。
        system: mf.system === true || item.system === true,
        // 启停（保存状态优先，否则用原型默认）。
        enabled: item.enabled,
        // 是否真的在服务器上（决定运行时是否加载）。
        available: true,
      })
    } else {
      // 只在原型清单里：界面仍显示，但标注不可用。
      list.push({ ...item, dir: item.name, version: null, available: false })
    }
    // 从发现表里移除（剩下的都是"原型清单没登记的 Mod"）。
    found.delete(item.name)
  }
  // 追加"清单外"的发现项（第三方 Mod）：默认启用，除非保存状态说禁用。
  for (const { name, manifest: mf = {} } of found.values()) {
    // 保存状态。
    const savedEnabled = saved?.enabled?.[name]
    // 推入。
    list.push({
      // 名字。
      name: mf.name || name,
      // 目录名（读文件用；见上）。
      dir: name,
      // 展示。
      version: mf.version || null,
      description: mf.description || '（该 Mod 未提供描述）',
      permissions: Array.isArray(mf.permissions) ? mf.permissions : [],
      // 系统标记。
      system: mf.system === true,
      // 默认启用（第三方 Mod 装上就生效），保存状态优先。
      enabled: savedEnabled !== undefined ? savedEnabled : true,
      // 可用。
      available: true,
    })
  }
  // 返回。
  return list
}

// #loadModCatalog
// 读取 localStorage 状态 + 合并发现结果（界面直接可用的入口）。
//
// @param {Array} discovered - 发现的 Mod
// @param {object} [storage] - 存储适配器（缺省 localStorage）
// @returns {Array<object>} 目录
export function loadModCatalog(discovered = [], storage) {
  // 读状态。
  const saved = loadModsState(storage)
  // 合并。
  return buildModCatalog({ discovered, saved })
}

// #enabledModNames
// 从目录里取出"要加载的 Mod 名"（启用 + 服务器上真的存在）。
//
// @param {Array<object>} catalog - 目录
// @returns {string[]} 名字
export function enabledModNames(catalog = []) {
  // 过滤。
  return catalog.filter((m) => m.enabled && m.available !== false).map((m) => m.name)
}
