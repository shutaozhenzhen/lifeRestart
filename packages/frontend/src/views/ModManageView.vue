<script setup>
// Mod 管理页（对应设计文档 6.5）。
// 展示 Mod 列表、启用/禁用开关、权限声明、删除（系统 Mod 不可删）。
// 原型：数据用内存 mock（真实文件系统操作在引擎侧，浏览器通过 API 层）。
import { ref } from 'vue'
import { useRouter } from 'vue-router'
// 权限说明。
import { PERMISSION_LABELS } from 'game-engine/src/mod/permissions.js'

// 路由。
const router = useRouter()

// Mod 列表（原型 mock）。
const mods = ref([
  {
    name: 'lifeRestart-data',
    version: '1.0.0',
    description: '原版数据（系统内置）',
    system: true,
    enabled: true,
    permissions: [],
  },
  {
    name: 'base-mod',
    version: '1.0.0',
    description: '测试基础 Mod',
    system: false,
    enabled: true,
    permissions: ['hooks'],
  },
  {
    name: 'fun-mod',
    version: '1.0.0',
    description: '测试趣味 Mod',
    system: false,
    enabled: false,
    permissions: ['hooks', 'storage'],
  },
])

// 待授权的 Mod（权限弹窗）。
const pendingAuth = ref(null)

// 切换启用状态。
function toggle(mod) {
  // 系统 Mod 只可禁用不可删除，原型允许切换。
  mod.enabled = !mod.enabled
}

// 删除 Mod（系统 Mod 禁止）。
function remove(mod) {
  // 系统 Mod 不可删。
  if (mod.system) return
  // 确认删除。
  if (confirm(`删除 Mod ${mod.name}？`)) {
    // 移除。
    mods.value = mods.value.filter(m => m !== mod)
  }
}

// 授权弹窗：首次加载需授权权限。
function requestPermission(mod) {
  // 需要授权的权限。
  const needsAuth = mod.permissions.length > 0 && mod.enabled
  // 弹窗。
  pendingAuth.value = needsAuth ? mod : null
}

// 确认授权。
function confirmAuth() {
  // 关闭弹窗。
  pendingAuth.value = null
}

// 回主页。
function back() {
  // 返回。
  router.push('/')
}
</script>

<template>
  <div class="modmanage">
    <h2 class="title">Mod 管理</h2>
    <button class="btn back" @click="back">← 返回</button>

    <!-- Mod 列表 -->
    <div v-for="mod in mods" :key="mod.name" class="mod">
      <div class="mod-info">
        <span class="mod-name">{{ mod.name }} <span v-if="mod.system" class="badge">系统</span></span>
        <span class="mod-desc">{{ mod.description }}</span>
        <span class="mod-perms">
          权限：
          <span v-if="mod.permissions.length === 0">无</span>
          <span v-for="p in mod.permissions" :key="p" class="perm">{{ PERMISSION_LABELS[p] || p }}</span>
        </span>
      </div>
      <div class="mod-actions">
        <button class="btn" :class="{ on: mod.enabled }" @click="toggle(mod); requestPermission(mod)">
          {{ mod.enabled ? '已启用' : '已禁用' }}
        </button>
        <button v-if="!mod.system" class="btn danger" @click="remove(mod)">删除</button>
        <span v-else class="sys-hint">系统内置</span>
      </div>
    </div>

    <!-- 权限弹窗 -->
    <div v-if="pendingAuth" class="modal">
      <div class="modal-box">
        <h3>Mod「{{ pendingAuth.name }}」请求权限</h3>
        <p>以下权限将被授予：</p>
        <ul>
          <li v-for="p in pendingAuth.permissions" :key="p">{{ PERMISSION_LABELS[p] || p }}（{{ p }}）</li>
        </ul>
        <div class="modal-actions">
          <button class="btn" @click="pendingAuth = null">拒绝</button>
          <button class="btn primary" @click="confirmAuth">允许</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modmanage {
  padding: 30px;
  max-width: 640px;
  margin: 0 auto;
}
.title {
  text-align: center;
  margin-bottom: 16px;
}
.back {
  margin-bottom: 16px;
}
.mod {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #16213e;
  border-radius: 8px;
  padding: 16px 18px;
  margin-bottom: 12px;
}
.mod-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mod-name {
  font-size: 16px;
  font-weight: bold;
}
.badge {
  background: #e94560;
  color: #fff;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
}
.mod-desc {
  font-size: 13px;
  color: #aaa;
}
.mod-perms {
  font-size: 12px;
  color: #888;
}
.perm {
  background: #2a3a5e;
  padding: 1px 6px;
  border-radius: 4px;
  margin-right: 4px;
}
.mod-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
}
.btn.on {
  background: #2e7d32;
}
.btn.danger {
  background: #b71c1c;
}
.btn.primary {
  background: #e94560;
}
.sys-hint {
  color: #888;
  font-size: 12px;
}
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-box {
  background: #1a2a4e;
  padding: 24px;
  border-radius: 12px;
  min-width: 320px;
}
.modal-box h3 {
  margin-bottom: 12px;
}
.modal-box ul {
  margin: 8px 0 16px 20px;
  color: #ccc;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
