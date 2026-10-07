// example-mod/code.js —— 示例 Mod 的代码入口（教学用，逐段注释）
//
// ⚠️ 这不是 ES 模块：引擎把它当**脚本体**执行（loader.js:258）：
//     new Function('gameAPI', 'require', '"use strict";\n' + 你的代码)(gameAPI, requireFn)
//   所以：
//     · 不要写 export / import（直接语法错误）；
//     · 不能用顶层 await（不是 async 函数）；
//     · 作用域里只有两样东西：`gameAPI` 与 `require`（require 只认 manifest.modules 声明过的模块）；
//     · 想看日志就用 gameAPI.log（**2026-10 起可用**；console.log 在打包环境不进日志面板）。
//
// 完整字段与 API 清单见页面里的「Mod 制作文档」/「gameAPI 参考」（/mods/docs、/mods/api）。

// ── 0. 先探能力，再使用 ────────────────────────────────────────────
// gameAPI.param 只有在"宿主已经建好 Life"时才存在（浏览器侧有；别假设一定有）。
// gameAPI.host 在纯静态站里是**空桥**：available 为空、has() 恒 false、call() 抛错。
// gameAPI.ai 只在用户配了 API Key 时 available 才为 true。
// gameAPI.property 只有在跑到一局游戏里时才 available（见第 6 节）。
gameAPI.log.info(
  '[example-mod] 能力探测 →',
  'param:', gameAPI.param ? '可用' : '不可用',
  '| property:', gameAPI.property && gameAPI.property.available ? '可用' : '不可用（降级桥）',
  '| asset:', gameAPI.asset && gameAPI.asset.available ? '可用' : '不可用（降级桥）',
  '| host:', gameAPI.host && gameAPI.host.available && gameAPI.host.available.length ? gameAPI.host.available.join(',') : '（无后端，静态站正常现象）',
  '| ai:', gameAPI.ai && gameAPI.ai.available ? '已配置' : '未配置',
)

// ── 1. 注册一个新参数（能让条件里多出一个 params.XXX）──────────────
if (gameAPI.param) {
  // type: 'local' = 本局标量，重开一局时归零。
  gameAPI.param.define('LUCK_EXAMPLE', { type: 'local', label: '示例幸运值' })
  // 其它 type（详见 API 文档）：
  //   { type: 'derived', formula: 'CHR + STR + INT' }   派生值，读取时实时算
  //   { type: 'array' }                                  本局数组
  //   { type: 'storage', storeKey: 'EXAMPLE_KEY' }       跨局持久化
  // 注册后就能在**任何条件**里用：params.LUCK_EXAMPLE > 3
}

// ── 2. 三个逐岁/抽卡钩子（同步！异步回调会被丢弃）──────────────────
// onTalentPoolGenerate：抽卡前触发，payload.pool 是候选数组，push 进去就算进了池子。
gameAPI.on('onTalentPoolGenerate', function (payload) {
  // 池子里已有就不重复塞（这个钩子每局都会触发）。
  var has = payload.pool.some(function (t) { return t.id === '90001' })
  if (!has) {
    payload.pool.push({ id: '90001', name: '示例·锦鲤', description: '示例天赋：CHR+1、SPR+1', grade: 1 })
  }
})

// onYearAdvance：每翻一年触发一次，payload = { age, content, isEnd }。
// 往 payload.content 里 push 的条目会出现在当年轨迹里（必须在**同步**过程里 push）。
gameAPI.on('onYearAdvance', function (payload) {
  // 幸运值每年 +1（演示 param.change；param 可能不存在，所以先判断）。
  if (gameAPI.param) gameAPI.param.change('LUCK_EXAMPLE', 1)
  // 每到整十岁，往当年轨迹里追加一句。
  if (payload.age > 0 && payload.age % 10 === 0) {
    var luck = gameAPI.param ? gameAPI.param.get('LUCK_EXAMPLE') : '-'
    payload.content.push({ type: 'EVT', description: '【示例 Mod】你 ' + payload.age + ' 岁了，示例幸运值 ' + luck })
  }
  // 30 岁那年，往轨迹里塞一张**包内的图**（2026-10 能力补齐 ②）。
  // 界面识别这个受控占位符并渲染成真 `<img>`（资源读不到就原样显示这几个字符，不报错）。
  if (payload.age === 30) {
    payload.content.push({ type: 'EVT', description: '【示例 Mod】你翻出了小时候的照片 {{asset:assets/logo.png}}' })
  }
  // **改真实游戏属性**（2026-10 起可用）：20 岁那年精神 +3。
  // ⚠️ 为什么放在逐岁钩子里而不是 code.js 顶层：code.js 跑在 `life.start()`（开局分配属性）
  //    **之前**，那时改属性会被随后的开局分配覆盖掉。要改属性就在游戏过程中的时机改。
  if (payload.age === 20 && gameAPI.property && gameAPI.property.available) {
    gameAPI.property.change('SPR', 3)
    payload.content.push({ type: 'EVT', description: '【示例 Mod】你 20 岁了，精神 +3（示例属性改动）' })
  }
})

// onEventRender：渲染事件文本时触发；**唯一一个返回值生效的钩子**（返回字符串会替换原文）。
gameAPI.on('onEventRender', function (payload) {
  if (typeof payload.text === 'string' && payload.text.indexOf('示例事件') !== -1) {
    return '✨ ' + payload.text
  }
  // 返回 undefined = 不改。
  return undefined
})

// propertyChange：**任何**属性变化都会触发（2026-10 起）——包括引擎内部的事件/天赋效果、
// 年龄自增、成就记账。payload = { prop, value, source }，source 是 'engine'（引擎内部）
// 或 'mod'（本 Mod 自己通过 gameAPI.property.* 改的）。观察时通常只看 'engine'，
// 否则"我自己改的"会把通知刷屏（年龄自增那种一年一条的噪声也是这么来的）。
gameAPI.on('propertyChange', function (payload) {
  if (payload.source === 'engine') {
    gameAPI.log.debug('[example-mod] 引擎改了属性：', payload.prop, payload.value)
  }
})

// ── 3. 运行时增删数据（效果与写数据文件等价，只是发生在代码里）──────
// ⚠️ 浏览器侧有个**真陷阱**：code.js 是在 `life.initial()` **之后**才执行的（因为要拿到
//    Life 的参数注册表），所以这里加进去的天赋**绕过了引擎的规范化**（talent.js 只在 initial
//    里补 id/grade/maxTriggers）。后果：
//      · `grade` 必须是**数字**，否则它永远不会被抽到（抽卡按数字等级分池）；
//      · `maxTriggers` 必须**显式写**，否则触发判定 `0 < undefined` 为假 → 效果永不生效。
//    写数据文件里的天赋不用管这两条（initial 会补齐）。
gameAPI.addTalent({ id: '90004', name: '示例·运行时天赋', description: '由 code.js 在运行时加进来', grade: 0, maxTriggers: 1, effect: { SPR: 1 } })
gameAPI.addEvent({ id: '90005', event: '【示例事件】你梦见自己在写 Mod。', effect: { INT: 1 } })
gameAPI.addAchievement({ id: '90002', name: '示例·Mod 作者', description: '启用示例 Mod 并跑出轨迹', grade: 1, condition: 'params.AGE > 0', hide: 0, opportunity: 'END' })
// 反向操作同样存在：removeTalent(id) / removeEvent(id)。成就**没有** remove。

// ── 4. 读数据（只读视图）──────────────────────────────────────────
// gameAPI.data 就是合并后的数据表；按 id 取单条用 getTalent/getEvent/getAchievement。
gameAPI.log.info('[example-mod] 当前天赋条数:', Object.keys(gameAPI.data.talents || {}).length)

// ── 5. 用随包分发的依赖（需要 manifest.modules 声明过才 require 得到）──
// 示例：manifest 里写 "modules": { "fflate": "vendor/fflate.mjs" }，然后：
//   var fflate = require('fflate')
// 没声明的模块名会直接抛错（这是故意设计的：依赖必须随包分发、运行期解析）。

// ── 6. 改游戏属性：见上面 onYearAdvance 里 20 岁那一段 ──────────────
// 要点（2026-10 起 `gameAPI.property` 是真的游戏属性，不再是自定义区）：
//   ① `available` 要先判断：宿主没跑到一局游戏里时是**降级桥**，写操作会抛可读错误；
//   ② 时序：code.js 跑在 `life.start()`（开局分配属性）**之前**，在这里直接改会被覆盖 ——
//      要改属性就找游戏过程中的时机（逐岁钩子 / 事件触发后的某一岁）；
//   ③ 观察变化用 `propertyChange`（见上），并用 `payload.source` 过滤掉自己造成的。

// ── 7. 用包里的**资源文件**（图片/音频/字体；2026-10 能力补齐 ②）────
// 本 Mod 的包里就带了一张图：`assets/logo.png`（1×1 的极小 PNG，70 字节）。
//
// 三条要点（照抄这段就能用）：
//   ① **先问 available 再用**：宿主没注入资源能力时 `gameAPI.asset` 是**降级桥**
//      （`available: false`，读操作抛可读错误）—— 无条件调用会炸。
//   ② `url(path)` 在浏览器里给 `blob:` URL（可直接当 `<img src>`），**同路径恒同 URL**；
//      Node 里没有 `URL.createObjectURL`，降级成**绝对文件路径**。
//   ③ 轨迹文本里写 `{{asset:assets/logo.png}}`，界面会把它渲染成真的 `<img>`
//      （走的是同一条 `asset.url()` 通道；**绝不用 v-html**）。资源缺失时原样显示占位符。
if (gameAPI.asset && gameAPI.asset.available) {
  // 列出包里的资源（只列图片/音频/字体；`manifest.json`/`code.js` 不在其中）。
  gameAPI.asset.list().then(function (list) {
    // 日志（debug 级：资源清单在排障时有用，但不该刷屏）。
    gameAPI.log.debug('[example-mod] 包内资源：', list.join(', ') || '（无）')
    // 取一个可直接用的 URL（blob URL / 绝对路径）并把结果说清楚。
    return gameAPI.asset.url('assets/logo.png')
  }).then(function (url) {
    // 有就报出来（`url` 是 undefined 时说明这个包没带那张图）。
    gameAPI.log.info('[example-mod] 资源 assets/logo.png →', url || '（读不到，界面会降级成文本）')
  }).catch(function (e) {
    // 读资源失败不致命（界面照样能玩），但必须**出声**。
    gameAPI.log.warn('[example-mod] 读取资源失败：', e.message)
  })
} else {
  // 降级分支：这句日志让"为什么图没出来"变得可查。
  gameAPI.log.info('[example-mod] 当前宿主没有资源能力（gameAPI.asset.available === false）：资源相关的代码被安全跳过')
}

// ── 8. 与本 Mod 的后端入口通信（本示例没有 server.js → 走降级分支）──
if (gameAPI.host && gameAPI.host.has && gameAPI.host.has('example-mod')) {
  gameAPI.host.call('example-mod', 'hello', { from: 'code.js' }).then(function (r) {
    gameAPI.log.debug('[example-mod] 后端返回', r)
  })
} else {
  gameAPI.log.info('[example-mod] 没有可用的后端：这段代码在静态站上被安全跳过')
}

// ── 9. 加界面（2026-10 能力补齐 ③）────────────────────────────────
// 两种注册源，**职责不同**（这是这一节最重要的一句话）：
//   ① manifest.ui（静态声明）——应用**启动时**收集，主页 / Mod 管理页也能看到；
//      本 Mod 的 manifest 里就有一段（1 个页面 + 1 个 home 面板 + 1 个属性项 + 1 个统计）。
//   ② gameAPI.ui.*（运行期注册）——只有 code.js 执行时才可用（= 一局游戏已经建好），
//      适合"按条件显示"。**启动时不执行 code.js**（它需要 Life，重复执行还会重复注册钩子），
//      所以运行期注册的东西在开局前是不存在的。
//
// ⚠️ 必须先判断 `available`：CLI 之类的宿主没有界面注册能力，注册调用会抛**可读错误**
//    （不静默丢弃 —— 静默丢弃会表现成"界面里没有我加的东西，也没有任何提示"）。
if (gameAPI.ui && gameAPI.ui.available) {
  // 运行期加一个面板（插到 `game` slot）。
  // ⚠️ 目前真的挂了界面的 slot 是 home / mods / property / summary；`game` 与 `settings`
  //    能校验、能注册，但页面上暂时没有挂载点 —— 这里的演示刻意用一个**已挂载**的 slot，
  //    这样启用示例 Mod 后你在总结页就能看到它。
  gameAPI.ui.addPanel({
    id: 'example-runtime-panel',
    slot: 'summary',
    title: '示例 Mod · 运行期面板',
    blocks: [
      { t: 'p', text: '这张卡片是 code.js 在**开局之后**用 gameAPI.ui.addPanel 注册的。' },
      { t: 'note', kind: 'tip', text: '对比一下：主页那张卡片来自 manifest.ui（启动即可见），这张只在开了一局之后才存在。' },
      // 动作按钮：注册过就是可点的，没注册就是**禁用** + 可读提示。
      { t: 'action', id: 'example-hello', label: '点我（示例动作）' }
    ],
  })
  // 动作处理函数（异常隔离：这里抛错只会记一条日志，不会炸页面）。
  gameAPI.ui.onAction('example-hello', function (block) {
    gameAPI.log.info('[example-mod] 动作按钮被点了：', block && block.id)
  })
  // 让「统计」里真的多出一项：**两步**
  //   ① addStatistic 让引擎产生这个键；② addStat 告诉界面怎么显示它。
  //   （顺序反了也能显示，但统计键不存在时界面会跳过它并记 warn。）
  gameAPI.ui.addStatistic('EXAMPLE_YEARS', 0)
  gameAPI.ui.addStat({ key: 'EXAMPLE_YEARS', label: '示例 · 走过的年头', kind: 'count' })
  gameAPI.log.info('[example-mod] 已注册界面扩展（1 个运行期面板 + 1 个统计项 + 1 个动作）')
} else {
  // 降级分支：这句日志让"为什么界面上没有它"变得可查。
  gameAPI.log.info('[example-mod] 当前宿主没有界面注册能力（gameAPI.ui.available === false）：界面扩展被安全跳过（用 manifest.ui 声明的那些仍然可见）')
}

// 每年把那个统计项 +1（演示"统计项的值由 Mod 自己维护"）。
// 注意：`addStatistic` 是**覆盖**语义，所以这里自己累计一份计数。
var exampleYears = 0
gameAPI.on('onYearAdvance', function () {
  // 累计（与界面能力无关：引擎侧的统计键登记在宿主没有界面能力时是安全的空操作）。
  exampleYears += 1
  // 写回（宿主没有界面能力时 `available` 为 false，整段跳过）。
  if (gameAPI.ui && gameAPI.ui.available) {
    gameAPI.ui.addStatistic('EXAMPLE_YEARS', exampleYears)
  }
})
