<script setup>
// 属性分配页（对应原版 property.js）。
// 四个属性（颜值/智力/体质/家境）通过 ± 按钮分配，可随机分配，剩余点数实时显示。
//
// 2026-10 能力补齐 ③：Mod 可以在 `manifest.ui.properties` / `gameAPI.ui.addProperty` 里
// 声明**额外的可分配属性行**（内置 4 项 + Mod 声明项）。一条硬要求：
// **只有该属性在引擎参数注册表里真实存在时才能加**（属性面板是"分配"语义，
// 分配一个引擎不认识的键 → 开局时写进去、属性读取得 NaN）。
// 拿不到 → **不渲染并记一条 warn**（不静默塞进去）。
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'
// 扩展注册表（Mod 声明的属性项）。
import { useExtensionsStore } from '../stores/extensions.js'
// 名人天赋详情（与名人选择页同一个组件，保证两处文案一致）。
import TalentDetailList from '../components/TalentDetailList.vue'
// Mod 面板（slot = property）。
import ModPanels from '../components/ModPanels.vue'

// 路由。
const router = useRouter()
// 游戏 store。
const store = useGameStore()
// 扩展注册表。
const ext = useExtensionsStore()

// 内置可分配属性（**引擎 params.js 里真实存在的四项**；顺序就是界面顺序）。
const BUILTIN_ALLOC_KEYS = [
  { key: 'CHR', label: '颜值' },
  { key: 'INT', label: '智力' },
  { key: 'STR', label: '体质' },
  { key: 'MNY', label: '家境' },
]

// #paramNames
// 引擎参数注册表里的全部参数名（MOD 属性必须在这里面才允许渲染）。
//
// 为什么读 `life.params.names` 而不是 `getAll()`：names 是键列表，getAll 会展开
// 全部参数值（含参数定义的公式求值），代价大且可能有副作用。
//
// @returns {Set<string>} 参数名集合（引擎未初始化时为空集）
function paramNames() {
  // 引擎没建好 → 空集（此时 Mod 属性一律不渲染，并记 warn）。
  const names = store.life?.params?.names
  // 非数组 → 空集。
  if (!Array.isArray(names)) return new Set()
  // 集合。
  return new Set(names)
}

// 可分配属性行 = 内置 4 项 + Mod 声明项（**只保留引擎里真实存在的**）。
// 已警告过的键（computed 会被反复求值，同一条 warn 不该刷屏 —— 每个键只出声一次）。
const warnedKeys = new Set()
const allocKeys = computed(() => {
  // 参数名。
  const known = paramNames()
  // 内置优先（同名不重复加；Mod 想改内置项的标签时以 Mod 为准，但键不变）。
  const rows = [...BUILTIN_ALLOC_KEYS]
  // 已见键。
  const seen = new Set(rows.map((r) => r.key))
  // 逐个 Mod 声明项。
  for (const p of ext.merged.properties) {
    // 键非法跳过。
    if (!p || typeof p.key !== 'string' || p.key.length === 0) continue
    // 重复键跳过（同名以内置项为准 —— 位置/语义都别乱）。
    if (seen.has(p.key)) continue
    // 标记已见。
    seen.add(p.key)
    // **引擎里不存在这个参数 → 不渲染 + 记 warn**（分配它是 NaN，不如不显示）。
    if (!known.has(p.key)) {
      // 同一条只记一次（computed 会被反复求值）。
      if (!warnedKeys.has(p.key)) {
        // 记下。
        warnedKeys.add(p.key)
        // 出声。
        store.pushLog('warn', `[UI][mod-ui] Mod 属性「${p.label || p.key}」（${p.key}，来自 Mod ${p.mod || '?'}）没有对应的引擎参数，属性面板不显示它（请先用 gameAPI.param.define 注册）`)
      }
      // 下一个。
      continue
    }
    // 收下（标签用 Mod 声明的）。
    rows.push({ key: p.key, label: p.label || p.key })
  }
  // 返回。
  return rows
})

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

    <!-- 名人模式：名人的固定属性是基底，玩家分配的是"额外点数"（来自名人天赋） -->
    <p v-if="store.character" class="celebrity">
      名人：<b>{{ store.character.name }}</b> —— 基础属性已固定（颜值 {{ store.characterBase.CHR }} / 智力 {{ store.characterBase.INT }} /
      体质 {{ store.characterBase.STR }} / 家境 {{ store.characterBase.MNY }}），下面分配的是**额外点数**
    </p>

    <p class="subtitle">剩余点数：<b class="points">{{ store.leftPoints }}</b> / {{ store.propertyPoints }}</p>

    <!-- 分配行 -->
    <div v-for="item in allocKeys" :key="item.key" class="row">
      <span class="label">{{ item.label }}</span>
      <div class="controls">
        <button class="btn small" @click="adjust(item.key, -1)">−</button>
        <span class="value">{{ store.allocation[item.key] }}</span>
        <button class="btn small" @click="adjust(item.key, 1)">＋</button>
        <!-- 名人模式：显示合计 = 名人基础 + 额外 -->
        <span v-if="store.character" class="total">
          = {{ store.finalProperties[item.key] }}<span class="base">（含名人 {{ store.characterBase[item.key] }}）</span>
        </span>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="actions">
      <button class="btn" @click="random">随机分配</button>
      <button class="btn" @click="reset">重置</button>
      <button class="btn primary" @click="next">下一步 →</button>
    </div>

    <!-- 名人模式：这一局带的天赋（决定"额外点数"从哪来，所以放在这一页可见） -->
    <TalentDetailList
      v-if="store.character"
      :talents="store.character.talent"
      :heading="`${store.character.name} 的天赋（额外点数来源）`"
    />

    <!-- Mod 面板（slot = property；2026-10 能力补齐 ③）。没有声明时什么都不渲染。 -->
    <ModPanels slot="property" />
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
/* 名人模式提示条（基础属性已固定） */
.celebrity {
  font-size: 12px;
  line-height: 1.7;
  color: #ffb84d;
  background: #1a2a4e;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 14px;
}
/* 合计（名人基础 + 额外） */
.total {
  font-size: 13px;
  color: #ffd700;
  margin-left: 10px;
  font-variant-numeric: tabular-nums;
}
.total .base {
  font-size: 11px;
  color: #888;
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
