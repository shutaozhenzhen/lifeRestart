<script setup>
// 游戏页：属性面板 + 推进按钮。
// Step 7 目标：store → 组件响应式推送，属性实时显示。
// 简化版：演示属性面板联动，天赋选择/分配在 Step 8/9 补充。
import { computed } from 'vue'
import { useGameStore } from '../stores/game.js'

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

// 简单开局：使用已选天赋（从天赋页带入）。
function startSimple() {
  // 用 store 的 begin（remake 已选天赋 + start）。
  store.begin({})
}

// 推进一年。
function advance() {
  // 推进（store 内记录流水）。
  store.next()
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
      <button class="btn" @click="startSimple">开局</button>
      <button class="btn" :disabled="!store.isReady || isEnd" @click="advance">下一年</button>
    </div>

    <!-- 事件流水 -->
    <div class="content">
      <div v-for="(c, i) in store.content" :key="i" class="event">
        {{ c.type === 'EVT' ? `[事件] ${c.description}` : `[天赋] ${c.name}` }}
      </div>
      <p v-if="store.content.length === 0" class="empty">（无事发生）</p>
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
  padding: 10px 24px;
  border: none;
  border-radius: 6px;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
}
.btn:hover {
  background: #1a4a80;
}
.content {
  background: #16213e;
  border-radius: 8px;
  padding: 16px;
  min-height: 120px;
}
.event {
  padding: 8px;
  border-bottom: 1px solid #2a3a5e;
}
.empty {
  color: #666;
  text-align: center;
  padding: 20px;
}
</style>
