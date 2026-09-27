// Vite 配置（frontend）
// 引入 Vue 插件，启用 Hash 路由兼容 GitHub Pages。
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 导出 Vite 配置。
export default defineConfig({
  // Vue 插件。
  plugins: [vue()],
  // 资源基础路径：相对路径。
  // GitHub Pages 项目页部署在 https://<user>.github.io/<repo>/ 子路径下，
  // 默认 base '/' 会让 /assets/* 指向域名根而 404；'./' 生成相对引用，
  // 配合 Hash 路由（#/xxx 不影响相对路径解析）可同时兼容用户页与项目页。
  base: './',
  // 开发服务器：端口 3000，自动打开浏览器。
  server: {
    port: 3000,
    open: true,
    // 开发代理：/ai-proxy → 本地 AI 代理（Step 16，先启动 cd packages/game-engine && node server.js）。
    proxy: {
      '/ai-proxy': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        // 剥离前缀：/ai-proxy/health → /health。
        rewrite: (path) => path.replace(/^\/ai-proxy/, ''),
      },
    },
  },
  // 构建配置。
  build: {
    // 输出目录。
    outDir: 'dist',
  },
})
