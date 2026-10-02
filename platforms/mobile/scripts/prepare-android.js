/**
 * 把「APK 内置 Node 运行时」接进 Capacitor 现场生成的 Android 工程（Step 25 延伸）
 *
 * 为什么需要这一步：`android/` 不入库（Gradle 工程含大量生成物与二进制），
 * CI 每次 `npx cap add android` 现场重建，所以所有原生侧改动都必须**可重复地打补丁**：
 *
 *   1. 预编译运行时     官方 nodejs-mobile v18.20.4 的 include/ 与 bin/<abi>/libnode.so → app/libnode/
 *   2. JNI 壳           android-patch/cpp/（node::Start 入口，CMake 编译成 libnodejs_jni.so）
 *   3. Java 启动器      android-patch/java/（覆盖模板的 MainActivity，新增 NodeRuntime）
 *   4. Gradle 配置      android-patch/gradle/nodejs.gradle + 在 app/build.gradle 末尾追加一行 apply from
 *   5. 清单与网络策略   INTERNET 权限（已有则跳过）+ 只对回环地址放开明文 HTTP 的 network security config
 *   6. Node 工程        nodejs-build/（main.js + 打包好的 proxy.js）→ app/src/main/assets/nodejs-project/
 *
 * 设计要点：**幂等**（重复执行不产生重复内容）、**可测**（纯字符串变换 + 假工程骨架都能跑）、
 * **缺件即失败**（少一个 .so 或没先跑 build-node-project 都要明确报错，而不是打出一个没 Node 的 APK）。
 *
 * 用法：
 *   node scripts/prepare-android.js --libnode <解压后的官方 zip 目录>
 *   node scripts/prepare-android.js --libnode <dir> --android <android 工程> --nodejs-build <dir>
 */

// 文件系统。
import fs from 'node:fs/promises'
// 路径。
import path from 'node:path'
// 定位本脚本目录 + 判断是否被直接执行。
import { fileURLToPath, pathToFileURL } from 'node:url'

// 本目录（scripts/）。
const HERE = path.dirname(fileURLToPath(import.meta.url))
// mobile 包根。
const ROOT = path.join(HERE, '..')

// #DEFAULT_ANDROID_DIR
// Capacitor 生成的 Android 工程（cap add android 的产物）。
export const DEFAULT_ANDROID_DIR = path.join(ROOT, 'android')
// #DEFAULT_PATCH_DIR
// 我们自己的原生侧补丁模板（入库）。
export const DEFAULT_PATCH_DIR = path.join(ROOT, 'android-patch')
// #DEFAULT_NODEJS_BUILD
// build-node-project.js 的产物（main.js + proxy.js），不入库。
export const DEFAULT_NODEJS_BUILD = path.join(ROOT, 'nodejs-build')
// #GRADLE_INCLUDE
// 追加到 app/build.gradle 末尾的那一行（幂等判据）。
export const GRADLE_INCLUDE = "apply from: 'nodejs.gradle'"
// #REQUIRED_ABIS
// nodejs-mobile 官方提供的 ABI（x86 已停止支持）。
export const REQUIRED_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64']

// #patchManifest
// 给 AndroidManifest.xml 打补丁（纯字符串变换，便于单测）：
//   · 确保有 INTERNET 权限（模板已自带，缺了才补）
//   · 给 <application> 加上 networkSecurityConfig（只对回环放开明文 HTTP）
//
// @param {string} xml - 原始清单
// @returns {{xml: string, changed: string[]}} 结果与本次改动说明
export function patchManifest(xml) {
  // 本次改动记录。
  const changed = []
  // 结果。
  let out = xml
  // 1) INTERNET 权限。
  if (!out.includes('android.permission.INTERNET')) {
    out = out.replace('</manifest>', '    <uses-permission android:name="android.permission.INTERNET" />\n</manifest>')
    changed.push('已补充 INTERNET 权限')
  }
  // 2) network security config（幂等：已有引用就跳过）。
  if (!out.includes('android:networkSecurityConfig')) {
    out = out.replace(
      '<application',
      '<application\n        android:networkSecurityConfig="@xml/network_security_config"',
    )
    changed.push('已为 <application> 加上 networkSecurityConfig')
  }
  // 返回。
  return { xml: out, changed }
}

// #applyGradleInclude
// 在 app/build.gradle 末尾追加 `apply from: 'nodejs.gradle'`（幂等）。
//
// @param {string} text - build.gradle 内容
// @returns {{text: string, changed: boolean}}
export function applyGradleInclude(text) {
  // 已经加过：原样返回（重复执行不会叠加）。
  if (text.includes(GRADLE_INCLUDE)) return { text, changed: false }
  // 追加（带注释说明来源，避免后来人以为可以手改 android/）。
  const appended = `${text.trimEnd()}\n\n// ↓ APK 内置 Node 运行时（nodejs-mobile）：由 scripts/prepare-android.js 追加，android/ 不入库、勿手改\n${GRADLE_INCLUDE}\n`
  return { text: appended, changed: true }
}

// #exists
// 探测文件/目录是否存在。
async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

// #assertExists
// 缺件即失败（把"没准备好"变成明确的报错，而不是打出一个没有 Node 的 APK）。
async function assertExists(target, hint) {
  if (!(await exists(target))) {
    throw new Error(`缺少 ${target}${hint ? `（${hint}）` : ''}`)
  }
}

// #copyDir
// 复制目录（合并到目标，已存在文件覆盖）。
async function copyDir(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.cp(from, to, { recursive: true, force: true })
}

// #prepareAndroid
// 主流程：把 Node 运行时接进 Android 工程。
//
// @param {object} [options]
// @param {string} [options.androidDir] - Android 工程目录
// @param {string} [options.patchDir] - 补丁模板目录
// @param {string} [options.libnodeDir] - 官方 nodejs-mobile zip 解压目录（含 include/ 与 bin/）
// @param {string} [options.nodejsBuildDir] - build-node-project.js 的产物目录
// @param {Function} [options.log] - 日志函数
// @returns {Promise<{steps: string[], abis: string[]}>}
export async function prepareAndroid({
  androidDir = DEFAULT_ANDROID_DIR,
  patchDir = DEFAULT_PATCH_DIR,
  libnodeDir,
  nodejsBuildDir = DEFAULT_NODEJS_BUILD,
  log = console.log,
} = {}) {
  // 步骤记录（测试与 CI 日志都用它）。
  const steps = []
  // 目标路径。
  const appDir = path.join(androidDir, 'app')
  const mainDir = path.join(appDir, 'src', 'main')
  const gradleFile = path.join(appDir, 'build.gradle')
  const manifestFile = path.join(mainDir, 'AndroidManifest.xml')

  // 0) 前置检查：android 工程与两个输入目录都必须存在。
  if (!libnodeDir) {
    throw new Error('必须用 --libnode 指定解压后的 nodejs-mobile 目录（官方 zip 解压后的根目录）')
  }
  await assertExists(gradleFile, 'android 工程不存在？先跑 npx cap add android')
  await assertExists(manifestFile, 'android 工程不完整')
  await assertExists(libnodeDir, '官方 nodejs-mobile zip 解压目录不存在')
  await assertExists(path.join(libnodeDir, 'include', 'node', 'node.h'), '官方 zip 的 include/ 不完整')
  await assertExists(path.join(nodejsBuildDir, 'main.js'), '先跑 node scripts/build-node-project.js')
  await assertExists(path.join(nodejsBuildDir, 'proxy.js'), '先跑 node scripts/build-node-project.js')

  // 1) 预编译运行时 libnode（头文件 + 各 ABI 的 .so）。
  await copyDir(path.join(libnodeDir, 'include'), path.join(appDir, 'libnode', 'include'))
  await copyDir(path.join(libnodeDir, 'bin'), path.join(appDir, 'libnode', 'bin'))
  // 逐个 ABI 校验（少一个会在运行时报 UnsatisfiedLinkError，不如构建期就失败）。
  for (const abi of REQUIRED_ABIS) {
    await assertExists(path.join(appDir, 'libnode', 'bin', abi, 'libnode.so'), `libnode.so 缺 ABI ${abi}`)
  }
  steps.push(`libnode（include + ${REQUIRED_ABIS.length} 个 ABI 的 libnode.so）→ app/libnode/`)
  log(`[android] libnode → ${path.join(appDir, 'libnode')}`)

  // 2) JNI 壳（CMake 工程）。
  await copyDir(path.join(patchDir, 'cpp'), path.join(mainDir, 'cpp'))
  steps.push('JNI 壳（CMakeLists.txt + nodejs_jni.cpp）→ app/src/main/cpp/')
  log('[android] cpp（JNI 壳）已就位')

  // 3) Java 启动器（含覆盖模板的 MainActivity）。
  await copyDir(path.join(patchDir, 'java'), path.join(mainDir, 'java'))
  steps.push('Java 启动器（NodeRuntime + MainActivity）→ app/src/main/java/')
  log('[android] Java（NodeRuntime / MainActivity）已就位')

  // 4) Gradle：复制 nodejs.gradle 并在 app/build.gradle 末尾追加 apply from。
  await fs.copyFile(path.join(patchDir, 'gradle', 'nodejs.gradle'), path.join(appDir, 'nodejs.gradle'))
  const gradleText = await fs.readFile(gradleFile, 'utf8')
  const applied = applyGradleInclude(gradleText)
  if (applied.changed) {
    await fs.writeFile(gradleFile, applied.text)
    steps.push(`app/build.gradle 末尾追加 ${GRADLE_INCLUDE}`)
    log('[android] app/build.gradle 已追加 apply from')
  } else {
    steps.push('app/build.gradle 已包含 nodejs.gradle（跳过）')
    log('[android] app/build.gradle 已包含 nodejs.gradle，跳过')
  }

  // 5) 网络策略 + 清单。
  await copyDir(path.join(patchDir, 'res'), path.join(mainDir, 'res'))
  const manifestText = await fs.readFile(manifestFile, 'utf8')
  const patched = patchManifest(manifestText)
  if (patched.changed.length > 0) {
    await fs.writeFile(manifestFile, patched.xml)
    steps.push(`AndroidManifest.xml：${patched.changed.join('；')}`)
    log(`[android] 清单已更新：${patched.changed.join('；')}`)
  }

  // 6) Node 工程（设备上真正执行的 JS）。
  const assetsDir = path.join(mainDir, 'assets', 'nodejs-project')
  await fs.rm(assetsDir, { recursive: true, force: true })
  await copyDir(nodejsBuildDir, assetsDir)
  steps.push(`Node 工程（${(await fs.readdir(nodejsBuildDir)).sort().join(', ')}）→ assets/nodejs-project/`)
  log(`[android] Node 工程 → ${assetsDir}`)

  // 汇总。
  log(`[android] 完成：${steps.length} 步`)
  return { steps, abis: [...REQUIRED_ABIS] }
}

// 仅在被直接执行时跑主流程（被测试 import 时不执行）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 极简参数解析（--key value）。
  const argv = process.argv.slice(2)
  const arg = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : fallback
  }
  await prepareAndroid({
    androidDir: path.resolve(arg('--android', DEFAULT_ANDROID_DIR)),
    patchDir: path.resolve(arg('--patch', DEFAULT_PATCH_DIR)),
    libnodeDir: arg('--libnode') ? path.resolve(arg('--libnode')) : undefined,
    nodejsBuildDir: path.resolve(arg('--nodejs-build', DEFAULT_NODEJS_BUILD)),
  })
}
