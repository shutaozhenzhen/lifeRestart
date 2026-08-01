/**
 * frontend 入口
 *
 * 挂载 Vue 应用：
 *   1. createApp 创建应用。
 *   2. createPinia 注入状态管理。
 *   3. 使用 Hash 路由。
 */

// 导入 Vue 核心与 Pinia。
import { createApp } from 'vue'
import { createPinia } from 'pinia'
// 导入根组件。
import App from './App.vue'
// 导入路由。
import { router } from './router/index.js'

// 创建应用。
const app = createApp(App)
// 注入 Pinia。
app.use(createPinia())
// 注入路由。
app.use(router)
// 挂载到 #app。
app.mount('#app')
