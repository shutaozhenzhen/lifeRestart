/**
 * release-test.yml 不变量测试（Step 25/26）
 *
 * 为什么用文本断言去测 workflow：
 *   打包链路的问题**不会**被单元测试发现——它们只在 CI 里、且在"绿灯"的状态下发生。
 *   我们已经真的踩过这三个坑，所以把它们固化成断言，避免回归：
 *     ① `prerelease: true` → release 只出现在 /releases 列表里，**侧栏与 /releases/latest 都看不到**，
 *        看起来就像"根本没发布"（用户实际反馈过）；
 *     ② `continue-on-error: true` → mobile job 失败但整体绿灯，产物缺失被掩盖整整几轮；
 *     ③ upload-artifact v4 以「通配符前的前缀」为压缩根，APK 落到 artifacts/debug/ 子目录，
 *        下游用平铺的 `artifacts/*.apk` 收集不到 → release 里没有 apk，**而且 job 全绿**。
 *
 * 断言的是「结构与关键命令」，不是逐字全文，所以正常加/删步骤、改文案不会误报。
 */

// 测试框架。
import { describe, it, expect } from 'vitest'
// 读 workflow 文件。
import { readFileSync } from 'node:fs'
// 路径拼接。
import path from 'node:path'
// 定位本文件所在目录。
import { fileURLToPath } from 'node:url'

// 本目录（platforms/mobile/）。
const HERE = path.dirname(fileURLToPath(import.meta.url))
// workflow 文件（仓库根 = platforms/mobile/../..）。
const WORKFLOW = path.join(HERE, '..', '..', '.github', 'workflows', 'release-test.yml')
// 全文（含中文注释，所以显式按 utf8 读）。
const text = readFileSync(WORKFLOW, 'utf8')

// #extractJob
// 从 workflow 文本里切出某个 job 的代码块（jobs 下的 key 缩进 2 空格）。
//
// @param {string} name - job 名（如 'mobile'）
// @returns {string} job 文本；找不到返回空串
function extractJob(name) {
  // 逐行处理（兼容 CRLF）。
  const lines = text.split(/\r?\n/)
  // 起始行：`  <name>:` 精确匹配（避免 'mobile' 命中 'mobile-x'）。
  const start = lines.findIndex((line) => line === `  ${name}:`)
  // 没这个 job。
  if (start < 0) return ''
  // 收集块内行。
  const block = []
  // 从下一行开始扫描。
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    // 非空且缩进 <= 2 → 下一个顶层 job（或 on: 的键），块结束。
    if (line.trim() !== '' && /^ {0,2}\S/.test(line)) break
    block.push(line)
  }
  // 拼回文本。
  return block.join('\n')
}

// #stripComments
// 去掉整行注释（含 shell 块里的 `# ...`）。
//
// 为什么需要它：本文件（以及 workflow 里的说明）会**引用**反模式来提醒后来人
// （"不要用 --prerelease" / "不要用平铺的 artifacts/*.apk"），
// 若直接对全文断言 not.toMatch，这些提醒反而会把测试弄红。
// 断言只该看**真正会被执行的行**，所以这里把纯注释行剔除后再匹配。
//
// @param {string} block - job 文本
// @returns {string} 去掉注释行后的文本
function stripComments(block) {
  return block
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
}

// 各 job 文本（多个用例共用）：先切块，再去注释行。
const mobileJob = stripComments(extractJob('mobile'))
const releaseJob = stripComments(extractJob('release'))
const electronJob = stripComments(extractJob('electron'))

describe('本包参与全量测试（否则新加的脚本测试永远不会在 CI 跑）', () => {
  it('package.json 声明了 test 脚本（scripts/test-all.mjs 按它发现包）', () => {
    // 读本包 package.json。
    const pkg = JSON.parse(readFileSync(path.join(HERE, 'package.json'), 'utf8'))
    // 必须有 test 脚本：没有的话 test-all 会把整个包跳过，37 个用例形同不存在。
    expect(pkg.scripts?.test).toBe('vitest run')
    // APK 收集脚本要有对应命令（CI 直接调 node，但本地要能一键跑）。
    expect(pkg.scripts?.['apk:collect']).toBe('node scripts/collect-apk.js')
  })

  it('全量测试 workflow 用根 `pnpm test`（= test-all.mjs，覆盖所有包）', () => {
    // 读 test.yml。
    const testWorkflow = readFileSync(path.join(HERE, '..', '..', '.github', 'workflows', 'test.yml'), 'utf8')
    // 断言用的是根测试入口，而不是"只跑某几个包"的写法。
    expect(testWorkflow).toMatch(/run: pnpm test/)
    // 安装必须冻结 lockfile（否则干净环境装不上时不会失败）。
    expect(testWorkflow).toMatch(/pnpm install --frozen-lockfile/)
  })
})

describe('release-test.yml 结构', () => {
  it('文件存在且声明了滚动 test release 应有的 4 个 job', () => {
    expect(text.length).toBeGreaterThan(0)
    // web / electron / mobile 三条产物线 + 一个汇总发布。
    expect(extractJob('web')).not.toBe('')
    expect(electronJob).not.toBe('')
    expect(mobileJob).not.toBe('')
    expect(releaseJob).not.toBe('')
  })

  it('release job 依赖全部三条产物线（缺一条就不该发布）', () => {
    expect(releaseJob).toMatch(/needs: \[web, electron, mobile\]/)
  })

  it('创建 release 需要 contents: write 权限', () => {
    expect(text).toMatch(/permissions:\s*\n\s+contents: write/)
  })
})

describe('mobile job：不许再掩盖失败', () => {
  it('不得使用 continue-on-error（曾让 APK 缺失连续几轮被绿灯掩盖）', () => {
    expect(mobileJob).not.toMatch(/continue-on-error/)
    // electron 也已经改成硬要求，一并钉住。
    expect(electronJob).not.toMatch(/continue-on-error/)
  })

  it('使用 JDK 21（Capacitor 7 / AGP 8.11+ 的硬要求；用 17 会在 Gradle 阶段失败）', () => {
    expect(mobileJob).toMatch(/java-version: '21'/)
  })

  it('现场生成 Android 工程并构建 debug APK', () => {
    expect(mobileJob).toMatch(/npx cap add android/)
    expect(mobileJob).toMatch(/npx cap sync android/)
    expect(mobileJob).toMatch(/gradlew assembleDebug/)
  })

  it('APK 先收集成平铺固定路径，再上传（修复 upload-artifact 子目录导致的丢失）', () => {
    // 收集脚本。
    expect(mobileJob).toMatch(/node scripts\/collect-apk\.js/)
    // 上传的是平铺目录（压缩根 = out/，解包后必定在顶层）。
    expect(mobileJob).toMatch(/path: platforms\/mobile\/out\/\*\.apk/)
    // 不再上传嵌套通配符（那正是事故根因）。
    expect(mobileJob).not.toMatch(/path: platforms\/mobile\/android\/app\/build\/outputs\/apk/)
  })

  it('没打出 APK 必须显式失败', () => {
    expect(mobileJob).toMatch(/if-no-files-found: error/)
  })
})

describe('mobile job：APK 内置 Node 运行时（nodejs-mobile）', () => {
  it('下载官方运行时：固定版本 + 校验 sha256（会随 APK 分发到用户设备的二进制）', () => {
    // 版本固定（不追 latest，避免上游悄悄换掉二进制）。
    expect(mobileJob).toMatch(/nodejs-mobile-v18\.20\.4-android\.zip/)
    expect(mobileJob).toMatch(/releases\/download\/v18\.20\.4\//)
    // 供应链校验。
    expect(mobileJob).toMatch(/sha256sum -c -/)
    expect(mobileJob).toMatch(/bd7321eaa1a7602fbe0bb87302df2d79d87835cf4363fbdd17c350dbb485c2af/)
  })

  it('先打包 Node 侧并冒烟，再打补丁进 Android 工程', () => {
    expect(mobileJob).toMatch(/node scripts\/build-node-project\.js/)
    // 桌面 Node 冒烟（设备上跑同一份 JS）。
    expect(mobileJob).toMatch(/node scripts\/smoke-node-project\.js/)
    expect(mobileJob).toMatch(/node scripts\/prepare-android\.js --libnode \.libnode/)
  })

  it('顺序正确：补丁必须在 cap add / cap sync 之后、Gradle 构建之前', () => {
    const capAddAt = mobileJob.indexOf('npx cap add android')
    const patchAt = mobileJob.indexOf('node scripts/prepare-android.js')
    const gradleAt = mobileJob.indexOf('./gradlew assembleDebug')
    expect(capAddAt).toBeGreaterThan(-1)
    expect(patchAt).toBeGreaterThan(capAddAt)
    expect(gradleAt).toBeGreaterThan(patchAt)
  })

  it('显式指定 CMake 3.x（runner 上还有 CMake 4，NDK toolchain 未必兼容）', () => {
    expect(mobileJob).toMatch(/LIFERESTART_CMAKE_VERSION/)
  })

  it('校验 APK 里真的带了内置 Node 运行时（缺件就失败，不许绿着交付）', () => {
    expect(mobileJob).toMatch(/Verify embedded Node runtime inside APK/)
    // Node 脚本。
    expect(mobileJob).toMatch(/assets\/nodejs-project\/main\.js/)
    expect(mobileJob).toMatch(/assets\/nodejs-project\/proxy\.js/)
    // 原生库（含 libnode 依赖的 libC++ 共享库）。
    expect(mobileJob).toMatch(/lib\/arm64-v8a\/libnode\.so/)
    expect(mobileJob).toMatch(/libnodejs_jni\.so/)
    expect(mobileJob).toMatch(/libc\+\+_shared\.so/)
    // 清单：INTERNET + 只对回环放开明文。
    expect(mobileJob).toMatch(/networkSecurityConfig/)
  })
})

describe('release job：产物收集与发布可见性', () => {
  it('递归收集产物（不再用平铺的 artifacts/*.apk）', () => {
    expect(releaseJob).toMatch(/find artifacts -type f/)
    expect(releaseJob).toMatch(/-name '\*\.apk'/)
    // 平铺通配符是事故写法，禁止回归。
    expect(releaseJob).not.toMatch(/artifacts\/\*\.apk/)
  })

  it('mobile 成功却没有 APK → 硬失败（不许静默漏掉）', () => {
    expect(releaseJob).toMatch(/needs\.mobile\.result/)
    expect(releaseJob).toMatch(/::error/)
  })

  it('先删旧 release（滚动：始终只有最新一份）', () => {
    expect(releaseJob).toMatch(/gh release delete test --yes --cleanup-tag/)
  })

  it('创建的是可见的正式 release（--latest，不能用 --prerelease）', () => {
    // 只检查真正执行的 gh release create 命令行（注释里可以提到反模式）。
    const createLines = releaseJob.split(/\r?\n/).filter((line) => line.includes('gh release create'))
    expect(createLines.length).toBeGreaterThan(0)
    for (const line of createLines) {
      expect(line).toMatch(/gh release create test/)
      expect(line).toMatch(/--latest/)
      // prerelease 会让侧栏与 /releases/latest 都看不到它。
      expect(line).not.toMatch(/--prerelease/)
    }
  })

  it('校验产物发生在删除旧 release 之前（避免"删了又失败"的空窗）', () => {
    // 收集/校验步骤必须排在删除步骤之前。
    const collectAt = releaseJob.indexOf('Collect and verify release files')
    const deleteAt = releaseJob.indexOf('Delete previous test release')
    expect(collectAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeGreaterThan(-1)
    expect(collectAt).toBeLessThan(deleteAt)
  })
})
