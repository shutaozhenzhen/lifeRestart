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
  {
    name: 'ai-mod',
    version: '1.0.0',
    description: 'AI 增强（系统内置，需配置 API Key）',
    system: true,
    enabled: false,
    permissions: ['ai', 'network', 'storage', 'hooks'],
  },
])

// AI 配置（localStorage 持久化）。
const aiConfig = ref(loadAIConfig())

// 读取 AI 配置。
function loadAIConfig() {
  // 读取。
  try {
    // localStorage。
    return JSON.parse(localStorage.getItem('aiConfig')) || { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', provider: 'openai' }
  } catch {
    // 默认。
    return { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', provider: 'openai' }
  }
}

// 保存 AI 配置。
function saveAIConfig() {
  // 写入。
  localStorage.setItem('aiConfig', JSON.stringify(aiConfig.value))
}

// AI 代理基地址（Step 16/17/23）优先序：
//   Electron 渲染进程（window.electronAIProxy，preload 注入）> VITE_AI_PROXY > Vite dev 代理 /ai-proxy。
const AI_PROXY = window.electronAIProxy?.baseUrl || import.meta.env.VITE_AI_PROXY || '/ai-proxy'

// AI 连接测试状态。
const aiTest = ref({ status: 'idle', output: '' })

// 测试 AI 连接（经本地代理调用当前服务商，验证 Key/模型/路由）。
async function testAI() {
  // 置为测试中。
  aiTest.value = { status: 'testing', output: '' }
  // 调用代理。
  try {
    // 请求（真实服务商需 Key；provider=mock 可无 Key 演示）。
    const res = await fetch(`${AI_PROXY}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: aiConfig.value.provider,
        apiKey: aiConfig.value.apiKey,
        baseUrl: aiConfig.value.baseUrl,
        model: aiConfig.value.model,
        messages: [{ role: 'user', content: '用一句话介绍你自己（用于连接测试）' }],
        max_tokens: 48,
      }),
    })
    // 解析响应。
    const data = await res.json()
    // 非 2xx。
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`)
    // 提取回复。
    const text = data.choices?.[0]?.message?.content || '(空回复)'
    // 成功。
    aiTest.value = { status: 'ok', output: text }
  } catch (e) {
    // 失败（含代理未启动的情况）。
    aiTest.value = { status: 'error', output: e.message }
  }
}

// 服务商预设。
const PROVIDERS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  glm: { label: 'GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  qwen: { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
}

// 选择服务商（自动填充 baseUrl/model）。
function selectProvider(p) {
  // 预设。
  const preset = PROVIDERS[p]
  // 有预设。
  if (preset) {
    // 填充。
    aiConfig.value.baseUrl = preset.baseUrl
    aiConfig.value.model = preset.model
  }
  // 记录。
  aiConfig.value.provider = p
}

// 切换 AI Mod 开关（启用时需配置 Key）。
function toggleAI(mod) {
  // 切换。
  mod.enabled = !mod.enabled
  // 启用但未配置 Key。
  if (mod.enabled && !aiConfig.value.apiKey) {
    // 提示。
    alert('启用 AI 增强前，请先配置 API Key（下方 AI 设置）')
  }
  // 保存。
  saveAIConfig()
}

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
        <button class="btn" :class="{ on: mod.enabled }" @click="mod.name === 'ai-mod' ? toggleAI(mod) : (toggle(mod), requestPermission(mod))">
          {{ mod.enabled ? '已启用' : '已禁用' }}
        </button>
        <button v-if="!mod.system" class="btn danger" @click="remove(mod)">删除</button>
        <span v-else class="sys-hint">系统内置</span>
      </div>
    </div>

    <!-- AI 配置面板 -->
    <div class="ai-panel">
      <h3 class="ai-title">AI 设置</h3>
      <p class="ai-hint">配置 AI 服务商（Mod 级 API Key，用于 AI 生成天赋/事件）</p>

      <div class="ai-field">
        <label>服务商</label>
        <div class="provider-row">
          <button
            v-for="(preset, key) in PROVIDERS"
            :key="key"
            class="btn provider"
            :class="{ active: aiConfig.provider === key }"
            @click="selectProvider(key)"
          >{{ preset.label }}</button>
        </div>
      </div>

      <div class="ai-field">
        <label>API Key</label>
        <input v-model="aiConfig.apiKey" type="password" placeholder="sk-..." @change="saveAIConfig" />
      </div>

      <div class="ai-field">
        <label>模型</label>
        <input v-model="aiConfig.model" placeholder="gpt-4o-mini" @change="saveAIConfig" />
      </div>

      <div class="ai-field">
        <label>Base URL</label>
        <input v-model="aiConfig.baseUrl" placeholder="https://api.openai.com/v1" @change="saveAIConfig" />
      </div>

      <div class="ai-field ai-status">
        <label>状态</label>
        <span :class="aiConfig.apiKey ? 'ok' : 'warn'">
          {{ aiConfig.apiKey ? '已配置 Key（可启用 ai-mod）' : '未配置 Key（无法调用 AI）' }}
        </span>
      </div>

      <div class="ai-field ai-test">
        <label>连接测试</label>
        <button class="btn primary" :disabled="aiTest.status === 'testing'" @click="testAI">
          {{ aiTest.status === 'testing' ? '测试中…' : '测试连接' }}
        </button>
        <span v-if="aiTest.status === 'ok'" class="ok test-out">{{ aiTest.output }}</span>
        <span v-else-if="aiTest.status === 'error'" class="err test-out">{{ aiTest.output }}</span>
      </div>
      <p class="ai-hint">
        测试经本地 AI 代理转发（需先启动代理：cd packages/game-engine && node server.js）。
        切换服务商后测试，可验证不同 provider 的路由与回复。
      </p>
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
.ai-panel {
  margin-top: 20px;
  background: #1a2a4e;
  border-radius: 8px;
  padding: 18px;
}
.ai-title {
  margin-bottom: 4px;
}
.ai-hint {
  font-size: 12px;
  color: #888;
  margin-bottom: 14px;
}
.ai-field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.ai-field label {
  width: 80px;
  font-size: 13px;
  color: #aaa;
  flex-shrink: 0;
}
.ai-field input {
  flex: 1;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #2a3a5e;
  background: #0f3460;
  color: #fff;
  font-size: 13px;
}
.provider-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.btn.provider {
  padding: 5px 12px;
  font-size: 12px;
  background: #0f3460;
}
.btn.provider.active {
  background: #e94560;
}
.ai-status .ok {
  color: #4caf50;
}
.ai-status .warn {
  color: #ff9800;
}
.ai-test .ok {
  color: #4caf50;
}
.ai-test .err {
  color: #e94560;
}
.test-out {
  font-size: 12px;
  word-break: break-all;
}
.ai-test .btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
