# 人生重开模拟器 — 移动端（Capacitor APK + 内置 Node 运行时，Step 25）

> ✅ **状态：CI 能构建出带内置 Node 运行时的 debug APK，并随滚动 `test` release 发布。**
> APK 里既有 WebView 前端，也有一个**真正的 Node.js 18.20.4 运行时**（nodejs-mobile），
> 在里面跑 game-engine 的 AI 代理 —— 桌面版（Electron 主进程）、Web 版（内嵌 http 服务）、
> 移动版（内置 Node）三端共用**同一份代理实现** `createProxyHandler`。
>
> ⚠️ **真机未验收**：CI 只能证明「APK 里有这些文件、清单权限与网络策略正确」，
> 证明不了「装到手机上一定跑起来」（ABI/系统版本/厂商限制）。装机后请看 logcat 的
> `LiferestartNode` 标签确认 Node 是否启动、代理是否监听 8787。
>
> 📌 **环境硬约束**：**JDK 21**（Capacitor 7 / AGP 8.11+；用 17 会在 Gradle 阶段直接失败）。
> NDK 27.x + CMake 3.x（GitHub runner 已预装；CMake 版本由 CI 用 `LIFERESTART_CMAKE_VERSION` 显式指定）。

## 架构

```
Capacitor WebView（www/，hash 路由，与 Web 版同一份前端产物）
  │  AI 请求直连 http://127.0.0.1:8787/v1/chat/completions
  ▼
APK 内置 Node 运行时（nodejs-mobile v18.20.4 → libnode.so，Node 18.20.4）
  └── assets/nodejs-project/main.js → require('./proxy.js')
        └── game-engine 的 createProxyHandler（provider 路由 / SSE 流式 / CORS）
              └── OpenAI / DeepSeek / GLM / 通义（请求体带用户自己的 apiKey）
```

- **渲染层**：Capacitor WebView 加载 `www/`（前端构建产物，与 Web 版同一个 dist）
- **代理层**：Node 在 App 进程内监听 `127.0.0.1:8787`（只监听回环，不暴露局域网 —— 请求体里有用户 API Key）
- **跨端一致性**：代理实现只有一份（`packages/game-engine/src/ai/ai-proxy.js`），移动端只是换了「谁来执行它」

### 启动链（排障时按这个顺序看）

| 步骤 | 位置 | 失败时的表现 |
|---|---|---|
| 1. `MainActivity.onCreate` | `android-patch/java/.../MainActivity.java` | App 直接崩溃 |
| 2. `NodeRuntime.startIfNeeded` 复制 assets → `filesDir/nodejs-project` | `.../NodeRuntime.java` | logcat `LiferestartNode`：复制失败 |
| 3. `System.loadLibrary("node")` + `"nodejs_jni"` | 同上 | `UnsatisfiedLinkError`（缺 .so / ABI 不匹配） |
| 4. `node::Start(["node", …/main.js, "8787"])` | `android-patch/cpp/nodejs_jni.cpp` | logcat 里没有 `[proxy] AI 代理已启动` |
| 5. `main.js` → `require('./proxy.js')` → 监听 8787 | `nodejs/main.js` + 打包产物 | 前端「测试连接」失败 |
| 6. 前端把代理地址解析为 `http://127.0.0.1:8787` | `packages/frontend/src/utils/mod-runtime.js` | 请求打到 `https://localhost/ai-proxy/...`（404） |

Node 的 `console.log` 在设备上会经 JNI 层转发到 **logcat（标签 `LiferestartNode`）** —— 这是真机排障的第一现场。

## 脚本

| 脚本 | 作用 |
|---|---|
| `scripts/copy-dist.js` | 前端产物 → `www/`（已有完整产物就复用；`--rebuild` 强制重建） |
| `scripts/build-node-project.js` | 用 esbuild 把 `nodejs/entry.js` + game-engine 打成 **CJS 单文件** `nodejs-build/proxy.js`（含产物自检：缺标记就失败），并复制 `main.js` / `package.json` |
| `scripts/smoke-node-project.js` | 用**桌面 Node** 跑一遍打包产物：`/health` + mock 对话（SSE）。设备上跑同一份 JS，用于排掉「代码/打包错」 |
| `scripts/prepare-android.js` | 把运行时/JNI/Java/Gradle/清单/Node 工程**幂等**地接进 `cap add android` 生成的工程 |
| `scripts/collect-apk.js` | Gradle 产出的 APK → 固定路径 `out/liferestart-mobile-debug.apk`（递归查找、空文件报错） |
| `release-workflow.spec.js` | 对 `.github/workflows/release-test.yml` 做结构断言（打包链路的问题只在 CI 里、且常常「绿着」发生） |

### `upload-artifact` 的坑（值得记住，已修）

`actions/upload-artifact@v4` 以**通配符之前的那段路径**作为压缩包的根目录，所以上传
`apk/**/*.apk` 解包后是 `debug/app-debug.apk`（多一层目录）；下游 release job 用平铺的
`artifacts/*.apk` 就匹配不到 → **APK 被静默漏掉，job 还全绿**。
现在先把 APK 收集到平铺的 `out/` 再上传，并在 release job 里加了「mobile 成功却没有 apk 就硬失败」。

## 原生侧改动（`android-patch/`，由 prepare-android.js 应用）

| 文件 | 作用 |
|---|---|
| `cpp/CMakeLists.txt` | 编译 JNI 壳 `libnodejs_jni.so`，按 ABI 链接预编译的 `app/libnode/bin/<abi>/libnode.so` |
| `cpp/nodejs_jni.cpp` | `node::Start(argc, argv)` 的 JNI 入口（Java 参数 → 连续内存 argv），并把 stdout/stderr 接到 logcat |
| `java/.../NodeRuntime.java` | 复制 assets → filesDir（只在 APK 更新后复制）、起线程调 `node::Start`；`PROXY_PORT = 8787` |
| `java/.../MainActivity.java` | **覆盖** Capacitor 模板的同名文件，在 `onCreate` 后拉起 Node |
| `gradle/nodejs.gradle` | `minSdkVersion 24`、`abiFilters`（三个 ABI）、`-DANDROID_STL=c++_shared`、NDK 版本取 `ANDROID_NDK_HOME`、CMake 版本取 `LIFERESTART_CMAKE_VERSION`、`jniLibs.srcDir 'libnode/bin'`、`useLegacyPackaging = true`（否则 APK 涨到 ~180 MB） |
| `res/xml/network_security_config.xml` | **只对回环地址**放开明文 HTTP（127.0.0.1 / localhost），其它出网仍强制 HTTPS |

另外两处（不在 `android-patch/` 里）：
- `capacitor.config.json` 的 `android.allowMixedContent: true` —— WebView 页面是 `https://localhost`，
  访问 `http://127.0.0.1` 属于混合内容，不放行会被 WebView 拦掉（对应 `Bridge.java` 的 `isMixedContentAllowed()`）
- `app/build.gradle` 末尾追加 `apply from: 'nodejs.gradle'`（只追加一行，避免正则改模板）

## 构建

```bash
cd platforms/mobile

# 1. 前端产物 → www/（若 packages/frontend/dist 已存在则复用）
pnpm build

# 2. 打包 APK 内置的 Node 侧（AI 代理 → CJS 单文件）
pnpm build:node                 # → nodejs-build/{proxy.js,main.js,package.json}
pnpm apk:smoke                  # 可选：桌面 Node 冒烟（/health + mock 对话）

# 3. 取官方运行时（CI 会校验 sha256；版本固定 v18.20.4）
curl -fsSL -o /tmp/nodejs-mobile.zip \
  https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip
unzip -q /tmp/nodejs-mobile.zip -d .libnode

# 4. 生成 Android 工程并接线
npx cap add android && npx cap sync android
node scripts/prepare-android.js --libnode .libnode
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# 5. 构建（需要 JDK 21 + NDK 27.x + CMake 3.x）
cd android && chmod +x gradlew && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk

# 6. 收集成发布用的固定路径
cd .. && node scripts/collect-apk.js     # → out/liferestart-mobile-debug.apk
```

APK 体积：`libnode.so` 每个 ABI 约 56~62 MB（arm64-v8a / armeabi-v7a / x86_64），
开启 `useLegacyPackaging` 后压缩存储，整包约 **60~70 MB**。只要一个 ABI 的话，
把 `android-patch/gradle/nodejs.gradle` 的 `abiFilters` 改小即可（例如只留 `arm64-v8a`）。

## 测试

```bash
node scripts/test-all.mjs mobile   # 67 用例
```

| 文件 | 覆盖 |
|---|---|
| `scripts/copy-dist.spec.js`（12） | 产物复用/强制重建/残缺即失败/`www` 先清空 |
| `scripts/collect-apk.spec.js`（12） | 递归查找、固定文件名、空目录与 0 字节报错 |
| `scripts/prepare-android.spec.js`（14） | 清单/gradle 纯变换 + **幂等** + 假工程骨架跑完整流程 + 缺件报错 + 真实模板自检 |
| `scripts/build-node-project.spec.js`（9） | 打包产物内容/清空输出 + **契约**（端口三处一致、JNI 符号名、appId、混合内容开关）+ **真跑冒烟**（起服务、`/health`、mock 对话 SSE） |
| `release-workflow.spec.js`（21） | CI 不变量：JDK 21、平铺上传、递归收集、`--latest`、先校验后删除、运行时固定版本+sha256、补丁顺序、APK 内容校验 |

## 验证（Step 25 验收）

- [x] CI 能构建出 debug APK 并作为 release 资源发布（`liferestart-mobile-debug.apk`）
- [x] APK 内含内置 Node 运行时（CI 逐项校验：`assets/nodejs-project/*`、`libnode.so`、`libnodejs_jni.so`、`libc++_shared.so`、清单权限与网络策略）
- [x] Node 侧打包产物可用桌面 Node 跑通（`/health` + mock 对话 SSE）
- [ ] APK 装机后打开 → 完整游戏（前端渲染正常）— 需真机/模拟器
- [ ] 设置页配置 Key → 「测试连接」成功（代理通路 OK）— 需真机
- [ ] 游戏内 AI 注入生效（生成天赋/事件）— 需真机

## 未决事项

- **真机验收**（安装/启动/AI 连接/生成天赋事件）—— CI 覆盖不到
- release 包是 **debug 签名**；正式分发需要 keystore + `assembleRelease`
- Node 18.20.4 已于 2025 年 EOL，且上游 nodejs-mobile 不再更新（社区现状如此，
  其作者本人也建议新项目改用 Tauri）；后续要升级运行时只能自己编译 libnode
- 后台常驻：目前 Node 随 Activity 启动，App 退到后台被回收时代理会一起停
  （要做常驻得改前台 Service + 通知，并处理厂商后台限制）
