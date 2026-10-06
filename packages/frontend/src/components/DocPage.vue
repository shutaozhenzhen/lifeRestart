<script setup>
// Mod 文档页的**公共渲染组件**（制作文档与 API 参考共用同一版式）
//
// 为什么内容不做成 Markdown 字符串：这个项目不带任何 Markdown 依赖（前端只有
// vue / pinia / vue-router），而为了一份文档去引一个解析器不划算。改成**结构化数据**
// （`utils/mod-doc-guide.js` / `utils/mod-doc-api.js` 里的 sections → blocks）有三个好处：
//   1. 渲染逻辑只有一份（本组件），两个文档页只是"换数据"；
//   2. 内容可以被单测逐块校验（块类型、必填字段、表格列数、代码非空）；
//   3. API 文档可以**机器核对**：块里记着 `path`（如 `talent.add`），测试拿它与
//      引擎 `createGameAPI()` 真实返回的键双向比对 —— 漏写/写错都会被挡住
//      （与 `statistics-view.js` 的覆盖性守卫同一个思路）。
//
// ⚠️ 锚点必须用 scrollIntoView，**不能**写 `<a href="#id">`：
//    本站是 Hash 路由（createWebHashHistory），改 `location.hash` 等于导航到另一个路由，
//    点一下目录就会被 router 当成"去 #section 这个路径"。
import { computed, ref } from 'vue'
import { copyText } from '../utils/log-export.js'

// 属性。
const props = defineProps({
  // 文档对象：{ id, title, subtitle, sections: [{ id, title, blocks }] }
  doc: { type: Object, required: true },
})

// 目录（章节）。
const sections = computed(() => props.doc?.sections || [])

// 当前高亮的章节（点击目录后短暂标记，纯观感）。
const active = ref('')

// 章节锚点 id（加文档前缀，避免与页面上其它元素撞 id）。
function anchorOf(sectionId) {
  // 组合。
  return `${props.doc?.id || 'doc'}-${sectionId}`
}

// 跳到某个章节（见文件头：Hash 路由下不能用 href="#…"）。
function scrollTo(sectionId) {
  // 标记。
  active.value = sectionId
  // 目标元素。
  const el = typeof document !== 'undefined' ? document.getElementById(anchorOf(sectionId)) : null
  // 滚动（jsdom/happy-dom 里可能没有 scrollIntoView → 容错，别让页面崩）。
  if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 复制一段代码（复用日志导出的剪贴板实现，取不到剪贴板时它内部有兜底）。
async function copy(code, key) {
  // 复制。
  const ok = await copyText(code)
  // 反馈（哪个块被复制了）。
  copied.value = ok ? key : ''
  // 两秒后清掉。
  if (ok && typeof setTimeout === 'function') setTimeout(() => { if (copied.value === key) copied.value = '' }, 2000)
}

// 刚复制的代码块 key。
const copied = ref('')

// 表格列数（渲染时对齐用）。
function colCount(b) {
  // 表头长度。
  return (b.head || []).length
}
</script>

<template>
  <div class="docpage">
    <!-- 标题 -->
    <h2 class="title">{{ doc.title }}</h2>
    <p v-if="doc.subtitle" class="subtitle">{{ doc.subtitle }}</p>
    <button class="btn back" @click="$router.back()">← 返回</button>

    <!-- 目录（点了滚动到章节；见文件头为什么不是 <a href="#…">） -->
    <div v-if="sections.length" class="toc">
      <span class="toc-title">目录（{{ sections.length }} 节）</span>
      <div class="toc-list">
        <button
          v-for="s in sections"
          :key="s.id"
          class="toc-item"
          :class="{ active: active === s.id }"
          @click="scrollTo(s.id)"
        >{{ s.title }}</button>
      </div>
    </div>

    <!-- 章节 -->
    <section v-for="s in sections" :id="anchorOf(s.id)" :key="s.id" class="section">
      <h3 class="section-title">{{ s.title }}</h3>

      <!-- 块 -->
      <template v-for="(b, i) in s.blocks" :key="`${s.id}-${i}`">
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
            <button class="copy" @click="copy(b.code, `${s.id}-${i}`)">{{ copied === `${s.id}-${i}` ? '已复制' : '复制' }}</button>
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
            <div class="code-head"><span class="code-label">示例</span><button class="copy" @click="copy(b.example, `${s.id}-${i}-ex`)">{{ copied === `${s.id}-${i}-ex` ? '已复制' : '复制' }}</button></div>
            <pre class="code"><code>{{ b.example }}</code></pre>
          </div>
        </div>

        <!-- 未知块：显式报出来（内容写错时页面上就能看见，而不是静默少一段） -->
        <p v-else class="note warn"><span class="note-mark">⚠</span>未知内容块类型：{{ b.t }}</p>
      </template>
    </section>
  </div>
</template>

<style scoped>
.docpage {
  padding: 30px;
  max-width: 900px;
  margin: 0 auto;
}
.title {
  text-align: center;
  margin-bottom: 6px;
}
.subtitle {
  text-align: center;
  font-size: 12px;
  color: #8f9bb3;
  margin-bottom: 14px;
}
.back {
  margin-bottom: 16px;
}
/* 目录 */
.toc {
  background: #16213e;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 16px;
}
.toc-title {
  font-size: 12px;
  color: #8f9bb3;
}
.toc-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.toc-item {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid #2a3a5e;
  background: #0f3460;
  color: #cfe1ff;
  cursor: pointer;
}
.toc-item:hover,
.toc-item.active {
  border-color: #e94560;
  color: #fff;
}
/* 章节 */
.section {
  margin-bottom: 26px;
  scroll-margin-top: 12px;
}
.section-title {
  font-size: 16px;
  color: #ffd700;
  border-bottom: 1px solid #2a3a5e;
  padding-bottom: 6px;
  margin-bottom: 10px;
}
.sub {
  font-size: 13px;
  color: #cfe1ff;
  margin: 14px 0 6px;
}
.p {
  font-size: 13px;
  color: #d7dee9;
  line-height: 1.8;
  margin-bottom: 8px;
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
</style>
