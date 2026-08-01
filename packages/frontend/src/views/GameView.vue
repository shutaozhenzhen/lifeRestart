<script setup>
// 人生轨迹页（对应原版 trajectory.js）。
// 开局后用已分配属性 + 已选天赋，逐年推进，事件卡片渲染，属性实时联动。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'

// 路由。
const router = useRouter()
// 游戏 store。
const store = useGameStore()

// 属性面板条目（名称 + 键）。
const propsList = [
  { key: 'CHR', label: '颜值' },
  { key: 'INT', label: '智力' },
  { key: 'STR', label: '体质' },
  { key: 'MNY', label: '家境' },
  { key: 'SPR', label: '快乐' },
  { key: 'AGE', label: '年龄' },
]

// 当前生命值。
const lif = computed(() => (store.life ? store.life.request('PROPERTY').get('LIF') : 1))
// 是否结束。
const isEnd = computed(() => (store.life ? store.life.request('PROPERTY').isEnd() : false))

// 挂载时自动开局（若未开局）。
onMounted(() => {
  // 未开局则开局。
  if (!store.life || store.life.getPropertyPoints !== undefined) {
    // 用已选天赋 + 分配属性开局。
    store.begin({ ...store.allocation })
  }
})

// 推进一年。
function advance() {
  // 已结束则不再推进。
  if (isEnd.value) return
  // 推进（store 记录流水）。
  store.next()
  // 结束后提示。
  if (isEnd.value) alert('人生结束！')
}

// 重开：回到天赋选择页。
function restart() {
  // 清空选择。
  store.selectedTalents = []
  store.allocation = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
  // 回主页。
  router.push('/')
}

// 查看总结（Step 10 实现）。
function summary() {
  // 跳转总结页。
  router.push('/summary')
}
</script>

<template>
  <div class="game">
    <h2 class="title">人生轨迹</h2>

    <!-- 属性面板：store → 响应式实时显示 -->
    <div class="panel">
      <div v-for="item in propsList" :key="item.key" class="stat">
        <span class="label">{{ item.label }}</span>
        <span class="value">{{ store.propertys[item.key] }}</span>
      </div>
      <div class="stat">
        <span class="label">生命</span>
        <span class="value" :class="{ dead: isEnd }">{{ lif }}</span>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="actions">
      <button class="btn primary" :disabled="isEnd" @click="advance">下一年</button>
      <button class="btn" :disabled="!isEnd" @click="summary">人生总结</button>
      <button class="btn" @click="restart">重开</button>
    </div>

    <!-- 事件卡片流 -->
    <div class="content">
      <div v-for="(c, i) in store.content" :key="i" class="card" :class="c.type === 'EVT' ? 'evt' : 'tlt'">
        <span class="card-type">{{ c.type === 'EVT' ? '事件' : '天赋' }}</span>
        <span class="card-text">{{ c.type === 'EVT' ? c.description : c.name }}</span>
      </div>
      <p v-if="store.content.length === 0" class="empty">（点击"下一年"开始人生）</p>
    </div>
  </div>
</template>

<style scoped>
.game {
  padding: 30px;
  max-width: 600px;
  margin: 0 auto;
}
.title {
  text-align: center;
  margin-bottom: 24px;
}
.panel {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}
.stat {
  background: #16213e;
  border-radius: 8px;
  padding: 14px;
  text-align: center;
}
.label {
  display: block;
  color: #aaa;
  font-size: 13px;
  margin-bottom: 6px;
}
.value {
  font-size: 28px;
  font-weight: bold;
}
.value.dead {
  color: #e94560;
}
.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-bottom: 24px;
}
.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
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
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.content {
  background: #16213e;
  border-radius: 8px;
  padding: 16px;
  min-height: 160px;
  max-height: 400px;
  overflow-y: auto;
}
.card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 10px;
}
.card.evt {
  background: #1a2a4e;
  border-left: 3px solid #4d9de0;
}
.card.tlt {
  background: #1f2a3e;
  border-left: 3px solid #ffd700;
}
.card-type {
  font-size: 12px;
  color: #aaa;
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
}
.card-text {
  font-size: 14px;
}
.empty {
  color: #666;
  text-align: center;
  padding: 30px 0;
}
</style>
