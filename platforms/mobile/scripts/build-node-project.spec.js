/**
 * build-node-project.js 单测 + APK 内置 Node 侧的**契约测试**（Step 25 延伸）
 *
 * 三条线在这里汇合，任何一条单飞都会在设备上表现为「AI 用不了」，而 CI 可能全绿：
 *   1. 打包：game-engine 的代理必须真的进到 proxy.js 里（缺了就是空壳）
 *   2. 契约：端口/加载方式在前端、Java、Node 三处必须一致
 *   3. 冒烟：用桌面 Node 跑一遍打包产物，确认真的能监听、能回 chat
 *      （设备上跑的是同一份 JS，剩下唯一没被覆盖的只有"原生装载"那一层，由 APK 内容校验兜）
 */

// 测试框架。
import { describe, it, expect, afterEach } from 'vitest'
// 文件系统。
import fs from 'node:fs/promises'
// 路径。
import path from 'node:path'
// 定位本脚本目录（临时产物放在包内，见下方说明）。
import { fileURLToPath } from 'node:url'
// 被测对象：打包。
import { buildNodeProject, BUNDLE_MARKERS, NODE_TARGET } from './build-node-project.js'
// 被测对象：冒烟。
import { runSmoke } from './smoke-node-project.js'

// #TMP_ROOT
// 临时产物目录**放在包内**（platforms/mobile/.tmp/，已 gitignore），而不是系统临时目录：
// esbuild 是独立子进程，在受限环境（沙箱/杀软）里写系统临时目录会被拒（Access is denied），
// 而写工作区内的路径是稳的。测试产物用完即删。
const TMP_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp')

// 临时目录（懒建，用完清理）。
const tempDirs = []

// #tempDir
// 建一个临时目录并登记清理。
async function tempDir(prefix) {
  await fs.mkdir(TMP_ROOT, { recursive: true })
  const dir = await fs.mkdtemp(path.join(TMP_ROOT, prefix))
  tempDirs.push(dir)
  return dir
}

// 清理所有临时目录。
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

// #readText
// 读文本（测试辅助）。
function readText(file) {
  return fs.readFile(file, 'utf8')
}

describe('buildNodeProject（打包 APK 内置 Node 侧）', () => {
  it('产出 3 个文件：proxy.js / main.js / package.json', async () => {
    const out = path.join(await tempDir('mobile-nodejs-'), 'build')
    const result = await buildNodeProject({ out, log: () => {} })
    expect(result.files).toEqual(['proxy.js', 'main.js', 'package.json'])
    for (const name of result.files) {
      expect(await fs.readFile(path.join(out, name), 'utf8')).toBeTruthy()
    }
    // main.js 是设备上的入口，必须 require 同目录的 proxy.js。
    expect(await readText(path.join(out, 'main.js'))).toContain("require(path.join(__dirname, 'proxy.js'))")
  })

  it('proxy.js 里真的打进了 game-engine 的代理（不是空壳）', async () => {
    const out = path.join(await tempDir('mobile-nodejs-'), 'build')
    await buildNodeProject({ out, log: () => {} })
    const code = await readText(path.join(out, 'proxy.js'))
    // 标记：路由、健康检查、http 服务。
    for (const marker of BUNDLE_MARKERS) {
      expect(code).toContain(marker)
    }
    // 服务商表也应在（说明 PROVIDER_CONFIGS 真的被引用进来了）。
    expect(code).toContain('openai')
    // 打进产物里的必须是**引擎实现**，不是对 game-engine 的 import（否则设备上会找不到模块）。
    expect(code).not.toMatch(/require\(["']game-engine/)
  })

  it('输出为 CJS（nodejs-mobile 侧只跑 CJS）', async () => {
    const out = path.join(await tempDir('mobile-nodejs-'), 'build')
    await buildNodeProject({ out, log: () => {} })
    const code = await readText(path.join(out, 'proxy.js'))
    // CJS 特征：esbuild 用 __toCommonJS + module.exports 挂载，且 require 内置模块。
    expect(code).toContain('module.exports = __toCommonJS(')
    expect(code).toContain('require("node:http")')
    // 不能残留 ESM 语句（否则设备上 require 会语法报错）。
    expect(code).not.toMatch(/^\s*(import|export)\s/m)
    expect(NODE_TARGET).toBe('node18')
  })

  it('清空输出目录（上一轮残留不会被打进 APK）', async () => {
    const out = path.join(await tempDir('mobile-nodejs-'), 'build')
    await fs.mkdir(out, { recursive: true })
    await fs.writeFile(path.join(out, 'stale.js'), '// 旧产物')
    await buildNodeProject({ out, log: () => {} })
    await expect(fs.access(path.join(out, 'stale.js'))).rejects.toThrow()
  })
})

describe('契约：端口与装载方式三处一致', () => {
  it('前端 / Java / Node 侧的端口都是 8787', async () => {
    // 前端（浏览器侧解析代理地址的地方）。
    const frontend = await readText(path.join('..', '..', 'packages', 'frontend', 'src', 'utils', 'mod-runtime.js'))
    const frontendPort = frontend.match(/NATIVE_AI_PROXY_PORT = (\d+)/)
    expect(frontendPort, '前端里找不到 NATIVE_AI_PROXY_PORT').not.toBeNull()
    // Java 启动器。
    const java = await readText(path.join('android-patch', 'java', 'com', 'liferestart', 'mobile', 'NodeRuntime.java'))
    const javaPort = java.match(/PROXY_PORT = (\d+)/)
    expect(javaPort, 'NodeRuntime.java 里找不到 PROXY_PORT').not.toBeNull()
    // Node 侧默认端口。
    const mainJs = await readText(path.join('nodejs', 'main.js'))
    const nodePort = mainJs.match(/\|\| (\d{4,5})\)/)
    expect(nodePort, 'main.js 里找不到默认端口').not.toBeNull()
    // 三处必须相等。
    expect(javaPort[1]).toBe(frontendPort[1])
    expect(nodePort[1]).toBe(frontendPort[1])
  })

  it('Java 侧加载的两个 .so 与 CMake 模板里的目标名对得上', async () => {
    const java = await readText(path.join('android-patch', 'java', 'com', 'liferestart', 'mobile', 'NodeRuntime.java'))
    // System.loadLibrary("node") 来自官方 libnode.so；nodejs_jni 由 CMake 编译。
    expect(java).toContain('System.loadLibrary("node")')
    expect(java).toContain('System.loadLibrary("nodejs_jni")')
    const cmake = await readText(path.join('android-patch', 'cpp', 'CMakeLists.txt'))
    expect(cmake).toContain('add_library(nodejs_jni SHARED nodejs_jni.cpp)')
    // 官方 .so 按 ABI 选择，路径必须与 prepare-android.js 的摆放一致（app/libnode/bin/<abi>/）。
    expect(cmake).toContain('libnode/bin/${ANDROID_ABI}/libnode.so')
    // JNI 符号名与 Java 包名/类名/方法名绑定。
    const cpp = await readText(path.join('android-patch', 'cpp', 'nodejs_jni.cpp'))
    expect(cpp).toContain('Java_com_liferestart_mobile_NodeRuntime_startNodeWithArguments')
  })

  it('capacitor.config.json 开了混合内容（否则 https://localhost 连不上 http://127.0.0.1）', async () => {
    const config = JSON.parse(await readText('capacitor.config.json'))
    expect(config.android.allowMixedContent).toBe(true)
    // 仍然保持 https scheme（安全上下文），只是放行混合内容。
    expect(config.server.androidScheme).toBe('https')
    expect(config.webDir).toBe('www')
  })

  it('Android 侧的包名与 appId 一致（JNI 符号名依赖它）', async () => {
    const config = JSON.parse(await readText('capacitor.config.json'))
    expect(config.appId).toBe('com.liferestart.mobile')
    const java = await readText(path.join('android-patch', 'java', 'com', 'liferestart', 'mobile', 'MainActivity.java'))
    expect(java).toContain('package com.liferestart.mobile;')
  })
})

describe('冒烟：桌面 Node 跑打包产物（设备上跑的是同一份 JS）', () => {
  it(
    '能启动、/health 正常、对话路由返回 SSE',
    async () => {
      // 自己先打包（不依赖外部先跑过 build:node）。
      const out = path.join(await tempDir('mobile-nodejs-'), 'build')
      await buildNodeProject({ out, log: () => {} })
      // 换一个不常用的端口，避免和开发中的代理服务撞车。
      const result = await runSmoke({ port: 18787, buildDir: out, timeoutMs: 30000, log: () => {} })
      // 健康检查。
      expect(result.health.ok).toBe(true)
      expect(result.health.service).toBe('ai-proxy')
      expect(result.health.providers).toContain('mock')
      // 对话路由：mock 服务商流式返回。
      expect(result.chatStatus).toBe(200)
      expect(result.chatText).toContain('data:')
      expect(result.chatText).toContain('mock')
      // Node 侧自己打印的启动横幅（设备上会出现在 logcat 里）。
      expect(result.nodeOutput).toContain('AI 代理已启动')
    },
    60000,
  )
})
