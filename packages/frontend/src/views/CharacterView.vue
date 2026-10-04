<script setup>
// 名人选择页（名人模式的第二步；对应原版 remake 的 Step.Chara）。
//
// 流程：抽一批候选名人（默认 3 位）→ 点选一位 → 下一步进入属性分配页。
//   · 名人自带**固定属性**（作为基础值）与**天赋**（直接作为已选天赋，不抽卡）
//   · 名人模式只额外分配"名人天赋带来的点数"（默认 20 点已被名人属性取代）
//   · 「换一批」可以反复抽；连点若干次会解锁唯一「我」（引擎侧的彩蛋逻辑）
//
// 内容来源：**只有 Mod**（引擎不内置任何名人）。没有内容 Mod 时候选必然是空的 ——
// 同样在**抽取之前**就说清楚，而不是让人反复点「换一批」。
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'

// 路由。
const router = useRouter()
// 游戏 store。
const store = useGameStore()
// 是否已抽过一批。
const drawn = ref(false)
// 提示消息。
const message = ref('')

// 无可用名人：数据里一位都没有（= 没有任何 Mod 提供名人数据）。
// 前提 `isReady`：直接刷新 /character 时引擎还没初始化（rawData 为 null），
// 那不是"没有内容 Mod"，不能给出误导性的原因。
const noContent = computed(() => store.isReady && Object.keys(store.rawData?.characters || {}).length === 0)

// 抽一批候选。
function draw() {
  // 抽取。
  const result = store.drawCharacters()
  // 标记已抽。
  drawn.value = true
  // 清提示。
  message.value = result.normal.length === 0 && !noContent.value ? '这一批没抽到名人（数据里可能只有很少几位），再点一次「换一批」' : ''
}

// 点选一位名人。
function pick(id) {
  // 已选中同一位 → 取消。
  if (store.character && String(store.character.id) === String(id)) {
    // 清空选择（回到"还没选"）。
    store.character = null
    // 清提示。
    message.value = ''
    return
  }
  // 选定。
  const result = store.chooseCharacter(id)
  // 失败显示原因。
  if (!result.ok) {
    // 显示消息。
    message.value = result.message
    return
  }
  // 清提示。
  message.value = ''
}

// 选定唯一「我」（彩蛋）。
function pickUnique() {
  // 选定。
  const result = store.chooseUnique()
  // 失败显示原因。
  if (!result.ok) {
    // 显示消息。
    message.value = result.message
    return
  }
  // 清提示。
  message.value = ''
}

// 下一步：进入属性分配页。
function next() {
  // 还没选名人。
  if (!store.character) {
    // 提示。
    message.value = '请先选一位名人'
    return
  }
  // 跳转属性分配页（额外点数与基础属性已由 store 写好，无需再确认天赋）。
  router.push('/property')
}
</script>

<template>
  <div class="character">
    <h2 class="title">名人模式</h2>
    <p class="subtitle">选一位名人，用 TA 的属性与天赋重开一生</p>

    <!-- 操作按钮 -->
    <div class="actions">
      <button v-if="!drawn" class="btn primary" :disabled="noContent" @click="draw">抽取名人</button>
      <button v-else class="btn" @click="draw">换一批</button>
      <!-- 未选名人时**不禁用**：点了给一句提示（禁用的按钮无法解释为什么不能走） -->
      <button class="btn primary" @click="next">下一步 →</button>
      <button class="btn ghost" @click="router.push('/')">返回主页</button>
    </div>

    <!-- 已选提示 -->
    <p v-if="store.character" class="picked">
      已选：<b>{{ store.character.name }}</b>
      （基础属性 颜值 {{ store.characterBase.CHR }} / 智力 {{ store.characterBase.INT }} / 体质 {{ store.characterBase.STR }} / 家境 {{ store.characterBase.MNY }}，
      天赋 {{ store.selectedTalents.length }} 个，额外可分配 {{ store.characterExtraPoints }} 点）
    </p>

    <!-- 提示 -->
    <p v-if="message" class="message">{{ message }}</p>

    <!-- 无内容 Mod：提前说明（引擎不内置内容，不可能抽出名人） -->
    <p v-if="noContent" class="message">
      （无可用名人：当前没有 Mod 提供名人数据。到「Mod 管理」启用 lifeRestart-data，或安装其它内容 Mod。数据源：{{ store.dataSource || '未知' }}）
    </p>

    <!-- 候选卡片 -->
    <div class="grid">
      <button
        v-for="c in store.characters"
        :key="c.id"
        class="card"
        :class="{ selected: store.character && String(store.character.id) === String(c.id) }"
        @click="pick(c.id)"
      >
        <span class="name">{{ c.name }}</span>
        <span class="props">
          颜值 {{ c.property?.CHR }} · 智力 {{ c.property?.INT }}<br />
          体质 {{ c.property?.STR }} · 家境 {{ c.property?.MNY }}
        </span>
        <span class="talents">
          <span v-for="t in c.talent" :key="t.id" class="talent-chip">{{ t.name }}</span>
        </span>
      </button>

      <!-- 唯一「我」：连点解锁的彩蛋（引擎侧 10 秒内连点 10 次） -->
      <button
        v-if="store.uniqueUnlocked"
        class="card unique"
        :class="{ selected: store.character && store.character.id === 'unique' }"
        @click="pickUnique"
      >
        <span class="name">？？？</span>
        <span class="props">唯一「我」<br />属性与天赋随机生成</span>
      </button>
    </div>

    <p v-if="drawn && store.characters.length === 0 && !noContent" class="message">（这一批没有候选人，再点一次「换一批」）</p>
  </div>
</template>

<style scoped>
.character {
  padding: 30px;
  max-width: 900px;
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
.btn.ghost {
  background: transparent;
  border: 1px solid #2a3a5e;
}
.btn:hover {
  filter: brightness(1.2);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.picked {
  text-align: center;
  color: #ffd700;
  margin-bottom: 12px;
}
.message {
  text-align: center;
  color: #ffb84d;
  margin-bottom: 16px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px;
  border: 2px solid #2a3a5e;
  border-radius: 10px;
  background: #16213e;
  color: #eee;
  cursor: pointer;
}
.card.selected {
  border-color: #e94560;
  background: #1a2a4e;
}
.card.unique {
  border-style: dashed;
}
.name {
  font-size: 18px;
  font-weight: bold;
}
.props {
  font-size: 12px;
  color: #aaa;
  text-align: center;
  line-height: 1.6;
}
.talents {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
}
.talent-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #0f3460;
  color: #cfe1ff;
}
</style>
