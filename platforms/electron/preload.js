/**
 * Electron 预加载脚本（Step 23）
 *
 * 通过 contextBridge 向渲染进程暴露 AI 代理地址，
 * 供前端（ModManageView 的 AI 设置）经代理调用 AI。
 * 地址由主进程经 additionalArguments 注入（--ai-proxy-url=...）。
 */

// contextBridge。
const { contextBridge } = require('electron')

// 解析主进程注入的代理地址。
const arg = process.argv.find((a) => a.startsWith('--ai-proxy-url='))
// 代理地址（缺省 8787）。
const baseUrl = arg ? arg.split('=')[1] : 'http://127.0.0.1:8787'

// 暴露给渲染进程（只读常量，无 Node 能力）。
contextBridge.exposeInMainWorld('electronAIProxy', {
  // AI 代理基地址。
  baseUrl,
  // 平台标识。
  platform: 'electron',
})
