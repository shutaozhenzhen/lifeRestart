/**
 * gameStore — 游戏状态管理
 *
 * 用 Pinia 包裹 Life 实例，向组件提供响应式状态：
 *   - propertys：当前六个基础属性（响应式快照）
 *   - life：Life 实例引用
 *   - initialized：是否已初始化
 *
 * 设计：
 *   - Life 是纯 JS 引擎，不感知 Vue。
 *   - gameStore 是 Vue 与引擎之间的桥，把引擎状态映射为响应式。
 *   - 组件通过 store.propertys 实时读取，引擎每次变化后调用 sync() 刷新。
 */

// 导入 Pinia。
import { defineStore } from 'pinia'
// markRaw：Life 实例含 # 私有字段，reactive 代理会破坏私有字段访问（Vue 响应式代理问题）。
import { markRaw } from 'vue'
// 导入 Life 引擎（应用侧唯一构造入口：create-life 负责装配 storage/logger）。
import { createAppLife } from '../life/create-life.js'
// 随机源：mulberry32 种子 RNG + 种子生成/规范化（每局固定种子 → 可复现）。
import { createRng, createSeed, normalizeSeed } from 'game-engine/src/functions/util.js'
// 日志器工厂（前端配置界面创建，注入引擎全链路）。
import { createLogger } from 'game-engine/src/functions/logger.js'
// 日志格式化/报告构建（纯函数，供悬浮窗导出与单测）。
import { formatLogLine, countByLevel, collectLogMeta, buildLogReport } from '../utils/log-report.js'
// Mod 启停状态（报告里带上，便于复现）。
import { loadModsState } from '../utils/mods-state.js'
// Mod 代码执行（网页版运行时；与 CLI 共用引擎内核）。
import { executeModCodes, createAssetRegistry, createSourceAssetReader } from '../utils/mod-runtime.js'
// 钩子总线（`store.init` 没被传总线时**自己建一条**，见下面 init 里的说明）。
import { createHookBus } from 'game-engine/src/mod/gameapi.js'
// 轨迹文本里的受控资源占位符（`{{asset:相对路径}}`；纯函数 + 异步解析）。
import { collectAssetPaths } from '../utils/asset-text.js'
// Mod 界面扩展注册表（2026-10 能力补齐 ③）：`gameAPI.ui.*` 的落点（运行期注册）。
import { useExtensionsStore } from './extensions.js'

// 日志缓冲上限：1000 条在 trace 级下也够覆盖一次完整复现（每条约 100 字节）。
const LOG_BUFFER_LIMIT = 1000

// #loadLogLevel
// 读取日志级别配置（localStorage 键 logLevel，缺省 info）。
function loadLogLevel() {
  // 读取。
  const v = localStorage.getItem('logLevel')
  // 合法级别列表。
  return ['trace', 'debug', 'info', 'warn', 'error'].includes(v) ? v : 'info'
}

// 定义 store。
export const useGameStore = defineStore('game', {
  // 状态。
  state: () => ({
    // Life 实例（初始 null；赋值时经 markRaw 保护 # 私有字段，见 init）。
    life: null,
    // 是否初始化完成。
    initialized: false,
    // 是否已开局（start 已执行）。GameView 挂载时据此判断，避免重复开局。
    started: false,
    // 天赋是否已确认（confirmTalents 已执行 → begin 不再重复触发替换链）。
    talentsConfirmed: false,
    // 当前六个基础属性（响应式）。
    propertys: {
      AGE: 0, CHR: 0, INT: 0, STR: 0, MNY: 0, SPR: 0,
    },
    // 游戏模式（custom 自定义 / celebrity 名人）。
    mode: 'custom',
    // 名人模式：本批候选名人（一次抽 characterPullCount 个，默认 3）。
    characters: [],
    // 名人模式：已选名人（null = 还没选）。
    character: null,
    // 名人模式：名人的**基础属性**（固定值；属性分配页只读展示，玩家点数是额外部分）。
    characterBase: { CHR: 0, INT: 0, STR: 0, MNY: 0 },
    // 名人模式：可额外分配的点数（= 名人天赋带来的点数；默认 20 点已被名人固定属性取代）。
    characterExtraPoints: 0,
    // 名人模式：唯一「我」是否已解锁（连点彩蛋，见 character.js 的时间窗口逻辑）。
    uniqueUnlocked: false,
    // 天赋池（抽取结果）。
    talentPool: [],
    // 已选天赋（ID 数组）。
    selectedTalents: [],
    // 每岁事件/天赋流水（响应式，仅当前这一岁）。
    content: [],
    // 完整人生轨迹：每年一条 { age, isEnd, items }，供轨迹页逐条渲染全部历史。
    // （原实现每年覆盖 content，导致页面上只剩最新一岁。）
    history: [],
    // 生命是否结束（**响应式镜像**）。
    // 为什么需要镜像：Life 实例是 markRaw 的，模板里直接读 life.request('PROPERTY').isEnd()
    // 不是响应式依赖 → computed 会永久缓存首次结果（false），导致死亡后仍继续推进。
    isEnd: false,
    // 当前生命值（同上，响应式镜像）。
    lif: 1,
    // 属性分配（CHR/INT/STR/MNY）。
    allocation: { CHR: 0, INT: 0, STR: 0, MNY: 0 },
    // 分配边界 [min, max]。
    allocLimit: [0, 10],
    // 日志级别（配置界面切换，localStorage 持久化）。
    logLevel: loadLogLevel(),
    // 日志缓冲（界面日志面板显示，最多保留 LOG_BUFFER_LIMIT 条）。
    logBuffer: [],
    // 错误发生序号（每写一条 error 级日志 +1；悬浮窗据此自动展开提醒）。
    errorSeq: 0,
    // 当前数据源描述（主页选原版数据 / fixture 降级时写入，报告里带上）。
    dataSource: '',
    // Mod 运行时信息（这局执行了哪些 Mod 代码、有没有失败；报告里带上）。
    modsRuntime: null,
    // 本局随机种子（mulberry32；页面显示 + 报告带上，同种子可复现同一局）。
    seed: null,
    // 本局使用的原始数据（markRaw，供「同种子复现」重开一局；不参与渲染）。
    rawData: null,
    // 成就达成提示队列（引擎 emit('achievement') 推入；由全局 AchievementToast 渲染）。
    achievementToasts: [],
    // Mod 资源注册表（2026-10 能力补齐 ②）：每局由 executeModCodes 建好，
    // 界面用它把 `{{asset:路径}}` 解析成可显示的 URL（blob URL）。
    // null = 这局没有资源能力（降级：占位符按纯文本显示）。
    assetRegistry: null,
    // 资源 URL 缓存（路径 → URL / Promise；**markRaw 的 Map**，见 init 里的说明）。
    // 只缓存"本局确认能拿到 URL"的路径 —— 缺失的资源不缓存，等 Mod 修好后立刻可见。
    assetUrlCache: null,
    // 资源 URL 解析完成度计数器（Map 不是响应式的，模板靠这个数字触发重渲染）。
    assetUrlTick: 0,
    // 本局的 Mod 装载输入（供 `restartWithSeed` 重建：数据不变，但代码/钩子/资源要重来一遍）。
    modCodes: null,
    // 本局的钩子总线（同上）。
    modHooks: null,
    // 本局的各 Mod require（同上）。
    modRequires: null,
    // 本局的 Mod 文件源（界面侧按路径读资源字节；markRaw）。
    assetSource: null,
    // 本局各 Mod 的**界面桥**（2026-10 能力补齐 ③；markRaw）。
    // 渲染 `{ t: 'action', id }` 按钮时按 id 查"谁注册过这个动作"（`hasAction` / `trigger`）。
    modUiBridges: null,
  }),

  // 计算属性。
  getters: {
    // 已初始化。
    isReady: (state) => state.initialized && state.life !== null,
    // 总可用点数。
    //   custom：默认 20 + 天赋加成；
    //   celebrity：**只有名人的天赋加成** —— 默认那 20 点的位置已经被名人的固定属性占了
    //   （与原版语义一致：名人模式 = 名人属性 + 天赋带来的额外点数）。
    propertyPoints: (state) => {
      // 引擎未就绪。
      if (!state.life) return 0
      // 名人模式（且已选定名人）。
      if (state.mode === 'celebrity' && state.character) return state.characterExtraPoints
      // 自定义模式。
      return state.life.getPropertyPoints()
    },
    // 已分配点数。
    // Mod 声明的额外属性（`manifest.ui.properties`）也要算进去 —— 否则"分配了却不扣点数"。
    allocatedTotal: (state) => Object.values(state.allocation).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0),
    // 剩余点数。
    leftPoints: (state) => {
      // 可用点数（见 propertyPoints）。
      const total = state.mode === 'celebrity' && state.character && state.life
        ? state.characterExtraPoints
        : (state.life ? state.life.getPropertyPoints() : 0)
      // 已分配（含 Mod 声明的额外属性；非有限值按 0 算，防 NaN 一路传下去）。
      const used = Object.values(state.allocation).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0)
      // 剩余。
      return total - used
    },
    // 是否名人模式。
    isCelebrity: (state) => state.mode === 'celebrity',
    // 属性分配页要展示的「基础值 + 额外分配 = 合计」。
    finalProperties: (state) => ({
      CHR: (state.characterBase.CHR || 0) + state.allocation.CHR,
      INT: (state.characterBase.INT || 0) + state.allocation.INT,
      STR: (state.characterBase.STR || 0) + state.allocation.STR,
      MNY: (state.characterBase.MNY || 0) + state.allocation.MNY,
    }),
    // 错误条数（悬浮窗角标；按缓冲内容实时统计）。
    errorCount: (state) => countByLevel(state.logBuffer).error,
    // 警告条数（同上）。
    warnCount: (state) => countByLevel(state.logBuffer).warn,
    // 本局有没有可用的 Mod 资源能力（界面据此决定占位符能不能渲染成 <img>）。
    assetsAvailable: (state) => Boolean(state.assetRegistry?.available),
  },

  // 动作。
  actions: {
    // 初始化引擎。
    // @param {object} data - 游戏数据
    // @param {object} [options]
    // @param {number|string|null} [options.seed] - 本局随机种子（缺省自动生成；给值则复现）
    // @param {object} [options.hooks] - Mod 钩子总线（网页版由 mod-runtime 创建）
    // @param {Array<{name: string, code: string}>} [options.modCodes] - Mod 代码（Life 建好后执行）
    // @param {Record<string, Function>} [options.modRequires] - 每个 Mod 的 require
    //   （运行时模块：依赖随包分发，阶段一已由 mod-runtime 异步加载好）
    // @param {object} [options.assetReader] - Mod 资源读取能力（阶段一产出的惰性读取器）
    // @param {object} [options.assetSource] - Mod 文件源（界面侧按路径读资源字节用）
    // @param {object} [options.assetUrlApi] - 注入的 URL 原语（缺省全局；测试用）
    async init(data, { seed, hooks, modCodes, modRequires, assetReader, assetSource, assetUrlApi } = {}) {
      // 重置单局状态：从主页重新开始时，不能残留上一局的进度标记与选择。
      this.started = false
      this.talentsConfirmed = false
      this.talentPool = []
      this.selectedTalents = []
      // 名人模式的中间态也一起清（换局/换模式不能带着上一位名人的属性）。
      this.characters = []
      this.character = null
      this.characterBase = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
      this.characterExtraPoints = 0
      this.uniqueUnlocked = false
      this.clearTrace()
      // 上一局的成就提示也不该带到新一局。
      this.clearAchievementToasts()
      this.isEnd = false
      this.lif = 1
      this.allocation = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
      // 创建日志器：级别从配置读取，输出到浏览器 console + 界面缓冲。
      // 引擎内核（Life/属性/天赋/事件/成就/角色/数据加载/Mod 钩子）全部日志经此汇入。
      const logger = createLogger({
        level: this.logLevel,
        sink: {
          trace: (m) => this.pushLog('trace', m),
          debug: (m) => this.pushLog('debug', m),
          info: (m) => this.pushLog('info', m),
          warn: (m) => this.pushLog('warn', m),
          error: (m) => this.pushLog('error', m),
        },
      })
      // 本局随机种子：显式指定优先（复现），否则随机生成一个并**记录下来供页面显示**。
      // 之后所有随机（天赋抽卡、事件抽取、RDM 效果）都走 createRng(seed)，
      // 因此"同种子 + 同操作顺序 = 同一局人生"。
      this.seed = normalizeSeed(seed) ?? createSeed()
      // ⚠️ **钩子总线必须在这里收敛成一条**（2026-10 修的真实缺陷）：
      //   以前直接把入参 `hooks` 往下传。生产路径（HomeView → loadModBundle）总会给，
      //   但**只要有一处调用方不传**（测试、未来的其它入口），就会出这种事：
      //     · `createGameAPI` 在 hooks 为 undefined 时**自建一条总线** → Mod 的钩子挂在 A 上；
      //     · Life 在 hooks 为 undefined 时**另建一条总线** → `life.next()` 在 B 上 emitSync；
      //   结果是 Mod 代码执行"成功"、`hooks.list()` 里也有它，**但钩子永远不会被触发**
      //   （完全静默）。收敛成一条之后，"谁注册的、谁触发"必然对得上。
      const hookBus = hooks || createHookBus()
      // 创建 Life 实例：经 create-life 统一装配（数据 + 日志 + **持久化 storage** + 种子随机源 + 事件总线）。
      // emit：引擎在成就达成时广播 'achievement'（带成就对象），这里转成界面提示。
      // markRaw 防止被 reactive 代理（Life 含 # 私有字段，被代理会崩）。
      // 生命周期钩子 onBeforeLife（Phase A 语义：这个点**可以异步**，Mod 能在这里等后端 / 预取数据）。
      // 位置在建 Life 之前 —— 钩子总线此时已由 loadModBundle 建好并传入。
      await hookBus.emit('onBeforeLife', { data }, logger)
      this.life = markRaw(createAppLife({
        // 数据。
        data,
        // 日志。
        logger,
        // 随机源（本局种子）。
        random: createRng(this.seed),
        // 事件总线。
        emit: (tag, payload) => this.handleEngineEvent(tag, payload),
        // Mod 钩子总线（Mod 里 gameAPI.on 注册的钩子由它触发）。
        hooks: hookBus,
      }))
      // 保留原始数据引用（markRaw 保护，避免 Vue 深度代理 3.5MB 数据），供"同种子复现"重开一局。
      this.rawData = markRaw(data)
      // 初始化。
      await this.life.initial()
      // 配置。
      this.life.config()
      // 执行 Mod 代码：**必须在 Life 建好之后**——Mod 可注册新属性/读写参数/注册钩子，
      // 而 gameAPI.param 需要 Life 的参数注册表（浏览器侧就是靠这一步把 Mod 支持接上的）。
      if (Array.isArray(modCodes) && modCodes.length > 0) {
        // 资源注册表（2026-10 能力补齐 ②）：**换局时必须先释放上一局的 blob URL**，
        // 否则换几十局之后内存里堆着一堆没人引用的图片（每个 blob URL 都把字节钉住）。
        if (this.assetRegistry?.dispose) this.assetRegistry.dispose()
        // 资源能力：优先用调用方给的读取器，否则用文件源现造一个（`restartWithSeed` 走这条）。
        const reader = assetReader || (assetSource ? createSourceAssetReader(assetSource) : null)
        // 本局的资源注册表（界面解析 `{{asset:...}}` 与 Mod 代码操作**同一份**桥）。
        const assetRegistry = createAssetRegistry({ log: logger })
        // 界面扩展注册表（2026-10 能力补齐 ③）：**运行期注册**的落点。
        // 每次开局先清掉上一局的运行期注册（静态声明 manifest.ui 由 App.vue 的 load() 装载，保留）。
        const extStore = useExtensionsStore()
        extStore.beginRuntime(logger)
        // 执行（异常隔离：单个 Mod 失败不影响游戏）。
        const { executed, errors, uiBridges } = executeModCodes({
          // 代码。
          codes: modCodes,
          // 钩子总线（与 Life **同一条**：见上面 hookBus 的说明）。
          hooks: hookBus,
          // Life（提供 params / property / storage）。
          life: this.life,
          // 数据。
          data,
          // 日志。
          log: logger,
          // 运行时模块。
          requires: modRequires,
          // 资源读取能力（惰性；没有就是降级桥）。
          assetReader: reader,
          // 注册表（与界面共用）。
          assetRegistry,
          // URL 原语（缺省全局；测试注入假实现才能测到 blob URL 的缓存与释放）。
          assetUrlApi: assetUrlApi || null,
          // 界面注册表（`gameAPI.ui.*` → stores/extensions.js 的 append；
          // `gameAPI.ui.addStatistic` → Life 的统计登记，让 Mod 统计键真的产生）。
          uiSink: extStore.uiSink({ life: this.life }),
        })
        // 记下注册表 + 清空 URL 缓存（旧缓存指向上一局的 blob）。
        // ⚠️ Map 必须 markRaw：Vue 会深度代理 Map 的**值**，而我们往里面存的是 Promise
        //    （代理 Promise 会让 `await` 拿到一个被包过的 thenable，行为不可预期）。
        this.assetRegistry = markRaw(assetRegistry)
        this.assetUrlCache = markRaw(new Map())
        // 各 Mod 的界面桥（动作按钮的查找源；同样 markRaw）。
        this.modUiBridges = markRaw(uiBridges || {})
        // 记运行信息（日志报告里能看到"这局跑了哪些 Mod"）。
        this.modsRuntime = { loaded: executed, errors }
        // 日志。
        this.pushLog('info', `[UI][mods] 已执行 Mod 代码：${executed.join(', ') || '（无）'}${errors.length ? `（失败 ${errors.length} 个）` : ''}`)
        // 失败逐条记（便于按报告排障）。
        errors.forEach((e) => this.pushLog('warn', `[UI][mods] ${e}`))
        // 资源能力可用时提示一句（Mod 作者排障时能立刻确认"我的包里有资源能力"）。
        if (assetRegistry.available) {
          // 列出各 Mod 的资源数（**惰性读清单**，量级很小）。
          try {
            // 读清单。
            const list = await assetRegistry.list()
            // 日志。
            this.pushLog('debug', `[UI][mods] Mod 资源可用：${list.length} 个（${list.slice(0, 8).map((x) => x.path).join(', ')}${list.length > 8 ? ', …' : ''}）`)
          } catch {
            // 读清单失败不影响开局（真正的错误会在用的时候出声）。
          }
        }
      }
      // 生命周期钩子 onAfterLife（Life 已就绪 + Mod 代码已执行完）：适合做「开局后一次性」的异步准备。
      await hookBus.emit('onAfterLife', { life: this.life, data }, logger)
      // 标记完成。
      this.initialized = true
      // 本局使用的资源文件源（`restartWithSeed` 重开一局时还要用它重建资源能力）。
      this.assetSource = assetSource ? markRaw(assetSource) : null
      // 记下本局的 Mod 装载输入（重开一局要用同一批代码/钩子/依赖重建）。
      this.modCodes = Array.isArray(modCodes) ? modCodes : null
      this.modHooks = hookBus
      this.modRequires = modRequires || null
      // 同步属性。
      this.sync()
    },

    // 用指定种子重新开一局（复现入口：总结页「复现此局」按钮调用）。
    // 数据沿用上一局的引用，因此不需要重新加载。
    //
    // @param {number|string} seed - 种子
    // @returns {Promise<boolean>} 是否成功（无数据时 false）
    async restartWithSeed(seed) {
      // 没有数据（例如直接刷新到总结页）→ 交给调用方引导回主页。
      if (!this.rawData) return false
      // 复用同一份数据重新初始化（种子相同 → 随机序列相同）。
      // 资源能力也要带上：不带的话复现的一局里 `{{asset:...}}` 全都会降级成文本。
      await this.init(this.rawData, {
        // 种子。
        seed,
        // Mod 代码（上一局加载的，重开要重新执行一遍）。
        modCodes: this.modCodes,
        // 钩子总线。
        hooks: this.modHooks,
        // 运行时模块。
        modRequires: this.modRequires,
        // 资源读取能力（上一局的文件源现造一个，惰性）。
        assetReader: this.assetSource ? createSourceAssetReader(this.assetSource) : null,
        // 资源文件源（界面侧解析占位符用）。
        assetSource: this.assetSource,
      })
      // 成功。
      return true
    },

    // #handleEngineEvent
    // 引擎业务事件 → 界面行为。
    //
    // @param {string} tag - 事件名
    // @param {*} payload - 事件负载
    // @returns {void}
    handleEngineEvent(tag, payload) {
      // 成就达成 → 弹提示（+ 记日志，便于日志报告里核对）。
      if (tag === 'achievement') {
        // 推入提示队列。
        this.pushAchievementToast(payload)
        // 日志。
        this.pushLog('info', `[UI][achievement] 达成成就：${payload?.name || payload?.id || '未知'}`)
      }
    },

    // #pushAchievementToast
    // 推入一条成就提示（同一条成就不重复堆叠；队列上限 3 条，超出丢最旧）。
    //
    // @param {object} achievement - 成就对象（引擎 achievement.get(id) 的副本）
    // @returns {void}
    pushAchievementToast(achievement) {
      // 无效负载忽略。
      if (!achievement || !achievement.id) return
      // 已在队列里 → 只刷新（顶到最新），不重复堆叠。
      const existing = this.achievementToasts.findIndex((t) => t.id === achievement.id)
      // 已存在则移除旧的那条。
      if (existing !== -1) this.achievementToasts.splice(existing, 1)
      // 推入（补上时间戳，供界面显示/测试断言）。
      this.achievementToasts.push({
        // 成就 ID。
        id: achievement.id,
        // 名称。
        name: achievement.name || achievement.id,
        // 描述。
        description: achievement.description || '',
        // 星级。
        grade: achievement.grade ?? 0,
        // 达成时间。
        achievedAt: Date.now(),
      })
      // 队列上限：最多保留 3 条（避免刷屏）。
      if (this.achievementToasts.length > 3) this.achievementToasts.splice(0, this.achievementToasts.length - 3)
    },

    // #dismissAchievementToast
    // 关闭一条成就提示（用户点击或超时自动调用）。
    //
    // @param {string} id - 成就 ID
    // @returns {void}
    dismissAchievementToast(id) {
      // 过滤掉。
      this.achievementToasts = this.achievementToasts.filter((t) => t.id !== id)
    },

    // #clearAchievementToasts
    // 清空提示队列（重开一局时调用）。
    //
    // @returns {void}
    clearAchievementToasts() {
      // 清空。
      this.achievementToasts = []
    },

    // 从引擎同步属性到响应式状态。
    sync() {      // 引擎不可用则跳过。
      if (!this.life) return
      // 读取六个属性。
      const p = this.life.propertys
      // 写入响应式状态。
      this.propertys = { ...p }
      // 生命值镜像（引擎实例是 markRaw，模板直接读引擎内部不会触发更新）。
      const lif = this.life.request('PROPERTY').get('LIF')
      // 非数字时回退 1（开局前 LIF 可能尚未建立）。
      this.lif = typeof lif === 'number' ? lif : 1
      // 结束标志镜像（LIF < 1）——自动播放据此停止、按钮据此禁用。
      this.isEnd = this.life.request('PROPERTY').isEnd()
    },

    // 开始一局。
    start(allocation) {
      // 需要已开局（remake 在页面流程中调用）。
      this.life.start(allocation)
      // 同步属性。
      this.sync()
    },

    // 推进一年。
    next() {
      // 引擎推进。
      const result = this.life.next()
      // 同步属性。
      this.sync()
      // 记录当前这岁流水（供需要"最新一岁"的调用方）。
      this.content = result.content
      // 结束标志（引擎返回值，与 sync 的镜像一致；死亡那一年立刻置位 → 自动播放停止）。
      this.isEnd = result.isEnd
      // 累积到完整轨迹：条目做浅拷贝，避免后续被引擎就地修改（钩子可能回写 content）。
      this.history.push({
        // 年龄。
        age: result.age,
        // 该岁是否结束。
        isEnd: result.isEnd,
        // 条目快照。
        items: (result.content || []).map((c) => ({ ...c })),
      })
      // 轨迹里的资源占位符（`{{asset:路径}}`）解析成 URL（异步；不阻塞逐年推进）。
      this.trackAssets()
      // 返回结果（供组件渲染事件卡片）。
      return result
    },

    // #trackAssets
    // 把轨迹文本里的 `{{asset:相对路径}}` 解析成可显示的 URL（2026-10 能力补齐 ②）。
    //
    // 为什么在这里做：轨迹条目是**同步**产生的（`life.next()` 是同步函数），而资源 URL
    // 必须异步拿（blob URL 要读字节）。所以推进一年后异步解析一批，界面拿到就渲染 `<img>`；
    // 还没解析完 / 解析不到 → 占位符按纯文本显示（绝不阻塞、绝不报错）。
    //
    // @returns {void}
    trackAssets() {
      // 没有资源能力 → 什么都不用做（界面会把占位符当纯文本）。
      if (!this.assetRegistry) return
      // 缓存（markRaw 的 Map；缺了就当没有）。
      const cache = this.assetUrlCache || (this.assetUrlCache = markRaw(new Map()))
      // 收集本局轨迹里出现过的全部资源路径。
      const paths = collectAssetPaths(this.history)
      // 逐个（已在缓存里的跳过：Map 里存的是 URL 或"解析中"的 Promise）。
      for (const path of paths) {
        // 已有（URL 或进行中的 Promise）→ 跳过。
        if (cache.has(path)) continue
        // 起一次解析（只读这一个文件）。
        const task = (async () => {
          // 问注册表要 URL（跨 Mod 按路径查找；读不到给 null）。
          const url = await this.assetRegistry.url(path)
          // 读到了才进缓存（**读不到不入缓存**：Mod 修好后重新推进一年就能看见）。
          if (url) {
            // 存 URL。
            cache.set(path, url)
            // 触发模板重渲染（Map 本身不是响应式的）。
            this.assetUrlTick++
            // 日志（trace 级：逐年轨迹里出现资源是很频繁的事，别刷屏）。
            this.pushLog('trace', `[UI][asset] ${path} → ${String(url).slice(0, 48)}`)
          }
        })()
        // 先存 Promise（避免同一路径并发解析多次）。
        cache.set(path, task)
        // 失败不影响游戏（静默降级为纯文本）。
        task.catch(() => {})
      }
    },

    // #assetUrl
    // 同步取一个资源路径的 URL（给模板用）。
    //
    // 语义：解析完成 → URL 字符串；解析中/读不到/无资源能力 → `null`（调用方降级成纯文本）。
    // 这一步**不做 IO** —— 字节的读取发生在 `trackAssets()` 里（推进一年后异步做一次）。
    //
    // @param {string} path - 资源相对路径
    // @returns {string|null} URL 或 null
    assetUrl(path) {
      // 缓存里找。
      const hit = this.assetUrlCache?.get(path)
      // 字符串才是 URL（Promise = 解析中；undefined = 没解析到）。
      return typeof hit === 'string' ? hit : null
    },

    // 设置游戏模式。
    // 换模式要清掉上一模式的中间态：否则「名人模式选好名人 → 切回自定义」会带着
    // 名人的基础属性开局（propertyPoints 与 begin 的合并都以 character 为准）。
    setMode(mode) {
      // 记录模式。
      this.mode = mode
      // 清中间态。
      this.characters = []
      this.character = null
      this.characterBase = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
      this.characterExtraPoints = 0
      this.uniqueUnlocked = false
      this.talentPool = []
      this.selectedTalents = []
      this.talentsConfirmed = false
      this.allocation = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
    },

    // #drawCharacters
    // 抽取名人候选（名人模式）。
    //
    // 引擎侧：`characterRandom()` 按权重抽 `characterPullCount` 个（带保底），
    // 并把名人的天赋 ID 换成天赋对象；同时返回唯一「我」（连点彩蛋解锁时非 null）。
    //
    // @returns {{normal: Array<object>, unique: object|null}} 候选与唯一「我」
    drawCharacters() {
      // 引擎未初始化保护（刷新后直进页面的双保险）。
      if (!this.life) {
        // 错误日志（常显进面板）。
        this.pushLog('error', '[UI][game] 引擎未初始化，无法抽取名人（应回主页重新开始）')
        // 空结果。
        return { normal: [], unique: null }
      }
      // 抽一批。
      const result = this.life.characterRandom()
      // 过滤掉天赋缺失的条目（Mod 数据不完整时，页面会渲染出 undefined 卡片）。
      this.characters = (result.normal || []).filter(c => c && Array.isArray(c.talent) && c.talent.every(Boolean))
      // 唯一「我」。
      this.uniqueUnlocked = Boolean(result.unique)
      // 丢弃条目的告警（不静默）。
      const dropped = (result.normal || []).length - this.characters.length
      if (dropped > 0) this.pushLog('warn', `[UI][character] ${dropped} 位名人的天赋数据缺失，已跳过`)
      // 页面日志。
      this.pushLog('debug', `[UI][character] 抽取名人候选 ${this.characters.length} 位：${this.characters.map(c => c.name).join(' / ') || '（无）'}${this.uniqueUnlocked ? '（唯一「我」已解锁）' : ''}`)
      // 返回。
      return { normal: this.characters, unique: result.unique }
    },

    // #applyCharacter
    // 写入一位名人：基础属性 + 已选天赋 + 额外点数（内部动作，chooseCharacter/chooseUnique 共用）。
    //
    // @param {object} chara - { id, name, property, talent: Array<天赋对象> }
    // @returns {void}
    applyCharacter(chara) {
      // 记录名人本体（页面顶部显示"名人：曹操"）。
      // 天赋保留**完整对象**（description/grade/effect/status/exclusive/replacement）——
      // 名人页与属性页都要显示天赋详情，只留 {id,name} 就没得显示了。
      this.character = {
        id: chara.id,
        name: chara.name,
        property: { ...chara.property },
        talent: chara.talent.map(t => ({ ...t })),
      }
      // 基础属性：数据里是字符串，统一转数字（NaN 兜底 0）。
      const toNum = (v) => {
        // 转数字。
        const n = Number(v)
        // 非法值。
        return Number.isFinite(n) ? n : 0
      }
      // 四维。
      this.characterBase = {
        CHR: toNum(chara.property?.CHR),
        INT: toNum(chara.property?.INT),
        STR: toNum(chara.property?.STR),
        MNY: toNum(chara.property?.MNY),
      }
      // 名人的天赋直接作为"已选天赋"（名人模式不抽卡）。
      this.selectedTalents = chara.talent.map(t => String(t.id))
      // 额外点数 = 名人天赋带来的加成：先清空天赋跑一次拿到基线（= 默认点数），
      // 再写入名人天赋 —— 两者相减就是"天赋给的点数"（默认点数已被名人属性取代）。
      this.life.remake([])
      // 基线（此时 TLT 为空 → 加成为 0）。
      const baseline = this.life.getPropertyPoints()
      // 写入名人天赋（触发替换链：名人自带的天赋也可能被替换/互斥）。
      this.life.remake([...this.selectedTalents])
      // 额外点数。
      this.characterExtraPoints = this.life.getPropertyPoints() - baseline
      // 天赋已确认（begin 不再重复跑替换链，避免重复消耗随机源）。
      this.talentsConfirmed = true
      // 分配从 0 开始（玩家分的是"额外点数"）。
      this.allocation = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
      // 页面日志。
      this.pushLog('info', `[UI][character] 选定名人：${chara.name}（基础属性 ${this.characterBase.CHR}/${this.characterBase.INT}/${this.characterBase.STR}/${this.characterBase.MNY}，天赋 ${this.selectedTalents.length} 个，额外点数 ${this.characterExtraPoints}）`)
    },

    // #chooseCharacter
    // 选定一位候选名人。
    //
    // @param {string|number} id - 名人 ID
    // @returns {{ok: boolean, message?: string}} 结果
    chooseCharacter(id) {
      // 引擎保护。
      if (!this.life) return { ok: false, message: '引擎未初始化' }
      // 找候选（ID 字符串比较：数据里可能是数字键）。
      const chara = this.characters.find(c => String(c.id) === String(id))
      // 不在候选里。
      if (!chara) return { ok: false, message: '这位名人不在本批候选里' }
      // 应用。
      this.applyCharacter(chara)
      // 成功。
      return { ok: true }
    },

    // #chooseUnique
    // 选定唯一「我」（连点彩蛋；`drawCharacters()` 连点若干次后解锁）。
    //
    // @returns {{ok: boolean, message?: string}} 结果
    chooseUnique() {
      // 引擎保护。
      if (!this.life) return { ok: false, message: '引擎未初始化' }
      // 生成（引擎侧幂等：已生成过就直接返回存档里的那一个）。
      const unique = this.life.generateUnique()
      // 未解锁。
      if (!unique) return { ok: false, message: '唯一「我」还没解锁（多连点几次「换一批」）' }
      // 天赋给的是 ID 列表 → 换成对象（与普通名人同形）。
      const talents = (unique.talent || []).map(id => this.rawData?.talents?.[id]).filter(Boolean)
      // 应用。
      this.applyCharacter({ id: 'unique', name: '我', property: unique.property, talent: talents })
      // 成功。
      return { ok: true }
    },

    // 抽取天赋池。
    drawTalents() {
      // 引擎未初始化保护（刷新后直进页面的双保险）。
      if (!this.life) {
        // 错误日志（常显进面板）。
        this.pushLog('error', '[UI][game] 引擎未初始化，无法抽取天赋（应回主页重新开始）')
        // 空池返回。
        return
      }
      // 调用引擎抽取（trace 引擎日志随级别过滤）。
      this.talentPool = this.life.talentRandom()
      // 页面日志：池规模。
      this.pushLog('debug', `[UI][game] 抽取天赋池 ${this.talentPool.length} 个`)
    },

    // 选中一个天赋（互斥校验 + 限 3 个）。
    // @param {number} index - 天赋池索引
    // @returns {{ok: boolean, message?: string}} 结果
    selectTalent(index) {
      // 池中天赋。
      const talent = this.talentPool[index]
      // 无效索引。
      if (!talent) return { ok: false, message: '无效索引' }
      // 已选则取消。
      if (this.selectedTalents.includes(talent.id)) {
        // 移除。
        this.selectedTalents = this.selectedTalents.filter(id => id !== talent.id)
        // 成功。
        return { ok: true }
      }
      // 限 3 个。
      if (this.selectedTalents.length >= this.life.talentSelectLimit) {
        return { ok: false, message: `最多选择 ${this.life.talentSelectLimit} 个天赋` }
      }
      // 互斥校验。
      const conflict = this.life.exclude(this.selectedTalents, talent.id)
      // 有冲突。
      if (conflict !== null) {
        return { ok: false, message: `与 ${conflict} 互斥` }
      }
      // 加入选中。
      this.selectedTalents.push(talent.id)
      // 成功。
      return { ok: true }
    },

    // 确认天赋（进入属性分配页之前必须调用）。
    //
    // 为什么必须在这里而不是开局时：属性分配页要显示「默认点数 + 天赋加成」，
    // 即读取 life.getPropertyPoints()，而该值来自引擎的 #initialData.TLT；
    // 原实现只在 begin() 里 remake，属性页先渲染 → #initialData 未建立 → 崩溃。
    //
    // 重复调用安全：remake 内部对入参做深拷贝后重建初始数据，替换链不会累积污染。
    //
    // @returns {number} 确认后的可用点数（引擎未初始化时返回 0）
    confirmTalents() {
      // 引擎未初始化保护（刷新后直进页面的双保险）。
      if (!this.life) {
        // 错误日志（常显进面板）。
        this.pushLog('error', '[UI][game] 引擎未初始化，无法确认天赋（应回主页重新开始）')
        // 无点数。
        return 0
      }
      // 触发替换链并把已选天赋写入初始数据。
      this.life.remake([...this.selectedTalents])
      // 标记已确认（begin 据此避免重复执行）。
      this.talentsConfirmed = true
      // 可用点数（默认 + 天赋加成）。
      const points = this.life.getPropertyPoints()
      // 页面日志：确认结果。
      this.pushLog('info', `[UI][talent] 已确认天赋 ${this.selectedTalents.length} 个，可用点数 ${points}`)
      // 返回，供调用方/测试断言。
      return points
    },

    // 开局（应用分配属性 + 进入人生轨迹）。
    // @param {object} allocation - 属性分配
    begin(allocation = {}) {
      // 引擎未初始化保护。
      if (!this.life) {
        // 错误日志（常显进面板）。
        this.pushLog('error', '[UI][game] 引擎未初始化，无法开局（应回主页重新开始）')
        // 中断。
        return
      }
      // 天赋未确认则补做一次（替换链只跑一次，避免重复消耗随机源）。
      if (!this.talentsConfirmed) this.confirmTalents()
      // 名人模式：名人的固定属性是基底，玩家分配的是"额外点数"叠加在上面。
      // （自定义模式：分配值就是最终值。）
      const finalAllocation = this.character
        ? {
            CHR: (this.characterBase.CHR || 0) + (allocation.CHR || 0),
            INT: (this.characterBase.INT || 0) + (allocation.INT || 0),
            STR: (this.characterBase.STR || 0) + (allocation.STR || 0),
            MNY: (this.characterBase.MNY || 0) + (allocation.MNY || 0),
          }
        : allocation
      // 开局（写入分配属性 + 触发初始成就）。
      this.life.start(finalAllocation)
      // 名人模式：把最终属性也记进日志（总结页/报告里能看出"名人的底子"）。
      if (this.character) this.pushLog('info', `[UI][character] 开局属性（名人 ${this.character.name} 基础 + 额外）：${JSON.stringify(finalAllocation)}`)
      // 标记已开局（GameView 挂载时据此避免重复开局）。
      this.started = true
      // 清空轨迹（新的一局）。
      this.clearTrace()
      // 同步。
      this.sync()
    },

    // 清空人生轨迹（开局/重开/回主页时调用）。
    // @returns {void}
    clearTrace() {
      // 当前一岁流水。
      this.content = []
      // 完整轨迹。
      this.history = []
    },

    // 推进一年，并回答「还能不能继续」（自动播放/手动按钮共用的守卫）。
    //
    // 把这条规则放在 store 而不是组件里：视图只负责渲染，
    // 「结束后不再推进」这条约束就可以被单测直接钉住（曾出现死亡后仍继续推进）。
    //
    // @returns {boolean} 本次推进后是否仍可继续（已结束/未初始化 → false，且不推进）
    advanceYear() {
      // 未初始化或已结束：不推进，返回 false。
      if (!this.life || this.isEnd) return false
      // 推进一年。
      this.next()
      // 结束后返回 false（自动播放据此停止）。
      return !this.isEnd
    },

    // 调整单个属性分配。
    // @param {string} key - 属性键（CHR/INT/STR/MNY）
    // @param {number} delta - 增量（±1）
    // @returns {{ok: boolean, message?: string}} 结果
    adjustAllocation(key, delta) {
      // 计算新值。
      // ⚠️ 键可能不属于内置四项：Mod 通过 `manifest.ui.properties` 声明的**额外可分配属性**
      //    （2026-10 能力补齐 ③）走的是同一个 store。`this.allocation[key]` 为 undefined 时
      //    必须先归一成 0，否则 `undefined + 1` = NaN 会一路写进开局分配。
      const cur = Number.isFinite(this.allocation[key]) ? this.allocation[key] : 0
      const newValue = cur + delta
      // 单属性边界 [0, max]。
      const [, max] = this.allocLimit
      // 超出单属性上限。
      if (newValue < 0 || newValue > max) return { ok: false, message: `单属性范围 0-${max}` }
      // 剩余点数不足。
      if (this.leftPoints - delta < 0) return { ok: false, message: '点数不足' }
      // 更新分配。
      this.allocation[key] = newValue
      // 成功。
      return { ok: true }
    },

    // 随机分配全部点数。
    randomAllocate() {
      // 可用点数。
      let t = this.propertyPoints
      // 每项剩余可加空间（从上限倒扣）。
      const [, max] = this.allocLimit
      // 四项初始为剩余空间。
      const remain = new Array(4).fill(max)
      // 逐点分配。
      while (t > 0) {
        // 随机子步长（1 到 min(t, max)）。
        const sub = Math.round(Math.random() * (Math.min(t, max) - 1)) + 1
        // 尝试随机选择一项。
        while (true) {
          // 随机项。
          const select = Math.floor(Math.random() * 4) % 4
          // 该项剩余空间不足则重选。
          if (remain[select] - sub < 0) continue
          // 扣减空间。
          remain[select] -= sub
          // 扣减点数。
          t -= sub
          // 本子步完成。
          break
        }
      }
      // 写入四项分配（上限 - 剩余 = 已分配）。
      const keys = ['CHR', 'INT', 'STR', 'MNY']
      // 逐项写入。
      keys.forEach((k, i) => { this.allocation[k] = max - remain[i] })
      // 成功。
      return { ok: true }
    },

    // 重置分配。
    resetAllocation() {
      // 全部归零。
      this.allocation = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
    },

    // 切换日志级别：全链路实时生效（引擎自身 + 全部子模块日志器）并持久化。
    // @param {string} level - trace/debug/info/warn/error
    setLogLevel(level) {
      // 更新状态。
      this.logLevel = level
      // 引擎已创建则同步切换（Life.setLogLevel 遍历各子模块日志器）。
      if (this.life) this.life.setLogLevel(level)
      // 持久化。
      localStorage.setItem('logLevel', level)
      // 缓冲提示。
      this.pushLog('info', `[配置] 日志级别切换为 ${level}`)
    },

    // 收集日志到缓冲（logger sink 回调：级别过滤已在 logger 内完成）。
    // @param {string} level - 级别
    // @param {string} msg - 格式化消息
    pushLog(level, msg) {
      // 行文本（带时间戳：导出的报告要能看出问题发生顺序）。
      const line = formatLogLine(level, msg)
      // 缓冲。
      this.logBuffer.push(line)
      // 超限截断（保留最新）。
      if (this.logBuffer.length > LOG_BUFFER_LIMIT) this.logBuffer.splice(0, this.logBuffer.length - LOG_BUFFER_LIMIT)
      // error 级：递增序号（悬浮窗监听它以自动展开，让用户第一时间能导出）。
      if (level === 'error') this.errorSeq++
      // 同步到浏览器 console。
      console.log(line)
    },

    // 构建可导出的日志报告（悬浮窗「复制 / 下载」用）。
    // 除日志外还带上路由、UA、视口、游戏与 Mod 状态——报告可直接贴进 issue。
    // @returns {string} 报告文本
    logReport() {
      // 环境信息（Node 环境无 window，自动降级为 null）。
      const env = collectLogMeta({
        location: globalThis.location,
        navigatorLike: globalThis.navigator,
        screenLike: globalThis.screen,
        devicePixelRatio: globalThis.devicePixelRatio,
      })
      // Mod 启停状态（读 localStorage，失败不影响报告生成）。
      let mods = null
      try {
        // 持久化状态。
        const state = loadModsState()
        // 摘要文本。
        const pairs = Object.entries(state.enabled || {}).map(([name, on]) => `${name}=${on ? 'on' : 'off'}`)
        // 有内容才用。
        mods = pairs.length > 0 ? pairs.join(', ') : '（无记录）'
      } catch {
        // 读不到就留空（报告头部显示「未知」）。
        mods = null
      }
      // 游戏状态摘要。
      const game =
        `initialized=${this.initialized} started=${this.started} mode=${this.mode} ` +
        `life=${this.life ? '已创建' : '未创建'} propertys=${JSON.stringify(this.propertys)} ` +
        `allocation=${JSON.stringify(this.allocation)}`
      // 组装报告。
      return buildLogReport({
        // 当前缓冲（已是「最旧 → 最新」顺序）。
        logs: this.logBuffer,
        // 头部信息（seed：报告直接可复现，见 README「随机种子」）。
        meta: { level: this.logLevel, ...env, game, mods, seed: this.seed, dataSource: this.dataSource || null },
      })
    },

    // 清空日志缓冲。
    clearLog() {
      // 清空。
      this.logBuffer = []
    },
  },
})
