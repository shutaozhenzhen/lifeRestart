<script setup>
// 设置页（全局应用级配置）。
// 当前内容：日志设置（切换日志等级 + 实时日志面板）。
// 日志等级是全局设置，不属于任何 Mod，故独立成页而非放在 Mod 管理下。
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
// 游戏 store（日志等级/缓冲全部经 gameStore 管理）。
import { useGameStore } from '../stores/game.js'

// 路由。
const router = useRouter()
// 游戏 store。
const gameStore = useGameStore()

// 页面挂载：记录进入设置页。
onMounted(() => {
  // 记录（UI 日志常显，不随引擎级别过滤）。
  gameStore.pushLog('info', '[UI][settings] 进入设置页')
})

// 切换日志等级：引擎级切换 + 页面行为日志（常显进面板）。
// @param {string} key - trace/debug/info/warn/error
function changeLevel(key) {
  // 引擎级切换（setLogLevel 内部会写引擎日志）。
  gameStore.setLogLevel(key)
  // 页面行为日志（直接进面板，不受引擎级别过滤）。
  gameStore.pushLog('info', `[UI][settings] 日志等级切换为 ${key}`)
}

// 清空日志面板。
function clearLogs() {
  // 清空缓冲。
  gameStore.clearLog()
  // 页面行为日志。
  gameStore.pushLog('info', '[UI][settings] 清空日志面板')
}

// 日志级别选项。
const LOG_LEVELS = [
  { key: 'trace', label: 'trace', desc: '函数级追踪（最详细）' },
  { key: 'debug', label: 'debug', desc: '调试流程' },
  { key: 'info', label: 'info', desc: '关键节点（推荐）' },
  { key: 'warn', label: 'warn', desc: '仅警告与错误' },
  { key: 'error', label: 'error', desc: '仅错误' },
]

// 回主页。
function back() {
  // 返回。
  router.push('/')
}
</script>

<template>
  <div class="settings">
    <h2 class="title">设置</h2>
    <button class="btn back" @click="back">← 返回</button>

    <!-- 日志设置卡片：切换日志等级 + 实时日志面板（引擎全链路按此级别输出） -->
    <div class="log-panel">
      <h3 class="log-head">日志设置</h3>
      <p class="log-hint">
        切换日志等级全链路实时生效：引擎内核（Life/属性/天赋/事件/成就/角色）+ 数据加载 + Mod/AI 钩子均按此级别输出；
        持久化到 localStorage（logLevel），浏览器控制台同步输出。
      </p>

      <div class="field">
        <label>等级</label>
        <div class="level-row">
          <button
            v-for="lv in LOG_LEVELS"
            :key="lv.key"
            class="btn level"
            :class="{ active: gameStore.logLevel === lv.key }"
            :title="lv.desc"
            @click="changeLevel(lv.key)"
          >{{ lv.label }}</button>
        </div>
      </div>

      <div class="field test">
        <label>日志面板</label>
        <button class="btn" @click="clearLogs">清空</button>
        <span class="log-count">{{ gameStore.logBuffer.length }} 条</span>
      </div>

      <div class="log-view">
        <div v-for="(line, i) in gameStore.logBuffer" :key="i" class="log-line">{{ line }}</div>
        <div v-if="gameStore.logBuffer.length === 0" class="log-empty">
          （暂无日志。进入游戏后开一局/翻年会触发引擎日志；切到 trace 查看函数级参数追踪）
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  padding: 30px;
  max-width: 640px;
  margin: 0 auto;
}
.title {
  text-align: center;
  margin-bottom: 16px;
}
.back {
  margin-bottom: 16px;
}
.log-panel {
  margin-top: 4px;
  background: #1a2a4e;
  border-radius: 8px;
  padding: 18px;
}
.log-head {
  margin-bottom: 6px;
}
.log-hint {
  font-size: 12px;
  color: #888;
  margin-bottom: 14px;
}
.field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.field label {
  width: 80px;
  font-size: 13px;
  color: #aaa;
  flex-shrink: 0;
}
.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
}
.level-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.btn.level {
  padding: 5px 12px;
  font-size: 12px;
  background: #0f3460;
}
.btn.level.active {
  background: #e94560;
}
.log-count {
  font-size: 12px;
  color: #888;
}
.log-view {
  margin-top: 8px;
  max-height: 280px;
  overflow-y: auto;
  background: #0f3460;
  border-radius: 6px;
  padding: 10px 12px;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.7;
}
.log-line {
  color: #ddd;
  white-space: pre-wrap;
  word-break: break-all;
}
.log-line:nth-child(4n+1) {
  color: #9e9e9e;
}
.log-empty {
  color: #666;
  font-size: 12px;
}
</style>