// Vite 配置（frontend）
// 引入 Vue 插件，启用 Hash 路由兼容 GitHub Pages。
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 导出 Vite 配置。
export default defineConfig({
  // Vue 插件。
  plugins: [vue()],
  // 开发服务器：端口 3000，自动打开浏览器。
  server: {
    port: 3000,
    open: true,
  },
  // 构建配置。
  build: {
    // 输出目录。
    outDir: 'dist',
  },
})
