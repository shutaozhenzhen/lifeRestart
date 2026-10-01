/**
 * frontend 入口
 *
 * 挂载 Vue 应用：
 *   1. createApp 创建应用。
 *   2. createPinia 注入状态管理。
 *   3. 使用 Hash 路由。
 *   4. 接入全局异常捕获 → 日志悬浮窗（Vue 渲染异常 + window 未捕获异常）。
 */

// 导入 Vue 核心与 Pinia。
import { createApp } from 'vue'
import { createPinia } from 'pinia'
// 导入根组件。
import App from './App.vue'
// 导入路由。
import { router } from './router/index.js'
// 游戏 store（异常日志写入它的缓冲，悬浮窗据此展示/导出）。
import { useGameStore } from './stores/game.js'
// 全局异常捕获与格式化。
import { installErrorCapture, formatErrorLog } from './utils/error-capture.js'

// 创建应用。
const app = createApp(App)
// Pinia 实例（显式保存：挂载前就要拿到 store 接异常，不能依赖组件上下文）。
const pinia = createPinia()
// 注入 Pinia。
app.use(pinia)
// 注入路由。
app.use(router)

// #异常 → 日志
// 为什么需要：Vue 渲染期异常与 window 级未捕获异常此前只出现在浏览器控制台，
// 应用自己的日志缓冲里一条都没有——用户遇到白屏时无法把现场带出来。
// 处理：两类异常统一格式化后写入日志缓冲；error 级日志会让悬浮窗自动展开。

// 取 store（挂载前也能取：显式传入 pinia）。
const store = useGameStore(pinia)
// 1) Vue 渲染/生命周期/侦听器异常。
app.config.errorHandler = (err, _instance, info) => {
  // 写入日志（含 info 与堆栈）。
  store.pushLog('error', formatErrorLog({ kind: 'Vue 错误', error: err, extra: String(info || '') }))
}
// 2) window 未捕获错误 / 未处理的 Promise 拒绝。
installErrorCapture({
  // 浏览器环境才有 window。
  target: typeof window !== 'undefined' ? window : null,
  // 写入日志缓冲。
  pushLog: (level, msg) => store.pushLog(level, msg),
})

// 挂载到 #app。
app.mount('#app')
