<script setup>
// DocBlocks — **内容块的公共渲染器**（2026-10 能力补齐 ③ 抽出）
//
// 为什么抽出来：Mod 加界面的四种扩展点里有两种（`pages` / `panels`）直接复用"文档页那套块
// 类型"（`p|sub|note|list|table|code|link|api|action`）。抽成组件之后：
//   · `DocPage.vue`（制作文档 / gameAPI 参考）与 Mod 页面 / 面板卡片**共用同一份渲染器**；
//   · 不会出现"文档里能用的块，Mod 界面里渲染不出来"这种两套实现的分叉（本项目反复踩过）。
//
// ⚠️ 未知块类型仍然显式渲染成 `⚠ 未知内容块类型：xxx`（内容写错时页面上就能看见，
//    而不是静默少一段）—— 这条既有行为有测试钉住。
//
// `action` 块（2026-10 新增）：渲染成按钮，点击调用 `onAction(id)`（由父组件接
// `gameAPI.ui.onAction` 注册的回调）；没注册过 → 按钮**禁用**并给出可读提示。
import { ref } from 'vue'
// 复制文本（剪贴板 API + 回退；与日志导出同一个实现）。
import { copyText } from '../utils/log-export.js'

// 属性。
const props = defineProps({
  // 内容块数组。
  blocks: { type: Array, default: () => [] },
  // 锚点/键前缀（同一页面上多个块列表要避免键冲突）。
  idPrefix: { type: String, default: 'blk' },
  // 动作点击（父组件接 gameAPI.ui.onAction 的注册表）。
  //   传 null/不传 = 这个页面/卡片**不支持**动作块 → 按钮禁用并说明原因。
  onAction: { type: Function, default: null },
  // 判断某个动作 id 是否已注册（缺省 = onAction 存在就算注册过）。
  hasAction: { type: Function, default: null },
})

// 刚复制的代码块 key。
const copied = ref('')

// #copy
// 复制一段代码（复用日志导出的剪贴板实现，取不到剪贴板时它内部有兜底）。
//
// @param {string} code - 代码文本
// @param {string} key - 块键（用于显示"已复制"反馈）
// @returns {Promise<void>}
async function copy(code, key) {
  // 复制。
  const ok = await copyText(code)
  // 反馈（哪个块被复制了）。
  copied.value = ok ? key : ''
  // 两秒后清掉。
  if (ok && typeof setTimeout === 'function') setTimeout(() => { if (copied.value === key) copied.value = '' }, 2000)
}

// #actionAvailable
// 某个动作 id 现在能不能点。
//
// @param {string} id - 动作 id
// @returns {boolean} 是否已注册
function actionAvailable(id) {
  // 父组件给了判据就用它。
  if (typeof props.hasAction === 'function') return Boolean(props.hasAction(id))
  // 缺省：给了 onAction 就算"有人接"。
  return typeof props.onAction === 'function'
}

// #triggerAction
// 点击动作按钮（**异步 + 异常隔离**：回调抛错/拒绝只记日志，不炸页面）。
//
// @param {object} b - 动作块
// @returns {Promise<void>}
async function triggerAction(b) {
  // 没注册过（按钮本应禁用；这里再挡一次，防"禁用状态被绕过"）。
  if (!actionAvailable(b.id)) {
    // 出声（不静默什么都不发生）。
    console.warn(`[UI][mod-ui] 动作 ${b.id} 没有注册处理函数（gameAPI.ui.onAction 未注册）`)
    // 结束。
    return
  }
  // 调用（await 支持异步回调）。
  try {
    // 执行。
    await props.onAction(b)
  } catch (e) {
    // 只记日志（回调是 Mod 提供的，它出错不该让宿主页面崩）。
    console.warn(`[UI][mod-ui] 动作 ${b.id} 执行失败：${e?.message || e}`)
  }
}

// 表格列数（渲染时对齐用）。
function colCount(b) {
  // 表头长度。
  return (b.head || []).length
}
</script>

<template>
  <div class="docblocks">
    <!-- 块 -->
    <template v-for="(b, i) in blocks" :key="`${idPrefix}-${i}`">
      <!-- 段落 -->
      <p v-if="b.t === 'p'" class="p">{{ b.text }}</p>

      <!-- 小节标题 -->
      <h4 v-else-if="b.t === 'sub'" class="sub">{{ b.text }}</h4>

      <!-- 提示 / 警告 -->
      <p v-else-if="b.t === 'note'" class="note" :class="b.kind || 'info'">
        <span class="note-mark">{{ b.kind === 'warn' ? '⚠' : (b.kind === 'tip' ? '💡' : 'ℹ') }}</span>{{ b.text }}
      </p>

      <!-- 列表 -->
      <component :is="b.ordered ? 'ol' : 'ul'" v-else-if="b.t === 'list'" class="list">
        <li v-for="(it, k) in b.items" :key="k">{{ it }}</li>
      </component>

      <!-- 表格 -->
      <div v-else-if="b.t === 'table'" class="table-wrap">
        <table class="table">
          <thead>
            <tr><th v-for="(h, k) in b.head" :key="k">{{ h }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, k) in b.rows" :key="k">
              <td v-for="(cell, j) in row" :key="j" :colspan="j === colCount(b) - 1 && row.length < colCount(b) ? colCount(b) - row.length + 1 : 1">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 代码块 -->
      <div v-else-if="b.t === 'code'" class="code-wrap">
        <div class="code-head">
          <span class="code-label">{{ b.label || b.lang || 'code' }}</span>
          <button class="copy" @click="copy(b.code, `${idPrefix}-${i}`)">{{ copied === `${idPrefix}-${i}` ? '已复制' : '复制' }}</button>
        </div>
        <pre class="code"><code>{{ b.code }}</code></pre>
      </div>

      <!-- 站内链接 -->
      <p v-else-if="b.t === 'link'" class="p">
        <router-link class="inlink" :to="b.to">{{ b.text }} →</router-link>
      </p>

      <!-- API 条目（path/sig/params/returns/… 由测试与引擎真实键双向核对） -->
      <div v-else-if="b.t === 'api'" class="api">
        <div class="api-head">
          <code class="api-path">{{ b.path }}</code>
          <span v-if="b.perms" class="api-tag perm" :title="'需要的权限'">{{ b.perms }}</span>
          <span v-if="b.platform" class="api-tag plat" :title="'可用平台'">{{ b.platform }}</span>
        </div>
        <pre class="code sig"><code>{{ b.sig }}</code></pre>
        <table v-if="b.params && b.params.length" class="table">
          <thead><tr><th>参数</th><th>类型</th><th>说明</th></tr></thead>
          <tbody>
            <tr v-for="(p, k) in b.params" :key="k">
              <td><code>{{ p[0] }}</code></td>
              <td>{{ p[1] }}</td>
              <td>{{ p[2] }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="b.returns" class="api-line"><span class="api-k">返回</span>{{ b.returns }}</p>
        <p v-if="b.side" class="api-line"><span class="api-k">副作用</span>{{ b.side }}</p>
        <p v-if="b.note" class="api-line note-line"><span class="api-k">注意</span>{{ b.note }}</p>
        <div v-if="b.example" class="code-wrap">
          <div class="code-head"><span class="code-label">示例</span><button class="copy" @click="copy(b.example, `${idPrefix}-${i}-ex`)">{{ copied === `${idPrefix}-${i}-ex` ? '已复制' : '复制' }}</button></div>
          <pre class="code"><code>{{ b.example }}</code></pre>
        </div>
      </div>

      <!-- 动作按钮（Mod 用 gameAPI.ui.onAction 注册回调；没注册 → 禁用 + 可读提示） -->
      <div v-else-if="b.t === 'action'" class="action-wrap">
        <button
          class="btn action"
          :disabled="!actionAvailable(b.id)"
          :title="actionAvailable(b.id) ? '' : `动作 ${b.id} 未注册（本页/本卡片没有对应的 gameAPI.ui.onAction）`"
          @click="triggerAction(b)"
        >{{ b.label || b.id }}</button>
        <!-- 没注册时给出**可读提示**（不是"点了没反应"）。 -->
        <span v-if="!actionAvailable(b.id)" class="action-hint">未注册的动作：{{ b.id }}（Mod 需在 code.js 里 gameAPI.ui.onAction 注册）</span>
      </div>

      <!-- 未知块：显式报出来（内容写错时页面上就能看见，而不是静默少一段） -->
      <p v-else class="note warn"><span class="note-mark">⚠</span>未知内容块类型：{{ b.t }}</p>
    </template>
  </div>
</template>

<style scoped>
.p {
  font-size: 13px;
  color: #d7dee9;
  line-height: 1.8;
  margin-bottom: 8px;
}
.sub {
  font-size: 13px;
  color: #cfe1ff;
  margin: 14px 0 6px;
}
/* 提示条 */
.note {
  font-size: 12px;
  line-height: 1.7;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
}
.note.info {
  background: #16213e;
  color: #9aa7bd;
}
.note.tip {
  background: #12324a;
  color: #9fd4ff;
}
.note.warn {
  background: #3a2f10;
  color: #ffd08a;
}
.note-mark {
  margin-right: 6px;
}
/* 列表 */
.list {
  margin: 0 0 10px 20px;
  font-size: 13px;
  color: #d7dee9;
  line-height: 1.9;
}
/* 表格 */
.table-wrap {
  overflow-x: auto;
  margin-bottom: 10px;
}
.table {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;
}
.table th,
.table td {
  border: 1px solid #2a3a5e;
  padding: 5px 8px;
  text-align: left;
  color: #d7dee9;
  vertical-align: top;
}
.table th {
  background: #0f3460;
  color: #cfe1ff;
  white-space: nowrap;
}
.table code {
  color: #ffd700;
}
/* 代码 */
.code-wrap {
  margin-bottom: 10px;
  border: 1px solid #2a3a5e;
  border-radius: 6px;
  overflow: hidden;
}
.code-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #0f3460;
  padding: 4px 8px;
}
.code-label {
  font-size: 11px;
  color: #8f9bb3;
}
.copy {
  font-size: 11px;
  background: transparent;
  border: 1px solid #2a3a5e;
  border-radius: 4px;
  color: #9fd4ff;
  cursor: pointer;
  padding: 1px 8px;
}
.code {
  margin: 0;
  padding: 10px 12px;
  background: #0b1220;
  overflow-x: auto;
}
.code code {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.7;
  color: #cfe1ff;
  white-space: pre;
}
.code.sig {
  border-bottom: 1px solid #2a3a5e;
}
/* 站内链接 */
.inlink {
  color: #4d9de0;
  text-decoration: none;
}
.inlink:hover {
  text-decoration: underline;
}
/* API 条目 */
.api {
  border: 1px solid #2a3a5e;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #16213e;
}
.api-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.api-path {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 13px;
  color: #ffd700;
}
.api-tag {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  white-space: nowrap;
}
.api-tag.perm {
  background: #3a2f10;
  color: #ffd08a;
}
.api-tag.plat {
  background: #2a3a5e;
  color: #c9c9d1;
}
.api-line {
  font-size: 12px;
  color: #d7dee9;
  line-height: 1.7;
  margin-bottom: 4px;
}
.api-line.note-line {
  color: #ffb84d;
}
.api-k {
  display: inline-block;
  min-width: 42px;
  color: #8f9bb3;
  margin-right: 6px;
}
/* 动作按钮（本项目的 `.btn` 不是全局样式，每个组件各定义一份；有源码守卫钉住）。 */
.action-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  background: #16457a;
}
.btn.action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-hint {
  font-size: 11px;
  color: #ffd08a;
}
</style>
