/**
 * 路由配置
 *
 * Hash 路由（createWebHashHistory），兼容 GitHub Pages 静态部署。
 *
 * 路由表：
 *   /          主页（模式选择）
 *   /talent    天赋选择页（Step 8，自定义模式）
 *   /character 名人选择页（名人模式：选一位名人，用 TA 的属性与天赋开局）
 *   /property  属性分配页
 *   /game      游戏页（人生轨迹）
 *   /summary   人生总结页（Step 10）
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
// 名人选择页（名人模式：选一位名人，用 TA 的属性与天赋开局）。
import CharacterView from '../views/CharacterView.vue'
// 属性分配页（Step 9）。
import PropertyView from '../views/PropertyView.vue'
// 人生轨迹页（Step 9）。
import GameView from '../views/GameView.vue'
// 人生总结页（Step 10）。
import SummaryView from '../views/SummaryView.vue'
// Mod 管理页（Step 14）。
import ModManageView from '../views/ModManageView.vue'
// Mod 数据详情页（点 Mod 卡片上的「查看数据」进来；可视化该 Mod 装了什么）。
import ModDetailView from '../views/ModDetailView.vue'
// 设置页（日志等级等全局配置）。
import SettingsView from '../views/SettingsView.vue'
// 模拟统计页（批量模拟：随机天赋 + 随机属性）。
import SimulateView from '../views/SimulateView.vue'

// 路由表。
// 具名导出：测试用**同一份**路由表创建内存 history 实例，避免测试与线上路由分叉。
export const routes = [
  // 主页。
  { path: '/', name: 'home', component: HomeView },
  // 天赋选择页。
  { path: '/talent', name: 'talent', component: TalentView },
  // 名人选择页（名人模式：候选名人 → 选定 → 属性分配）。
  { path: '/character', name: 'character', component: CharacterView },
  // 属性分配页。
  { path: '/property', name: 'property', component: PropertyView },
  // 人生轨迹页。
  { path: '/game', name: 'game', component: GameView },
  // 人生总结页。
  { path: '/summary', name: 'summary', component: SummaryView },
  // Mod 管理页。
  { path: '/mods', name: 'mods', component: ModManageView },
  // Mod 数据详情页（:name = Mod 的**目录名**；不需要引擎，可深链）。
  // 注意不加 `props: true`：页面自己用 useRoute() 取参数（避免多出一个落到根元素上的属性）。
  { path: '/mods/:name', name: 'mod-detail', component: ModDetailView },
  // 设置页（全局配置）。
  { path: '/settings', name: 'settings', component: SettingsView },
  // 模拟统计页。
  { path: '/simulate', name: 'simulate', component: SimulateView },
  // 未知路径回主页。
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

// 路由实例（Hash 历史：静态托管无需 404 回退）。
export const router = createRouter({
  // Hash 历史模式。
  history: createWebHashHistory(),
  // 路由定义。
  routes,
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
