<script setup>
// 主页：模式选择 + 开始新人生。
// 两种模式（对应原版 remake 的 Mode）：
//   custom    自定义模式 → 天赋选择页（抽卡）
//   celebrity 名人模式   → 名人选择页（选一位名人，用 TA 的属性与天赋开局）
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'
// 数据加载（与模拟页共用同一实现：原版数据 → fixture 降级）。
import { loadGameData } from '../utils/game-data.js'
// 重置本地数据（存档 / Mod 状态 / AI Key / 界面偏好 + 已安装 Mod）。
import { resetAppData, resetSummary } from '../utils/reset-data.js'
// Mod 面板（slot = home；Mod 通过 manifest.ui.panels / gameAPI.ui.addPanel 插入）。
import ModPanels from '../components/ModPanels.vue'

// 路由。
const router = useRouter()
// 游戏 store。
const store = useGameStore()
// 初始化状态。
const loading = ref(false)
// 当前选中的模式。
const activeMode = ref('custom')
// 随机种子输入（留空 = 每局自动生成；填旧种子 = 复现同一局）。
const seedInput = ref('')
// 重置数据：是否已展开确认条（危险操作要两步）。
const confirmingReset = ref(false)
// 重置中（防重复点击）。
const resetting = ref(false)
// 重置结果提示。
const resetMessage = ref('')
// 将清空的内容（确认条里逐条列出，别让人盲点）。
const resetItems = resetSummary()

// 组装游戏数据：数据源由 lifeRestart-data Mod 的启停状态决定。
// 加载逻辑（含降级、Mod 运行时与 dataSource 标注）统一在 utils/game-data.js —— 模拟页共用同一份实现。
async function buildData() {
  // 按优先级加载（原版数据 → fixture 降级）+ 前端 Mod 运行时（合并数据、返回待执行代码）。
  const bundle = await loadGameData()
  // 页面日志：数据源（降级用 warn，便于在日志面板一眼看到）。
  store.pushLog(bundle.degraded ? 'warn' : 'info', `[UI][home] 数据源：${bundle.dataSource}`)
  // 记录数据源摘要（日志报告头部会带上，便于判断问题是否与数据相关）。
  store.dataSource = bundle.dataSource
  // Mod 运行信息：加载了哪些、有没有错误（都要让人看得见）。
  if (bundle.mods) {
    // 错误逐条。
    for (const e of bundle.mods.errors) store.pushLog('warn', `[UI][mods] ${e}`)
    // 已加载清单。
    if (bundle.mods.loaded.length > 0) store.pushLog('info', `[UI][mods] 已加载 Mod：${bundle.mods.loaded.join(', ')}（代码 ${bundle.mods.codes} 个）`)
  }
  // 返回整包（data/hooks/modCodes 都要给 store.init）。
  return bundle
}

// #askReset
// 第一步：展开确认条（危险操作不直接执行）。
function askReset() {
  // 展开。
  confirmingReset.value = true
  // 清掉上次结果。
  resetMessage.value = ''
}

// #doReset
// 第二步：确认后真正清空（存档 + Mod 状态 + AI 配置 + 界面偏好 + 已安装 Mod），
// 并把**内存态**一起归零（否则当前会话还留着上一局的 life / 轨迹 / 日志）。
//
// @returns {Promise<void>}
async function doReset() {
  // 防重复。
  resetting.value = true
  // 清（不抛：失败项在 errors 里）。
  const result = await resetAppData()
  // 内存态归零（引擎实例、轨迹、日志缓冲全部回到初始）。
  store.$reset()
  // 结果提示（$reset 会清日志，所以写在重置之后）。
  const parts = [`已清空 ${result.cleared.length} 个存储键`]
  // 本来就没有的如实说明（避免让人以为清了很多）。
  if (result.absent.length) parts.push(`${result.absent.length} 项本来为空`)
  // 卸载的本地 Mod。
  if (result.removedMods.length) parts.push(`卸载本地 Mod ${result.removedMods.length} 个`)
  // 失败项（最坏的情况：清了却说成功）。
  if (result.errors.length) parts.push(`⚠ ${result.errors.length} 项失败：${result.errors[0]}`)
  // 组装提示。
  resetMessage.value = `${parts.join('，')}（刷新页面即为全新状态）`
  // 日志（把结果也写进日志面板/报告）。
  store.pushLog(result.errors.length ? 'warn' : 'info', `[UI][home] 重置数据：${result.cleared.length} 键 / ${result.removedMods.length} Mod / ${result.errors.length} 失败`)
  // 收起确认条 + 结束。
  confirmingReset.value = false
  resetting.value = false
}

// 选择模式。
function chooseMode(mode) {
  // 记录模式到 store。
  store.setMode(mode)
  // 更新本地高亮。
  activeMode.value = mode
}

// 开始新人生。
async function startGame() {
  // 页面行为日志（常显进日志面板）。
  store.pushLog('info', '[UI][home] 开始新人生（引擎初始化）')
  // 标记加载。
  loading.value = true
  // 初始化引擎：种子留空 → 自动生成（随后显示在轨迹页/总结页），填了就用它复现。
  // hooks/modCodes/modRequires 来自前端 Mod 运行时（Mod 代码在 Life 建好后执行 → 可注册属性与钩子）。
  // 2026-10 能力补齐 ②：`assetReader`/`assetSource` 是**惰性**的资源读取能力
  // （构造时不读任何字节；只有 Mod 真的用 `gameAPI.asset`，或轨迹里出现
  //  `{{asset:路径}}` 占位符时，才去读那一个文件）。
  const bundle = await buildData()
  await store.init(bundle.data, { seed: seedInput.value, hooks: bundle.hooks, modCodes: bundle.modCodes, modRequires: bundle.modRequires, assetReader: bundle.assetReader, assetSource: bundle.assetSource })
  // 日志：本局种子（复现的关键信息）。
  store.pushLog('info', `[UI][home] 本局随机种子：${store.seed}`)
  // 跳转：名人模式先去选名人（名人自带属性与天赋），自定义模式去抽天赋。
  router.push(store.mode === 'celebrity' ? '/character' : '/talent')
}
</script>

<template>
  <div class="home">
    <h1 class="title">人生重开模拟器</h1>
    <p class="subtitle">这垃圾人生一秒也不想待了</p>

    <!-- 模式选择 -->
    <div class="modes">
      <button
        class="mode"
        :class="{ active: activeMode === 'custom' }"
        @click="chooseMode('custom')"
      >
        <span class="mode-name">自定义模式</span>
        <span class="mode-desc">自己分配属性，选择天赋</span>
      </button>
      <button
        class="mode"
        :class="{ active: activeMode === 'celebrity' }"
        @click="chooseMode('celebrity')"
      >
        <span class="mode-name">名人模式</span>
        <span class="mode-desc">模拟名人生平</span>
      </button>
    </div>

    <button class="btn" :disabled="loading" @click="startGame">
      {{ loading ? '加载中...' : '↻ 立即重开' }}
    </button>

    <!-- 随机种子：留空自动生成（每局都会在轨迹页/总结页显示），填入旧种子即可复现同一局 -->
    <div class="seed-row">
      <label class="seed-label" for="seed-input">随机种子</label>
      <input
        id="seed-input"
        v-model="seedInput"
        class="seed-input"
        :disabled="loading"
        placeholder="留空 = 随机生成"
        inputmode="numeric"
      />
      <button class="btn ghost tiny" :disabled="loading || !seedInput" @click="seedInput = ''">清空</button>
    </div>
    <p class="seed-hint">同一局 = 同一种子 + 同样的选择（抽卡结果与属性分配顺序一致）</p>

    <!-- 设置 / Mod 管理 / 模拟统计入口 -->
    <div class="nav-btns">
      <button class="btn ghost" @click="router.push('/settings')">设置</button>
      <button class="btn ghost" @click="router.push('/mods')">Mod 管理</button>
      <button class="btn ghost" @click="router.push('/simulate')">模拟统计</button>
    </div>

    <!-- Mod 面板（slot = home；2026-10 能力补齐 ③）：Mod 通过 manifest.ui.panels
         或 gameAPI.ui.addPanel 往主页插卡片。没有声明时这个组件什么都不渲染。 -->
    <ModPanels slot="home" />

    <!-- 重置数据（危险操作：两步确认；只清本应用自己的键，不做 localStorage.clear()） -->
    <div class="reset-zone">
      <button v-if="!confirmingReset" class="btn ghost danger" :disabled="loading || resetting" @click="askReset">
        🗑 重置数据
      </button>
      <template v-else>
        <p class="reset-warn">将清空：{{ resetItems }}（以及本地安装的 Mod）</p>
        <div class="reset-actions">
          <button class="btn danger" :disabled="resetting" @click="doReset">
            {{ resetting ? '清空中…' : '确认清空' }}
          </button>
          <button class="btn ghost" :disabled="resetting" @click="confirmingReset = false">取消</button>
        </div>
        <p class="reset-hint">不可撤销；只清本应用的数据，不动同源下其它键</p>
      </template>
      <p v-if="resetMessage" class="reset-message">{{ resetMessage }}</p>
    </div>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 20px;
}
.nav-btns {
  display: flex;
  gap: 10px;
}
/* 随机种子输入行 */
.seed-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.seed-label {
  font-size: 13px;
  color: #aaa;
}
.seed-input {
  width: 160px;
  padding: 7px 10px;
  border: 1px solid #2a3a5e;
  border-radius: 6px;
  background: #16213e;
  color: #eee;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.seed-hint {
  font-size: 12px;
  color: #777;
  margin-top: -12px;
}
.btn.ghost.tiny {
  padding: 6px 10px;
  font-size: 12px;
}
.title {
  font-size: 48px;
  font-weight: bold;
}
.subtitle {
  color: #aaa;
  font-size: 16px;
}
.modes {
  display: flex;
  gap: 16px;
}
.mode {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 32px;
  border: 2px solid #2a3a5e;
  border-radius: 12px;
  background: #16213e;
  color: #eee;
  cursor: pointer;
}
.mode.active {
  border-color: #e94560;
  background: #1a2a4e;
}
.mode-name {
  font-size: 18px;
  font-weight: bold;
}
.mode-desc {
  font-size: 12px;
  color: #aaa;
}
.btn {
  padding: 14px 40px;
  font-size: 18px;
  border: none;
  border-radius: 8px;
  background: #e94560;
  color: #fff;
  cursor: pointer;
}
.btn:hover {
  background: #ff6b81;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.ghost {
  background: transparent;
  border: 1px solid #2a3a5e;
}
/* 重置数据区（危险操作：低调但看得见） */
.reset-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  max-width: 560px;
}
.btn.ghost.danger {
  border-color: #b71c1c;
  color: #ff6b6b;
}
.btn.ghost.danger:hover {
  background: #b71c1c;
  color: #fff;
}
.btn.danger {
  padding: 8px 20px;
  font-size: 13px;
  background: #b71c1c;
}
.btn.danger:hover {
  background: #d32f2f;
}
.reset-actions {
  display: flex;
  gap: 10px;
}
.reset-actions .btn {
  padding: 8px 20px;
  font-size: 13px;
}
.reset-warn {
  font-size: 13px;
  color: #ffb84d;
  text-align: center;
  line-height: 1.5;
}
.reset-hint {
  font-size: 11px;
  color: #777;
}
.reset-message {
  font-size: 12px;
  color: #4caf50;
  text-align: center;
}
</style>

