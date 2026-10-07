/**
 * mod-doc-guide — 「Mod 制作文档」的**内容数据**（页面由 components/DocPage.vue 渲染）
 *
 * 事实来源（2026-10 逐行核对）：`mod/manifest.js`（字段与校验原文）、`mod/loader.js`（加载/合并/
 * code.js 执行）、`modules/{talent,event,achievement,character,property}.js`（各表字段的真实消费点）、
 * `params/param-registry.js`、`mod/modules.js`（运行时依赖）、`mod/zip.js`（包限制）。
 *
 * 这份文档的样板是仓库里的 `mods/example-mod/` —— 文中每段都能在它里面找到对应文件，
 * 并且有 `packages/game-engine/src/mod/example-mod.spec.js` 真跑一局钉住"样板没坏"。
 */

// #MOD_GUIDE
// 制作文档。
export const MOD_GUIDE = {
  // 文档 id（锚点前缀）。
  id: 'mod-guide',
  // 标题。
  title: 'Mod 制作文档',
  // 副标题。
  subtitle: '从零做一个 Mod：目录结构 · manifest 每个字段 · 5 张数据表 · code.js 与钩子 · 调试 · 打包分发',
  // 章节。
  sections: [
    // ---------- 五分钟 ----------
    {
      id: 'quickstart',
      title: '1. 五分钟做出第一个 Mod',
      blocks: [
        {
          t: 'p',
          text: '一个最小可用的 Mod 只有两个文件：`manifest.json`（它是什么）+ 若干数据文件或 `code.js`（它做什么）。',
        },
        {
          t: 'code',
          lang: 'text',
          label: '目录结构',
          code: `my-mod/
├── manifest.json      # 必需：name + version
├── talents.json       # 可选：天赋表（想加天赋就写）
├── events.json        # 可选：事件表
├── achievements.json  # 可选：成就表
├── characters.json    # 可选：名人表
├── age.json           # 可选：年龄表（"哪一岁可能发生哪些事件"）
├── code.js            # 可选：代码入口（钩子 / 参数 / 运行时改数据）
├── vendor/            # 可选：随包分发的依赖（自包含单文件）
└── README.md          # 可选但强烈建议
`,
        },
        {
          t: 'code',
          lang: 'json',
          label: 'manifest.json（最小）',
          code: `{
  "name": "my-mod",
  "version": "1.0.0"
}`,
        },
        {
          t: 'code',
          lang: 'json',
          label: 'talents.json（加一个天赋）',
          code: `{
  "my-t1": {
    "id": "my-t1",
    "name": "锦鲤",
    "description": "运气不错（魅力+1）",
    "grade": 1,
    "effect": { "CHR": 1 }
  }
}`,
        },
        {
          t: 'sub',
          text: '三种装上它的方式',
        },
        {
          t: 'list',
          ordered: true,
          items: [
            '**上传 zip**：把整个目录打成 zip（里面要有 `manifest.json`，支持外面多包一层目录）→ Mod 管理页的「+ 安装 Mod（.zip）」',
            '**从 GitHub 装**：把目录推到公开仓库 → Mod 管理页粘链接 → 「⬇ 从 GitHub 安装」（详细规则见第 12 节）',
            '**放进仓库的 `mods/` 目录**：`mods/my-mod/…` → 跑 `node packages/frontend/scripts/sync-mods.mjs`（dev/build 会自动跑）→ 页面即可发现',
          ],
        },
        {
          t: 'note',
          kind: 'tip',
          text: '装好后点卡片上的「查看数据 →」就能看到它到底装进去了什么（表计数 / 分布 / 逐条浏览）。数据页用的是**引擎同一套读取实现**，所以"页面显示什么"就是"引擎会加载什么"。',
        },
      ],
    },

    // ---------- 边界 ----------
    {
      id: 'what',
      title: '2. Mod 能做什么、不能做什么',
      blocks: [
        {
          t: 'table',
          head: ['能做', '不能做'],
          rows: [
            ['**加/改数据**：天赋、事件、成就、名人、年龄表（后加载覆盖先加载）', '**默认同步**：不声明 `async: true` 时，逐岁流程里的 async 回调返回的 Promise 会被丢弃（改动晚于引擎读取）'],
            ['**异步介入逐岁流程**（2026-10 起）：`"async": true` + `onBeforeYear` / `onYearAdvance` / `onAfterYear` 里可以 `await`（内容真的进**当年**轨迹）', '**异步不是免费的**：单个异步钩子超 3 秒 → 记 warn 并继续推进；批量模拟与一致性检查会**跳过** `async: true` 的 Mod（异步 = 不可逐位复现），报告里会写明'],
            ['**加界面**（2026-10 起，见 §14）：页面（`/mods/page/:id`）、面板卡片（插到 home / mods / property / game / summary / settings 六个 slot）、属性分配面板多一行、总结页统计多一项', '**私有仓库 / 任意 URL 安装**：只支持 zip 与 GitHub 公开仓库'],
            ['挂**钩子**：抽卡池、每一年、事件文本渲染，以及**观察任何属性变化**（`propertyChange`，带 `source` 区分来源）', '**Mod 之间没有正式 API**：只能自定义钩子名互发消息，或共享 `gameAPI.data`'],
            ['**注册新参数**：条件里立刻能用的 `params.XXX`', '**发布到应用商店/被审核**：没有中心化分发，也没有访问控制'],
            ['**带资源文件**：包里放图片 / 音频 / 字体（`assets/`），用 `gameAPI.asset` 读出来（2026-10 起）', '**加音频/动画的系统级能力**：资源能读出来，但播放要自己在浏览器里做（没有音频通道 API）'],
            ['**运行期改数据**：`addTalent` / `addEvent` / `addAchievement` 等', '**往任意位置插组件**：只有下面这四种扩展点与六个 slot，没有通用 DOM/组件注册'],
            ['**改游戏属性**：`gameAPI.property.change/set/effect` 直接读写真实属性（2026-10 起）', '**超 8 MB 的单个资源 / 超 32 MB 的整包**：会被跳过（不是拒绝安装）'],
            ['**调用 AI**（需用户配 Key）与**本 Mod 的后端**（需 `server.js`）', '**还没挂界面的 slot**：`game` / `settings` 两个 slot 能校验、能注册，但页面上暂时没有挂载点（见 §14 的"哪些 slot 真的挂了"）'],
          ],
        },
        {
          t: 'note',
          kind: 'info',
          text: '一条贯穿全项目的硬约束：**引擎不内置任何游戏内容**。天赋/事件/成就/名人都只能来自 Mod 或数据目录 —— 所以"你没装任何内容 Mod"时游戏就是空内容，这不是 bug（见 `_准则_Mod设计.md` B4）。',
        },
      ],
    },

    // ---------- manifest ----------
    {
      id: 'manifest',
      title: '3. manifest.json：每个字段都讲一遍',
      blocks: [
        {
          t: 'table',
          head: ['字段', '类型', '必填', '缺省', '作用与校验'],
          rows: [
            ['`name`', 'string', '**是**', '—', 'Mod 名。校验 `/^[a-zA-Z0-9_-]+$/`（只能字母数字连字符下划线），不合法报 `name 只能包含字母数字连字符`。**建议与目录名一致**（页面按目录名寻址，两者允许不同但容易绕晕自己）'],
            ['`version`', 'string', '**是**', '—', '版本号。**没有格式校验**（写 `abc` 也合法），只用于显示与导出 zip 的文件名'],
            ['`author`', 'string', '否', '—', '作者。完全不校验，仅显示'],
            ['`description`', 'string', '否', '—', '一句话说明。显示在 Mod 卡片上；不写就显示"（该 Mod 未提供描述）"'],
            ['`permissions`', 'string[]', '否', '`[]`', '合法值只有 `ai` / `network` / `storage` / `hooks`，写别的报 `未知权限: x`。**目前不强制**（见 API 文档 §12），是给用户看的声明'],
            ['`dependencies`', 'string[]', '否', '`[]`', '依赖的 Mod 名（**写目录名/源里的名字**）。决定加载顺序：被依赖的先加载。缺失报 `缺失依赖: x`，成环报 `循环依赖: a → b → a`'],
            ['`system`', 'boolean', '否', '—', '标记"系统内置"。**与能否删除无关**（预装 Mod 也能完全移除），也**不**参与安装侧的名字保护（那份名单是硬编码的 `lifeRestart-data` / `ai-mod`）'],
            ['`targets`', 'string[]', '否', '`["browser"]`', '运行目标：`browser`（执行 code.js）/ `node`（加载 server.js）。空数组、重复项、未知值都会被拒绝'],
            ['`entry`', 'object', '否', '`{browser:"code.js"}`', '入口文件名。**只有 `entry.node` 生效**（宿主入口）；浏览器入口固定读 `code.js`，写 `entry.browser` 只影响界面显示'],
            ['`deterministic`', 'boolean', '否', '由 targets 推导', '声明"行为可复现"（**已真的被消费**：`false` 的 Mod 会被批量模拟与一致性检查跳过，并在报告里写明理由）'],
            ['`async`', 'boolean', '否', '`false`', '**异步逐岁介入的 opt-in 开关**（2026-10 起）：写 `true` 后，前端推进改用 `life.nextAsync()`，本 Mod 的逐岁钩子会被 **await**（"某年去后端取一句剧情塞进当年轨迹"因此成立）。不写 = 一切照旧（同步 `life.next()`）。非布尔值是**硬错误**'],
            ['`asyncHooks`', 'string[]', '否', '（省 = 全部逐岁钩子）', '可选细化：只把列出的逐岁钩子按异步等。合法值**只有** `onBeforeYear` / `onYearAdvance` / `onAfterYear`；写别的（如 `onEventRender`）或空数组/重复项都是**硬错误**。见 §6 与 API 文档 §16'],
            ['`modules`', 'object', '否', '`{}`', '运行时依赖：`{ 模块名: 包内相对路径 }`，见第 10 节'],
            ['`ai`', 'object', '否', '—', '**引擎从不读取**（历史字段）。AI 配置实际来自用户设置页 / CLI 环境变量'],
            ['`ui`', 'object', '否', '—', '**界面扩展**（2026-10 起）：`{ pages, panels, properties, stats }` 四类，每类 ≤ 8 项，见 §14。**写错会拒绝加载**（未知 slot、超上限、同 Mod 重复 id 都是硬错误）'],
          ],
        },
        {
          t: 'note',
          kind: 'info',
          text: '**未知字段会被忽略，不会拒绝**（校验器只逐个检查白名单字段）。所以写错字段名不会报错，只是不生效 —— 这是最容易查半天的地方。',
        },
        {
          t: 'code',
          lang: 'json',
          label: '示例 Mod 的 manifest（仓库里真实存在）',
          code: `{
  "name": "example-mod",
  "version": "1.0.0",
  "author": "lifeRestart 示例",
  "description": "示例 Mod（教学）：演示 5 张数据表、三个钩子、参数注册与 gameAPI 的用法",
  "permissions": ["hooks", "storage"],
  "dependencies": ["lifeRestart-data"]
}`,
        },
        {
          t: 'sub',
          text: 'manifest 校验失败的错误原文（照它改就行）',
        },
        {
          t: 'code',
          lang: 'text',
          code: `manifest 必须是对象
缺少必填字段: name / 缺少必填字段: version
name 只能包含字母数字连字符
permissions 必须是数组 / 未知权限: hack
dependencies 必须是数组
targets 必须是数组 / targets 不能是空数组（缺省为 ["browser"]） / 未知 target: server（合法值：browser / node） / targets 不能有重复项
entry 必须是对象 / entry 含未知目标键: web（合法键：browser / node） / entry.node 必须是不含路径穿越的相对文件名
deterministic 必须是布尔值
async 必须是布尔值 / asyncHooks 必须是数组 / asyncHooks 不能是空数组（缺省表示"本 Mod 用到的逐岁钩子都按异步等"）
asyncHooks 含未知钩子名: onYear（合法值：onBeforeYear / onYearAdvance / onAfterYear） / asyncHooks 不能有重复项
modules 必须是对象（{ 模块名: 相对路径 }） / modules.fflate 必须是不含路径穿越的相对路径
ui 必须是对象（{ pages, panels, properties, stats }） / ui 含未知字段: page（支持：pages / panels / properties / stats）
ui.panels[0].slot "sidebar" 不是合法 slot（可用：home/mods/property/game/summary/settings）
ui.pages[0].title 必须是非空字符串（页面要有个标题）
ui.pages[0].blocks 必须是非空的内容块数组（块类型见文档页：p/sub/note/list/table/code/link/api/action）
ui.stats[0].kind "percent" 不是合法类型（可用：count/ratio）
ui.pages 最多 8 项（当前 9 项） / ui.pages[1].id "p1" 与前面某个扩展项重复（id 在同一个 Mod 内必须唯一）

（外层还会包一层：Mod X manifest 非法: <上面若干条用 "; " 连接>）`,
        },
      ],
    },

    // ---------- 数据表 ----------
    {
      id: 'data',
      title: '4. 五张数据表：字段的真实含义',
      blocks: [
        {
          t: 'p',
          text: '数据文件的**文件名就是表名**（`talents.json` → `data.talents`）。每张表都是 `{ "id": { …条目… } }`，合并规则是**按 ID 整键替换**的一层浅合并（不是数组追加）。',
        },
        {
          t: 'sub',
          text: 'talents.json —— 天赋',
        },
        {
          t: 'code',
          lang: 'json',
          code: `{
  "my-t1": {
    "id": "my-t1",
    "name": "锦鲤",
    "description": "运气不错",
    "grade": 1,
    "effect": { "CHR": 1, "SPR": 1 },
    "condition": "params.AGE >= 30",
    "exclude": ["my-t2"],
    "maxTriggers": 1,
    "status": 2,
    "exclusive": false
  }
}`,
        },
        {
          t: 'table',
          head: ['字段', '含义'],
          rows: [
            ['`grade`', '**实质必填且必须是数字**（引擎会 `Number(grade)`）。抽卡按等级分池，缺失/非数字 → 分池对不上 → **永远抽不到**'],
            ['`effect`', '属性效果对象（`{ CHR: 1 }`）。不写就是"只出一句文本、不改属性"'],
            ['`condition`', '**触发时**才判定的门槛（不是"能不能进池"）：条件不满足时这次触发直接不生效'],
            ['`exclude`', '与这些天赋**互斥**（数组）。抽卡时会检查，不能同时拥有'],
            ['`maxTriggers`', '最多触发几次，缺省 1。**运行期用 `addTalent` 注入时必须显式写**（见第 6 节）'],
            ['`status`', '数字：带给玩家的**额外属性分配点**'],
            ['`exclusive`', 'truthy → **不进抽卡池**（只能被替换链换出来）'],
            ['`replacement`', '替换链：`{ grade: { "2": 权重 } }` 或 `{ talent: { "某ID": 权重 } }`；写成数组时用 `"ID*权重"` 的 DSL（引擎会在初始化时解析成映射）'],
          ],
        },
        {
          t: 'note',
          kind: 'warn',
          text: '真实数据里有 184 条天赋，其中 86 条有 `effect`、52 条有 `condition`、36 条 `exclusive`、25 条 `exclude`、15 条 `replacement`、10 条 `status`。**`grade` 的分布是 0/1/2/3 四档**（101/52/23/8 条）—— 新天赋选哪一档决定了它多容易被抽到。',
        },
        {
          t: 'sub',
          text: 'events.json —— 事件（注意正文的字段名）',
        },
        {
          t: 'code',
          lang: 'json',
          code: `{
  "my-e1": {
    "id": "my-e1",
    "event": "【示例事件】你在路边捡到一枚硬币。",
    "effect": { "MNY": 1 },
    "include": "params.AGE > 0",
    "exclude": "params.MNY > 100",
    "postEvent": "你把它收进了口袋。",
    "branch": ["params.MNY > 8:my-e2", "true:my-e3"],
    "grade": 1,
    "NoRandom": 0
  }
}`,
        },
        {
          t: 'table',
          head: ['字段', '含义'],
          rows: [
            ['`event`', '**正文文本**。字段名就叫 `event`（**不是** description）—— 写成 description 不会报错，只是事件里一个字都没有'],
            ['`effect`', '属性效果'],
            ['`include`', '条件：**必须满足**才能被随机触发'],
            ['`exclude`', '条件：**满足则禁止**随机触发'],
            ['`NoRandom`', 'truthy → 禁止随机触发（只能被 `branch` 链到）。真实数据里 152 条是这种'],
            ['`branch`', '`["条件:目标事件id", …]`，**按顺序取第一条满足的** → 递归执行目标事件。命中时本条事件的 `effect` 照常生效、但 `postEvent` 不会返回'],
            ['`postEvent`', '附加的一句后续文本（无分支命中时返回）'],
            ['`grade`', '事件等级（会带进轨迹条目，用于展示分级）'],
          ],
        },
        {
          t: 'note',
          kind: 'warn',
          text: '**光有事件定义不会触发**：事件必须被 `age.json` 某个年龄的 `event` 列表引用（带权重）才会被抽到。这是新手最常卡住的地方。',
        },
        {
          t: 'sub',
          text: 'achievements.json —— 成就',
        },
        {
          t: 'code',
          lang: 'json',
          code: `{
  "my-a1": {
    "id": "my-a1",
    "name": "活到十岁",
    "description": "第一次活到 10 岁",
    "grade": 1,
    "condition": "params.AGE >= 10",
    "hide": 0,
    "opportunity": "END"
  }
}`,
        },
        {
          t: 'table',
          head: ['字段', '含义'],
          rows: [
            ['`opportunity`', '**在哪个时机判定**，必须精确等于 `START` / `TRAJECTORY` / `SUMMARY` / `END` 之一。写错 → 永远不会达成（而且不报错）'],
            ['`condition`', '达成条件（省略 = 该时机一到就达成）'],
            ['`hide`', '1 = 隐藏（不显示在成就列表里）'],
            ['`id`', '**必须自带且与键一致**：引擎判定达成时用对象里的 `id` 记账'],
            ['`grade` / `name` / `description`', '展示用'],
          ],
        },
        {
          t: 'sub',
          text: 'characters.json —— 名人（名人模式的候选）',
        },
        {
          t: 'code',
          lang: 'json',
          code: `{
  "my-c1": {
    "id": "my-c1",
    "name": "我自己",
    "property": { "CHR": "5", "INT": "7", "STR": "4", "MNY": "7" },
    "talent": ["my-t1"]
  }
}`,
        },
        {
          t: 'table',
          head: ['字段', '含义'],
          rows: [
            ['`property`', '基础属性。真实数据里值是**字符串**（前端会 `Number()` 兜 0）；只用 CHR/INT/STR/MNY 四项'],
            ['`talent`', '自带天赋的 ID 数组 —— **必须是数组**（引擎直接 `.map`，写成字符串会抛 TypeError）'],
            ['`id`', '**必须自带**（前端按 `c.id` 匹配选中项）'],
          ],
        },
        {
          t: 'sub',
          text: 'age.json —— 年龄表（最容易踩的一张）',
        },
        {
          t: 'code',
          lang: 'json',
          code: `{
  "1": {
    "age": "1",
    "event": [
      ["my-e1", 20],
      ["10009", 10],
      ["10010", 10],
      ["10011", 1]
    ]
  }
}`,
        },
        {
          t: 'table',
          head: ['字段', '含义'],
          rows: [
            ['键（`"1"`）', '年龄。真实数据覆盖 0~500 岁，共 501 个键'],
            ['`event`', '`[事件id, 权重]` 的数组。引擎按权重随机抽一个；**不在这个列表里的事件永远不会发生**'],
            ['`age`', '条目里的这个字段引擎**不读**（真实数据里带着它，无害）'],
            ['`talent`', '（可选）该年龄自动获得的天赋 id 数组'],
          ],
        },
        {
          t: 'note',
          kind: 'warn',
          text: '**age 是"整键替换"，不是追加**：你写 `"1": {…}` 会把第 1 岁**整张列表**换掉。想"加一条"必须把原来的 id 一起抄进来（示例 Mod 就抄了 `10009/10010/10011`，否则"你从小生活在农村/城市/美国国籍"这三句会消失）。抄了 id 但没提供事件定义也不会崩：引擎对找不到的事件是 `try/catch + warn 跳过`（日志里出现 `doEvent: 事件缺失或异常（[ERROR] No Event[10009]），跳过`），但那一岁会少几句。',
        },
      ],
    },

    // ---------- code.js ----------
    {
      id: 'codejs',
      title: '5. code.js：脚本体，不是模块',
      blocks: [
        {
          t: 'p',
          text: '引擎执行 code.js 的方式是 `new Function(\'gameAPI\', \'require\', \'"use strict";\\n\' + 你的代码)(gameAPI, requireFn)` —— 所以：',
        },
        {
          t: 'list',
          items: [
            '**不要写 `export` / `import`**（直接语法错误 `Unexpected token \'export\'`）',
            '**不能用顶层 `await`**（不是 async 函数）。需要异步就写在钩子/回调里',
            '作用域里只有 `gameAPI` 与 `require`（还有 `console` 这类全局对象）',
            '`return` 合法但返回值没人接',
            '`"use strict"` 生效（函数体里的 `this` 是 `undefined`）',
            '执行是**同步**的；单个 Mod 抛错只影响它自己（记成 `执行 X/code.js 失败: <原因>`）',
          ],
        },
        {
          t: 'code',
          lang: 'js',
          label: 'code.js 的完整结构（示例 Mod 的骨架）',
          code: `// 1) 先探能力，再使用（能力不是"一定都有"）
console.log('[my-mod] param:', gameAPI.param ? '可用' : '不可用')

// 2) 注册参数（浏览器侧有；CLI 里 gameAPI.param 是 null，所以要判断）
if (gameAPI.param) gameAPI.param.define('MY_LUCK', { type: 'local' })

// 3) 挂钩子（同步回调；异步回调会被丢弃）
gameAPI.on('onYearAdvance', (payload) => {
  if (gameAPI.param) gameAPI.param.change('MY_LUCK', 1)
  if (payload.age % 10 === 0) payload.content.push({ type: 'EVT', description: '整十岁' })
})

// 4) 运行期改数据（注意 maxTriggers，见下）
gameAPI.addTalent({ id: 'my-t9', name: '运行时天赋', description: '…', grade: 0, maxTriggers: 1, effect: { SPR: 1 } })

// 5) 用随包依赖（manifest.modules 声明过才 require 得到）
// const fflate = require('fflate')
`,
        },
        {
          t: 'sub',
          text: '一个真陷阱：code.js 在两端的执行时机不同',
        },
        {
          t: 'table',
          head: ['路径', '执行时机', '后果'],
          rows: [
            ['Node CLI', '在 Life 构造与 `life.initial()` **之前**', '`addTalent` 注入的天赋**会**被引擎规范化（补 id/grade/maxTriggers）'],
            ['浏览器', '在 `await life.initial()` **之后**（因为要拿 Life 的参数注册表）', '注入的天赋**绕过**规范化 → `grade` 必须是数字、`maxTriggers` 必须显式写，否则**效果永不生效**（触发判定 `0 < undefined` 为假）'],
          ],
        },
        {
          t: 'note',
          kind: 'tip',
          text: '写**数据文件**里的天赋没这个问题（初始化时会补齐）。只有"运行期用 addTalent 注入"才要注意。',
        },
      ],
    },

    // ---------- 钩子 ----------
    {
      id: 'hooks',
      title: '6. 钩子：逐岁（同步 / 异步两条路）+ 一个观察',
      blocks: [
        {
          t: 'table',
          head: ['钩子', '什么时候触发', '你怎么影响它'],
          rows: [
            ['`onTalentPoolGenerate`', '抽卡时', '往 `payload.pool` 里 push 天赋对象（注意别重复塞）'],
            ['`onBeforeYear`', '**翻年之前**（只在 `async: true` 的 Mod 上触发）', '`payload.pending.push(条目)` 进当年轨迹；也可以在这时按后端结果补数据（`age` = 当前年龄，`nextAge` = 这一岁推进后的年龄）'],
            ['`onYearAdvance`', '每翻一年', '往 `payload.content` 里 push 条目（会进当年轨迹、被轨迹页与总结页渲染）'],
            ['`onAfterYear`', '**翻年之后**（只在 `async: true` 的 Mod 上触发）', '往 `payload.content` 里 push 收尾/结算类条目'],
            ['`onEventRender`', '渲染每段事件文本时', '**返回字符串**即替换文本（唯一返回值生效的钩子）'],
            ['`propertyChange`', '**任何**属性变化：事件/天赋效果、年龄自增、成就记账、Mod 自己改的都算', '观察（不能改）；payload 带 `source`（`\'engine\'`/`\'mod\'`）用来过滤自己造成的噪声'],
          ],
        },
        {
          t: 'code',
          lang: 'js',
          label: '三个同步钩子的可运行写法',
          code: `// 抽卡池：只塞一次
gameAPI.on('onTalentPoolGenerate', (payload) => {
  if (!payload.pool.some((t) => t.id === 'my-t1')) {
    payload.pool.push({ id: 'my-t1', name: '锦鲤', description: '魅力+1', grade: 1 })
  }
})

// 每一年：追加一条轨迹
gameAPI.on('onYearAdvance', (payload) => {
  if (payload.age === 18) payload.content.push({ type: 'EVT', description: '成年了' })
})

// 渲染：加前缀（返回 undefined = 不改）
gameAPI.on('onEventRender', (payload) => {
  if (payload.text.includes('示例事件')) return '✨ ' + payload.text
  return undefined
})`,
        },
        {
          t: 'note',
          kind: 'warn',
          text: '**默认同步**：不声明 `async: true` 时，逐岁钩子里写 `async` 再改数据是**无效**的 —— 回调返回的 Promise 会被丢弃，`life.next()` 返回后引擎/界面立刻做轨迹快照，晚到的改动不会进当年。',
        },
        {
          t: 'sub',
          text: '要"每年调一次后端"：声明 async，然后 await',
        },
        {
          t: 'code',
          lang: 'json',
          label: 'manifest.json 的一行开关',
          code: `{
  "name": "my-mod",
  "version": "1.0.0",
  "async": true,
  "asyncHooks": ["onBeforeYear", "onAfterYear"]
}`,
        },
        {
          t: 'code',
          lang: 'js',
          label: 'code.js：await 完塞进**当年**轨迹',
          code: `gameAPI.on('onBeforeYear', async (payload) => {
  if (payload.nextAge !== 18) return
  const line = await fetchBackendLine()          // 真的会被等到
  payload.pending.push({ type: 'EVT', description: line })
})

gameAPI.on('onAfterYear', async (payload) => {
  if (payload.age !== 18) return
  payload.content.push({ type: 'EVT', description: '岁末结算' })
})`,
        },
        {
          t: 'table',
          head: ['说清取舍', '实情'],
          rows: [
            ['**超时 3 秒**', '单个异步钩子超过 3000ms → 记一条 warn（带 Mod 名与钩子名）并**继续推进**；慢后端不会把游戏卡死'],
            ['**`onTalentPoolGenerate` / `onEventRender` 永远同步**', '它们是"抽卡时机"与"渲染时机"，调用方当场就要结果（卡池 / 文本）→ 写进 `asyncHooks` 是 manifest 校验硬错误'],
            ['**随机数顺序不变**', '`nextAsync()` 与 `next()` 共用同一次推进 → 同种子下游戏内容逐字节相同（Mod 自己引入的不确定性除外）'],
            ['**sim / 一致性会跳过异步 Mod**', '`async: true`（与 `deterministic: false`）的 Mod 不参与批量模拟与一致性检查，理由写进报告的警告/脚注'],
          ],
        },
        {
          t: 'note',
          kind: 'info',
          text: '可跑样板：`mods/example-async-mod/`（**默认禁用**）—— 它的 `code.js` 就是上面这两段，另有一条真跑一局的引擎单测钉住"内容确实进了当年轨迹"。详见 API 文档 §16。',
        },
      ],
    },

    // ---------- 参数 ----------
    {
      id: 'param',
      title: '7. 注册新参数，并在条件里用',
      blocks: [
        {
          t: 'code',
          lang: 'js',
          code: `if (gameAPI.param) {
  gameAPI.param.define('MY_LUCK', { type: 'local' })                       // 本局标量
  gameAPI.param.define('MY_POWER', { type: 'derived', formula: 'CHR + STR + INT' })  // 派生
}
// 之后任何条件里都能用：
//   events.json 的 include/exclude/branch 条件
//   talents.json 的 condition
//   achievements.json 的 condition
// 例： "include": "params.MY_POWER > 20"`,
        },
        {
          t: 'note',
          kind: 'warn',
          text: '`def.label`（中文标签）**引擎不读**，而且没有界面注册 API —— 所以 Mod 自定义的参数**不会**出现在属性面板上，它只在条件里可用。这是能力边界，不是配置问题。',
        },
      ],
    },

    // ---------- 依赖与顺序 ----------
    {
      id: 'order',
      title: '8. 加载顺序、依赖与"覆盖"的真实语义',
      blocks: [
        {
          t: 'list',
          ordered: true,
          items: [
            '引擎先扫描所有 Mod（浏览器看 `public/mods/index.json`，Node 看目录），校验 manifest',
            '按 `dependencies` 做拓扑排序（**被依赖的先加载**），无依赖的按文件源顺序',
            '按顺序逐个**先合并数据、再执行 `code.js`**',
            '合并规则：`merged[表] = { ...已有, ...本 Mod 的 }` —— **按 ID 整键替换**（`age` 表在"年龄"这一层替换）',
            '所以"后加载者覆盖先加载者"。**想补充原版内容的 Mod 必须声明 `dependencies: ["lifeRestart-data"]`**，否则它可能排在数据 Mod 前面、改动被整键覆盖回去 —— 表现是"我的事件从来不触发"，而日志里什么都看不出来',
          ],
        },
        {
          t: 'note',
          kind: 'info',
          text: '依赖被用户**禁用**时不会报"缺失依赖"（那是"关掉了"不是"缺失"）；只有源里**根本没有**那个名字才报 `缺失依赖: X`。成环会报 `循环依赖: a → b → a` 但仍然继续加载（顺序按遍历结果）。',
        },
      ],
    },

    // ---------- 运行时依赖 ----------
    {
      id: 'modules',
      title: '9. 用外部 npm 依赖（随包分发，零构建）',
      blocks: [
        {
          t: 'p',
          text: 'Mod 侧**没有构建步骤**：依赖要以**自包含单文件**放进包里（约定 `vendor/`），在 manifest 里登记，运行期用 `require()` 同步取用。',
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
          code: `const { strToU8, zipSync } = require('fflate')`,
        },
        {
          t: 'note',
          kind: 'warn',
          text: '**必须是单文件**：zip 装出来的 Mod 在浏览器里只有 `blob:` URL，没有目录基准 → 依赖内部的相对导入必断。也不要带 `node_modules/` 目录（安装时会被忽略并提示撞条目上限）。Node 侧 `server.js` 没这个限制（原生 ESM，相对路径可用）。',
        },
      ],
    },

    // ---------- 资源文件（2026-10 能力补齐 ②） ----------
    {
      id: 'assets',
      title: '10. 带资源文件：图片 / 音频 / 字体',
      blocks: [
        {
          t: 'p',
          text: 'Mod 的包里可以放**二进制资源**（图片、音频、字体），用 `gameAPI.asset` 读出来。以前这是硬边界 —— zip 安装"只收文本"（`.json/.js/.mjs/.txt/.md`），其它文件被**丢弃**并给一条警告，所以想把图片带进 Mod 只能靠宿主桥去读本地文件。现在二进制**逐字节保留**（zip 装出来的 Mod 也一样）。',
        },
        {
          t: 'code',
          lang: 'text',
          label: '包结构（约定把资源放 assets/，子目录会一起同步）',
          code: `my-mod/
├── manifest.json
├── code.js
├── talents.json          （数据表，文本）
└── assets/
    ├── logo.png          （资源，二进制）
    └── bgm.ogg`,
        },
        {
          t: 'code',
          lang: 'js',
          label: 'code.js：读资源 + 在轨迹里显示图片',
          code: `// ① 先判断 available（宿主可能没有资源能力 → 降级桥，读操作会抛可读错误）
if (gameAPI.asset.available) {
  gameAPI.asset.list().then((list) => {
    gameAPI.log.info('[my-mod] 包内资源：', list.join(', '))   // 只列图片/音频/字体
  })

  // ② 拿一个可直接用的 URL（浏览器里是 blob:，同路径恒同 URL）
  //    ⚠️ 这是异步的；不声明 "async": true 时逐岁钩子是**同步**的，所以要先把 URL 读好缓存起来。
  let logoUrl = null
  gameAPI.asset.url('assets/logo.png').then((u) => { logoUrl = u })
}

// ③ 轨迹文本里的**受控占位符**：界面会把它渲染成真的 <img>（不用 v-html）。
//    资源读不到时原样显示这几个字符，不报错、不白屏。
gameAPI.on('onYearAdvance', (p) => {
  if (p.age === 30) {
    p.content.push({ type: 'EVT', description: '你翻出了小时候的照片 {{asset:assets/logo.png}}' })
  }
})`,
        },
        {
          t: 'sub',
          text: '占位符语法的边界（严格，不猜）',
        },
        {
          t: 'table',
          head: ['写法', '结果'],
          rows: [
            ['`{{asset:assets/logo.png}}`', '渲染成 `<img>`（路径必须是包内相对路径）'],
            ['`{{asset:../x.png}}` / `{{asset:/etc/passwd}}`', '**原样当普通文本**（拒绝路径穿越与绝对路径）'],
            ['`{{asset:http://…}}` / `{{asset:data:…}}`', '**原样当普通文本**（资源只能来自本 Mod 包内，这是 XSS 边界）'],
            ['`{{asset:a\\b.png}}` / `{{Asset:a.png}}` / `{{asset:}}`', '**原样当普通文本**（反斜杠、大小写、空路径都不认）'],
            ['资源不存在 / 本局没有资源能力', '**原样显示占位符**（作者一眼能看出路径写错了；页面不报错）'],
          ],
        },
        {
          t: 'note',
          kind: 'warn',
          text: '**体积上限没有放宽**：单文件 ≤ 8 MB、累计 ≤ 32 MB、条目 ≤ 512。超了是**跳过那一个文件 + 警告**（安装仍然成功）—— 表现会是"装上了但那张图读不到"，所以打包前自己看一眼大小。大音乐请先压缩。',
        },
        {
          t: 'note',
          kind: 'tip',
          text: '**`files.json` 是浏览器侧的权威清单**：跑 `sync-mods`（dev/build 自动跑）时会递归找出资源一起复制并写进清单。如果你自己手写清单**漏列了一个资源**，浏览器侧根本不会去请求它 —— 表现是"本地好好的、线上永远是一串字符"（有回归用例盯着这件事）。',
        },
        {
          t: 'link',
          to: '/mods/api',
          text: '`gameAPI.asset` 每条签名的完整说明（list / has / bytes / url / text / dispose）',
        },
      ],
    },

    // ---------- 调试 ----------
    {
      id: 'debug',
      title: '11. 调试与排错',
      blocks: [
        {
          t: 'list',
          ordered: true,
          items: [
            '页面右下角**日志悬浮窗**常显；设置页把级别调到 `debug`（看加载/合并/钩子）或 `trace`（看每个引擎函数的参数）',
            'Mod 管理页点「查看数据 →」确认表真的进来了（条数、分布、逐条内容）',
            '游戏里跑一局，看轨迹里有没有你的条目（`onYearAdvance` 的效果）与事件（`age` 表的效果）',
            'CLI 侧：`node src/cli/mod.cli.js ../../mods` 打印依赖图 / 加载顺序 / 合并数据条数 / 钩子表',
            'CLI 侧真跑一局：`node src/cli/ai-game.cli.js --mods ../../mods --mock-ai --seed 42`（不需要 API Key）',
          ],
        },
        {
          t: 'sub',
          text: '静默失败清单（不报错，只是没效果）',
        },
        {
          t: 'table',
          head: ['现象', '多半是'],
          rows: [
            ['钩子从不触发', '钩子名拼错（引擎不校验名字）'],
            ['天赋永远抽不到', '`grade` 不是数字 / 写了 `exclusive`（不进池）'],
            ['事件从不出现', 'id 没写进 `age.json` 的 `event` 列表 / `include` 条件太严 / 被 `exclude` 挡住'],
            ['age 表的改动"没生效"', '加载顺序在数据 Mod **之前**（补 `dependencies`）'],
            ['成就永远不达成', '`opportunity` 写错（必须精确四选一）'],
            ['运行期加的天赋没效果', '缺 `maxTriggers`（见第 5 节）'],
            ['条件里的新参数总是 undefined', '参数名拼错，或 `gameAPI.param` 在这个宿主里是 null'],
            ['图片永远是一串 `{{asset:…}}` 字符', '路径写错（用 `gameAPI.asset.list()` 对一遍）/ 资源没进包 / `files.json` 漏列（见第 10 节）'],
            ['`gameAPI.asset.available` 是 false', '宿主没注入资源能力（旧版本前端 / 该环境下没有 Mod 文件源）'],
          ],
        },
        {
          t: 'link',
          to: '/mods/api',
          text: '完整错误原文与 API 明细看 gameAPI 参考',
        },
      ],
    },

    // ---------- 打包分发 ----------
    {
      id: 'ship',
      title: '12. 打包与分发',
      blocks: [
        {
          t: 'table',
          head: ['方式', '怎么做'],
          rows: [
            ['**导出 zip**', 'Mod 管理页每张卡片的「⬇ 下载 zip」把任意 Mod 打包下载（可作为你自己的起点/备份）'],
            ['**上传 zip**', '把目录打成 zip（含 `manifest.json`，可多包一层）→「+ 安装 Mod（.zip）」'],
            ['**从 GitHub 安装**', '粘 GitHub 链接 →「⬇ 从 GitHub 安装」：走 `api.github.com` + `raw`（zipball 端点受 CORS 限制，浏览器用不了）；仓库里有多个 Mod 会让你选目录'],
            ['**放进仓库 `mods/`**', '`mods/my-mod/…` + 跑 `sync-mods`（dev/build 自动跑）'],
          ],
        },
        {
          t: 'sub',
          text: 'zip 的限制（超了会跳过或失败）',
        },
        {
          t: 'table',
          head: ['限制', '值', '行为'],
          rows: [
            ['条目数', '≤ 512', '超过 → 安装失败'],
            ['单文件', '≤ 8 MB', '超限条目跳过 + 警告（安装继续）'],
            ['累计解压', '≤ 32 MB', '同上'],
            ['路径安全', '拒绝 `../` / 绝对路径', '越界条目跳过'],
            ['文件类型', '文本 `.json/.js/.mjs/.txt/.md` + **资源**（`png/jpg/jpeg/gif/webp/svg/bmp/ico/mp3/ogg/wav/m4a/flac/woff/woff2/ttf/otf`）', '资源**逐字节保留**（2026-10 起；以前直接丢弃并提示）'],
            ['`node_modules/`', '—', '忽略并提示改用 `vendor/` + `manifest.modules`'],
            ['系统名', '`lifeRestart-data` / `ai-mod`', '**默认拒绝**被包覆盖；用户二次确认后可放行（挡误操作，不是权限）'],
          ],
        },
      ],
    },

    // ---------- 界面扩展 ----------
    {
      id: 'ui',
      title: '14. 加界面：四种扩展点（2026-10 起）',
      blocks: [
        {
          t: 'p',
          text: 'Mod 可以让界面上多出东西，一共**四种扩展点**（没有第五种，也没有通用的"插一个组件到任意位置"）。内容一律用**文档页那套块类型**渲染：`p`（段落）/ `sub`（小标题）/ `note`（提示条）/ `list`（列表）/ `table`（表格）/ `code`（带复制按钮的代码块）/ `link`（站内链接）/ `api`（API 条目）/ `action`（动作按钮）。',
        },
        {
          t: 'table',
          head: ['扩展点', '声明', '效果'],
          rows: [
            ['`pages`', '`[{ id, title, blocks }]`', '多出一个页面 `/mods/page/<id>`（深链可用、可分享）'],
            ['`panels`', '`[{ id, slot, title, blocks }]`', '往某个 slot 插一张卡片（标题 + 内容块 + 来源 Mod 名）'],
            ['`properties`', '`[{ key, label }]`', '属性分配面板多一行（`key` 必须先是引擎里真实的参数）'],
            ['`stats`', '`[{ key, label, kind }]`', '总结页「收集统计」多一项（`kind` = `count` 或 `ratio`）'],
          ],
        },
        {
          t: 'sub',
          text: '两种注册源：manifest（启动即可见）vs 运行期（开局后可见）',
        },
        {
          t: 'table',
          head: ['', '`manifest.ui`（静态声明）', '`gameAPI.ui.*`（运行期注册）'],
          rows: [
            ['什么时候生效', '应用**启动时**收集（不需要先开一局）', '`code.js` 执行时（= 一局游戏已经建好）'],
            ['主页 / Mod 管理页看得到吗', '**看得到**', '看不到（那时还没有 code.js 执行过）'],
            ['换一局会怎样', '不变（它来自 manifest）', '**每局重来**（注册发生在那一局的 code.js 里）'],
            ['典型用途', '固定页面与说明卡片', '按条件显示（例如"今年属性达标才多一块提示"）'],
            ['产物去哪', '两者**汇进同一张注册表**（同 id 时后注册者胜）', '同左'],
          ],
        },
        {
          t: 'note',
          kind: 'warn',
          text: '**为什么启动时不执行 `code.js`**：它需要 Life（`param.define` 要参数注册表），而且重复执行会让钩子与数据重复注册。所以"manifest 写的"与"code.js 里注册的"天然有上面这条差异 —— 想要**任何时段都可见**，就写在 manifest 里。',
        },
        {
          t: 'code',
          lang: 'json',
          label: 'manifest.json：1 个页面 + 1 个首页面板 + 1 个属性 + 1 个统计',
          code: `{
  "name": "my-mod",
  "version": "1.0.0",
  "ui": {
    "pages": [
      {
        "id": "guide",
        "title": "我的指南",
        "blocks": [
          { "t": "p", "text": "这一页是 Mod 加的。" },
          { "t": "note", "kind": "tip", "text": "块类型与文档页完全一样。" }
        ]
      }
    ],
    "panels": [
      { "id": "hello", "slot": "home", "title": "来自我的 Mod", "blocks": [{ "t": "p", "text": "你好" }] }
    ],
    "properties": [{ "key": "LUCK", "label": "幸运" }],
    "stats": [{ "key": "MY_YEARS", "label": "走过的年头", "kind": "count" }]
  }
}`,
        },
        {
          t: 'code',
          lang: 'js',
          label: 'code.js：运行期注册（按条件显示）',
          code: `// ⚠️ 先判断 available：CLI 之类的宿主没有界面注册能力（注册调用会抛可读错误）
if (gameAPI.ui.available) {
  gameAPI.ui.addPanel({
    id: 'runtime-panel',
    slot: 'game',                       // 六个合法 slot 之一
    title: '运行期加的面板',
    blocks: [{ t: 'p', text: '这一局才有的内容' }],
  })

  // 属性面板多一行：**先注册参数**，否则界面不会显示它（见下）
  gameAPI.param.define('LUCK', { type: 'local', label: '幸运' })
  gameAPI.ui.addProperty({ key: 'LUCK', label: '幸运' })

  // 统计项：**两步** —— 先让引擎产生这个键，再告诉界面怎么显示。
  // 顺序反了也能显示，但键不存在时总结页会跳过它（并记一条 warn）。
  gameAPI.ui.addStatistic('MY_YEARS', 0)
  gameAPI.ui.addStat({ key: 'MY_YEARS', label: '走过的年头', kind: 'count' })
}

// 动作按钮：块里写 { t: 'action', id, label }，这里注册处理函数。
// 没注册的按钮在界面上是**禁用**的，并给出可读提示（不是"点了没反应"）。
if (gameAPI.ui.available) {
  gameAPI.ui.onAction('roll', (block) => {
    gameAPI.log.info('点了动作按钮：', block.id)
  })
}`,
        },
        {
          t: 'sub',
          text: '六个 slot 里，哪些**真的挂了界面**（如实说）',
        },
        {
          t: 'table',
          head: ['slot', '页面', '状态'],
          rows: [
            ['`home`', '主页 `/`', '**已挂**'],
            ['`mods`', 'Mod 管理页 `/mods`', '**已挂**'],
            ['`property`', '属性分配页 `/property`', '**已挂**'],
            ['`summary`', '人生总结页 `/summary`', '**已挂**'],
            ['`game`', '人生轨迹页 `/game`', '能校验、能注册，但**页面上暂时没有挂载点**（面板不会出现）'],
            ['`settings`', '设置页 `/settings`', '同上'],
          ],
        },
        {
          t: 'note',
          kind: 'info',
          text: '上表是"当前实情"，不是承诺：六个 slot 全部**能校验、能注册**，界面按需逐个挂载（以后挂 `game`/`settings` 不需要改 manifest schema）。',
        },
        {
          t: 'sub',
          text: '两条硬要求（不满足时界面**不会显示**它，而不是显示成一行 NaN）',
        },
        {
          t: 'list',
          items: [
            '**属性**：`key` 必须先在引擎里存在（通常 `gameAPI.param.define(key, { type: \'local\', label: \'…\' })`）。属性面板是"分配"语义，分配一个引擎不认识的键会得到 `NaN` —— 所以拿不到就**不渲染，并记一条 warn**（日志面板里能看到）',
            '**统计**：`key` 必须真的出现在 `life.statistics` 里 —— 用 `gameAPI.ui.addStatistic(key, value, judge?)` 让引擎产生它，再用 `gameAPI.ui.addStat({ key, label, kind })` 告诉界面怎么显示。缺了第一步 → 总结页**跳过它并记 warn**（不会留一行永远显示 `—`）',
          ],
        },
        {
          t: 'sub',
          text: '上限与错误行为（**超限/写错是硬错误**，不是静默忽略）',
        },
        {
          t: 'table',
          head: ['项', '限制', '违反时'],
          rows: [
            ['每类扩展点', '≤ 8 项', '`ui.panels 最多 8 项（当前 9 项）` → **manifest 校验失败**，Mod 不加载'],
            ['单个页面/面板的块数', '≤ 64 块', '同上'],
            ['`slot`', '六个白名单值', '`ui.panels[0].slot "sidebar" 不是合法 slot（可用：home/mods/property/game/summary/settings）`'],
            ['`id` / `key`', '同一个 Mod 内唯一', '`ui.pages[1].id "p1" 与前面某个扩展项重复（id 在同一个 Mod 内必须唯一）`'],
            ['跨 Mod 同 id', '—', '**后加载者胜**（与数据合并语义一致）；重复会记一条 warn'],
          ],
        },
        {
          t: 'note',
          kind: 'warn',
          text: '**为什么写错 slot 要报错而不是忽略**：忽略的表现是"面板没出现，也没有任何提示"——这是最难查的一类问题。写错就报出来，并且在日志面板里能看到。',
        },
        {
          t: 'sub',
          text: '动作按钮（`{ t: \'action\', id, label }`）',
        },
        {
          t: 'list',
          items: [
            '块里写 `{ t: \'action\', id: \'roll\', label: \'点我\' }` → 渲染成一个按钮',
            '`gameAPI.ui.onAction(\'roll\', fn)` 注册过 → 点击调用（**异步、异常隔离**：回调抛错只记一条日志，不会炸页面）',
            '**没注册过 → 按钮禁用**并显示"未注册的动作：roll（Mod 需在 code.js 里 gameAPI.ui.onAction 注册）"',
            '动作是**运行期**能力：manifest 里的静态声明在启动时就渲染，那时还没人注册 → 按钮是禁用的（正确表现）',
          ],
        },
        {
          t: 'note',
          kind: 'warn',
          text: '未知块类型仍然会**显式显示**成 `⚠ 未知内容块类型：xxx`（与文档页同一行为）——所以块类型写错时你在页面上就能看见，而不是少了一段。',
        },
      ],
    },

    // ---------- 自检清单 ----------
    {
      id: 'checklist',
      title: '13. 提交前自检清单',
      blocks: [
        {
          t: 'list',
          items: [
            '`manifest.json` 有 `name` + `version`，`name` 只含字母数字连字符下划线',
            '**目录名与 `name` 一致**（页面按目录名寻址，省得自己绕）',
            '想补充原版内容 → 写了 `dependencies: ["lifeRestart-data"]`',
            '`code.js` 里没有 `export` / `import` / 顶层 `await`',
            '运行期注入的天赋显式写了 `maxTriggers`，`grade` 是数字',
            '新事件都写进了某个 `age.json` 的 `event` 列表（否则永远不会触发）',
            '改了 `age.json` 的某一岁 → **把原来那一岁的 id 抄回来了**',
            '成就的 `opportunity` 精确是 `START`/`TRAJECTORY`/`SUMMARY`/`END` 之一',
            '成就与名人条目自带 `id`；名人的 `talent` 是数组',
            '依赖放 `vendor/` 单文件并在 `manifest.modules` 登记（没带 `node_modules/`）',
            '带了资源（图片/音频/字体）→ 放在包内相对路径下（约定 `assets/`），并用 `gameAPI.asset` 读；单个 ≤ 8 MB、整包 ≤ 32 MB',
            '加了界面（`manifest.ui`）→ 每类 ≤ 8 项、`slot` 只在六个白名单值里、同 Mod 内 id 唯一；属性/统计的 key 必须在引擎侧真实存在（否则界面会跳过它并记 warn）',
            '界面里要用动作按钮 → 在 `code.js` 里 `gameAPI.ui.onAction(id, fn)` 注册（没注册的按钮是禁用的）',
            '加了**统计项** → 先用 `gameAPI.ui.addStatistic` 让引擎产生那个键，再 `addStat` 声明显示方式（少了第一步 → 总结页跳过并记 warn）',
            '在页面里真跑了一局，确认数据与轨迹都对（不是只看"能加载"）',
            '有条件就加一条测试：跑一局断言你的数据/钩子真的生效（例：`example-mod.spec.js`）',
          ],
        },
        {
          t: 'link',
          to: '/mods/example-mod',
          text: '打开示例 Mod 的数据页，对照它的 5 张表与 code.js',
        },
      ],
    },
  ],
}
