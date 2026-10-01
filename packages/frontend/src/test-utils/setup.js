/**
 * test-utils/setup — 前端测试公共装置（**仅测试使用**，不被应用代码引用，不会进构建产物）
 *
 * 提供五件事：
 *   1. buildFixtureData()：与 HomeView 同源的演示数据（fixture，**只用于快速用例**）。
 *   2. loadRealData()/stubFetchReal()：**真实数据**（501 年龄 / 184 天赋 / 1720 事件）。
 *      涉及"随机种子是否真的生效""复现是否真的成立"这类结论，必须用真实数据 ——
 *      fixture 只有 4 个候选天赋且每个年龄单一事件，随机性几乎不可观测。
 *      （实现放在 test-utils/real-data.js：那个模块不依赖 DOM/路由，node 环境的单测也能直接引用。）
 *   3. installLocalStorage()：内存 localStorage（Node 环境无该全局）。
 *   4. stubFetchOk/Fail()：拦截 HomeView 的 5 个数据请求。
 *   5. resetApp()/createTestRouter()/mountView()：每个用例的干净 pinia + 路由 + 挂载。
 */

// 挂载组件。
import { mount } from '@vue/test-utils'
// Pinia（复用当前激活实例：否则组件里的 store 与测试里的 store 会是两份状态）。
import { createPinia, setActivePinia, getActivePinia } from 'pinia'
// 内存路由（view 单测不启用真实守卫，便于独立驱动）。
import { createRouter, createMemoryHistory } from 'vue-router'
// 克隆工具。
import { clone } from 'game-engine/src/functions/util.js'
// fixture 数据（与 game.spec / HomeView 同源）。
import { AGE_DATA, TOTAL } from 'game-engine/src/fixtures/property.fixture.js'
import { TALENTS, EVENTS } from 'game-engine/src/fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from 'game-engine/src/fixtures/achievement-character.fixture.js'
// 线上路由表（测试复用同一份，避免分叉）。
import { routes } from '../router/index.js'
// 真实数据加载（独立模块，见其文件头说明）。
export { loadRealData, stubFetchReal } from './real-data.js'

// #buildFixtureData
// 组装演示数据（结构 = HomeView.fetchOriginalData / buildData 的返回值）。
//
// @returns {object} { age, total, talents, events, achievements, characters }
export function buildFixtureData() {
  // 逐字段深拷贝，避免用例之间互相污染。
  return {
    age: clone(AGE_DATA),
    total: TOTAL,
    talents: clone(TALENTS),
    events: clone(EVENTS),
    achievements: clone(ACHIEVEMENTS),
    characters: {},
  }
}

// #installLocalStorage
// 安装内存 localStorage（Node 环境没有该全局）。
//
// @returns {object} 底层 map（断言用）
export function installLocalStorage() {
  // 存储。
  const data = {}
  // 适配器。
  const mock = {
    // 读。
    getItem(k) { return k in data ? data[k] : null },
    // 写。
    setItem(k, v) { data[k] = String(v) },
    // 删。
    removeItem(k) { delete data[k] },
    // 清空。
    clear() { for (const k of Object.keys(data)) delete data[k] },
  }
  // 注入全局。
  // 注意：happy-dom 环境下 localStorage 可能是只读访问器，直接赋值会静默失败
  // → 用例之间状态泄漏（曾导致"上一个用例删掉的 Mod 在下一个用例里消失"）。
  // 因此用 defineProperty 强制替换。
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true, writable: true })
  } catch {
    // 极端情况下退回直接赋值。
    globalThis.localStorage = mock
  }
  // 返回底层数据。
  return data
}

// #resetApp
// 每个用例前的统一重置：全新 pinia + 干净的 localStorage。
//
// @returns {{pinia: object, storage: object}} pinia 实例与 localStorage 底层数据
export function resetApp() {
  // 全新 pinia（store 状态归零，模拟刷新页面）。
  const pinia = createPinia()
  // 激活（组件外的 useGameStore() 也拿到同一实例）。
  setActivePinia(pinia)
  // 干净存储。
  const storage = installLocalStorage()
  // 兜底清空：确保**当前生效的** localStorage 一定是空的
  // （用例之间状态泄漏过一次：上一个用例删掉的 Mod 在下一个用例里消失）。
  try {
    globalThis.localStorage.clear()
  } catch {
    // 无 clear 实现时忽略。
  }
  // 返回。
  return { pinia, storage }
}

// #createTestRouter
// 用线上路由表创建内存 history 路由（可断言 currentRoute，且不触发真实守卫）。
//
// @param {string} [initial] - 初始路径
// @returns {object} router
export function createTestRouter(initial = '/') {
  // 创建。
  const router = createRouter({ history: createMemoryHistory(), routes })
  // 起始路径。
  router.push(initial)
  // 返回。
  return router
}

// #mountView
// 挂载一个页面组件并注入 pinia + 路由。
//
// @param {object} component - 组件
// @param {object} [options]
// @param {object} [options.pinia] - 指定 pinia（缺省新建）
// @param {object} [options.router] - 指定路由（缺省新建内存路由）
// @param {string} [options.route] - 初始路由路径
// @param {object} [options.global] - 追加的 global 配置（stubs 等）
// @returns {{wrapper: object, router: object, pinia: object}} 挂载结果
export function mountView(component, { pinia, router, route = '/', global = {} } = {}) {
  // 复用当前激活的 pinia（resetApp 建好的那个），否则组件与测试会各持一份 store。
  const p = pinia || getActivePinia() || createPinia()
  // 确保组件外的 useGameStore() 与组件内一致。
  setActivePinia(p)
  // 路由。
  const r = router || createTestRouter(route)
  // 挂载。
  const wrapper = mount(component, {
    // 注入插件（pinia + router 是组件 useStore/useRouter 的来源）。
    global: { plugins: [p, r], ...global },
  })
  // 返回。
  return { wrapper, router: r, pinia: p }
}

// #waitFor
// 轮询等待条件成立（用于异步流程：批量模拟、取消等）。
// 注意：需要真实定时器（不要与 vi.useFakeTimers 同时用）。
//
// @param {Function} predicate - 条件（返回 true 即结束）
// @param {object} [options]
// @param {number} [options.timeout] - 超时毫秒
// @param {number} [options.interval] - 轮询间隔毫秒
// @returns {Promise<boolean>} 是否在超时前成立
export async function waitFor(predicate, { timeout = 4000, interval = 20 } = {}) {
  // 起点。
  const startedAt = Date.now()
  // 轮询。
  while (Date.now() - startedAt < timeout) {
    // 成立即返回。
    if (predicate()) return true
    // 等一小会儿（真实定时器）。
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  // 超时。
  throw new Error('waitFor 超时：条件在限定时间内未成立')
}

// #stubFetchOk
// 让 fetch 返回 fixture 数据（HomeView 会取 data/*.json 五个文件）。
//
// @param {object} [data] - 数据（缺省 fixture）
// @returns {Function} fetch 替身
export function stubFetchOk(data = buildFixtureData()) {
  // 路径 → 内容 的映射（HomeView 请求的 5 个文件）。
  const files = {
    'age.json': data.age,
    'talents.json': data.talents,
    'events.json': data.events,
    'achievements.json': data.achievements,
    'characters.json': data.characters,
  }
  // 替身。
  const fetchStub = async (url) => {
    // 匹配文件名。
    const name = String(url).split('/').pop()
    // 命中返回 JSON。
    if (name in files) return { ok: true, json: async () => clone(files[name]) }
    // 其它请求（如 AI 代理）：返回空对象，避免抛错。
    return { ok: true, json: async () => ({}) }
  }
  // 注入全局。
  globalThis.fetch = fetchStub
  // 返回。
  return fetchStub
}

// #stubFetchFail
// 让 fetch 失败（验证 HomeView 的 fixture 降级路径）。
//
// @returns {Function} fetch 替身
export function stubFetchFail() {
  // 替身：抛错。
  const fetchStub = async () => {
    throw new Error('network down')
  }
  // 注入。
  globalThis.fetch = fetchStub
  // 返回。
  return fetchStub
}
