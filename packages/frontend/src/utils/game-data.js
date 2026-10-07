/**
 * game-data — 游戏数据加载（主页与模拟页共用，避免两套实现）
 *
 * 提取原因：
 *   「加载原版数据 → 失败降级 fixture」这段逻辑原先写在 HomeView 里。
 *   新增「模拟统计」页同样需要一份数据；如果再抄一遍，就会出现两套加载/降级
 *   行为（正是本项目此前踩过的坑）。这里收敛成一处，并保持与主页完全一致的
 *   日志文案与 dataSource 标注。
 *
 * 数据源优先级（**引擎不内置任何游戏内容**）：
 *   1. `lifeRestart-data` Mod 启用（缺省视为启用）→ 加载 public/data/*.json（Data Mod 产物）
 *   2. 加载失败或被禁用 → **空内容**（天赋/事件/成就/名人都为空）+ 写明原因的 dataSource
 *
 * 为什么不再降级到 fixture 演示数据：
 *   以前降级用的是引擎测试 fixture，里面有「填充天赋1/2/3」这类占位数据。
 *   于是「所有 Mod 关闭」时玩家看到的是测试数据，而且界面上没有任何解释 ——
 *   既是内容泄漏（引擎不该内置内容），也掩盖了"没有内容 Mod"这个真实原因。
 *   现在无 Mod = 无内容，原因写进 dataSource（日志报告 + 页面提示可见）。
 *   fixture 只剩测试用途，见 test-utils/fixture-data.js。
 */

// Mod 运行时（浏览器侧：发现 + 加载启用的 Mod 数据与代码）与目录/状态。
import { discoverMods, loadModBundle } from './mod-runtime.js'
import { buildModCatalog, enabledModNames } from './mod-catalog.js'
import { loadModsState, isModRemoved } from './mods-state.js'
// 已安装 Mod 的浏览器存储（IndexedDB，含内存回退）。
import { getModStore } from './mod-store.js'

// #buildEmptyData
// 空内容数据：引擎不内置任何天赋/事件/成就/名人 —— 内容只能来自 Mod。
// 结构与原版数据加载结果一致（缺内容时游戏能启动，但什么都抽不到）。
//
// @returns {object} { age, total, talents, events, achievements, characters }
export function buildEmptyData() {
  // 空表 + 零总量（TTLT 等比率参数的分母有 `|| 1` 保护，不会算出 NaN）。
  return {
    age: {},
    total: { TACHV: 0, TEVT: 0, TTLT: 0 },
    talents: {},
    events: {},
    achievements: {},
    characters: {},
  }
}

// #loadModState
// 读取某个 Mod 的启停状态（localStorage 键 modsState，与 Mod 管理页共用）。
//
// ⚠️ **完全移除 = 不加载**（2026-10 补）：命中 `removed` 直接返回 false。
// 否则"把内容 Mod 完全移除"只影响界面列表，游戏仍按默认值加载它 —— 界面说已移除、
// 实际还在用它的内容。判据收敛在 `mods-state.isModRemoved()`。
//
// @param {string} name - Mod 名
// @param {object} [storage] - 存储适配器（缺省 localStorage）
// @returns {boolean|null} 启停；无记录返回 null
export function loadModState(name, storage) {
  // 读取 + 解析。
  try {
    // 解析。
    const parsed = JSON.parse((storage || localStorage).getItem('modsState'))
    // 已被完全移除 → 视为禁用（含内容 Mod：移除后游戏为空内容）。
    if ((parsed?.removed || []).includes(name)) return false
    // 返回该 Mod 启停（缺省 null = 用默认值）。
    return parsed?.enabled?.[name] ?? null
  } catch {
    // 无记录 / 解析失败。
    return null
  }
}

// #fetchOriginalData
// 加载 Data Mod 产物（public/data/*.json）。
//
// @param {object} [deps]
// @param {Function} [deps.fetchImpl] - 请求实现（测试可注入）
// @param {string} [deps.baseUrl] - 数据基础路径（缺省用 Vite 的 BASE_URL）
// @returns {Promise<object>} 引擎可直接消费的数据
export async function fetchOriginalData({ fetchImpl, baseUrl } = {}) {
  // 请求实现。
  const request = fetchImpl || fetch
  // 基础路径：用 import.meta.env.BASE_URL（dev '/'，Pages 构建 './'），
  // 避免部署到子路径时请求到域名根而 404。
  const base = baseUrl !== undefined ? baseUrl : import.meta.env.BASE_URL || '/'
  // 并行加载 5 个数据文件。
  const [age, talents, events, achievements, characters] = await Promise.all([
    // 年龄表。
    request(`${base}data/age.json`).then((r) => r.json()),
    // 天赋。
    request(`${base}data/talents.json`).then((r) => r.json()),
    // 事件。
    request(`${base}data/events.json`).then((r) => r.json()),
    // 成就。
    request(`${base}data/achievements.json`).then((r) => r.json()),
    // 名人。
    request(`${base}data/characters.json`).then((r) => r.json()),
  ])
  // 返回整合数据（total 供引擎统计使用）。
  return {
    age,
    total: { TACHV: Object.keys(achievements).length, TEVT: Object.keys(events).length, TTLT: Object.keys(talents).length },
    talents,
    events,
    achievements,
    characters,
  }
}

// #loadGameData
// 按数据源优先级加载数据（含**前端 Mod 运行时**：加载启用的 Mod 数据与代码），
// 并给出 dataSource 描述（供日志/报告）。
//
// 步骤：
//   1. 基础数据：原版数据产物（public/data）→ 失败降级 fixture
//   2. Mod：发现 public/mods/index.json → 合并启停状态 → 加载启用 Mod 的数据与代码
//      · 数据在这里合并（必须在 Life.initial() 之前）
//      · 代码**不执行**，随结果返回（要等 Life 建好才能注入 params → 见 store.init）
//
// @param {object} [deps]
// @param {Function} [deps.fetchImpl] - 请求实现（测试可注入）
// @param {object} [deps.storage] - 存储适配器（读 Mod 启停）
// @param {string} [deps.baseUrl] - 数据基础路径
// @param {boolean} [deps.withMods] - 是否加载 Mod（缺省 true；模拟页等可关掉）
// @returns {Promise<{data: object, dataSource: string, degraded: boolean, hooks: object|null, modCodes: Array, modRequires: object|null, assetReader: object|null, assetSource: object|null, mods: object|null}>} 数据与来源
export async function loadGameData({ fetchImpl, storage, baseUrl, withMods = true } = {}) {
  // 原版数据 Mod 的启停（缺省视为启用：系统内置默认开）。
  const enabled = loadModState('lifeRestart-data', storage)
  // 基础数据与来源描述。
  let data = null
  let dataSource = ''
  let degraded = false
  // 启用路径。
  if (enabled !== false) {
    // 尝试加载原版。
    try {
      // 加载。
      data = await fetchOriginalData({ fetchImpl, baseUrl })
      // 来源描述（含规模摘要）。
      dataSource = `lifeRestart-data（${Object.keys(data.talents).length} 天赋 / ${Object.keys(data.events).length} 事件）`
    } catch (e) {
      // 降级：空内容 + 标注失败原因。
      data = buildEmptyData()
      dataSource = `空内容（原版数据加载失败：${e.message}）`
      degraded = true
    }
  } else {
    // 被禁用 / **被完全移除**：空内容（引擎没有可退的"默认内容"，内容 Mod 就是内容的唯一来源）。
    data = buildEmptyData()
    // 说清是"移除"还是"禁用"：两者的出路不同（移除要去 /mods 恢复预装或重新上传 zip）。
    dataSource = isModRemoved('lifeRestart-data', storage)
      ? '空内容（lifeRestart-data 已完全移除：到 /mods 恢复预装或重新上传 zip）'
      : '空内容（lifeRestart-data 已禁用）'
    degraded = true
  }
  // Mod 运行时（失败绝不阻断游戏：Mod 是增强，不是必需）。
  let hooks = null
  let modCodes = []
  let modRequires = null
  // 资源能力（2026-10 能力补齐 ②）：惰性读取器 + 文件源，交给 store.init。
  // 没加载 Mod 时是 null（`gameAPI.asset` 走降级桥、占位符按纯文本显示）。
  let assetReader = null
  let assetSource = null
  let mods = null
  // 需要且未禁用时加载。
  if (withMods) {
    // 容错。
    try {
      // 已安装 Mod 的本地存储（无 IndexedDB 时退回内存，功能仍在）。
      const store = await getModStore()
      // 发现 Mod（本地已安装 + 服务器，本地优先）。
      const discovered = await discoverMods({ fetchImpl, store })
      // 合并启停/删除状态得到目录（真实 manifest 覆盖展示字段）。
      const catalog = buildModCatalog({ discovered: discovered.mods, saved: loadModsState(storage) })
      // 要加载的 Mod 名（启用且服务器上真的存在）。
      const enabledNames = enabledModNames(catalog)
      // 加载数据与代码。
      const bundle = await loadModBundle({ fetchImpl, enabled: enabledNames, store })
      // 合并 Mod 数据（后加载覆盖；与内核里 Mod 之间的合并规则一致）。
      for (const key of Object.keys(bundle.data)) {
        // 合并一个数据集。
        data[key] = { ...(data[key] || {}), ...bundle.data[key] }
      }
      // 内容总量按**合并后**的实际规模重算：无内容 Mod 时数据为空、内容全靠 Mod，
      // 沿用加载时的 total 会与真实表对不上（收集率等比率参数的分母就错了）。
      data.total = {
        TACHV: Object.keys(data.achievements || {}).length,
        TEVT: Object.keys(data.events || {}).length,
        TTLT: Object.keys(data.talents || {}).length,
      }
      // 传出钩子总线与待执行代码（由 store.init 在建好 Life 后执行）。
      hooks = bundle.hooks
      modCodes = bundle.codes
      // 运行时模块（每个 Mod 的 require；阶段二注入给 code.js）。
      modRequires = bundle.requires
      // 资源能力（**惰性**：这里不读任何字节；只有 Mod 真用 `gameAPI.asset` 或
      // 轨迹里出现 `{{asset:路径}}` 时才去读那一个文件）。
      assetReader = bundle.assetReader
      assetSource = bundle.assetSource
      // 运行信息（报告/界面用）。
      mods = {
        // 目录（界面渲染）。
        catalog,
        // 实际加载（拓扑顺序）。
        loaded: bundle.loaded,
        // 被开关挡掉的。
        disabled: bundle.disabled,
        // 错误（扫描/排序/解析/发现）。
        errors: [...(discovered.errors || []), ...(bundle.errors || [])],
        // 待执行代码数。
        codes: bundle.codes.length,
      }
      // 来源描述追加 Mod 信息（日志报告里一眼可见）。
      if (bundle.loaded.length > 0) dataSource += ` + Mod×${bundle.loaded.length}`
    } catch (e) {
      // 记录为错误信息，但不影响游戏数据。
      mods = { catalog: [], loaded: [], disabled: [], errors: [`Mod 运行时异常：${e.message}`], codes: 0 }
    }
  }
  // 返回。
  return { data, dataSource, degraded, hooks, modCodes, modRequires, assetReader, assetSource, mods }
}
