/**
 * 路由配置
 *
 * Hash 路由（createWebHashHistory），兼容 GitHub Pages 静态部署。
 *
 * 路由表：
 *   /        主页（模式选择）
 *   /talent  天赋选择页（Step 8）
 *   /game    游戏页（属性分配 + 人生轨迹，Step 9）
 *   /summary 人生总结页（Step 10）
 */

// 导入路由。
import { createRouter, createWebHashHistory } from 'vue-router'
// 导入视图组件。
import HomeView from '../views/HomeView.vue'
// 天赋选择页（Step 8）。
import TalentView from '../views/TalentView.vue'
// 游戏页占位（Step 9 实现）。
import GameView from '../views/GameView.vue'

// 路由表。
export const router = createRouter({
  // Hash 历史模式。
  history: createWebHashHistory(),
  // 路由定义。
  routes: [
    // 主页。
    { path: '/', name: 'home', component: HomeView },
    // 天赋选择页。
    { path: '/talent', name: 'talent', component: TalentView },
    // 游戏页。
    { path: '/game', name: 'game', component: GameView },
    // 未知路径回主页。
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
