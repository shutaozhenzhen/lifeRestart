<script setup>
// 日志悬浮窗（全局组件，挂在 App.vue，所有页面常驻）。
//
// 解决什么问题：
//   以前只有在「设置页」才能看到日志；一旦某个页面出问题（尤其是渲染崩溃、
//   路由跳转异常），用户既看不到日志、也没法把现场带出来。
//
// 设计要点：
//   1. 常驻 App 层（不在 <router-view> 内）→ 页面组件崩了它依然可用。
//   2. 出现 error 级日志（含 window 异常 / Vue 渲染异常）时自动展开并亮角标。
//   3. 一键「复制」或「下载」完整报告：报告含环境/路由/游戏与 Mod 状态 + 全部日志。
//   4. 快捷键 Ctrl+Shift+L 随时收放。
//   5. 只读 gameStore.logBuffer（数组），任何异常都不让它自己成为新的故障点。

// Vue 组合式 API。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
// 游戏 store（日志缓冲与报告构建）。
import { useGameStore } from '../stores/game.js'
// 复制 / 下载（浏览器 API 缺失时返回 false，不抛错）。
import { copyText, downloadText } from '../utils/log-export.js'
// 文件名生成。
import { buildLogFileName } from '../utils/log-report.js'

// store。
const store = useGameStore()
// 是否展开。
const open = ref(false)
// 级别过滤（all/error/warn/info）。
const filter = ref('all')
// 操作反馈文案（复制成功/失败等）。
const feedback = ref('')
// 日志列表容器（自动滚到底部用）。
const listEl = ref(null)

// 过滤选项。
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'error', label: '错误' },
  { key: 'warn', label: '警告' },
  { key: 'info', label: '信息' },
]

// 当前展示的日志行（按级别过滤）。
const lines = computed(() => {
  // 防御：缓冲异常时按空数组处理。
  const logs = Array.isArray(store.logBuffer) ? store.logBuffer : []
  // 全部。
  if (filter.value === 'all') return logs
  // 按 `[LEVEL]` 过滤（info 同时包含 debug/trace，便于"非错误信息"一屏看完）。
  if (filter.value === 'info') return logs.filter((l) => /\[(TRACE|DEBUG|INFO)\]/.test(l))
  // error / warn。
  return logs.filter((l) => l.includes(`[${filter.value.toUpperCase()}]`))
})

// #lineClass
// 按级别给日志行上色。
//
// @param {string} line - 日志行
// @returns {string} class 名
function lineClass(line) {
  // 逐级判定（error 优先）。
  if (line.includes('[ERROR]')) return 'lv-error'
  if (line.includes('[WARN]')) return 'lv-warn'
  if (line.includes('[DEBUG]')) return 'lv-debug'
  if (line.includes('[TRACE]')) return 'lv-trace'
  // 默认 info。
  return 'lv-info'
}

// #flash
// 显示一条操作反馈（2.5s 后自动消失）。
//
// @param {string} text - 文案
// @returns {void}
function flash(text) {
  // 写入。
  feedback.value = text
  // 定时清除（保存句柄以便组件卸载时清理）。
  if (flashTimer) clearTimeout(flashTimer)
  // 2.5s。
  flashTimer = setTimeout(() => { feedback.value = '' }, 2500)
}

// 反馈定时器句柄。
let flashTimer = null

// #scrollToBottom
// 展开时把日志列表滚到最新一行。
//
// @returns {Promise<void>}
async function scrollToBottom() {
  // 等 DOM 更新。
  await nextTick()
  // 有容器则滚到底。
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
}

// 复制报告到剪贴板。
async function onCopy() {
  // 生成报告（含环境与全部日志）。
  const report = store.logReport()
  // 复制（浏览器拒绝时返回 false）。
  const ok = await copyText(report)
  // 反馈。
  flash(ok ? `已复制 ${store.logBuffer.length} 条日志到剪贴板` : '复制失败：请改用「下载」或手动选择文本')
}

// 下载报告为 txt。
function onDownload() {
  // 下载（API 缺失返回 false）。
  const ok = downloadText(store.logReport(), buildLogFileName())
  // 反馈。
  flash(ok ? '已开始下载日志文件' : '下载失败：请改用「复制」')
}

// 清空日志。
function onClear() {
  // 清空缓冲。
  store.clearLog()
  // 记一条（保留"刚清空"这一事实，避免面板看起来坏掉）。
  store.pushLog('info', '[UI][log] 日志已清空')
}

// 切换展开。
function toggle() {
  // 取反。
  open.value = !open.value
  // 展开时滚到底。
  if (open.value) scrollToBottom()
}

// #onKeydown
// 快捷键：Ctrl+Shift+L 收放悬浮窗（页面任意位置可用）。
//
// @param {KeyboardEvent} e - 键盘事件
// @returns {void}
function onKeydown(e) {
  // 组合键判定。
  if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
    // 阻止浏览器默认（部分浏览器 Ctrl+Shift+L 有其他含义）。
    e.preventDefault()
    // 收放。
    toggle()
  }
}

// 挂载：注册快捷键 + 首次展开滚动。
onMounted(() => {
  // 全局快捷键。
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', onKeydown)
})

// 卸载：清理监听与定时器。
onBeforeUnmount(() => {
  // 移除快捷键。
  if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('keydown', onKeydown)
  // 清理定时器。
  if (flashTimer) clearTimeout(flashTimer)
})

// 新日志：展开状态下自动滚到底（跟随最新）。
watch(() => store.logBuffer.length, () => {
  // 只在展开时滚动。
  if (open.value) scrollToBottom()
})

// 出现新错误：自动展开（用户"遇到问题"的当下就能一键导出）。
watch(() => store.errorSeq, () => {
  // 展开。
  open.value = true
  // 滚到最新（错误就在末尾）。
  scrollToBottom()
})
</script>

<template>
  <!-- 悬浮窗：右下角常驻，不遮挡页面交互 -->
  <div class="log-dock">
    <!-- 展开面板 -->
    <section v-if="open" class="panel" aria-label="运行日志">
      <header class="panel-head">
        <span class="panel-title">运行日志</span>
        <span class="counts">
          <em v-if="store.errorCount" class="badge error">{{ store.errorCount }} 错误</em>
          <em v-if="store.warnCount" class="badge warn">{{ store.warnCount }} 警告</em>
          <em class="badge total">{{ store.logBuffer.length }} 条</em>
        </span>
        <button class="icon-btn" title="收起（Ctrl+Shift+L）" @click="toggle">✕</button>
      </header>

      <p class="hint">
        遇到问题请点「复制」或「下载」，把内容发给开发者；报告含页面地址、环境、游戏与 Mod 状态。
      </p>

      <div class="toolbar">
        <button class="btn primary" @click="onCopy">复制</button>
        <button class="btn" @click="onDownload">下载</button>
        <button class="btn" @click="onClear">清空</button>
        <span class="spacer"></span>
        <button
          v-for="f in FILTERS"
          :key="f.key"
          class="chip"
          :class="{ active: filter === f.key }"
          @click="filter = f.key"
        >{{ f.label }}</button>
      </div>

      <!-- 反馈条 -->
      <p v-if="feedback" class="feedback">{{ feedback }}</p>

      <!-- 日志列表 -->
      <div ref="listEl" class="list">
        <div v-for="(line, i) in lines" :key="i" class="line" :class="lineClass(line)">{{ line }}</div>
        <div v-if="lines.length === 0" class="empty">
          （当前过滤条件下没有日志。可在设置页调低日志级别到 trace 以获取更多细节）
        </div>
      </div>
    </section>

    <!-- 折叠按钮（带错误/警告角标） -->
    <button class="fab" :class="{ alert: store.errorCount > 0 }" title="运行日志（Ctrl+Shift+L）" @click="toggle">
      <span class="fab-text">日志</span>
      <em v-if="store.errorCount" class="fab-badge">{{ store.errorCount }}</em>
      <em v-else-if="store.warnCount" class="fab-badge warn">{{ store.warnCount }}</em>
    </button>
  </div>
</template>

<style scoped>
/* 容器：只让面板/按钮本身接收点击 */
.log-dock {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
}
.panel,
.fab {
  pointer-events: auto;
}
/* 面板 */
.panel {
  width: min(92vw, 460px);
  max-height: min(70vh, 560px);
  display: flex;
  flex-direction: column;
  background: #16213e;
  border: 1px solid #0f3460;
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #0f3460;
}
.panel-title {
  font-size: 14px;
  font-weight: bold;
}
.counts {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.badge {
  font-size: 11px;
  font-style: normal;
  padding: 2px 6px;
  border-radius: 8px;
  background: #1a2a4e;
  color: #bbb;
}
.badge.error {
  background: #e94560;
  color: #fff;
}
.badge.warn {
  background: #b8860b;
  color: #fff;
}
.icon-btn {
  border: none;
  background: transparent;
  color: #bbb;
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
}
.hint {
  font-size: 11px;
  color: #888;
  padding: 8px 12px 0;
  line-height: 1.5;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  flex-wrap: wrap;
}
.btn {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: #1a2a4e;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.btn.primary {
  background: #e94560;
}
.btn:hover,
.chip:hover {
  filter: brightness(1.2);
}
.spacer {
  flex: 1;
}
.chip {
  padding: 4px 8px;
  border: 1px solid #0f3460;
  border-radius: 10px;
  background: transparent;
  color: #aaa;
  font-size: 11px;
  cursor: pointer;
}
.chip.active {
  background: #0f3460;
  color: #fff;
}
.feedback {
  font-size: 11px;
  color: #ffd700;
  padding: 0 12px 6px;
}
.list {
  flex: 1;
  overflow-y: auto;
  background: #101a33;
  padding: 8px 10px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.6;
}
.line {
  white-space: pre-wrap;
  word-break: break-all;
  color: #ccc;
}
.lv-error {
  color: #ff6b81;
}
.lv-warn {
  color: #ffd700;
}
.lv-info {
  color: #cfd8e3;
}
.lv-debug {
  color: #8f9bb3;
}
.lv-trace {
  color: #6b7688;
}
.empty {
  color: #666;
  font-size: 11px;
}
/* 折叠按钮 */
.fab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: none;
  border-radius: 999px;
  background: #0f3460;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
.fab.alert {
  background: #e94560;
}
.fab-badge {
  font-style: normal;
  font-size: 11px;
  background: #fff;
  color: #e94560;
  border-radius: 8px;
  padding: 1px 5px;
}
.fab-badge.warn {
  color: #b8860b;
}
</style>
