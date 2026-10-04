<script setup>
// 天赋详情列表（**公共组件**）
//
// 用在两处：名人选择页（选定名人后展示 TA 的天赋）+ 属性分配页（名人模式下的同一批天赋）。
// 抽成组件而不是各写一遍：这两处必须完全一致（星级配色 / 效果文案 / 标记），
// 否则改一处漏一处（本仓库反复踩过的"两份实现"）。
import { computed } from 'vue'
import { talentDetail } from '../utils/talent-view.js'

// 属性。
const props = defineProps({
  // 天赋对象数组（引擎给的原始对象：id/name/description/grade/effect/status/…）。
  talents: { type: Array, default: () => [] },
  // 列表标题（缺省「天赋」）。
  heading: { type: String, default: '天赋' },
})

// 展示信息（文案只在 utils/talent-view.js 里算一次）。
const items = computed(() => (props.talents || []).map(talentDetail))

// 额外点数合计（名人模式的"额外点数"就是从这些 status 来的，展示出来能对上账）。
const totalPoints = computed(() => items.value.reduce((sum, t) => sum + t.points, 0))
</script>

<template>
  <!-- 没有天赋就不占位（名人数据里 talent 可以为空） -->
  <div v-if="items.length" class="talent-list">
    <p class="heading">
      {{ heading }}（{{ items.length }} 个<span v-if="totalPoints"> · 额外点数 {{ totalPoints > 0 ? '+' : '' }}{{ totalPoints }}</span>）
    </p>
    <!-- 逐条 -->
    <div v-for="t in items" :key="t.id" class="row">
      <span class="grade" :class="t.gradeClass">{{ t.gradeText }}</span>
      <span class="name">{{ t.name }}</span>
      <!-- 描述：可能为空（引擎数据里 description 都有，缺失时不编） -->
      <span class="desc">{{ t.description }}</span>
      <!-- 属性效果 -->
      <span v-if="t.effectText" class="badge effect">效果：{{ t.effectText }}</span>
      <!-- 额外点数 -->
      <span v-if="t.points" class="badge points">额外点数 {{ t.points > 0 ? '+' : '' }}{{ t.points }}</span>
      <!-- 标记 -->
      <span v-for="tag in t.tags" :key="tag" class="badge tag">{{ tag }}</span>
    </div>
  </div>
</template>

<style scoped>
.talent-list {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid #2a3a5e;
  border-radius: 8px;
  background: #16213e;
}
.heading {
  font-size: 12px;
  color: #aaa;
  margin-bottom: 8px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid #1f2c47;
}
.row:first-of-type {
  border-top: none;
}
.grade {
  font-size: 11px;
  color: #aaa;
  min-width: 30px;
}
.grade.g3 {
  color: #ffd700;
}
.grade.g2 {
  color: #c0c0ff;
}
.name {
  font-size: 13px;
  font-weight: bold;
  color: #eee;
}
.desc {
  font-size: 12px;
  color: #9aa7bd;
  flex: 1 1 200px;
}
.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}
.badge.effect {
  background: #0f3460;
  color: #cfe1ff;
}
.badge.points {
  background: #3a2f10;
  color: #ffd700;
}
.badge.tag {
  background: #2a3a5e;
  color: #c9c9d1;
}
</style>
