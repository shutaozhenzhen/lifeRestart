/**
 * mod-doc-api — 「gameAPI 参考」的**内容数据**（页面由 components/DocPage.vue 渲染）
 *
 * 为什么内容写成结构化数据而不是 Markdown：见 DocPage.vue 的文件头（没有 Markdown 依赖、
 * 内容要能被单测逐块校验、API 条目要能被**机器核对**）。
 *
 * ⚠️ 准确性约定：这里每一条 `path`（如 `ai.chat`）都会被 `mod-doc.spec.js` 拿去与
 *    engines `createGameAPI()` **真实返回的键**双向比对 —— 引擎加了 API 而这里没跟上会直接红，
 *    这里写了不存在的 API 也会直接红。所以改引擎的 gameAPI 时**必须同时改这个文件**。
 *
 * 事实来源（2026-10 逐行核对）：`packages/game-engine/src/mod/gameapi.js`、
 * `mod/loader.js`（code.js 执行）、`params/param-registry.js`（param.define）、
 * `mod/host.js`（宿主桥）、`ai/ai-mod.js`（createAIMod）。
 */

// #MOD_API
// API 参考文档。
export const MOD_API = {
  // 文档 id（页面用它做锚点前缀）。
  id: 'mod-api',
  // 标题。
  title: 'gameAPI 参考',
  // 副标题。
  subtitle: 'Mod 代码在运行期能调用的**全部**东西 —— 逐条给签名、返回、副作用与失败表现，并明确标出"没有的东西"',
  // 章节。
  sections: [
    // ---------- 怎么拿到 ----------
    {
      id: 'how',
      title: '1. 怎么拿到 gameAPI',
      blocks: [
        {
          t: 'p',
          text: 'Mod 的代码入口是 `code.js`，它是一个**脚本体**（不是 ES 模块）：引擎用 `new Function(\'gameAPI\', \'require\', \'"use strict";\\n\' + 你的代码)(gameAPI, requireFn)` 执行它。作用域里只有两样东西：',
        },
        {
          t: 'list',
          items: [
            '`gameAPI` —— 本文档的主角（每个 Mod 拿到**自己的一份**，但底层数据是共享的）',
            '`require(id)` —— 取用随包分发的运行时依赖（见 §10；没声明时是"解释为什么不能用"的 deny 版）',
          ],
        },
        {
          t: 'code',
          lang: 'js',
          label: 'code.js 的最小骨架（脚本体，不要写 export/import）',
          code: `// code.js —— 注意：没有 export、没有 import、不能用顶层 await
// 引擎实际执行的是： new Function('gameAPI', 'require', '"use strict";\\n' + 这段文本)(gameAPI, requireFn)

gameAPI.log.info('[my-mod] 加载了')      // 接宿主日志器（Node/打包环境里 console 不进日志面板）
gameAPI.on('onYearAdvance', (p) => {    // 注册钩子
  p.content.push({ type: 'EVT', description: '自定义的一年' })
})`,
        },
        {
          t: 'note',
          kind: 'warn',
          text: '写 `export default ...` 会直接语法错误（`Unexpected token \'export\'`），顶层 `await` 同理；`return` 合法但**返回值被丢弃**。异常会被引擎隔离成一条错误记录（`执行 <name>/code.js 失败: <原因>`），不会让整个游戏崩掉。',
        },
        {
          t: 'sub',
          text: '顶层能力总览（引擎真实返回的键，一个不多一个不少）',
        },
        {
          t: 'code',
          lang: 'js',
          label: 'gameAPI 的完整形状',
          code: `gameAPI = {
  // 钩子总线
  on(name, fn), off(name, fn), emit(name, payload), emitSync(name, payload), hooks(),

  // AI（需注入 ai 客户端；浏览器要用户先配 Key）
  ai: { available, config: { baseUrl, model }, chat(params), generate(params) },

  // 宿主桥（调用本 Mod 的 server.js 注册的处理器；静态站是空桥）
  host: { available, has(mod), call(mod, handler, args) },

  // AI Mod 工厂（引擎未注入时为 null）
  createAIMod(cfg),

  // 参数注册表（**宿主没传注册表时整个 param 为 null**，见下）
  param: { define(name, def), get(name), set(name, v), change(name, v), names, getAll() },

  // 属性自定义区（**不是**游戏属性系统，见 §5）
  property: { get(prop), set(prop, value) },

  // 数据 CRUD（顶层扁平函数，没有 talent.* / event.* 这种子命名空间）
  addTalent(t), getTalent(id), removeTalent(id),
  addEvent(e), getEvent(id), removeEvent(id),
  addAchievement(a), getAchievement(id),

  // 合并后的数据本体（5 张表的引用）
  data,
}`,
        },
        {
          t: 'note',
          kind: 'warn',
          text: '**`gameAPI.param` 可能是 null**：它只有在宿主把参数注册表传进来时才存在。浏览器侧有（用的是 Life 的注册表），但**所有 CLI 原型都没有** —— 所以写 `gameAPI.param.define(...)` 前先判断 `if (gameAPI.param)`，否则 CLI 里会抛 `Cannot read properties of null`。',
        },
      ],
    },

    // ---------- 钩子总线 ----------
    {
      id: 'bus',
      title: '2. 钩子总线：on / off / emit / emitSync / hooks',
      blocks: [
        {
          t: 'p',
          text: '所有钩子都挂在这条总线上。引擎在固定时机**同步**调用它；你的回调按**注册顺序**执行（也就是 Mod 的加载顺序）。',
        },
        {
          t: 'api',
          path: 'on',
          sig: 'gameAPI.on(name: string, fn: Function) → Function',
          params: [
            ['name', 'string', '钩子名（§3 的四个名字，或你自己 emit 的自定义名）'],
            ['fn', 'Function', '回调。收到一个 payload 对象'],
          ],
          returns: '一个**注销函数**（`() => void`），调用它即摘掉这个回调 —— 比记住 fn 引用再 `off` 更省事',
          side: '把 fn 追加到该名字的回调数组末尾',
          note: 'name 不做白名单校验：写错名字不会报错，只是永远不触发（最隐蔽的坑）。fn 不是函数也照样入队，直到触发时才报 TypeError（被隔离成一条日志）。',
          perms: 'hooks',
          platform: '两端',
          example: `const off = gameAPI.on('onYearAdvance', (p) => {
  if (p.age === 18) p.content.push({ type: 'EVT', description: '成年了' })
})
// 不想用了：off()`,
        },
        {
          t: 'api',
          path: 'off',
          sig: 'gameAPI.off(name: string, fn: Function) → undefined',
          params: [
            ['name', 'string', '钩子名'],
            ['fn', 'Function', '**必须是注册时那一个函数引用**（同引用才摘得掉）'],
          ],
          returns: 'undefined',
          side: '从数组里过滤掉该引用',
          note: '传匿名函数是摘不掉的（每次都是新引用）—— 要么保存引用，要么用 `on` 的返回值。',
          perms: 'hooks',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'emit',
          sig: 'gameAPI.emit(name: string, payload: any) → Promise<Array>',
          params: [
            ['name', 'string', '钩子名'],
            ['payload', 'any', '传给回调的对象'],
          ],
          returns: '所有回调返回值的数组（按顺序）',
          side: '**异步**：顺序 await 每个回调',
          note: '单个回调抛错会被吞成一条 logger.error（`钩子 X 异常: msg`）并继续跑后面的；没有该钩子的回调时返回 `[]`。',
          perms: 'hooks',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'emitSync',
          sig: 'gameAPI.emitSync(name: string, payload: any) → Array',
          params: [['name', 'string', '钩子名'], ['payload', 'any', '传给回调的对象']],
          returns: '所有回调返回值的数组 —— **async 回调给到的是 Promise 本身（没人 await）**',
          side: '**同步**：顺序直接调用，不 await',
          note: '引擎的三个逐岁钩子走的就是它。所以"在逐岁钩子里写异步逻辑再改数据"是**无效**的：改动会晚于引擎读取（详见 §11）。',
          perms: 'hooks',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'hooks',
          sig: 'gameAPI.hooks() → { [name]: count }',
          params: [],
          returns: '钩子名 → 当前回调数量的对象（**不是数组**）',
          side: '无',
          note: '调试用：想知道"我到底挂上去了没"就打印它。',
          perms: 'hooks',
          platform: '两端',
          example: `console.log(gameAPI.hooks())   // { onYearAdvance: 1, onEventRender: 1 }`,
        },
      ],
    },

    // ---------- 四个钩子 ----------
    {
      id: 'hooks',
      title: '3. 引擎实际会触发的四个钩子',
      blocks: [
        {
          t: 'table',
          head: ['钩子名', '触发点', 'payload', '能改什么', '同步/异步'],
          rows: [
            ['`onTalentPoolGenerate`', '`life.talentRandom()`（抽卡时）', '`{ pool }`', '**改 `payload.pool`**（push 天赋对象即可入池）', '`emitSync`'],
            ['`onYearAdvance`', '`life.next()`（每翻一年）', '`{ age, content, isEnd }`', '**push 进 `payload.content`**（进当年轨迹）', '`emitSync`'],
            ['`onEventRender`', '`life.format()`（渲染每个事件文本时）', '`{ text }`', '**返回字符串即覆盖文本**（唯一返回值生效的钩子）', '`emitSync`'],
            ['`propertyChange`', '**任何**属性变化（事件/天赋效果、年龄自增、成就记账、Mod 自己改）', '`{ prop, value, source }`（source: `\'engine\'` / `\'mod\'`）', '不能改（纯观察）；回调里改属性会被重入保护挡掉嵌套通知', '`emitSync`（同步）'],
          ],
        },
        {
          t: 'sub',
          text: 'content 里的条目长什么样',
        },
        {
          t: 'p',
          text: '`onYearAdvance` 的 `content` 是"这一年已经发生的事"的数组（引擎自己 push 的天赋/事件条目就在里面，结构是 `{ type, name?, grade?, description, postEvent? }`）。你 push 的条目会被轨迹页与总结页一起渲染，所以至少要有 `type` 与 `description`：',
        },
        {
          t: 'code',
          lang: 'js',
          code: `gameAPI.on('onYearAdvance', (payload) => {
  // payload.age / payload.content / payload.isEnd
  if (payload.age === 10) {
    payload.content.push({ type: 'EVT', description: '十岁生日，你收到一本书' })
  }
})`,
        },
        {
          t: 'sub',
          text: 'onEventRender 是唯一能改文本的钩子',
        },
        {
          t: 'code',
          lang: 'js',
          code: `gameAPI.on('onEventRender', (payload) => {
  // 返回字符串 = 替换这段文本；返回 undefined = 不改
  if (payload.text.includes('你死了')) return payload.text + '（这一世到此为止）'
  return undefined
})`,
        },
        {
          t: 'note',
          kind: 'warn',
          text: 'async 回调在这里**必然失效**：`typeof (async () => \'x\')() === \'object\'`（是 Promise，不是字符串），引擎只认字符串返回值。',
        },
        {
          t: 'note',
          kind: 'info',
          text: '**成就广播不是钩子**：引擎达成成就时用 Life 自己的 emit 广播事件 `achievement`，那条通道与 Mod 的钩子总线是**两个不同的东西**，Mod 订阅不到。想在成就达成时做事，只能自己 define 一个成就并轮询条件。',
        },
      ],
    },

    // ---------- param ----------
    {
      id: 'param',
      title: '4. param：注册新参数（让条件里多出 params.XXX）',
      blocks: [
        {
          t: 'p',
          text: '参数就是引擎的配置系统：条件是拿 `params` 求值的，`param.define` 注册的新参数**立刻**能写进任何条件里（事件 include/exclude、天赋 condition、成就 condition、branch 条件、派生公式）。',
        },
        {
          t: 'api',
          path: 'param',
          sig: 'gameAPI.param → { define, get, set, change, names, getAll } | null',
          params: [],
          returns: '参数注册表的门面；**宿主没传注册表时整个键是 `null`**',
          side: '无（门面本身不做事）',
          note: '**这是唯一会变成 null 的命名空间**：浏览器侧有（用 Life 的注册表），而所有 CLI 原型都没传 → CLI 里 `gameAPI.param` 是 null，不判断就 `define` 会抛 `Cannot read properties of null (reading \'define\')`。',
          perms: '无',
          platform: '浏览器有；CLI 为 null',
        },
        {
          t: 'api',
          path: 'param.define',
          sig: 'gameAPI.param.define(name: string, def: object) → undefined',
          params: [
            ['name', 'string', '参数名（条件里写 params.NAME）。同名重复 define = 直接覆盖'],
            ['def', 'object', '参数定义，形状由 `def.type` 决定（见下表）'],
          ],
          returns: 'undefined',
          side: '注册进参数注册表（与 Life 共享 → 立即影响条件求值）',
          note: '**`def.label` 引擎不读**：中文标签的唯一来源是引擎手写的参数定义，Mod 自定义参数不会自动出现在界面上（没有界面注册 API）。',
          perms: '无（声明 permissions 与能力无关，见 §12）',
          platform: '**仅浏览器路径可用**（CLI 没传注册表 → `gameAPI.param` 是 null）',
          example: `if (gameAPI.param) {
  // 本局标量：重开一局归零
  gameAPI.param.define('MY_LUCK', { type: 'local' })
  // 派生值：读取时实时算（公式里的属性名会被替换成 ctx.get('X')）
  gameAPI.param.define('MY_POWER', { type: 'derived', formula: 'CHR + STR + INT' })
  // 之后条件里就能写： params.MY_POWER > 20
}`,
        },
        {
          t: 'table',
          head: ['def.type', '形状', '语义'],
          rows: [
            ['`local`', '`{ type, label?, low?, high?, array?, change? }`', '本局标量（`array: true` 或 type 写 `array` → 数组）。标量的 `change` 是**数字累加**，并联动 `low`/`high`（分别取 min/max）'],
            ['`number` / `array`', '同 `local`', '同一实现的别名'],
            ['`derived`', '`{ type: \'derived\', formula: \'CHR + INT\' }` 或 `{ from: \'AGE\', op: \'min\'|\'max\' }`', '读取时实时求值，不占存储'],
            ['`storage`', '`{ type: \'storage\', storeKey?, default?, array?, change? }`', '跨局持久化（走注入的 storage；JSON 序列化）'],
            ['`function`', '`{ type: \'function\', get: \'return ...\', set?: \'...\', change?: \'...\' }`', '函数体字符串（`new Function(\'ctx\', ...)` 编译，`ctx` 是唯一注入依赖）'],
            ['`special`', '`{ type: \'special\' }`', '**不进 params**（条件里看不到），只在内部用（引擎的 RDM 就是它）'],
          ],
        },
        {
          t: 'api',
          path: 'param.get',
          sig: 'gameAPI.param.get(name: string) → any',
          params: [['name', 'string', '参数名']],
          returns: '参数当前值（数组参数返回**深拷贝**）',
          side: '无',
          note: '不存在或循环依赖时返回 `undefined`（循环依赖只记一条 `参数循环依赖: X` 的 error，不抛错）。',
          platform: '仅浏览器路径',
        },
        {
          t: 'api',
          path: 'param.set',
          sig: 'gameAPI.param.set(name: string, v: any) → void',
          params: [['name', 'string', '参数名'], ['v', 'any', '新值']],
          returns: 'undefined',
          side: '写参数',
          note: '对**未定义**的参数是静默 no-op（不报错，也不生效）—— 名字写错很难发现。',
          platform: '仅浏览器路径',
        },
        {
          t: 'api',
          path: 'param.change',
          sig: 'gameAPI.param.change(name: string, v: any) → void',
          params: [['name', 'string', '参数名'], ['v', 'any', '增量（标量是数字；数组参数看它的自定义 change）']],
          returns: 'undefined',
          side: '增量修改（标量 = 当前值 + v）',
          note: '这是"每年涨一点"最常用的写法（示例 Mod 的 `LUCK_EXAMPLE` 就是每年 +1）。',
          platform: '仅浏览器路径',
        },
        {
          t: 'api',
          path: 'param.names',
          sig: 'gameAPI.param.names → string[]',
          params: [],
          returns: '全部已注册参数名',
          side: '无',
          note: '调试用（getter，不是方法，别写成 `names()`）。',
          platform: '仅浏览器路径',
        },
        {
          t: 'api',
          path: 'param.getAll',
          sig: 'gameAPI.param.getAll() → object',
          params: [],
          returns: '参数名 → 值 的对象（**跳过 special**）',
          side: '无',
          note: '这就是条件里的 `params`。',
          platform: '仅浏览器路径',
        },
      ],
    },

    // ---------- property ----------
    {
      id: 'property',
      title: '5. property：读写**真实**游戏属性，并观察属性变化',
      blocks: [
        {
          t: 'note',
          kind: 'info',
          text: '2026-10 能力补齐：这里以前读写的是数据对象上一个自定义键（`data.properties`），全引擎没有一处读它 —— `property.get(\'CHR\')` 恒为 `undefined`。**现在它是真的**：调用会转发到游戏属性系统（`CHR`/`INT`/`AGE`/`TLT`/`TMS`… 与条件里 `params` 看到的是同一套）。',
        },
        {
          t: 'api',
          path: 'property',
          sig: 'gameAPI.property → { available, get, set, change, effect, all, types }',
          params: [],
          returns: '属性桥（**永远存在**；宿主没跑到一局游戏里时是降级桥，见 `available`）',
          side: '无',
          note: '**先判断 `available`**（与 `param` 会变 null 不同，这里永远有对象，但可能是降级版）。降级版的写操作会**抛可读错误**，读取返回 `undefined` —— 刻意不静默，否则"写了属性却什么都没发生"是最难查的问题。',
          perms: '无',
          platform: '两端（需宿主已建好一局游戏）',
        },
        {
          t: 'api',
          path: 'property.available',
          sig: 'gameAPI.property.available → boolean',
          params: [],
          returns: '是否真的连上了游戏属性系统',
          side: '无',
          note: '浏览器侧为 true（code.js 在 `life.initial()` 之后执行）；`mod.cli.js` 这类"只检查 Mod 目录"的宿主为 false。',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'property.get',
          sig: 'gameAPI.property.get(prop: string) → any',
          params: [['prop', 'string', '属性名（`CHR` / `INT` / `STR` / `MNY` / `SPR` / `AGE` / `TLT` / `EVT` / `TMS` / `ACHV`…）']],
          returns: '当前值（含派生/累计/统计参数；`RDM` 这类 special 不在其中）',
          side: '无',
          note: '读的就是条件引擎看到的同一份（`getAll()`）。',
          platform: '两端',
          example: `if (gameAPI.property.available) {
  const chr = gameAPI.property.get('CHR')
}`,
        },
        {
          t: 'api',
          path: 'property.set',
          sig: 'gameAPI.property.set(prop: string, value: any) → void',
          params: [['prop', 'string', '属性名'], ['value', 'any', '新值（覆盖）']],
          returns: 'undefined',
          side: '**真的改游戏属性**，并同步广播 `propertyChange`（`source: \'mod\'`）',
          note: '对 `TLT` / `EVT` 这类累计参数，`set` 之后引擎还会记账（ATLT/AEVT）—— 只通知一次，不会重复。',
          platform: '两端（需 `available`）',
        },
        {
          t: 'api',
          path: 'property.change',
          sig: 'gameAPI.property.change(prop: string, value: any) → void',
          params: [['prop', 'string', '属性名'], ['value', 'any', '增量；数组属性传 ID（`\'-id\'` 或负数表示移除）']],
          returns: 'undefined',
          side: '增量修改 + 广播 `propertyChange`（`source: \'mod\'`）',
          note: '数字属性直接累加并联动 `low`/`high`（引擎的 addi 语义）。这是"改属性"最常用的写法。',
          platform: '两端（需 `available`）',
          example: `// 20 岁那年精神 +3（示例 Mod 就是这么写的）
gameAPI.on('onYearAdvance', (p) => {
  if (p.age === 20) gameAPI.property.change('SPR', 3)
})`,
        },
        {
          t: 'api',
          path: 'property.effect',
          sig: 'gameAPI.property.effect(effects: object) → void',
          params: [['effects', 'object', '形如 `{ CHR: 1, SPR: -2 }`；支持 `RDM`（随机基础属性）']],
          returns: 'undefined',
          side: '逐键 `change`（每个键一条 `propertyChange`），语义与事件的 `effect` 字段**完全一致**',
          note: '想"像事件那样给一组效果"，用它最省事。',
          platform: '两端（需 `available`）',
        },
        {
          t: 'api',
          path: 'property.all',
          sig: 'gameAPI.property.all() → object',
          params: [],
          returns: '全部本局属性的快照（属性名 → 值）',
          side: '无',
          note: '条件引擎求值用的就是这一份；调试时打印它比逐个 `get` 方便。',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'property.types',
          sig: 'gameAPI.property.types() → string[]',
          params: [],
          returns: '属性名清单（引擎 `TYPES` 的键）',
          side: '无',
          note: '用来确认某个属性名在当前版本里存在（拼错的属性名不会报错，只会让你读到 `undefined`）。',
          platform: '两端',
        },
        {
          t: 'note',
          kind: 'warn',
          text: '**时序坑**：`code.js` 在浏览器侧跑在 `life.initial()` 之后、但**在玩家分配属性（`life.start()`）之前** —— 在顶层直接 `property.change` 会被随后的开局分配覆盖。要改属性请选游戏过程中的时机（逐岁钩子等）。',
        },
        {
          t: 'note',
          kind: 'tip',
          text: '**观察属性变化**：`propertyChange` 钩子现在对**任何**变化都会触发（引擎内部的事件/天赋效果、年龄自增、成就记账、以及 Mod 自己的写入），payload 多了一个 `source`（`\'engine\'` / `\'mod\'`）用来过滤自己造成的噪声；而且它是**同步**广播 —— 回调里读到的就是变更后的值。回调里**不要再改属性**：引擎有重入保护（嵌套通知会被跳过并记 trace），但依赖它不如自己避开。',
        },
      ],
    },

    // ---------- log / storage / dispose（2026-10 能力补齐） ----------
    {
      id: 'extras',
      title: '13. log / storage / dispose：补齐的三个小能力',
      blocks: [
        {
          t: 'p',
          text: '这三个是 2026-10 补的"以前只能绕路"的能力。共同点：**环境探测用 `available` 之类的前置判断，缺能力时给可读错误而不是静默**。',
        },
        {
          t: 'api',
          path: 'log',
          sig: 'gameAPI.log → { debug, info, warn, error }',
          params: [],
          returns: '接了宿主日志器的四个方法（每条自动加 `[mod:<Mod 名>]` 前缀）',
          side: '无',
          note: '以前只能 `console.log` —— 在 Node / 打包环境里，console 的输出**不进**日志面板与日志报告，排障时等于没有。缺级别实现的日志器会自动回落到 `debug`。',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'storage',
          sig: 'gameAPI.storage → { get(key, fallback), set(key, value), remove(key), keys() }',
          params: [['key', 'string', '键名（会加命名空间，见下）'], ['fallback', 'any', '缺失/坏数据时返回的值']],
          returns: '读：JSON 解析后的值；`keys()`：本 Mod 的键数组（已去前缀）',
          side: '写入宿主 storage（跨局持久化）',
          note: '键名一律变成 **`mod:<Mod 名>:<键>`**，与引擎自己的键（TMS/ACHV/…）互不干扰，也不会被别的 Mod 读到。没有注入 storage 时：**读给 fallback、写抛可读错误**（静默丢弃是最难查的问题）。⚠️ 「重置数据」按 `mod:` 前缀清理这些键（`utils/reset-data.js`），所以 Mod 的数据也会被一起清掉。',
          platform: '两端（需注入 storage）',
        },
        {
          t: 'api',
          path: 'dispose',
          sig: 'gameAPI.dispose() → number',
          params: [],
          returns: '摘掉的钩子数量',
          side: '**摘掉本 Mod 通过 `gameAPI.on` 注册的全部钩子**（幂等，重复调用返回 0）',
          note: '用于"换局 / 禁用 Mod / 重新加载"时避免**幽灵钩子**（漏摘 → 同一个 Mod 的逻辑生效两次）。它只影响本 Mod 的注册，别的 Mod 与引擎自己的钩子不受影响。',
          platform: '两端',
        },
      ],
    },

    // ---------- 数据 CRUD ----------
    {
      id: 'crud',
      title: '6. 数据 CRUD（顶层扁平函数）',
      blocks: [
        {
          t: 'p',
          text: '注意没有 `gameAPI.talent.add(...)` 这种子命名空间：天赋/事件/成就的增删查都是**顶层函数**，而且**只有这三类有 API**。',
        },
        {
          t: 'api',
          path: 'addTalent',
          sig: 'gameAPI.addTalent(talent: object) → string',
          params: [['talent', 'object', '天赋对象（要有 id；`grade` 必须是数字，见下方警告）']],
          returns: '天赋 id',
          side: '写进 `data.talents[id]`（同名覆盖）',
          note: '**运行期注入的天赋必须显式写 `maxTriggers`**：浏览器侧 code.js 在 `life.initial()` 之后执行，绕过了引擎对天赋的规范化（补 grade/maxTriggers）。缺 `maxTriggers` 时触发判定是 `0 < undefined` → 假 → **效果永不生效**。写数据文件里的天赋没这个问题。',
          platform: '两端',
          example: `gameAPI.addTalent({
  id: 'my-t1', name: '我的天赋', description: '精神+1',
  grade: 0,            // 数字！否则永远抽不到
  maxTriggers: 1,      // 运行期注入必须显式写
  effect: { SPR: 1 },
})`,
        },
        {
          t: 'api',
          path: 'getTalent',
          sig: 'gameAPI.getTalent(id: string) → object | undefined',
          params: [['id', 'string', '天赋 id']],
          returns: '天赋对象（**引用**，不是拷贝）',
          side: '无',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'removeTalent',
          sig: 'gameAPI.removeTalent(id: string) → undefined',
          params: [['id', 'string', '天赋 id']],
          returns: 'undefined',
          side: '从 `data.talents` 删除',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'addEvent',
          sig: 'gameAPI.addEvent(event: object) → string',
          params: [['event', 'object', '事件对象（正文写在 **`event`** 字段，不是 description）']],
          returns: '事件 id',
          side: '写进 `data.events[id]`',
          note: '**加进去不等于会触发**：能被随机触发的前提是它的 id 出现在 `age.json` 某个年龄的 `event` 列表里（见「Mod 制作文档」的年龄表一节）。',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'getEvent',
          sig: 'gameAPI.getEvent(id: string) → object | undefined',
          params: [['id', 'string', '事件 id']],
          returns: '事件对象（引用）',
          side: '无',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'removeEvent',
          sig: 'gameAPI.removeEvent(id: string) → undefined',
          params: [['id', 'string', '事件 id']],
          returns: 'undefined',
          side: '从 `data.events` 删除',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'addAchievement',
          sig: 'gameAPI.addAchievement(ach: object) → string',
          params: [['ach', 'object', '成就对象（**必须自带 id 字段**，判定时会用它记账）']],
          returns: '成就 id',
          side: '写进 `data.achievements[id]`',
          note: '`opportunity` 必须精确等于 `START` / `TRAJECTORY` / `SUMMARY` / `END` 之一，写错则**永远不会达成**（引擎用 `==` 过滤时机）。',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'getAchievement',
          sig: 'gameAPI.getAchievement(id: string) → object | undefined',
          params: [['id', 'string', '成就 id']],
          returns: '成就对象（引用）',
          side: '无',
          note: '配套 `removeAchievement`（2026-10 补齐，见下）。',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'removeAchievement',
          sig: 'gameAPI.removeAchievement(id: string) → void',
          params: [['id', 'string', '成就 ID']],
          returns: 'undefined',
          side: '从成就表删除（**2026-10 补齐**：以前只有 add/get，没有 remove）',
          note: '删除不存在的 ID 不报错。',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'addCharacter',
          sig: 'gameAPI.addCharacter(ch: object) → string',
          params: [['ch', 'object', '{ id, name, property, talent, … }']],
          returns: '写入的 id',
          side: '写入名人表（同名 id 覆盖）',
          note: '⚠️ 名人表主键 = 条目**自己的 `id`**（与事件表不同：事件不读对象里的 id）。**2026-10 补齐**。',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'getCharacter',
          sig: 'gameAPI.getCharacter(id: string) → object | undefined',
          params: [['id', 'string', '名人 ID']],
          returns: '名人条目（引用）',
          side: '无',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'removeCharacter',
          sig: 'gameAPI.removeCharacter(id: string) → void',
          params: [['id', 'string', '名人 ID']],
          returns: 'undefined',
          side: '从名人表删除',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'addAge',
          sig: 'gameAPI.addAge(age: number|string, entry: object) → string',
          params: [['age', 'number|string', '年龄'], ['entry', 'object', '{ age, event: [[id, weight]], talent: [] }']],
          returns: '写好的年龄键（字符串）',
          side: '写入年龄表',
          note: '⚠️ **整键替换**：想给某一岁追加事件，必须把原条目的 id 一起抄进来，否则那些事件就没了（引擎的真实语义，不是 bug）。**2026-10 补齐**。',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'getAge',
          sig: 'gameAPI.getAge(age: number|string) → object | undefined',
          params: [['age', 'number|string', '年龄']],
          returns: '该年龄的条目（引用）',
          side: '无',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'removeAge',
          sig: 'gameAPI.removeAge(age: number|string) → void',
          params: [['age', 'number|string', '年龄']],
          returns: 'undefined',
          side: '从年龄表删除该年龄',
          platform: '两端',
        },
        {
          t: 'api',
          path: 'list',
          sig: 'gameAPI.list(table: string) → Array',
          params: [['table', 'string', "talents / events / achievements / characters / age"]],
          returns: '条目数组（浅拷贝）',
          side: '无',
          note: '以前只能自己 `Object.keys(gameAPI.data.xxx)`。未知表名 → **空数组**（不抛）。**2026-10 补齐**。',
          platform: '两端',
        },
        {
          t: 'sub',
          text: '各表的主键要求不一致（照抄容易踩）',
        },
        {
          t: 'table',
          head: ['表', '主键怎么读', '必须自带 id 字段？'],
          rows: [
            ['talents', '`talent.initial()` 会用**键**覆盖对象里的 `id`', '可以省，但建议写'],
            ['events', '`event.get(id)` 按**键**查（对象里的 id 引擎不读）', '引擎不读（惯例仍要写）'],
            ['achievements', '`list()` 从**对象值**里取 `id` 记账', '**必须**，且要与键一致'],
            ['characters', '前端按 `c.id` 匹配', '**必须**；且 `talent` 必须是数组'],
            ['age', '按年龄键查，条目里的 `age` 字段引擎不读', '—'],
          ],
        },
      ],
    },

    // ---------- data ----------
    {
      id: 'data',
      title: '7. data：合并后的数据本体',
      blocks: [
        {
          t: 'api',
          path: 'data',
          sig: 'gameAPI.data → { age, talents, events, achievements, characters }',
          params: [],
          returns: '合并后的数据对象（**与 Life 共享同一个引用**）',
          side: '**可任意读写**（包括没有 API 的 `characters`/`age`）',
          note: '写入在运行期是**真实生效**的（Life 各模块持有的就是这批引用）。但也因为共享，改坏了会直接影响正在跑的这一局；另外重新开一局时数据会按原始内容重建，你的运行期改动不会保留。',
          platform: '两端',
          example: `// characters / age 没有专用 API，只能走 data（两边都是引用，改了立即生效）
gameAPI.data.characters['my-c1'] = {
  id: 'my-c1', name: '我自己',
  property: { CHR: '5', INT: '5', STR: '5', MNY: '5' },   // 真实数据里是字符串，前端会 Number 兜 0
  talent: [],                                             // 必须是数组
}
gameAPI.data.age['18'] = { age: '18', event: [['my-e1', 1]] }   // 注意：这**整键替换**了 18 岁`,
        },
      ],
    },

    // ---------- ai ----------
    {
      id: 'ai',
      title: '8. ai 与 createAIMod',
      blocks: [
        {
          t: 'api',
          path: 'ai',
          sig: 'gameAPI.ai → { available, config, chat(params), generate(params) }',
          params: [],
          returns: 'AI 客户端门面（**永远存在**，但 `available` 可能是 false）',
          side: '无',
          note: '注入面：宿主给不给客户端决定 `available`。**浏览器侧目前不给 Mod 注入 AI 配置**（`executeModCodes` 不传 aiConfig）→ 那里的 `available` 恒为 false；CLI 加 `--mock-ai` 或设 `AI_API_KEY` 才有。',
          perms: 'ai',
          platform: '需宿主注入客户端',
        },
        {
          t: 'api',
          path: 'ai.available',
          sig: 'gameAPI.ai.available → boolean',
          params: [],
          returns: '是否注入了可用 AI 客户端',
          side: '无',
          note: '**先判断再用**。浏览器里用户在设置页配了 API Key 才是 true；CLI 加 `--mock-ai` 或设环境变量。',
          perms: 'ai',
          platform: '需宿主注入客户端',
        },
        {
          t: 'api',
          path: 'ai.config',
          sig: 'gameAPI.ai.config → { baseUrl, model }',
          params: [],
          returns: '当前 AI 配置（**不含 apiKey**）',
          side: '无',
          perms: 'ai',
          platform: '同上',
        },
        {
          t: 'api',
          path: 'ai.chat',
          sig: 'gameAPI.ai.chat(params) → Promise<string>',
          params: [['params', 'object', '透传给客户端（model / messages / max_tokens / stream …）']],
          returns: '模型回复文本',
          side: '发起一次对话请求（可能要等几秒到几十秒）',
          note: '没有客户端时**同步抛错**（`AI 客户端不可用（未配置 ai 客户端）`），不是 rejected promise —— 用 try/catch 包住，别只挂 `.catch()`。',
          perms: 'ai / network',
          platform: '需宿主注入客户端',
        },
        {
          t: 'api',
          path: 'ai.generate',
          sig: 'gameAPI.ai.generate(params) → Promise<object>',
          params: [['params', 'object', '同上；引擎会按 JSON 解析并校验返回']],
          returns: '解析后的对象（失败有校验重试与兜底）',
          side: '同 chat',
          perms: 'ai / network',
          platform: '需宿主注入客户端',
        },
        {
          t: 'api',
          path: 'createAIMod',
          sig: 'gameAPI.createAIMod(cfg) → { register, unregister, generateTalent, generateEvent } | null',
          params: [['cfg', 'object', '覆盖 AI 配置（可选）']],
          returns: 'AI Mod 增强器；**引擎未注入工厂时为 null**',
          side: '创建一个增强器（`register()` 会把生成的天赋/事件挂到钩子上）',
          note: '`ai-mod` 的 code.js 就是 13 行壳：`if (gameAPI.createAIMod) { const m = gameAPI.createAIMod({}); m.register() }`。注意浏览器侧目前**不给 Mod 注入 AI 配置**，所以那里的 `available` 是 false、`register()` 会立刻返回。',
          perms: 'ai',
          platform: 'CLI 默认注入；浏览器需宿主接线',
        },
      ],
    },

    // ---------- host ----------
    {
      id: 'host',
      title: '9. host：调用本 Mod 的后端入口（优雅降级）',
      blocks: [
        {
          t: 'p',
          text: '如果 Mod 声明了 `targets: ["node"]` 并提供 `server.js`，它注册的处理器就能被前端（或 CLI）通过宿主桥调用。**静态站没有后端**，桥是空的 —— 所以这段代码必须写成"先问再用"。',
        },
        {
          t: 'api',
          path: 'host',
          sig: 'gameAPI.host → { available, has(mod), call(mod, handler, args) }',
          params: [],
          returns: '宿主桥（**永远存在**；没有后端时是"空桥"：`available` 为 `[]`、`has()` 恒 false、`call()` 抛错）',
          side: '无',
          note: '"永远存在"是刻意的：这样 Mod 可以无条件写 `if (gameAPI.host.has(...))` 而不必先判断对象是否存在（优雅降级）。',
          perms: '无',
          platform: '两端（静态站为空桥）',
        },
        {
          t: 'api',
          path: 'host.available',
          sig: 'gameAPI.host.available → string[]',
          params: [],
          returns: '在线可调用的 Mod 名数组（每次调用返回新数组）',
          side: '无',
          note: '静态站恒为 `[]`。',
          platform: '需 host-node / host-rpc 适配器',
        },
        {
          t: 'api',
          path: 'host.has',
          sig: 'gameAPI.host.has(mod: string) → boolean',
          params: [['mod', 'string', 'Mod 名（目录名）']],
          returns: '该 Mod 的后端是否在线',
          side: '无',
          platform: '同上（静态站恒 false）',
        },
        {
          t: 'api',
          path: 'host.call',
          sig: 'gameAPI.host.call(mod: string, handler: string, args: any) → Promise<any>',
          params: [
            ['mod', 'string', 'Mod 名'],
            ['handler', 'string', '`server.js` 里注册的处理器名'],
            ['args', 'any', '参数（**必须能 JSON 序列化** —— 这是宿主桥唯一的实质边界）'],
          ],
          returns: '处理器返回值（JSON）',
          side: '跨进程/跨语言调用（Node 侧完全权限：文件、进程、网络）',
          note: '失败信息很具体：`宿主 Mod 未注册: X（在线：…）`、`未注册处理器: Y（现有：…）`、`处理器 X 抛错` 会被包成 `Mod X 处理器 Y 失败: <原因>`；纯静态站是 `当前环境没有后端宿主（纯静态站）：请在桌面版/CLI 运行，或改用包内自带数据`。',
          platform: '需要后端适配器',
          example: `// 唯一正确的用法：先 has 再 call（静态站上这段会被安全跳过）
if (gameAPI.host.has('my-mod')) {
  const r = await gameAPI.host.call('my-mod', 'stat', { key: 'x' })
}`,
        },
      ],
    },

    // ---------- require ----------
    {
      id: 'require',
      title: '10. require：随包分发的运行时依赖',
      blocks: [
        {
          t: 'p',
          text: '`require(id)` 是**同步**的，只认 `manifest.modules` 里声明过的模块。依赖必须以**自包含单文件**随包分发（约定放 `vendor/`）。',
        },
        {
          t: 'code',
          lang: 'json',
          label: 'manifest.json',
          code: `{ "name": "my-mod", "version": "1.0.0", "modules": { "fflate": "vendor/fflate.mjs" } }`,
        },
        {
          t: 'code',
          lang: 'js',
          label: 'code.js',
          code: `const { strToU8, zipSync } = require('fflate')   // 同步拿到模块命名空间`,
        },
        {
          t: 'table',
          head: ['情况', '失败信息'],
          rows: [
            ['没声明就 require', "`Mod X 没有声明模块 'fflate'（可用：无）`"],
            ['声明了但加载失败', "`Mod X 的模块 'fflate' 声明了但加载失败（见加载日志）：<原因>`"],
            ['完全没传注册表（deny 版）', "`Mod X 不能 require('fflate')：它没有在 manifest.modules 里声明任何运行时模块。（依赖要作为自包含单文件随包分发，例如 vendor/<id>.mjs，并在 manifest.modules 里登记）`"],
          ],
        },
        {
          t: 'note',
          kind: 'warn',
          text: '**为什么必须单文件**：zip 装出来的 Mod 在浏览器里只有 `blob:` URL，而 `blob:` 没有目录基准 → 依赖内部的任何相对导入都会解析到不存在的路径。Node 侧的 `server.js` 没有这个限制（原生 ESM，相对路径可用）。',
        },
      ],
    },

    // ---------- 边界 ----------
    {
      id: 'boundaries',
      title: '11. 没有的东西（扩展前先看这里）',
      blocks: [
        {
          t: 'p',
          text: '下面每一条都是"引擎里根本没有对应实现"，不是"文档没写"。设计新功能时如果撞上它们，要么换方案，要么先改引擎（并同步本文档）。',
        },
        {
          t: 'table',
          head: ['做不到的事', '实情'],
          rows: [
            ['**加界面**', '没有页面/组件/路由/属性面板/统计项的注册 API。Mod 定义的新参数与新统计**不会自动出现在界面上**（统计项还必须在 `statistics-view.js` 里登记，那是前端源码）'],
            ['**订阅成就达成**', '成就广播走 Life 自己的 emit，与 Mod 钩子总线是两条通道（见 §3 末）'],
            ['**network API**', '`permissions` 里的 `network` 只是声明字符串，**没有对应 API**（也没有强制）。`storage` 已于 2026-10 有对应 API：见 §13 的 `gameAPI.storage`'],
            ['**utils（工具函数）**', 'gameAPI 不提供工具函数（没有深拷贝 / 格式化 / 随机数）；`log` 已于 2026-10 提供（见 §13）'],
            ['**成就删除**', '只有 `addAchievement` / `getAchievement`'],
            ['**characters / age 的专用 API**', '只能直接操作 `gameAPI.data.characters` / `.age`（引用，改了立即生效）'],
            ['**逐岁异步介入**', '`life.next()` 是同步函数，三个逐岁钩子走 `emitSync` → async 回调的 Promise 被丢弃。"每年调一次后端"必须先付"把 next() 改成 async"的代价'],
            ['**沙箱**', '`new Function` 执行、只注入 gameAPI：浏览器侧 Mod 摸得到 `window`/`document`，Node 侧 `server.js` 是真 ESM（`node:fs`、`child_process` 都能用）。"完全权限"是 Mod 模型的既定前提，不是缺陷'],
            ['**回滚/卸载数据**', '加载并执行过的 Mod 数据与钩子没有"卸载"接口（钩子只能靠 `on` 返回的注销函数手动摘），游戏内数据在重开一局时按原始内容重建'],
            ['**拿到 AI 配置**', '浏览器侧目前不给 Mod 注入 AI 配置（`ai.available` 为 false）；`manifest.ai` 字段引擎**从不读取**'],
          ],
        },
      ],
    },

    // ---------- 权限与失败 ----------
    {
      id: 'perms-failures',
      title: '12. permissions 的真实地位 + 常见失败表现',
      blocks: [
        {
          t: 'sub',
          text: 'permissions 目前是"声明 + 界面展示"',
        },
        {
          t: 'note',
          kind: 'warn',
          text: '合法值是 `ai` / `network` / `storage` / `hooks`（写别的会被 manifest 校验拒绝：`未知权限: hack`）。但**引擎里没有任何强制点**：`createGameAPI` 根本收不到 manifest，`checkPermissions` 只有测试在调用，界面上的授权弹窗只关弹窗+打日志、不落盘。所以**不要**以为"没写 hooks 权限就不能注册钩子"——能的。它现在的真实作用是给用户看的声明，以及给未来接线留的位置。',
        },
        {
          t: 'sub',
          text: '常见失败表现（原文，便于对着日志排错）',
        },
        {
          t: 'table',
          head: ['现象', '日志/错误原文', '原因'],
          rows: [
            ['Mod 没出现', '`Mod X 缺少 manifest.json`', '目录里没有 manifest 文件'],
            ['Mod 没出现', '`Mod X manifest 非法: 缺少必填字段: version; 未知权限: hack`', 'manifest 校验不过（多项用 `; ` 连接）'],
            ['加载了但没效果', '（无任何错误）', '钩子名写错 / 事件没进 age 表 / 天赋 grade 不是数字 —— 这类**不会报错**'],
            ['code.js 没跑', '`执行 X/code.js 失败: Unexpected token \'export\'`', '写成了 ES 模块'],
            ['顺序不对', '`缺失依赖: Y`', 'dependencies 里写了不存在的 Mod（被用户禁用的依赖**不会**报这条）'],
            ['循环依赖', '`循环依赖: a → b → a`', '依赖成环（仍会加载，顺序按 DFS 结果）'],
            ['事件没生效', '`doEvent: 事件缺失或异常（[ERROR] No Event[123]），跳过`', 'age 表引用了不存在的事件 id（是 warn，不会崩）'],
            ['zip 装不上', '`zip 缺少 manifest.json（Mod 包根目录必须有它）` / `zip 条目过多（N > 512）` / `<path>（超过单文件上限 8388608 字节）`', '包结构或体积问题'],
            ['系统 Mod 被拒', '`lifeRestart-data 是系统 Mod，不能被未经确认的包覆盖（装回来请二次确认）`', '系统名保护（用户二次确认后可覆盖）'],
          ],
        },
        {
          t: 'sub',
          text: '怎么验证你的 Mod',
        },
        {
          t: 'list',
          ordered: true,
          items: [
            '页面：Mod 管理页启用它 → 设置页把日志级别调到 `debug`/`trace` → 玩一局看轨迹与日志',
            '页面：点卡片上的「查看数据 →」看它到底装进去了哪些表、多少条（数据层与引擎同一套读取实现）',
            'CLI：`node src/cli/mod.cli.js ../../mods` 看依赖图、加载顺序、合并数据条数与钩子表',
            'CLI：`node src/cli/ai-game.cli.js --mods ../../mods --mock-ai --seed 42` 真跑一局（不需要 Key）',
          ],
        },
        {
          t: 'link',
          to: '/mods/example-mod',
          text: '对照示例 Mod 的数据（它把上面这些都用了一遍）',
        },
      ],
    },
  ],
}
