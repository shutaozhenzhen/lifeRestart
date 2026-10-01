<script setup>
// AchievementToast — 成就达成提示（全局常驻，挂在 App.vue 里）
//
// 为什么做成全局组件而不是塞进轨迹页：
//   成就的触发时机有四种（START/TRAJECTORY/SUMMARY/END），其中 SUMMARY 发生在**总结页**、
//   END 发生在点「重开」时——只挂在轨迹页会漏掉一半。
//
// 自动关闭：每条提示 4 秒后自动消失（也可以点掉）。
// 队列：store 侧已保证同一条成就不堆叠、最多 3 条（见 pushAchievementToast）。
import { onBeforeUnmount, watch } from 'vue'
import { useGameStore } from '../stores/game.js'

// 自动关闭延时（毫秒）。
const AUTO_DISMISS_MS = 4000

// store。
const store = useGameStore()

// 已安排关闭的成就 ID → 定时器句柄（避免重复安排、并在卸载时清掉）。
const timers = new Map()

// #scheduleDismiss
// 给一条提示安排自动关闭。
//
// @param {object} toast - 提示项
// @returns {void}
function scheduleDismiss(toast) {
  // 已安排过就跳过。
  if (timers.has(toast.id)) return
  // 定时关闭。
  const handle = setTimeout(() => {
    // 从 store 移除（超时后用户看到的就是"自动消失"）。
    store.dismissAchievementToast(toast.id)
    // 释放句柄。
    timers.delete(toast.id)
  }, AUTO_DISMISS_MS)
  // 记录。
  timers.set(toast.id, handle)
}

// 监听队列：给新出现的提示安排自动关闭。
watch(
  // 队列。
  () => store.achievementToasts,
  // 每次变化都过一遍（数量少，成本可忽略）。
  (toasts) => {
    // 逐条安排。
    for (const toast of toasts) scheduleDismiss(toast)
  },
  // 立即执行一次（挂载时可能已有提示）。
  { immediate: true, deep: true }
)

// 卸载时清掉所有定时器（避免测试环境残留定时器影响其他用例）。
onBeforeUnmount(() => {
  // 逐个清理。
  for (const handle of timers.values()) clearTimeout(handle)
  // 清空表。
  timers.clear()
})

// #close
// 手动关闭。
//
// @param {string} id - 成就 ID
// @returns {void}
function close(id) {
  // 清定时器。
  if (timers.has(id)) {
    // 取消。
    clearTimeout(timers.get(id))
    // 删除记录。
    timers.delete(id)
  }
  // 从 store 移除。
  store.dismissAchievementToast(id)
}

// #stars
// 星级（0~3）。
//
// @param {number} grade - 星级
// @returns {string} 星符
function stars(grade) {
  // 钳到 0~3。
  const n = Math.max(0, Math.min(3, Number(grade) || 0))
  // 拼接。
  return '★'.repeat(n)
}
</script>

<template>
  <!-- 右上角浮层：不挡操作（pointer-events 只在卡片上开启） -->
  <div v-if="store.achievementToasts.length" class="toast-host">
    <TransitionGroup name="toast">
      <div v-for="toast in store.achievementToasts" :key="toast.id" class="toast" @click="close(toast.id)">
        <div class="toast-head">
          <span class="toast-icon">🏆</span>
          <span class="toast-title">成就达成</span>
          <span class="toast-stars">{{ stars(toast.grade) }}</span>
        </div>
        <div class="toast-name">{{ toast.name }}</div>
        <div v-if="toast.description" class="toast-desc">{{ toast.description }}</div>
        <div class="toast-hint">点击关闭</div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 容器不吃点击，只有卡片吃（否则会挡住右上角的界面元素）。 */
  pointer-events: none;
  max-width: 300px;
}
.toast {
  /* 卡片可点击关闭。 */
  pointer-events: auto;
  cursor: pointer;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #4a3b12;
  border-left: 4px solid #ffd700;
  background: linear-gradient(135deg, #2a2413 0%, #16213e 100%);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
}
.toast-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.toast-icon {
  font-size: 14px;
}
.toast-title {
  font-size: 11px;
  color: #ffd700;
  letter-spacing: 1px;
}
.toast-stars {
  margin-left: auto;
  font-size: 10px;
  color: #ffd700;
}
.toast-name {
  font-size: 14px;
  font-weight: bold;
  color: #fff;
}
.toast-desc {
  font-size: 11px;
  color: #b9c3d4;
  line-height: 1.5;
  margin-top: 2px;
}
.toast-hint {
  font-size: 10px;
  color: #6f7a90;
  margin-top: 4px;
  text-align: right;
}
/* 进出场动画（新提示从右侧滑入） */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
