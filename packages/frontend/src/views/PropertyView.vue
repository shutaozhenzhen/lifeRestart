<script setup>
// 属性分配页（对应原版 property.js）。
// 四个属性（颜值/智力/体质/家境）通过 ± 按钮分配，可随机分配，剩余点数实时显示。
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'

// 路由。
const router = useRouter()
// 游戏 store。
const store = useGameStore()

// 可分配属性列表。
const allocKeys = [
  { key: 'CHR', label: '颜值' },
  { key: 'INT', label: '智力' },
  { key: 'STR', label: '体质' },
  { key: 'MNY', label: '家境' },
]

// 加减属性。
function adjust(key, delta) {
  // 调用 store 分配逻辑。
  store.adjustAllocation(key, delta)
}

// 随机分配。
function random() {
  // 调用 store。
  store.randomAllocate()
}

// 重置。
function reset() {
  // 重置分配。
  store.resetAllocation()
}

// 下一步：进入人生轨迹页。
function next() {
  // 剩余点数必须为 0。
  if (store.leftPoints > 0) {
    // 提示。
    alert(`还有 ${store.leftPoints} 点未分配`)
    return
  }
  // 跳转轨迹页。
  router.push('/game')
}
</script>

<template>
  <div class="property">
    <h2 class="title">属性分配</h2>
    <p class="subtitle">剩余点数：<b class="points">{{ store.leftPoints }}</b> / {{ store.propertyPoints }}</p>

    <!-- 分配行 -->
    <div v-for="item in allocKeys" :key="item.key" class="row">
      <span class="label">{{ item.label }}</span>
      <div class="controls">
        <button class="btn small" @click="adjust(item.key, -1)">−</button>
        <span class="value">{{ store.allocation[item.key] }}</span>
        <button class="btn small" @click="adjust(item.key, 1)">＋</button>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="actions">
      <button class="btn" @click="random">随机分配</button>
      <button class="btn" @click="reset">重置</button>
      <button class="btn primary" @click="next">下一步 →</button>
    </div>
  </div>
</template>

<style scoped>
.property {
  padding: 30px;
  max-width: 420px;
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
.points {
  color: #ffd700;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #16213e;
  border-radius: 8px;
  padding: 14px 18px;
  margin-bottom: 12px;
}
.label {
  font-size: 16px;
}
.controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
.value {
  font-size: 22px;
  font-weight: bold;
  min-width: 36px;
  text-align: center;
}
.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
}
.btn.small {
  width: 34px;
  height: 34px;
  padding: 0;
  font-size: 18px;
}
.btn.primary {
  background: #e94560;
}
.btn:hover {
  filter: brightness(1.2);
}
.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 24px;
}
</style>
