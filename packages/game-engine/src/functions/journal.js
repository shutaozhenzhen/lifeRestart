/**
 * journal 游戏流水记录（Step 18/19 AI 上下文）
 *
 * 设计文档 10.4：Life.next() 返回的 content 只存内存，未持久化。
 * journal 记录结构化流水，供：
 *   1. AI 上下文（把过去的事件喂给 AI 生成更贴合剧情的内容）。
 *   2. 复盘/导出（Step 26 对比）。
 *
 * 存储注入式（浏览器 localStorage / Node 内存或文件），与 property 的 storage 一致。
 */

// #createJournal
// 创建流水记录器。
//
// @param {object} deps
// @param {object} [deps.storage] - 注入式 storage（getItem/setItem）
// @param {string} [deps.key] - storage 键名（默认 'lifeJournal'）
// @param {number} [deps.limit] - 最大记录条数（默认 500，防膨胀）
// @returns {object} journal
export function createJournal({ storage, key = 'lifeJournal', limit = 500 } = {}) {
  // 记录数组。
  const entries = []

  // #push
  // 追加一条流水。
  //
  // @param {object} entry - { age, type, description, props? }
  // @returns {void}
  function push(entry) {
    // 追加。
    entries.push(entry)
    // 超限截断（保留最新的）。
    if (entries.length > limit) entries.splice(0, entries.length - limit)
    // 持久化（有 storage）。
    if (storage) storage.setItem(key, JSON.stringify(entries))
  }

  // #all
  // 读取全部流水。
  //
  // @returns {Array} 流水数组
  function all() {
    // 返回副本。
    return [...entries]
  }

  // #last
  // 读取最近 N 条。
  //
  // @param {number} [n] - 条数（缺省全部）
  // @returns {Array} 流水数组
  function last(n) {
    // 全部。
    if (!n) return all()
    // 最近 n 条。
    return entries.slice(-n)
  }

  // #clear
  // 清空流水。
  //
  // @returns {void}
  function clear() {
    // 清空。
    entries.length = 0
    // 持久化。
    if (storage) storage.setItem(key, JSON.stringify([]))
  }

  // #restore
  // 从 storage 恢复（启动时调用）。
  //
  // @returns {number} 恢复条数
  function restore() {
    // 无 storage。
    if (!storage) return 0
    // 读取。
    const raw = storage.getItem(key)
    // 无数据。
    if (!raw) return 0
    // 解析。
    try {
      // 恢复。
      const data = JSON.parse(raw)
      // 数组。
      if (Array.isArray(data)) entries.push(...data)
      // 返回条数。
      return entries.length
    } catch {
      // 损坏忽略。
      return 0
    }
  }

  // 返回。
  return { push, all, last, clear, restore }
}

// #recordYear
// 便捷函数：记录一年的流水。
//
// @param {object} journal - journal 实例
// @param {object} year - { age, content }
// @returns {void}
export function recordYear(journal, year) {
  // 逐条记录。
  for (const c of year.content || []) {
    // 追加。
    journal.push({
      age: year.age,
      type: c.type,
      description: c.description || c.name || '',
      grade: c.grade,
    })
  }
}
