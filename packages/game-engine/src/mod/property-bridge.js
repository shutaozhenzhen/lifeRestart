/**
 * property-bridge — `gameAPI.property` 的**真实**实现（Mod ↔ 游戏属性系统之间的桥）
 *
 * 背景（2026-10 能力补齐）：
 *   原先 `gameAPI.property.get/set` 读写的是数据对象上的一个自定义键 `data.properties`，
 *   全引擎没有任何一处读写它 —— 也就是 `property.set('CHR', 99)` **不会**改游戏里的颜值，
 *   `property.get('CHR')` 恒为 `undefined`。那是当时的能力边界（文档里明写"它不是游戏属性系统"）。
 *   现在补成真的：桥把调用转给 Life 的 Property 模块，并统一打上 `source: 'mod'`，
 *   于是 Mod 既能**改**真实属性，也能通过 `propertyChange` 钩子**观察**真实属性变化。
 *
 * 为什么做成"桥"而不是把 Property 模块直接交给 Mod：
 *   1. **来源标记**：引擎内部的变更标 `source: 'engine'`，Mod 自己造成的标 `'mod'` ——
 *      观察者可以据此过滤掉自己触发的变化（否则一个"每年给 CHR +1"的 Mod 会被自己的通知刷屏）。
 *   2. **作用面收窄**：Mod 拿到的是 `{ available, get, set, change, effect, all, types }`，
 *      而不是 `restart` / `initial` / `config` 这些**不该由 Mod 碰**的内部方法。
 *   3. **降级明确**：宿主没有游戏属性系统时（例如 `mod.cli.js` 这种"只看 Mod 目录"的检查器），
 *      `available` 为 `false`，且调用给出可读错误，而不是静默写进一个没人读的对象里。
 *
 * ⚠️ 时序约束（写 Mod 的人必须知道）：桥要求 **Life 已经建好**。浏览器侧满足（code.js 在
 *    `life.initial()` 之后执行）；CLI 侧历史上 code.js 跑在 Life 构造**之前**（那时拿到的是
 *    降级版）—— 见 `_阅读计划_实现逻辑.md` 里 CLI 时序那一节。
 */

// #createPropertyBridge
// 用 Life 的属性模块造一个 Mod 可用的属性 API。
//
// @param {object} life - Life 实例（需要 `life.property`；也可直接传 Property 模块）
// @returns {object} 属性桥
export function createPropertyBridge(life) {
  // 属性模块（Life 本体或直接给模块都支持，测试里两种都用得上）。
  const property = life && life.property ? life.property : life
  // 没拿到 → 降级桥（available=false，调用给可读错误）。
  if (!property || typeof property.get !== 'function') return createUnavailablePropertyBridge()

  // 返回桥。
  return {
    // 是否真的连着游戏属性系统（Mod 应当先判断它）。
    available: true,

    // #get
    // 读属性（含派生/累计/统计；`RDM` 这类 special 不在其中）。
    //
    // @param {string} prop - 属性名（如 'CHR' / 'AGE' / 'TLT' / 'TMS'）
    // @returns {*} 当前值
    get: (prop) => property.get(prop),

    // #set
    // 覆盖设置属性（**会触发 propertyChange，source: 'mod'**）。
    //
    // @param {string} prop - 属性名
    // @param {*} value - 新值
    // @returns {void}
    set: (prop, value) => property.set(prop, value, 'mod'),

    // #change
    // 增量修改（数字累加；数组属性传 ID，`'-'` 前缀或负数表示移除）。
    //
    // @param {string} prop - 属性名
    // @param {*} value - 增量或 ID
    // @returns {void}
    change: (prop, value) => property.change(prop, value, 'mod'),

    // #effect
    // 批量应用效果（与事件的 `effect` 字段同一语义，支持 `RDM` 随机属性）。
    //
    // @param {object} effects - 形如 { CHR: 1, SPR: -2 }
    // @returns {void}
    effect: (effects) => property.effect(effects || {}, 'mod'),

    // #all
    // 全部本局属性的快照（条件引擎求值用的就是这一份）。
    //
    // @returns {object} 属性名 → 值
    all: () => property.getAll(),

    // #types
    // 属性名清单（TYPES 的键）。
    //
    // @returns {string[]} 属性名数组
    types: () => Object.keys(property.TYPES || {}),
  }
}

// #createUnavailablePropertyBridge
// 降级桥：宿主没有游戏属性系统时用（例如只做目录检查的 `mod.cli.js`）。
//
// 为什么不像 `host` 那样悄悄 no-op：写属性却什么都没发生，是最难查的一类问题。
// 这里选择**明确报错**，把原因写在错误信息里。
//
// @returns {object} 降级桥
export function createUnavailablePropertyBridge() {
  // 统一的错误。
  const fail = () => {
    // 抛出可读原因。
    throw new Error('当前宿主没有游戏属性系统（gameAPI.property.available === false）：请在跑到一局游戏里调用，或先判断 available')
  }
  // 返回。
  return {
    // 不可用。
    available: false,
    // 读取返回 undefined（不抛：`available` 判断之外顺手读一下不该炸）。
    get: () => undefined,
    // 其余写操作明确报错。
    set: fail,
    change: fail,
    effect: fail,
    // 空快照。
    all: () => ({}),
    // 空清单。
    types: () => [],
  }
}
