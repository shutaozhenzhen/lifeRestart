<script setup>
// 天赋选择页（对应原版 talent.js）。
// 流程：抽卡（draw）→ 点选天赋卡片（限 3 个 + 互斥校验）→ 下一步进入游戏。
//
// 内容来源：**只有 Mod**（引擎不内置任何天赋）。
//   没有内容 Mod 时天赋池必然是空的 —— 这一点在**抽卡之前**就告诉玩家，
//   而不是让人反复点「十连抽」才看到「无可选天赋」。
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'

// 路由。
const router = useRouter()
// 游戏 store。
const store = useGameStore()
// 是否已抽卡。
const drawn = ref(false)
// 提示消息。
const message = ref('')
// 当前选中的索引集合。
const selectedIndexes = ref(new Set())

// 无可用天赋：本局数据里一条天赋都没有（= 没有任何 Mod 提供天赋）。
// 前提 `isReady`：直接刷新 /talent 时引擎还没初始化（rawData 为 null），
// 那不是"没有内容 Mod"，不能给出误导性的原因。
const noContent = computed(() => store.isReady && Object.keys(store.rawData?.talents || {}).length === 0)

// 抽卡。
function draw() {
  // 抽取天赋池。
  store.drawTalents()
  // 标记已抽。
  drawn.value = true
  // 清空选择。
  selectedIndexes.value = new Set()
  store.selectedTalents = []
}

// 点击天赋卡片。
function toggle(index) {
  // 已选中 → 取消。
  if (selectedIndexes.value.has(index)) {
    // 移除索引。
    selectedIndexes.value.delete(index)
    // 同步 store。
    store.selectedTalents = store.selectedTalents.filter(id => id !== store.talentPool[index].id)
    // 清提示。
    message.value = ''
    return
  }
  // 尝试选中。
  const result = store.selectTalent(index)
  // 失败显示原因。
  if (!result.ok) {
    // 显示消息。
    message.value = result.message
    return
  }
  // 记录索引。
  selectedIndexes.value.add(index)
  // 清提示。
  message.value = ''
}

// 下一步：进入属性分配页。
function next() {
  // 未选满 3 个。
  if (store.selectedTalents.length < store.life.talentSelectLimit) {
    // 提示。
    message.value = `请选择 ${store.life.talentSelectLimit} 个天赋`
    return
  }
  // 先确认天赋（引擎 remake：写入初始数据 + 触发替换链）。
  // 必须在进入属性页之前执行——属性页要按「默认点数 + 天赋加成」显示可用点数，
  // 而该值来自引擎内部初始数据；漏掉这一步会在属性页读取点数时崩溃。
  store.confirmTalents()
  // 跳转属性分配页。
  router.push('/property')
}
</script>

<template>
  <div class="talent">
    <h2 class="title">天赋选择</h2>
    <p class="subtitle">已选 {{ store.selectedTalents.length }}/{{ store.life?.talentSelectLimit ?? 3 }}</p>

    <!-- 抽卡按钮 -->
    <div class="actions">
      <button v-if="!drawn" class="btn primary" @click="draw">十连抽！</button>
      <button v-else class="btn" @click="draw">重新抽取</button>
      <button class="btn primary" :disabled="drawn && store.selectedTalents.length < (store.life?.talentSelectLimit ?? 3)" @click="next">
        下一步 →
      </button>
    </div>

    <!-- 提示 -->
    <p v-if="message" class="message">{{ message }}</p>

    <!-- 无内容 Mod：提前说明（引擎不内置内容，不可能抽出天赋） -->
    <p v-if="noContent" class="message">
      （无可用天赋：当前没有 Mod 提供天赋数据。到「Mod 管理」启用 lifeRestart-data，或安装其它内容 Mod。数据源：{{ store.dataSource || '未知' }}）
    </p>

    <!-- 天赋卡片 -->
    <div class="grid">
      <button
        v-for="(t, i) in store.talentPool"
        :key="i"
        class="card"
        :class="{ selected: selectedIndexes.has(i) }"
        :disabled="!drawn"
        @click="toggle(i)"
      >
        <span class="grade" :class="'g' + t.grade">{{ t.grade }}星</span>
        <span class="name">{{ t.name }}</span>
        <span class="desc">{{ t.description }}</span>
      </button>
    </div>

    <p v-if="drawn && store.talentPool.length === 0 && !noContent" class="message">（无可选天赋，请重新抽取）</p>
  </div>
</template>

<style scoped>
.talent {
  padding: 30px;
  max-width: 800px;
  margin: 0 auto;
}
.title {
  text-align: center;
  margin-bottom: 8px;
}
.subtitle {
  text-align: center;
  color: #aaa;
  margin-bottom: 20px;
}
.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-bottom: 16px;
}
.btn {
  padding: 10px 24px;
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
.message {
  text-align: center;
  color: #ffb84d;
  margin-bottom: 16px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px;
  border: 2px solid #2a3a5e;
  border-radius: 10px;
  background: #16213e;
  color: #eee;
  cursor: pointer;
}
.card:disabled {
  cursor: not-allowed;
}
.card.selected {
  border-color: #e94560;
  background: #1a2a4e;
}
.grade {
  font-size: 12px;
  color: #aaa;
}
.grade.g3 {
  color: #ffd700;
}
.grade.g2 {
  color: #c0c0ff;
}
.name {
  font-size: 16px;
  font-weight: bold;
}
.desc {
  font-size: 12px;
  color: #aaa;
  text-align: center;
}
</style>
