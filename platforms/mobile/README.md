# 人生重开模拟器 — 移动端（Capacitor APK，Step 25）

> ⚠️ **状态：脚手架 + 文档，待 Android SDK 环境验证**。
> 本机 `$ANDROID_HOME`（android-clt）缺 `platforms/` 与 `build-tools/`，无法真实构建 APK。
> 参考实现：`lifeRestart-ai-system/android-offline/`（gradle 工程，nodejs-mobile 集成范例）。

## 架构

```
Vue 前端（www/，Capacitor WebView 加载）
  └── AI 代理（nodejs-mobile 内嵌 Node 运行时，跑 game-engine/server.js）
        └── provider 路由 → OpenAI / DeepSeek / GLM / 通义
```

- 渲染层：Capacitor WebView 加载 `www/`（hash 路由，与 Web 版同一前端构建产物）
- 代理层：`nodejs-mobile` 在 Android 内嵌 Node 运行时执行 AI 代理（单一实现复用，无需独立进程）
- 前端经 `http://127.0.0.1:<port>/v1/chat/completions` 调用（CORS 全开）

## 环境准备

```bash
# 1. Android SDK（本机 android-clt 需补充）：
#    sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools"

# 2. Capacitor CLI（在 platforms/mobile 下）：
npm i -D @capacitor/cli @capacitor/core @capacitor/android
```

## 构建

```bash
# 1. 构建前端 → www/
node scripts/copy-dist.js        # 或 pnpm --filter mobile-platform build

# 2. 生成 Android 工程（首次）
npx cap add android

# 3. 同步前端产物
npx cap sync android

# 4. 构建 APK
cd android && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

## nodejs-mobile 集成（代理通路）

在 `android/` 工程中集成 nodejs-mobile（参考 `lifeRestart-ai-system/android-offline`）：

1. 依赖：`implementation "com.nodejs:nodejs-mobile:..."`（或本地 aar）
2. 启动 Node 运行时加载 `game-engine/server.js`（`assets/nodejs-project/`）
3. WebView 与 Node 通过 `http://127.0.0.1:8787` 通信

## 验证（Step 25 验收）

- [ ] APK 安装后打开 → 完整游戏（前端渲染正常）
- [ ] AI 设置页配置 Key → 测试连接成功（代理通路 OK）
- [ ] 游戏内 AI 注入生效（生成天赋/事件）

## 未决事项（待 SDK 环境验证后处理）

- nodejs-mobile 版本与 Node 24 引擎代码兼容性（server.js 用 `node:http` + 全局 fetch，Node 18+ 即可）
- Capacitor 5/6 与 nodejs-mobile 的 gradle 配置冲突排查
- APK 体积（Electron 二进制不涉及；Node 运行时约 30-50MB）
