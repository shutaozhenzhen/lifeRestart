/**
 * reset-data — 首页「重置数据」：把本地的一切恢复到"第一次打开"
 *
 * 为什么单独一个模块：
 *   清空是**破坏性且跨模块**的操作（引擎存档 + Mod 启停 + AI Key + 界面偏好 + 已安装 Mod），
 *   写在页面里迟早漏一个 —— 而漏掉的现象是"重置完了重开次数还是 3"这种莫名其妙。
 *   所以把清单收敛成**一处**，并用一条测试兜底：
 *     · 扫描 frontend 源码里所有 `getItem/setItem/removeItem('字面量')`，
 *     · 遍历引擎 `BUILTIN_PARAMS` 里全部 `type: 'storage'` 参数（键 = `storeKey || 参数名`），
 *   两者都必须出现在下面的清单里（否则测试直接红）。
 *
 * 范围（**只清本应用自己的键**，不做 `localStorage.clear()`）：
 *   同源下可能还有别的东西（尤其 dev 常常多个项目共用 localhost:3000），
 *   "清空全部"会误伤 —— 所以只删清单里这些键。
 */

// 引擎存档的键前缀（与 life-storage.js 同一个常量，避免两处各写一遍）。
import { DEFAULT_PREFIX } from './life-storage.js'
// 已安装 Mod 的本地存储（IndexedDB / 内存回退）。
import { getModStore } from './mod-store.js'

// #ENGINE_SAVE_KEYS
// 引擎存档：**键不含前缀**（`storeKey || 参数名`，见 param-registry 的 storage 分支）。
// 与 `game-engine/src/params/params.js` 里 `type: 'storage'` 的参数一一对应。
export const ENGINE_SAVE_KEYS = [
  { key: 'times', label: '重开次数（TMS）' },
  { key: 'extendTalent', label: '继承天赋（EXT）' },
  { key: 'ATLT', label: '累计拥有的天赋' },
  { key: 'AEVT', label: '累计见过的事件' },
  { key: 'ACHV', label: '累计达成的成就' },
]

// #APP_STORAGE_KEYS
// 前端自己的键（**无前缀**，由各模块直接读写 localStorage）。
export const APP_STORAGE_KEYS = [
  { key: 'modsState', label: 'Mod 启停 / 删除记录' },
  { key: 'aiConfig', label: 'AI 配置（含 API Key）' },
  { key: 'logLevel', label: '日志级别' },
  { key: 'playSpeed', label: '自动播放速度' },
]

// #resetPlan
// 生成"要清哪些键"的清单（最终键名，供删除与界面显示）。
//
// @param {object} [params]
// @param {string} [params.prefix] - 引擎存档键前缀
// @returns {Array<{key: string, label: string, scope: 'engine'|'app'}>} 清单
export function resetPlan({ prefix = DEFAULT_PREFIX } = {}) {
  // 引擎存档（带前缀）+ 前端键（不带）。
  return [
    // 引擎存档。
    ...ENGINE_SAVE_KEYS.map((i) => ({ key: `${prefix}${i.key}`, label: i.label, scope: 'engine' })),
    // 前端键。
    ...APP_STORAGE_KEYS.map((i) => ({ ...i, scope: 'app' })),
  ]
}

// #resetSummary
// 一句话说明"将清空什么"（界面确认条直接显示）。
//
// @param {object} [params] - 同 resetPlan
// @returns {string} 摘要
export function resetSummary(params) {
  // 标签拼起来。
  return resetPlan(params).map((i) => i.label).join('、')
}

// #resetAppData
// 清空本应用的本地数据：存储键 + 已安装的 Mod。
//
// **不抛异常**：任何一步失败都进 `errors`（界面照实显示 —— 清空失败却提示成功是最坏的情况）。
//
// @param {object} [params]
// @param {object} [params.storage] - 存储适配器（缺省全局 localStorage；测试注入）
// @param {object} [params.modStore] - Mod 存储（缺省 getModStore()；测试注入）
// @param {string} [params.prefix] - 引擎存档键前缀
// @param {object} [params.log] - 日志器
// @returns {Promise<{cleared: string[], absent: string[], removedMods: string[], errors: string[]}>} 结果
export async function resetAppData({ storage, modStore, prefix = DEFAULT_PREFIX, log } = {}) {
  // 结果。
  const cleared = []
  const absent = []
  const removedMods = []
  const errors = []
  // 取存储（缺省全局 localStorage；隐私模式下可能取不到）。
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  // 没有存储。
  if (!store) {
    errors.push('当前环境没有可用的 localStorage（隐私模式？），存储键未清空')
  } else {
    // 逐个键清。
    for (const item of resetPlan({ prefix })) {
      // 容错：单个键失败不影响其它键。
      try {
        // 适配器必须支持删除。
        if (typeof store.removeItem !== 'function') {
          errors.push(`${item.key}：存储不支持 removeItem，未清空`)
          continue
        }
        // 删之前先看有没有（"清空了 N 项"要如实，不能把本来就没有的算进去）。
        const before = typeof store.getItem === 'function' ? store.getItem(item.key) : null
        // 删。
        store.removeItem(item.key)
        // 记账。
        if (before === null || before === undefined) absent.push(item.key)
        else cleared.push(item.key)
      } catch (e) {
        // 记错（不中断）。
        errors.push(`清空 ${item.key} 失败：${e.message}`)
      }
    }
  }
  // 已安装的 Mod（IndexedDB / 内存）——一并卸载，否则"重置"后 Mod 管理页还留着旧 Mod。
  let ms = modStore || null
  // 没注入就取（失败只记错）。
  if (!ms) {
    try {
      // 取存储。
      ms = await getModStore()
    } catch (e) {
      // 记错。
      errors.push(`打开本地 Mod 存储失败：${e.message}`)
    }
  }
  // 有存储则逐个卸载。
  if (ms) {
    // 列举 + 卸载都容错。
    try {
      // 已安装清单。
      const list = (await ms.list()) || []
      // 逐个卸。
      for (const m of list) {
        // 容错。
        try {
          // 卸载。
          await ms.remove(m.name)
          // 记账。
          removedMods.push(m.name)
        } catch (e) {
          // 记错。
          errors.push(`卸载 Mod ${m.name} 失败：${e.message}`)
        }
      }
    } catch (e) {
      // 记错。
      errors.push(`列举已安装 Mod 失败：${e.message}`)
    }
  }
  // 日志（可观测：清了什么、失败什么）。
  if (log?.info) {
    // 一行摘要。
    log.info(`[reset] 清空 ${cleared.length} 个存储键（${absent.length} 项本来为空）· 卸载 ${removedMods.length} 个本地 Mod${errors.length ? ` · ${errors.length} 项失败` : ''}`)
  }
  // 返回。
  return { cleared, absent, removedMods, errors }
}
