/**
 * mod-store — 已安装 Mod 的浏览器存储（IndexedDB，含内存回退）
 *
 * 为什么不用 localStorage：Mod 包是多个文件、可能几 MB，而 localStorage 只有 ~5MB
 * 且只能存字符串 —— 装两个 Mod 就炸。IndexedDB 能存结构化对象、容量按配额给。
 *
 * 对外接口刻意与"文件源"同形（list/listFiles/readText），这样组合源可以直接把
 * 本地已安装的 Mod 与服务器上的 Mod 拼在一起，加载内核完全不用改。
 *
 * 测试与降级：无 indexedDB（Node/happy-dom/隐私模式）时自动退回内存实现，
 * 也可注入自定义 factory。
 */

// 数据库/表名。
const DB_NAME = 'lifeRestart-mods'
const STORE_NAME = 'mods'
const DB_VERSION = 1

// #createMemoryModStore
// 内存实现（测试与 IndexedDB 不可用时的降级）。
//
// @returns {object} 存储
export function createMemoryModStore() {
  // name → { name, manifest, files }
  const mods = new Map()
  // 返回。
  return {
    // 实现类型。
    kind: 'memory',
    // 已安装的 Mod（含 manifest）。
    async list() {
      // 转数组。
      return [...mods.values()].map((m) => ({ name: m.name, manifest: m.manifest }))
    },
    // 某个 Mod 的文件清单。
    async listFiles(name) {
      // 取记录。
      const rec = mods.get(name)
      // 不存在。
      return rec ? Object.keys(rec.files) : null
    },
    // 读一个文件（文本）。
    async readText(name, rel) {
      // 取记录后读。
      return mods.get(name)?.files?.[rel] ?? null
    },
    // 安装（覆盖同名）。
    async install({ name, manifest, files }) {
      // 写入。
      mods.set(name, { name, manifest, files: { ...files } })
    },
    // 卸载。
    async remove(name) {
      // 删除并返回是否删掉。
      return mods.delete(name)
    },
  }
}

// #createIndexedDBModStore
// IndexedDB 实现。
//
// @param {object} [params]
// @param {string} [params.dbName] - 数据库名（测试可自定义）
// @param {object} [params.factory] - indexedDB 实现（缺省全局）
// @returns {object} 存储（含 ready() 用于等待建库）
export function createIndexedDBModStore({ dbName = DB_NAME, factory } = {}) {
  // indexedDB。
  const idb = factory || globalThis.indexedDB
  // 打开数据库（Promise 化）。
  const dbPromise = new Promise((resolve, reject) => {
    // 打开。
    const req = idb.open(dbName, DB_VERSION)
    // 建表。
    req.onupgradeneeded = () => {
      // 建对象仓（键 = Mod 名）。
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME, { keyPath: 'name' })
    }
    // 成功。
    req.onsuccess = () => resolve(req.result)
    // 失败。
    req.onerror = () => reject(req.error)
  })

  // #tx
  // 起一个事务并返回对象仓。
  async function tx(mode) {
    // 等库。
    const db = await dbPromise
    // 事务。
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)
  }

  // #wrap
  // 把 IDBRequest 包成 Promise。
  function wrap(req) {
    // 返回。
    return new Promise((resolve, reject) => {
      // 成功。
      req.onsuccess = () => resolve(req.result)
      // 失败。
      req.onerror = () => reject(req.error)
    })
  }

  // 返回。
  return {
    // 实现类型。
    kind: 'indexeddb',
    // 等建库完成（调用方可 await，失败则在调用点降级）。
    async ready() {
      // 等库。
      await dbPromise
      // 成功。
      return true
    },
    // 已安装列表。
    async list() {
      // 全量取。
      const all = await wrap((await tx('readonly')).getAll())
      // 只暴露名字与 manifest（加载器需要 manifest）。
      return all.map((m) => ({ name: m.name, manifest: m.manifest }))
    },
    // 文件清单。
    async listFiles(name) {
      // 取记录。
      const rec = await wrap((await tx('readonly')).get(name))
      // 返回键。
      return rec ? Object.keys(rec.files) : null
    },
    // 读文本文件。
    async readText(name, rel) {
      // 取记录。
      const rec = await wrap((await tx('readonly')).get(name))
      // 读文件。
      return rec?.files?.[rel] ?? null
    },
    // 安装（put 覆盖）。
    async install({ name, manifest, files }) {
      // 写。
      await wrap((await tx('readwrite')).put({ name, manifest, files: { ...files } }))
    },
    // 卸载。
    async remove(name) {
      // 删。
      await wrap((await tx('readwrite')).delete(name))
      // 成功。
      return true
    },
  }
}

// #getModStore
// 选择可用的存储实现（IndexedDB 不可用/打开失败 → 内存）。
//
// @param {object} [params]
// @param {object} [params.factory] - indexedDB 实现（测试注入）
// @returns {Promise<object>} 存储
export async function getModStore({ factory } = {}) {
  // 无 indexedDB。
  if (!factory && typeof indexedDB === 'undefined') return createMemoryModStore()
  // 尝试打开。
  try {
    // 建存储。
    const store = createIndexedDBModStore({ factory })
    // 等建库（失败会在这里抛）。
    await store.ready()
    // 返回。
    return store
  } catch {
    // 降级为内存（功能仍在，只是刷新后不保留）。
    return createMemoryModStore()
  }
}
