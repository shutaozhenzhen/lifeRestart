/**
 * demo-node-mod / server.js —— 拥有**完全 Node 权限**的后端入口（Mod 架构 v2 示例）
 *
 * 用法（在 packages/game-engine/ 下）：
 *   node src/cli/mod.cli.js examples                     # 列出在线宿主与处理器
 *   node src/cli/mod.cli.js examples --call demo-node-mod:nodeInfo
 *
 * 关键事实（已在 `_设计方案_Mod宿主能力与双目标.md` 第一节实证，
 * 并由 src/mod/host.spec.js 的「完全权限」一组用例长期钉住）：
 *   Mod 代码从来只被注入 `gameAPI`（code.js）或这里的 `{ handle, log, modsDir, name }`
 *   （server.js），**没有任何宿主 API 参数**；但因为是普通 ESM 模块 + 原生 import，
 *   它天然可以 `import('node:fs')` / `child_process` / 原生模块 / 访问 `process`。
 *   所以「完全权限」不是被授予的，而是 Mod 模型的既定前提——
 *   本文件不需要、也不应该有"申请权限"的写法。
 *
 * 与 code.js 的分工：
 *   本文件 = 重活（文件、进程、网络、原生模块）；code.js = 游戏内逻辑与钩子。
 *   二者通过命名处理器连接：code.js 侧 `await gameAPI.host.call('demo-node-mod', '<名字>', args)`。
 *   ⚠️ 该调用是**异步**的，因此只能放在已异步的生命周期点上（Phase A：
 *      loadBundle / onBeforeLife / onAfterLife / Mod 命令），**不能**放在逐岁同步钩子里。
 */

/**
 * 注册该 Mod 的后端处理器。
 *
 * @param {object} ctx
 * @param {(name: string, fn: Function) => void} ctx.handle - 注册命名处理器（同名后注册覆盖）
 * @param {object} ctx.log - 日志器
 * @param {string} ctx.modsDir - 本 Mod 所在的 Mods 根目录（由宿主传入）
 * @param {string} ctx.name - 本 Mod 名
 */
export default function setup({ handle, log, modsDir, name }) {
  // 日志（证明 setup 阶段确实拿到了宿主上下文）。
  log?.debug?.(`demo-node-mod 正在注册处理器（modsDir=${modsDir}）`)

  // #nodeInfo —— 进程与平台信息（完全权限：process / os）
  handle('nodeInfo', async () => {
    // 原生模块用动态 import 拿（ESM 里随时可用）。
    const os = await import('node:os')
    // 返回可 JSON 序列化的信息（跨进程传输的通用形态）。
    return {
      // Mod 名（确认是哪一个 Mod 应答）。
      mod: name,
      // 平台。
      platform: os.platform(),
      // Node 版本。
      node: process.version,
      // 当前工作目录。
      cwd: process.cwd(),
      // 内存总量（MB，演示"浏览器拿不到的信息"）。
      totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
    }
  })

  // #readParentPackage —— 读 Mods 目录**上一级**的 package.json（完全权限：fs + path）
  // 例：modsDir=examples 时读到 packages/game-engine/package.json。
  handle('readParentPackage', async () => {
    // 文件系统。
    const fs = await import('node:fs')
    // 路径。
    const path = await import('node:path')
    // 上一级目录。
    const parent = path.resolve(modsDir || '.', '..')
    // 读 + 解析。
    const pkg = JSON.parse(fs.readFileSync(path.join(parent, 'package.json'), 'utf8'))
    // 返回关键字段（type 尤其重要：它是 server.js 能否按 ESM 解析的依据）。
    return { dir: parent, name: pkg.name, type: pkg.type ?? null, packageManager: pkg.packageManager ?? null }
  })

  // #listModDirs —— 列目录（完全权限：fs）
  handle('listModDirs', async () => {
    // 文件系统。
    const fs = await import('node:fs')
    // 无 modsDir 时给空（宿主没传上下文）。
    if (!modsDir) return []
    // 只取目录名。
    return fs
      .readdirSync(modsDir, { withFileTypes: true })
      // 目录。
      .filter((e) => e.isDirectory())
      // 名字。
      .map((e) => e.name)
      // 排序，保证输出稳定（便于 diff）。
      .sort()
  })

  // #runCommand —— 起子进程（完全权限：child_process）
  // ⚠️ 示例而已：真实 Mod 请把命令写死，不要接受任意用户输入。
  handle('runCommand', async ({ cmd, args = [] }) => {
    // 子进程模块。
    const cp = await import('node:child_process')
    // 同步执行并回传 stdout（execFileSync 不经 shell，避免注入）。
    const stdout = cp.execFileSync(cmd, args, { encoding: 'utf8' })
    // 返回。
    return { cmd, stdout }
  })

  // #echo —— 最小回声处理器（验证参数原样传递；同进程按引用，不强制 JSON）
  handle('echo', (args) => args)

  // #fail —— 故意抛错（验证宿主桥的错误归一化会带上 Mod/处理器名）
  handle('fail', () => {
    // 抛。
    throw new Error('这是示例错误：宿主桥会把它包成「Mod demo-node-mod 处理器 fail 失败: ...」')
  })
}
