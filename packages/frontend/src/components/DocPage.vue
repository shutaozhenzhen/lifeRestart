<script setup>
// Mod 文档页的**公共渲染组件**（制作文档与 API 参考共用同一版式）
//
// 为什么内容不做成 Markdown 字符串：这个项目不带任何 Markdown 依赖（前端只有
// vue / pinia / vue-router），而为了一份文档去引一个解析器不划算。改成**结构化数据**
// （`utils/mod-doc-guide.js` / `utils/mod-doc-api.js` 里的 sections → blocks）有三个好处：
//   1. 渲染逻辑只有一份（本组件负责版式 + `components/DocBlocks.vue` 负责内容块），
//      两个文档页只是"换数据"；
//   2. 内容可以被单测逐块校验（块类型、必填字段、表格列数、代码非空）；
//   3. API 文档可以**机器核对**：块里记着 `path`（如 `talent.add`），测试拿它与
//      引擎 `createGameAPI()` 真实返回的键双向比对 —— 漏写/写错都会被挡住
//      （与 `statistics-view.js` 的覆盖性守卫同一个思路）。
//
// ⚠️ 锚点必须用 scrollIntoView，**不能**写 `<a href="#id">`：
//    本站是 Hash 路由（createWebHashHistory），改 `location.hash` 等于导航到另一个路由，
//    点一下目录就会被 router 当成"去 #section 这个路径"。
//
// ⚠️ 2026-10 能力补齐 ③：**块渲染已抽到 `components/DocBlocks.vue`** —— Mod 声明的
//    页面（`/mods/page/:id`）与面板卡片用的是**同一个渲染器**（不许有第二份）。
//    本组件只剩"文档版式"：标题 / 副标题 / 目录 / 章节。
import { computed, ref } from 'vue'
// 内容块渲染器（与 Mod 页面 / 面板卡片共用）。
import DocBlocks from './DocBlocks.vue'

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

      <!-- 块（公共渲染器：p/sub/note/list/table/code/link/api/action + 未知块警告） -->
      <DocBlocks :blocks="s.blocks" :id-prefix="`${doc.id || 'doc'}-${s.id}`" />
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
/* 按钮基础样式。
   本项目的 `.btn` **不是全局样式**：每个页面/组件都在自己的 <style scoped> 里各定义一份
   （HomeView / GameView / ModManageView / LogDock… 都是这么做的）。这里以前漏了，
   于是文档页的「← 返回」是浏览器默认按钮样式（白底凸起），与全站深色风格不一致 ——
   2026-10 由界面线框核对时发现，`views/ModDocsView.spec.js` 现在有一条源码守卫钉住这件事。 */
.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
}
.btn:hover {
  background: #16457a;
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
/* 章节（内容块的样式在 DocBlocks.vue 里，见该组件） */
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
</style>
