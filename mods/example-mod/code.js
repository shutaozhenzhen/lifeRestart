// example-mod/code.js —— 示例 Mod 的代码入口（教学用，逐段注释）
//
// ⚠️ 这不是 ES 模块：引擎把它当**脚本体**执行（loader.js:258）：
//     new Function('gameAPI', 'require', '"use strict";\n' + 你的代码)(gameAPI, requireFn)
//   所以：
//     · 不要写 export / import（直接语法错误）；
//     · 不能用顶层 await（不是 async 函数）；
//     · 作用域里只有两样东西：`gameAPI` 与 `require`（require 只认 manifest.modules 声明过的模块）；
//     · 想看日志就用 console.log —— gameAPI **没有** log 方法。
//
// 完整字段与 API 清单见页面里的「Mod 制作文档」/「gameAPI 参考」（/mods/docs、/mods/api）。

// ── 0. 先探能力，再使用 ────────────────────────────────────────────
// gameAPI.param 只有在"宿主已经建好 Life"时才存在（浏览器侧有；别假设一定有）。
// gameAPI.host 在纯静态站里是**空桥**：available 为空、has() 恒 false、call() 抛错。
// gameAPI.ai 只在用户配了 API Key 时 available 才为 true。
console.log(
  '[example-mod] 能力探测 →',
  'param:', gameAPI.param ? '可用' : '不可用',
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
  // 幸运值每年 +1（演示 param.change；param 可能不存在，所以用可选链）。
  if (gameAPI.param) gameAPI.param.change('LUCK_EXAMPLE', 1)
  // 每到整十岁，往当年轨迹里追加一句。
  if (payload.age > 0 && payload.age % 10 === 0) {
    var luck = gameAPI.param ? gameAPI.param.get('LUCK_EXAMPLE') : '-'
    payload.content.push({ type: 'EVT', description: '【示例 Mod】你 ' + payload.age + ' 岁了，示例幸运值 ' + luck })
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

// propertyChange：只有 gameAPI.property.set 会触发它（引擎内部改属性**不**触发）。
gameAPI.on('propertyChange', function (payload) {
  console.log('[example-mod] propertyChange:', payload.prop, '=', payload.value)
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
console.log('[example-mod] 当前天赋条数:', Object.keys(gameAPI.data.talents || {}).length)

// ── 5. 用随包分发的依赖（需要 manifest.modules 声明过才 require 得到）──
// 示例：manifest 里写 "modules": { "fflate": "vendor/fflate.mjs" }，然后：
//   var fflate = require('fflate')
// 没声明的模块名会直接抛错（这是故意设计的：依赖必须随包分发、运行期解析）。

// ── 6. 触发一次 propertyChange（顺便说清它是什么）────────────────────
// 两个容易误解的点：
//   ① `propertyChange` **只**由下面这一行触发；引擎内部改属性（事件/天赋效果）**不触发**它，
//      所以它不是"观察游戏属性变化"的钩子，而是给 Mod 之间通信用的小工具。
//   ② `gameAPI.property.*` 读写的是数据对象上的一个**自定义区**（`data.properties`），
//      **和游戏属性系统（CHR/INT/…）没有关系**：想改游戏属性请走「效果 effect」或「参数 param」。
gameAPI.property.set('EXAMPLE_NOTE', '来自 example-mod 的一句话')

// ── 7. 与本 Mod 的后端入口通信（本示例没有 server.js → 走降级分支）──
if (gameAPI.host && gameAPI.host.has && gameAPI.host.has('example-mod')) {
  gameAPI.host.call('example-mod', 'hello', { from: 'code.js' }).then(function (r) {
    console.log('[example-mod] 后端返回', r)
  })
} else {
  console.log('[example-mod] 没有可用的后端：这段代码在静态站上被安全跳过')
}
