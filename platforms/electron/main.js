/**
 * Electron 主进程（Step 23 桌面版）
 *
 * 职责：
 *   1. 启动 AI 代理子进程（game-engine/server.js），窗口退出时停止。
 *   2. 创建 BrowserWindow 加载 frontend 构建产物（dist-web/index.html）。
 *   3. 通过 preload 向渲染进程暴露 AI 代理地址（contextBridge）。
 *
 * 冒烟模式：`electron . --smoke` — 窗口加载完成后自动退出（exit 0），
 *           供 CI/自动化验证「窗口创建 + 页面加载 + 代理启动」全链路。
 */

// Electron 模块。
const { app, BrowserWindow } = require('electron')
// Node 路径。
const path = require('node:path')
// AI 代理进程管理器。
const { createProxyManager } = require('./proxy-manager.js')

// 冒烟模式（--smoke）。
const SMOKE = process.argv.includes('--smoke')
// AI 代理端口（--ai-proxy-port 或默认 8787）。
const proxyPort = Number(process.argv.find((a) => a.startsWith('--ai-proxy-port='))?.split('=')[1] || 8787)
// AI 代理脚本（game-engine/server.js，工作区相对路径）。
const PROXY_SCRIPT = path.join(__dirname, '..', '..', 'packages', 'game-engine', 'server.js')
// 前端构建产物（dist-web/，由 scripts/copy-dist.js 生成）。
const WEB_INDEX = path.join(__dirname, 'dist-web', 'index.html')

// 代理管理器（注入 console 日志，桌面端可见代理状态）。
const proxyManager = createProxyManager({
  log: { info: console.log, warn: console.warn, error: console.error },
})

// 代理句柄。
let proxyHandle = null
// 主窗口。
let mainWindow = null

// #createWindow
// 创建主窗口（加载前端构建产物，暴露 AI 代理地址）。
function createWindow() {
  // 主窗口。
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    // 标题。
    title: '人生重开模拟器',
    // 网页设置。
    webPreferences: {
      // 预加载脚本（contextBridge 暴露 AI 代理地址）。
      preload: path.join(__dirname, 'preload.js'),
      // 渲染进程地址：AI 代理（本地回环，CORS 全开）。
      additionalArguments: [`--ai-proxy-url=http://127.0.0.1:${proxyPort}`],
      // 上下文隔离（安全默认）。
      contextIsolation: true,
      // 禁 Node（渲染进程不需要）。
      nodeIntegration: false,
    },
  })
  // 加载前端。
  mainWindow.loadFile(WEB_INDEX)
  // 加载完成（冒烟模式退出）。
  mainWindow.webContents.on('did-finish-load', () => {
    // 记录。
    console.log(`[electron] 页面加载完成（${WEB_INDEX}）`)
    // 冒烟模式。
    if (SMOKE) {
      // 记录。
      console.log('[electron] 冒烟通过：窗口创建 + 页面加载 OK')
      // 退出（0）。
      app.exit(0)
    }
  })
  // 渲染进程崩溃。
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    // 记录。
    console.error(`[electron] 渲染进程异常: ${details.reason}`)
    // 冒烟模式：失败退出。
    if (SMOKE) app.exit(1)
  })
  // 窗口关闭。
  mainWindow.on('closed', () => {
    // 置空。
    mainWindow = null
  })
}

// 应用就绪。
app.whenReady().then(async () => {
  // 启动 AI 代理（失败不阻塞窗口——游戏可离线玩，AI 需代理）。
  try {
    // 启动。
    proxyHandle = await proxyManager.start({ script: PROXY_SCRIPT, port: proxyPort })
  } catch (e) {
    // 记录。
    console.warn(`[electron] AI 代理未启动（AI 功能不可用）: ${e.message}`)
  }
  // 创建窗口。
  createWindow()
  // macOS 惯例：点击 Dock 重新建窗。
  app.on('activate', () => {
    // 无窗口时重建。
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 全部窗口关闭（非 macOS）退出。
app.on('window-all-closed', () => {
  // macOS 保持常驻。
  if (process.platform !== 'darwin') app.quit()
})

// 退出前清理：停止 AI 代理。
app.on('before-quit', async () => {
  // 停止代理。
  if (proxyHandle) await proxyHandle.stop()
})
