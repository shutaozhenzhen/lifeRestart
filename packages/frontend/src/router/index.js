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
// 游戏 store（路由导航日志：翻页行为进日志面板）。
import { useGameStore } from '../stores/game.js'
// 守卫判定纯函数（引擎页未初始化重定向，可测试）。
import { shouldRedirectEnginePage } from './guard.js'
// 天赋选择页（Step 8）。
import TalentView from '../views/TalentView.vue'
// 属性分配页（Step 9）。
import PropertyView from '../views/PropertyView.vue'
// 人生轨迹页（Step 9）。
import GameView from '../views/GameView.vue'
// 人生总结页（Step 10）。
import SummaryView from '../views/SummaryView.vue'
// Mod 管理页（Step 14）。
import ModManageView from '../views/ModManageView.vue'
// 设置页（日志等级等全局配置）。
import SettingsView from '../views/SettingsView.vue'

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
    // 属性分配页。
    { path: '/property', name: 'property', component: PropertyView },
    // 人生轨迹页。
    { path: '/game', name: 'game', component: GameView },
    // 人生总结页。
    { path: '/summary', name: 'summary', component: SummaryView },
    // Mod 管理页。
    { path: '/mods', name: 'mods', component: ModManageView },
    // 设置页（全局配置）。
    { path: '/settings', name: 'settings', component: SettingsView },
    // 未知路径回主页。
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// 导航日志：每次路由切换打 UI 日志（翻页行为可观测，常显进日志面板）。
router.afterEach((to) => {
  // 获取 store（导航发生在 app 启动后，pinia 已激活）。
  const gameStore = useGameStore()
  // 记录导航。
  gameStore.pushLog('info', `[UI][route] → ${to.path}`)
})

// 导航守卫：需要引擎的页面必须已初始化（判定逻辑见 guard.js 纯函数，可测试）。
// 原因：store 状态为内存态，刷新后 life 重置为 null；
// 若 hash 停留在 #/talent 等页，刷新会直进该页导致抽卡/翻年报 null 异常。
// 处理：未初始化 → 重定向主页（用户重新点「开始」即可）。
router.beforeEach((to) => {
  // 游戏 store。
  const gameStore = useGameStore()
  // 判定（纯函数）。
  const redirect = shouldRedirectEnginePage(to.path, gameStore.isReady)
  // 需重定向。
  if (redirect) {
    // 守卫日志（常显进面板）。
    gameStore.pushLog('warn', `[UI][guard] ${to.path} 需要引擎但未初始化（刷新后状态丢失），重定向主页`)
    // 重定向主页。
    return redirect
  }
})
