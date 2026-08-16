# 人生重开模拟器 — Web / Termux 版（Step 24）

单进程服务：静态文件 + 内嵌 AI 代理（`/ai-proxy`，复用 game-engine 的单一实现）。

## Web 使用

```bash
# 1. 构建前端并打包（产出 release/liferestart-web.zip）
node scripts/build.js

# 2. 解压运行
cd release && unzip liferestart-web.zip && cd liferestart-web
node server.js            # http://127.0.0.1:8080
```

- 游戏本身离线可用；AI 增强需在页面「/mods → AI 设置」配置 API Key
- 无 Key 演示：`MOCK=1 node server.js`（AI 设置页测试连接走本地 mock）
- 自定义端口：`PORT=9000 node server.js`

## Termux（Android）使用

```bash
# 安装 Node
pkg install nodejs-lts unzip

# 解压分发包
unzip liferestart-web.zip && cd liferestart-web

# 启动（手机浏览器访问 http://127.0.0.1:8080）
node server.js
```

Termux 提示：若需局域网访问，用 `HOST=0.0.0.0 node server.js`（同 Wi-Fi 下其他设备可访问）。

## 路由

| 路径 | 说明 |
|------|------|
| `/` | 前端页面（hash 路由，`/#/talent` 等） |
| `/ai-proxy/v1/chat/completions` | AI 对话（内嵌代理，SSE 流式支持，错误码 400/401/413/429/500/504） |
| `/ai-proxy/health` | AI 代理健康检查 |

## 验证

```bash
pnpm test                 # 单元测试（server.spec.js，7 用例）
node server.js            # 起服后：
curl http://127.0.0.1:8080/ai-proxy/health
```
