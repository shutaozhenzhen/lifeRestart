/**
 * scripts/test-all.mjs — workspace 全量测试编排器
 *
 * 背景（为什么需要它）：
 *   根 package.json 原先的 "test": "pnpm -r test" 要求机器上存在**全局 pnpm**，
 *   而 pnpm 并不是本项目的前置依赖（本机 PATH 中常常没有，只有 Node 自带的 npm），
 *   结果是：仓库根目录执行 `pnpm test` 直接报 'pnpm' is not recognized，测试形同虚设。
 *
 * 方案：用 Node 直接编排各 workspace 包的 vitest，不依赖任何全局包管理器。
 *   - 包清单从 pnpm-workspace.yaml 的 packages globs 推导（单一事实来源，避免手写列表漂移）
 *   - 只跑「声明了 scripts.test 且能解析到 vitest」的包
 *     （如 platforms/mobile 是纯脚手架，没有 test 脚本，自动跳过而不是报错）
 *   - 子进程 stdio=inherit：输出直接透传终端，不做管道捕获
 *
 * 用法：
 *   node scripts/test-all.mjs                          # 全量（workspace 内所有有测试的包）
 *   node scripts/test-all.mjs frontend                 # 只跑名字/目录名匹配 frontend 的包
 *   node scripts/test-all.mjs game-engine -- -t 属性页  # `--` 之后的参数原样透传给 vitest
 *   node scripts/test-all.mjs -- --reporter=verbose    # 同上（不改包过滤）
 *
 * 退出码：全部通过为 0；任一包失败为 1（CI 可直接用）。
 */

// 文件系统：读 package.json / pnpm-workspace.yaml、列目录。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
// 路径拼接与解析（跨平台）。
import { join, dirname, resolve, basename } from 'node:path'
// 定位仓库根（本脚本位于 <root>/scripts/ 下）。
import { fileURLToPath } from 'node:url'
// 同步启动子进程（stdio 继承，逐包串行执行，失败不中断后续以便看到全貌）。
import { spawnSync } from 'node:child_process'

// 仓库根目录：本文件所在目录的上一级。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// #parseWorkspaceGlobs
// 从 pnpm-workspace.yaml 解析 packages 列表（只需支持本项目用到的简单写法）。
//
// @param {string} file - pnpm-workspace.yaml 路径
// @returns {string[]} glob 列表，如 ['packages/*', 'platforms/*']
function parseWorkspaceGlobs(file) {
  // 读文本。
  const text = readFileSync(file, 'utf8')
  // 收集到的 glob。
  const globs = []
  // 是否处于 packages: 块内。
  let inPackages = false
  // 逐行扫描。
  for (const rawLine of text.split(/\r?\n/)) {
    // 去掉行尾注释（本文件注释都以 # 开头，值里不含 #）。
    const line = rawLine.replace(/#.*$/, '')
    // 进入 packages: 块。
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    // 块外：跳过。
    if (!inPackages) continue
    // 列表项：- 'packages/*' / - "platforms/*" / - packages/*
    const matched = line.match(/^\s+-\s*['"]?([^'"]+?)['"]?\s*$/)
    if (matched) {
      globs.push(matched[1])
      continue
    }
    // 空行：块内允许。
    if (line.trim() === '') continue
    // 遇到下一个顶层字段：packages 块结束。
    inPackages = false
  }
  // 返回。
  return globs
}

// #expandWorkspaceDirs
// 把 glob 展开为实际包目录（只支持末尾 /* 这一种形式，够用且无第三方依赖）。
//
// @param {string[]} globs - glob 列表
// @returns {string[]} 绝对路径列表
function expandWorkspaceDirs(globs) {
  // 结果集。
  const dirs = []
  // 逐个 glob 展开。
  for (const glob of globs) {
    // 无通配符：直接当成目录。
    if (!glob.includes('*')) {
      dirs.push(join(root, glob))
      continue
    }
    // 通配符前的父目录（'packages/*' → 'packages'）。
    const parent = join(root, glob.slice(0, glob.indexOf('*')).replace(/[\\/]+$/, ''))
    // 父目录不存在：跳过（配置与实际目录不一致时不让脚本崩）。
    if (!existsSync(parent)) continue
    // 列出父目录下的所有子目录。
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      // 只认目录。
      if (entry.isDirectory()) dirs.push(join(parent, entry.name))
    }
  }
  // 去重后返回。
  return [...new Set(dirs)]
}

// #resolveVitestBin
// 在包内解析 vitest CLI 入口（node_modules/vitest 由 pnpm 软链到 store）。
//
// @param {string} pkgDir - 包目录
// @returns {string|null} vitest CLI 文件绝对路径；解析不到返回 null
function resolveVitestBin(pkgDir) {
  // vitest 包自身的 package.json。
  const pkgJsonPath = join(pkgDir, 'node_modules', 'vitest', 'package.json')
  // 未安装：交给调用方判定为「跳过」。
  if (!existsSync(pkgJsonPath)) return null
  // 解析 bin 字段（字符串或对象两种写法）。
  const meta = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  // 取出可执行入口相对路径。
  const bin = typeof meta.bin === 'string' ? meta.bin : meta.bin?.vitest
  // 没有 bin：视为不可用。
  if (!bin) return null
  // 拼出绝对路径。
  const binPath = join(pkgDir, 'node_modules', 'vitest', bin)
  // 文件不存在：不可用。
  return existsSync(binPath) ? binPath : null
}

// main
// 主流程：筛选包 → 串行跑 vitest → 汇总结果。
function main() {
  // 命令行参数（去掉 node 与脚本路径）。
  const argv = process.argv.slice(2)
  // `--` 分隔符位置：其后的参数**原样**透传给 vitest。
  // 为什么需要它：`-t <pattern>` 这类「带值」参数里，pattern 不以 - 开头，
  // 若不加分隔符会被误判为「包名过滤」，导致 vitest 只收到空的 -t（静默零用例退出）。
  const sep = argv.indexOf('--')
  // 分隔符之前：包名过滤 + 无值开关。
  const head = sep >= 0 ? argv.slice(0, sep) : argv
  // 分隔符之后：全部透传。
  const tail = sep >= 0 ? argv.slice(sep + 1) : []
  // 过滤器：不以 - 开头的参数按「包名/目录名子串」匹配。
  const filters = head.filter((a) => !a.startsWith('-'))
  // 透传参数：以 - 开头的参数 + `--` 之后的全部参数。
  const passthrough = [...head.filter((a) => a.startsWith('-')), ...tail]
  // globs → 目录 → 有效包。
  const candidates = expandWorkspaceDirs(parseWorkspaceGlobs(join(root, 'pnpm-workspace.yaml')))
  // 待执行列表与跳过列表。
  const plan = []
  const skipped = []
  // 逐个判定。
  for (const dir of candidates) {
    // 包名（目录名，便于人类识别）。
    const name = basename(dir)
    // 过滤器不匹配：不参与。
    if (filters.length > 0 && !filters.some((f) => name.includes(f))) continue
    // package.json 缺失：不是包。
    const pkgJsonPath = join(dir, 'package.json')
    if (!existsSync(pkgJsonPath)) continue
    // 读 scripts.test。
    const meta = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    // 没有 test 脚本（如 mobile 脚手架）：跳过并记录原因。
    if (!meta.scripts?.test) {
      skipped.push({ name, reason: '未声明 scripts.test' })
      continue
    }
    // 解析 vitest CLI。
    const bin = resolveVitestBin(dir)
    // 解析不到：跳过并记录原因（而不是静默当成通过）。
    if (!bin) {
      skipped.push({ name, reason: '未安装 vitest' })
      continue
    }
    // 进入执行计划。
    plan.push({ name, dir, bin })
  }
  // 计划为空：明确报错，避免「零测试也算通过」。
  if (plan.length === 0) {
    console.error(`[test-all] 没有匹配到任何可执行测试的包（filters=${filters.join(',') || '无'}）`)
    process.exit(1)
  }
  // 打印计划。
  console.log(`[test-all] 待执行 ${plan.length} 个包：${plan.map((p) => p.name).join(', ')}`)
  // 打印跳过项（透明，不隐藏信息）。
  for (const s of skipped) console.log(`[test-all] 跳过 ${s.name}（${s.reason}）`)
  // 统计。
  const results = []
  // 串行执行：逐个包跑 `vitest run`，cwd 设为该包目录（vitest 自行读取包内配置）。
  for (const item of plan) {
    // 开始计时。
    const startedAt = Date.now()
    // 打印分隔。
    console.log(`\n[test-all] ===== ${item.name} =====`)
    // 直接以 node 执行 vitest CLI：不经过 shell、不经过 pnpm，参数无歧义。
    const r = spawnSync(process.execPath, [item.bin, 'run', ...passthrough], {
      // 工作目录 = 包目录。
      cwd: item.dir,
      // 输出透传（不捕获管道）。
      stdio: 'inherit',
    })
    // 记录结果（非 0 退出码或启动失败都算失败）。
    results.push({
      name: item.name,
      ok: r.status === 0,
      code: r.status,
      error: r.error ? r.error.message : null,
      ms: Date.now() - startedAt,
    })
  }
  // 汇总表。
  console.log('\n[test-all] ===== 汇总 =====')
  for (const r of results) {
    // 状态文案。
    const status = r.ok ? 'PASS' : `FAIL(exit=${r.code}${r.error ? `, ${r.error}` : ''})`
    console.log(`[test-all] ${status.padEnd(26)} ${r.name}  ${(r.ms / 1000).toFixed(2)}s`)
  }
  // 失败包数量。
  const failed = results.filter((r) => !r.ok)
  // 全绿：退出 0。
  if (failed.length === 0) {
    console.log(`[test-all] 全部通过（${results.length} 个包）`)
    process.exit(0)
  }
  // 有失败：列出并退出 1。
  console.error(`[test-all] 失败 ${failed.length}/${results.length}：${failed.map((f) => f.name).join(', ')}`)
  process.exit(1)
}

// 执行。
main()
