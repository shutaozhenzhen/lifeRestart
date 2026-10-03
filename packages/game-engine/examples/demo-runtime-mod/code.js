/**
 * demo-runtime-mod / code.js —— 浏览器侧用外部 npm 依赖（**运行时**加载，无构建步骤）
 *
 * 依赖怎么来的（三步，全在运行期）：
 *   1. 依赖以**自包含单文件**随包分发：`vendor/fflate.mjs`
 *   2. `manifest.modules` 里声明：`{ "fflate": "vendor/fflate.mjs" }`
 *   3. 引擎在**执行本文件之前**把它加载好（HTTP 源直接 import；IndexedDB 源用 blob URL），
 *      然后把同步的 `require(id)` 注入进来 —— 所以这里能像 CommonJS 一样直接取
 *
 * ⚠️ 两条硬约束：
 *   · `import()` 是**语法**，不能被注入覆盖 → 浏览器侧只能用 `require(id)`，
 *     不能用 `import 'fflate'`（顶层 import 在 new Function 里也是语法错误）
 *   · 依赖必须是**自包含单文件**：zip 装出来的 Mod 只有 `blob:` URL，而 blob: 没有目录基准，
 *     依赖内部的相对导入（`./inner.js`）会解析成不存在的路径。fflate 的 bundle 版正是单文件。
 */

// 注入的 require：同步取（引擎已经把模块加载好了）。
const { strToU8, zipSync } = require('fflate')

// 与普通 Mod 写法一致。
gameAPI.on('onYearAdvance', (payload) => {
  // 只在第 1 年提示。
  if (payload.age !== 1) return
  // 真用一下依赖（不是空壳）。
  const zip = zipSync({ 'hello.txt': strToU8('runtime dep') }, { level: 6 })
  // 写进本岁轨迹。
  payload.content.push({
    // 条目类型。
    type: 'EVT',
    // 文案。
    description: `demo-runtime-mod：运行时依赖 fflate 可用（zip ${zip.length} 字节）；后端${gameAPI.host.has('demo-runtime-mod') ? '在线' : '不在线'}`,
    // 中性评分。
    grade: 0,
  })
})
