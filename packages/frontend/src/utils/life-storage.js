/**
 * life-storage — 给引擎 Life 用的持久化适配器
 *
 * 背景：
 *   引擎的存储型参数（TMS 重开次数、ACHV 达成成就、AEVT 已见事件）都走注入式 storage；
 *   前端此前 **没有注入** → Property 退回到"每次新建 Life 一个内存 storage"，
 *   于是重开次数永远是 0、成就/事件收集也无法跨局累积（总结页数据全是空的）。
 *
 * 设计：
 *   - 键加前缀（默认 `lifeRestart:`），避免与前端自己的键（modsState/logLevel/playSpeed）冲突；
 *   - 主存储惰性解析（注入优先，其次全局 localStorage），Node/隐私模式下退回内存；
 *   - 读写都 try/catch：配额超限、隐私模式禁用 localStorage 时**不能让游戏崩**，
 *     失败就退到内存副本（本局仍可用，只是不持久化）。
 */

// #DEFAULT_PREFIX
// 存储键前缀。
export const DEFAULT_PREFIX = 'lifeRestart:'

// #createLifeStorage
// 创建 storage 适配器（引擎侧只要求 getItem/setItem 的字符串语义）。
//
// @param {object} [deps]
// @param {object} [deps.storage] - 显式注入的底层存储（测试用；缺省用 localStorage）
// @param {string} [deps.prefix] - 键前缀
// @returns {{getItem: Function, setItem: Function}} 适配器
export function createLifeStorage({ storage, prefix = DEFAULT_PREFIX } = {}) {
  // 显式注入的存储（优先级最高）。
  const injected = storage
  // 内存副本：既是兜底，也作为主存储不可用时的读取来源。
  const memory = new Map()

  // #primary
  // 取主存储：注入优先，否则惰性读全局 localStorage（测试里可能后注入 mock）。
  //
  // @returns {object|null} 存储或 null
  function primary() {
    // 注入的优先。
    if (injected) return injected
    // 浏览器环境。
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null
    } catch {
      // 访问 localStorage 本身被拒（如隐私模式）→ 无主存储。
      return null
    }
  }

  // 返回适配器。
  return {
    // #getItem
    // 读取（缺失返回 null，与 localStorage 语义一致；引擎的 lsget 依赖这一点）。
    //
    // @param {string} key - 键（不含前缀）
    // @returns {string|null} 原始字符串
    getItem(key) {
      // 加前缀。
      const k = prefix + key
      // 先试主存储。
      try {
        // 取主存储。
        const store = primary()
        // 有主存储则读。
        if (store) {
          // 原始值。
          const raw = store.getItem(k)
          // 命中：同步进内存副本并返回。
          if (raw !== null && raw !== undefined) {
            // 缓存。
            memory.set(k, String(raw))
            // 返回字符串。
            return String(raw)
          }
        }
      } catch {
        // 读取异常：走内存兜底。
      }
      // 内存兜底。
      return memory.has(k) ? memory.get(k) : null
    },

    // #setItem
    // 写入（值是字符串；引擎侧已 JSON 序列化）。
    //
    // @param {string} key - 键（不含前缀）
    // @param {string} value - 字符串值
    // @returns {void}
    setItem(key, value) {
      // 加前缀。
      const k = prefix + key
      // 统一转字符串。
      const text = String(value)
      // 内存始终写（兜底 + 读取缓存）。
      memory.set(k, text)
      // 再写主存储（失败不影响本局）。
      try {
        // 取主存储。
        const store = primary()
        // 有则写。
        if (store) store.setItem(k, text)
      } catch {
        // 配额超限 / 隐私模式：忽略，内存副本仍在。
      }
    },
  }
}
