<script setup>
// 人生总结页（对应原版 summary.js）。
// 显示各属性分档评价、达成成就列表、重开次数，支持重开。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'

// 路由。
const router = useRouter()
// 游戏 store。
const store = useGameStore()

// 总结数据。
const summary = ref({})
// 成就列表。
const achievements = ref([])
// 统计信息。
const statistics = ref({})

// 总结条目展示（键 → 中文名）。
const summaryLabels = {
  SUM: '总评',
  HAGE: '最高年龄',
  HCHR: '最高颜值',
  HINT: '最高智力',
  HSTR: '最高体质',
  HMNY: '最高家境',
  HSPR: '最高快乐',
}

// 挂载时读取总结。
onMounted(() => {
  // 需要已开局。
  if (!store.life) {
    // 回主页。
    router.push('/')
    return
  }
  // 读取总结（触发 SUMMARY 成就检测）。
  summary.value = store.life.summary
  // 成就列表。
  achievements.value = store.life.achievements
  // 统计信息。
  statistics.value = store.life.statistics
})

// 重开次数。
const times = computed(() => (store.life ? store.life.times : 0))

// 重开：次数 +1，回到主页。
function remake() {
  // 次数 +1。
  store.life.times = store.life.times + 1
  // 清空状态。
  store.selectedTalents = []
  store.allocation = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
  store.content = []
  // 回主页。
  router.push('/')
}
</script>

<template>
  <div class="summary">
    <h2 class="title">人生总结</h2>
    <p class="subtitle">重开次数：{{ times }}</p>

    <!-- 属性评价 -->
    <div class="section">
      <h3>属性评价</h3>
      <div v-for="(v, key) in summary" :key="key" class="row">
        <span class="label">{{ summaryLabels[key] || key }}</span>
        <span class="value">{{ v ? `${v.value}（${v.judge}）` : '—' }}</span>
      </div>
    </div>

    <!-- 成就列表 -->
    <div class="section">
      <h3>成就（{{ achievements.filter(a => a.isAchieved).length }}/{{ achievements.length }}）</h3>
      <div v-for="a in achievements" :key="a.id" class="ach" :class="{ done: a.isAchieved }">
        <span class="ach-name">{{ a.isAchieved ? a.name : (a.hide ? '???' : a.name) }}</span>
        <span v-if="a.isAchieved" class="ach-check">✓</span>
      </div>
      <p v-if="achievements.length === 0" class="empty">（暂无成就）</p>
    </div>

    <!-- 操作 -->
    <div class="actions">
      <button class="btn primary" @click="remake">↻ 重开</button>
      <button class="btn" @click="router.push('/')">回主页</button>
    </div>
  </div>
</template>

<style scoped>
.summary {
  padding: 30px;
  max-width: 520px;
  margin: 0 auto;
}
.title {
  text-align: center;
  margin-bottom: 8px;
}
.subtitle {
  text-align: center;
  color: #aaa;
  margin-bottom: 24px;
}
.section {
  background: #16213e;
  border-radius: 8px;
  padding: 18px;
  margin-bottom: 16px;
}
.section h3 {
  margin-bottom: 12px;
  font-size: 15px;
  color: #aaa;
}
.row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid #2a3a5e;
}
.row:last-child {
  border-bottom: none;
}
.ach {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  color: #777;
}
.ach.done {
  color: #eee;
}
.ach-check {
  color: #4caf50;
  font-weight: bold;
}
.empty {
  color: #666;
  text-align: center;
  padding: 10px 0;
}
.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 24px;
}
.btn {
  padding: 12px 28px;
  border: none;
  border-radius: 8px;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
}
.btn.primary {
  background: #e94560;
}
.btn:hover {
  filter: brightness(1.2);
}
</style>
