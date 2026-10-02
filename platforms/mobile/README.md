# 人生重开模拟器 — 移动端（Capacitor APK，Step 25）

> ✅ **状态：CI 已能真实产出并发布 debug APK**。
> `.github/workflows/release-test.yml` 的 `mobile` job 在 ubuntu runner 上现场执行
> `cap add android` → `gradlew assembleDebug` → 收集 APK → 随滚动 `test` release 发布
> （产物名 `liferestart-mobile-debug.apk`）。
>
> ⚠️ **仍未实现**：App 内嵌 AI 代理（`nodejs-mobile`）。当前 APK 里只有 WebView 加载的前端，
> 因此"设置页测 AI 连接"在手机上不可用（需要外部代理服务，或在 WebView 里直连支持 CORS 的 provider）。
>
> 📌 **环境硬约束**：**JDK 21**。Capacitor 7 / AGP 8.11+ 用 JDK 17 会在 Gradle 阶段直接失败
> （CI 上复现过：run 36992811506 失败在 `Build debug APK`，换 21 后 run 36993418144 起稳定通过）。

## 架构

```
Vue 前端（www/，Capacitor WebView 加载）
  └── AI 代理（nodejs-mobile 内嵌 Node 运行时，跑 game-engine/server.js）  ← 尚未实现
        └── provider 路由 → OpenAI / DeepSeek / GLM / 通义
```

- 渲染层：Capacitor WebView 加载 `www/`（hash 路由，与 Web 版同一前端构建产物）
- 代理层（规划）：`nodejs-mobile` 在 Android 内嵌 Node 运行时执行 AI 代理（单一实现复用，无需独立进程）
- 前端经 `http://127.0.0.1:<port>/v1/chat/completions` 调用（CORS 全开）

## 脚本

| 脚本 | 作用 |
|---|---|
| `scripts/copy-dist.js` | 把 `packages/frontend/dist` 同步到 `www/`（Capacitor 的 `webDir`）。**已有完整产物就复用**（`index.html` + `data/age.json` 都在），否则自己调 vite；`--rebuild` 强制重建。构建后产物仍残缺会**抛错**，不静默产出白屏包 |
| `scripts/collect-apk.js` | 从 `android/app/build/outputs/apk` **递归**找 APK，复制成固定路径 `out/liferestart-mobile-debug.apk`。找不到、或文件为 0 字节都**抛错** |
| `release-workflow.spec.js` | 对 `.github/workflows/release-test.yml` 做结构断言（见文件头注释：三个真实踩过的坑） |

`collect-apk.js` 存在的原因（值得记住）：
`actions/upload-artifact@v4` 以**通配符之前的那段路径**作为压缩包的根目录，所以上传
`android/app/build/outputs/apk/**/*.apk` 解包后是 `debug/app-debug.apk`（多一层目录）；
下游 release job 用平铺的 `artifacts/*.apk` 就匹配不到 → **APK 被静默漏掉，job 还全绿**。
先把 APK 收集到平铺的 `out/` 再上传，压缩根就是 `out/`，解包后必定在顶层。

## 环境准备

```bash
# JDK 21（必须；Capacitor 7 / AGP 8.11+ 不支持 17）
java -version    # 应为 21.x

# Android SDK：需要 platforms（API 35/36 之一）、build-tools、platform-tools
sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"
yes | sdkmanager --licenses      # 未接受许可时 gradlew 直接失败

# Capacitor CLI（workspace 已在根 pnpm install 时装好；单独装用）
npm i -D @capacitor/cli @capacitor/core @capacitor/android
```

## 构建

```bash
cd platforms/mobile

# 1. 前端产物 → www/（若 packages/frontend/dist 已存在则直接复用）
pnpm build                       # 强制重新构建：pnpm build:rebuild

# 2. 生成 Android 工程（首次；android/ 不入库）
npx cap add android
npx cap sync android

# 3. 告诉 Gradle SDK 在哪（AGP 有时读不到 ANDROID_HOME）
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# 4. 构建 APK
cd android && chmod +x gradlew && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk

# 5. 收集成发布用的固定路径（CI 的 upload-artifact 之前会跑）
cd .. && node scripts/collect-apk.js     # → out/liferestart-mobile-debug.apk
```

## 测试

```bash
node scripts/test-all.mjs mobile      # 39 用例：copy-dist（12）/ collect-apk（12）/ release workflow（15）
```

`copy-dist.spec.js` 与 `collect-apk.spec.js` 用临时目录跑真实文件操作（不 mock fs）；
`release-workflow.spec.js` 读 workflow 文本做结构断言——**改 workflow 请一并跑它**。

## nodejs-mobile 集成（代理通路，未完成）

在 `android/` 工程中集成 nodejs-mobile（参考 `lifeRestart-ai-system/android-offline`）：

1. 依赖：`implementation "com.nodejs:nodejs-mobile:..."`（或本地 aar）
2. 启动 Node 运行时加载 `game-engine/server.js`（`assets/nodejs-project/`）
3. WebView 与 Node 通过 `http://127.0.0.1:8787` 通信

## 验证（Step 25 验收）

- [x] CI 能构建出 debug APK 并作为 release 资源发布（`liferestart-mobile-debug.apk`）
- [ ] APK 安装后打开 → 完整游戏（前端渲染正常）— 需真机/模拟器，CI 无法覆盖
- [ ] AI 设置页配置 Key → 测试连接成功（代理通路 OK）— 依赖上面的 nodejs-mobile 集成
- [ ] 游戏内 AI 注入生效（生成天赋/事件）

## 未决事项

- nodejs-mobile 集成（含 APK 体积：Node 运行时约 30–50MB）
- nodejs-mobile 与 Capacitor 7 的 gradle 配置冲突排查
- 真机验收（安装/启动/AI 连接），以及 release 包签名（当前是 debug 包）
