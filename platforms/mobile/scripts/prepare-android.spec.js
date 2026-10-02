/**
 * prepare-android.js 单测（Step 25 延伸：APK 内置 Node 运行时）
 *
 * 这是"把原生侧改动打到现场生成的 Android 工程上"的那一步，错了就会打出一个**没有 Node 的 APK**
 * 或者 Gradle 直接失败，所以两条都要钉住：
 *   · 纯变换（清单补丁 / gradle 追加）逐条断言，且必须**幂等**（CI 可能重跑）
 *   · 用真实模板 + 假工程骨架跑一遍完整流程，断言产物齐全
 *   · 缺件（没解压 libnode、没跑 build-node-project、少一个 ABI）必须**报错**而不是静默继续
 */

// 测试框架。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// 文件系统。
import fs from 'node:fs/promises'
// 临时目录。
import os from 'node:os'
// 路径。
import path from 'node:path'
// 被测对象（含真实模板目录常量）。
import {
  patchManifest,
  applyGradleInclude,
  prepareAndroid,
  DEFAULT_PATCH_DIR,
  GRADLE_INCLUDE,
  REQUIRED_ABIS,
} from './prepare-android.js'

// 每个用例独立的临时根目录。
let tmp

// 建临时目录。
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-android-'))
})

// 清理。
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

// #writeFile
// 写文件（自动建父目录）。
async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

// #exists
// 是否存在。
async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

// #CAPACITOR_MANIFEST
// 与 Capacitor 生成的清单同构（保留缩进与 INTERNET 权限，才能验证"已有的不重复加"）。
const CAPACITOR_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:label="@string/app_name"
        android:theme="@style/AppTheme">

        <activity android:name=".MainActivity" android:exported="true" />
    </application>

    <!-- Permissions -->

    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`

// #CAPACITOR_BUILD_GRADLE
// 与 Capacitor 生成的 app/build.gradle 同构（关键是有 android{} 块，apply from 要追加到文件末尾）。
const CAPACITOR_BUILD_GRADLE = `apply plugin: 'com.android.application'

android {
    namespace "com.liferestart.mobile"
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "com.liferestart.mobile"
        minSdkVersion rootProject.ext.minSdkVersion
    }
}

dependencies {
    implementation project(':capacitor-android')
}
`

// #makeInputs
// 造一份「官方 nodejs-mobile 解压目录」+「nodejs-build 产物」+「假的 Android 工程」。
async function makeInputs({ includeNodeHeader = true, abis = REQUIRED_ABIS, nodejsFiles = ['main.js', 'proxy.js', 'package.json'] } = {}) {
  // 官方 zip 解压目录。
  const libnodeDir = path.join(tmp, 'libnode')
  if (includeNodeHeader) {
    await writeFile(path.join(libnodeDir, 'include', 'node', 'node.h'), '// node.h stub')
  }
  for (const abi of abis) {
    await writeFile(path.join(libnodeDir, 'bin', abi, 'libnode.so'), `ELF ${abi}`)
  }
  // nodejs-build 产物。
  const nodejsBuildDir = path.join(tmp, 'nodejs-build')
  for (const name of nodejsFiles) {
    await writeFile(path.join(nodejsBuildDir, name), `// ${name}`)
  }
  // 假 Android 工程。
  const androidDir = path.join(tmp, 'android')
  await writeFile(path.join(androidDir, 'app', 'build.gradle'), CAPACITOR_BUILD_GRADLE)
  await writeFile(path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'), CAPACITOR_MANIFEST)
  return { androidDir, libnodeDir, nodejsBuildDir, patchDir: DEFAULT_PATCH_DIR }
}

describe('patchManifest（清单补丁）', () => {
  it('给 <application> 加上 networkSecurityConfig，且不动已有权限', () => {
    const { xml, changed } = patchManifest(CAPACITOR_MANIFEST)
    expect(xml).toContain('android:networkSecurityConfig="@xml/network_security_config"')
    // 模板已有 INTERNET：不能重复添加。
    expect(xml.match(/android\.permission\.INTERNET/g)).toHaveLength(1)
    expect(changed).toHaveLength(1)
  })

  it('缺少 INTERNET 权限时补上', () => {
    const withoutInternet = CAPACITOR_MANIFEST.replace(/\s*<uses-permission[^>]*>\s*/, '\n')
    const { xml, changed } = patchManifest(withoutInternet)
    expect(xml).toContain('android.permission.INTERNET')
    expect(changed.join()).toContain('INTERNET')
  })

  it('幂等：重复打补丁不会出现两处 networkSecurityConfig', () => {
    const once = patchManifest(CAPACITOR_MANIFEST).xml
    const twice = patchManifest(once)
    expect(twice.xml).toBe(once)
    expect(twice.changed).toHaveLength(0)
    expect(twice.xml.match(/android:networkSecurityConfig/g)).toHaveLength(1)
  })
})

describe('applyGradleInclude（追加 apply from）', () => {
  it('首次追加到文件末尾', () => {
    const { text, changed } = applyGradleInclude(CAPACITOR_BUILD_GRADLE)
    expect(changed).toBe(true)
    expect(text.trimEnd().endsWith(GRADLE_INCLUDE)).toBe(true)
    // 原有内容不能丢。
    expect(text).toContain("implementation project(':capacitor-android')")
  })

  it('幂等：已包含则不重复追加', () => {
    const once = applyGradleInclude(CAPACITOR_BUILD_GRADLE).text
    const twice = applyGradleInclude(once)
    expect(twice.changed).toBe(false)
    expect(twice.text.match(/apply from: 'nodejs\.gradle'/g)).toHaveLength(1)
  })
})

describe('prepareAndroid（完整流程）', () => {
  it('把运行时/JNI/Java/Gradle/清单/Node 工程全部就位', async () => {
    const inputs = await makeInputs()
    const result = await prepareAndroid({ ...inputs, log: () => {} })
    const app = path.join(inputs.androidDir, 'app')
    // 1) 官方运行时（头文件 + 每个 ABI 的 .so）。
    expect(await exists(path.join(app, 'libnode', 'include', 'node', 'node.h'))).toBe(true)
    for (const abi of REQUIRED_ABIS) {
      expect(await exists(path.join(app, 'libnode', 'bin', abi, 'libnode.so'))).toBe(true)
    }
    // 2) JNI 壳。
    expect(await exists(path.join(app, 'src', 'main', 'cpp', 'CMakeLists.txt'))).toBe(true)
    expect(await exists(path.join(app, 'src', 'main', 'cpp', 'nodejs_jni.cpp'))).toBe(true)
    // 3) Java：模板 MainActivity 被覆盖，NodeRuntime 新增。
    const mainActivity = await fs.readFile(path.join(app, 'src', 'main', 'java', 'com', 'liferestart', 'mobile', 'MainActivity.java'), 'utf8')
    expect(mainActivity).toContain('NodeRuntime.startIfNeeded')
    expect(await exists(path.join(app, 'src', 'main', 'java', 'com', 'liferestart', 'mobile', 'NodeRuntime.java'))).toBe(true)
    // 4) Gradle：nodejs.gradle 就位 + build.gradle 末尾追加。
    expect(await exists(path.join(app, 'nodejs.gradle'))).toBe(true)
    expect(await fs.readFile(path.join(app, 'build.gradle'), 'utf8')).toContain(GRADLE_INCLUDE)
    // 5) 清单与网络策略。
    expect(await exists(path.join(app, 'src', 'main', 'res', 'xml', 'network_security_config.xml'))).toBe(true)
    expect(await fs.readFile(path.join(app, 'src', 'main', 'AndroidManifest.xml'), 'utf8')).toContain('android:networkSecurityConfig')
    // 6) Node 工程（设备上真正执行的 JS）。
    for (const name of ['main.js', 'proxy.js', 'package.json']) {
      expect(await exists(path.join(app, 'src', 'main', 'assets', 'nodejs-project', name))).toBe(true)
    }
    // 步骤记录里要能看到关键动作（CI 日志靠它复盘）。
    expect(result.steps.join('\n')).toContain('libnode')
    expect(result.abis).toEqual(REQUIRED_ABIS)
  })

  it('重复执行幂等（清单/gradle 不会叠加）', async () => {
    const inputs = await makeInputs()
    await prepareAndroid({ ...inputs, log: () => {} })
    await prepareAndroid({ ...inputs, log: () => {} })
    const app = path.join(inputs.androidDir, 'app')
    const gradleText = await fs.readFile(path.join(app, 'build.gradle'), 'utf8')
    expect(gradleText.match(/apply from: 'nodejs\.gradle'/g)).toHaveLength(1)
    const manifestText = await fs.readFile(path.join(app, 'src', 'main', 'AndroidManifest.xml'), 'utf8')
    expect(manifestText.match(/android:networkSecurityConfig/g)).toHaveLength(1)
  })

  it('清掉上一次的 Node 工程残留（避免旧 proxy.js 被打进 APK）', async () => {
    const inputs = await makeInputs()
    // 先放一个"上一轮残留"。
    await writeFile(path.join(inputs.androidDir, 'app', 'src', 'main', 'assets', 'nodejs-project', 'stale.js'), '// 旧产物')
    await prepareAndroid({ ...inputs, log: () => {} })
    expect(await exists(path.join(inputs.androidDir, 'app', 'src', 'main', 'assets', 'nodejs-project', 'stale.js'))).toBe(false)
  })

  it('没有 --libnode → 报错（并说明要传什么）', async () => {
    const inputs = await makeInputs()
    await expect(prepareAndroid({ ...inputs, libnodeDir: undefined, log: () => {} })).rejects.toThrow(/--libnode/)
  })

  it('官方 zip 解压目录不完整（缺 node.h）→ 报错', async () => {
    const inputs = await makeInputs({ includeNodeHeader: false })
    await expect(prepareAndroid({ ...inputs, log: () => {} })).rejects.toThrow(/include/)
  })

  it('少一个 ABI 的 libnode.so → 报错（否则真机上是 UnsatisfiedLinkError）', async () => {
    const inputs = await makeInputs({ abis: ['arm64-v8a', 'x86_64'] })
    await expect(prepareAndroid({ ...inputs, log: () => {} })).rejects.toThrow(/ABI armeabi-v7a/)
  })

  it('没先跑 build-node-project（缺 proxy.js）→ 报错并提示', async () => {
    const inputs = await makeInputs({ nodejsFiles: ['main.js', 'package.json'] })
    await expect(prepareAndroid({ ...inputs, log: () => {} })).rejects.toThrow(/build-node-project/)
  })

  it('android 工程不存在 → 报错并提示 cap add', async () => {
    const inputs = await makeInputs()
    await expect(prepareAndroid({ ...inputs, androidDir: path.join(tmp, 'nope'), log: () => {} })).rejects.toThrow(/\?先跑|不存在/)
  })

  it('真实模板存在且内容非空（防止模板被误删/清空）', async () => {
    // 直接用仓库里的真实模板目录，逐个确认关键文件在。
    const expected = [
      path.join('cpp', 'CMakeLists.txt'),
      path.join('cpp', 'nodejs_jni.cpp'),
      path.join('java', 'com', 'liferestart', 'mobile', 'MainActivity.java'),
      path.join('java', 'com', 'liferestart', 'mobile', 'NodeRuntime.java'),
      path.join('gradle', 'nodejs.gradle'),
      path.join('res', 'xml', 'network_security_config.xml'),
    ]
    for (const rel of expected) {
      const content = await fs.readFile(path.join(DEFAULT_PATCH_DIR, rel), 'utf8')
      expect(content.length).toBeGreaterThan(50)
    }
    // 模板里的端口必须与前端/Node 侧一致（三处契约在 nodejs-contract.spec.js 里逐个解析比对）。
    const java = await fs.readFile(path.join(DEFAULT_PATCH_DIR, 'java', 'com', 'liferestart', 'mobile', 'NodeRuntime.java'), 'utf8')
    expect(java).toMatch(/PROXY_PORT = 8787/)
    // JNI 符号名必须与 Java 包名/类名/方法名严格对应（改名不同步就是 UnsatisfiedLinkError）。
    const cpp = await fs.readFile(path.join(DEFAULT_PATCH_DIR, 'cpp', 'nodejs_jni.cpp'), 'utf8')
    expect(cpp).toContain('Java_com_liferestart_mobile_NodeRuntime_startNodeWithArguments')
    // Gradle 模板：ABI 限定 + 压缩打包（不然 APK 会涨到 ~180MB）+ 回环明文策略。
    const gradle = await fs.readFile(path.join(DEFAULT_PATCH_DIR, 'gradle', 'nodejs.gradle'), 'utf8')
    expect(gradle).toContain('abiFilters "arm64-v8a", "armeabi-v7a", "x86_64"')
    expect(gradle).toContain('useLegacyPackaging = true')
    expect(gradle).toContain('-DANDROID_STL=c++_shared')
    expect(gradle).toContain('src/main/cpp/CMakeLists.txt')
    expect(gradle).toContain('minSdkVersion 24')
  })
})
