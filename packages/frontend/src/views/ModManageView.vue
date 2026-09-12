<script setup>
// Mod 管理页（对应设计文档 6.5）。
// 展示 Mod 列表、启用/禁用开关、权限声明、删除（系统 Mod 不可删）。
// 启停/删除状态经 localStorage 持久化（键 modsState），刷新后保留用户选择。
// 真实文件系统操作在引擎侧（mod/manager.js），浏览器侧为 UI 层（未接 API）。
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
// 权限说明。
import { PERMISSION_LABELS } from 'game-engine/src/mod/permissions.js'
// 游戏 store（页面操作行为日志：进入页面/按钮操作都记入日志面板）。
import { useGameStore } from '../stores/game.js'
// Mod 启停/删除状态持久化（纯函数，可测试）。
import { loadModsState, saveModsState, applyModsState } from '../utils/mods-state.js'

// 路由。
const router = useRouter()
// 游戏 store。
const gameStore = useGameStore()

// 页面挂载：记录进入 Mod 管理页。
onMounted(() => {
  // 记录（UI 日志常显，不随引擎级别过滤）。
  gameStore.pushLog('info', '[UI][mods] 进入 Mod 管理页')
})

// （loadModsState/saveModsState/applyModsState 已抽到 utils/mods-state.js，可单元测试）

// #MOD_LIST
// Mod 默认列表（原型数据源；启停/删除状态经 localStorage 持久化）。
const MOD_LIST = [
  {
    name: 'lifeRestart-data',
    version: '1.0.0',
    description: '原版数据（系统内置；启用时游戏加载真实原版数据，禁用回退演示数据）',
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
]

// 读取持久化状态（一次）。
const savedState = loadModsState()
// 已删除（非 system）Mod 名（持久化）。
const removedMods = ref(savedState.removed || [])
// Mod 列表：默认集合过滤已删除 + 应用保存的启停状态（applyModsState 纯函数，刷新后保留用户选择）。
const mods = ref(applyModsState(MOD_LIST, savedState))

// AI 配置（localStorage 持久化，与 ai-mod 开关解耦：配置仅保存，启用才生效）。
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
    // 记录（连接成功）。
    gameStore.pushLog('info', `[UI][mods] AI 连接测试成功（${aiConfig.value.provider}/${aiConfig.value.model}）`)
  } catch (e) {
    // 失败（含代理未启动的情况）。
    aiTest.value = { status: 'error', output: e.message }
    // 记录（连接失败）。
    gameStore.pushLog('warn', `[UI][mods] AI 连接测试失败: ${e.message}`)
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
  // 页面日志：切换服务商。
  gameStore.pushLog('info', `[UI][mods] AI 服务商切换为 ${preset?.label || p}`)
}

// 切换 AI Mod 开关（启用时需配置 Key）。
function toggleAI(mod) {
  // 切换。
  mod.enabled = !mod.enabled
  // 页面日志：AI Mod 开关。
  gameStore.pushLog('info', `[UI][mods] ai-mod ${mod.enabled ? '启用' : '禁用'}`)
  // 保存状态（刷新后保留，纯函数）。
  saveModsState({ mods: mods.value, removed: removedMods.value })
  // 禁用时联动折叠配置面板。
  if (!mod.enabled) aiPanelOpen.value = false
  // 启用但未配置 Key。
  if (mod.enabled && !aiConfig.value.apiKey) {
    // 提示。
    alert('启用 AI 增强前，请先配置 API Key（AI 配置面板）')
  }
  // 保存。
  saveAIConfig()
}

// AI 配置面板展开状态（点开才展开）。
const aiPanelOpen = ref(false)
// ai-mod 当前是否启用（联动面板的置灰与提示）。
const aiModEnabled = computed(() => mods.value.find(m => m.name === 'ai-mod')?.enabled || false)
// 展开/折叠 AI 配置面板。
function togglePanel() {
  aiPanelOpen.value = !aiPanelOpen.value
  // 页面日志。
  gameStore.pushLog('info', `[UI][mods] ${aiPanelOpen.value ? '展开' : '收起'} ai-mod AI 配置`)
}

// 待授权的 Mod（权限弹窗）。
const pendingAuth = ref(null)

// 切换启用状态。
function toggle(mod) {
  // 系统 Mod 只可禁用不可删除，原型允许切换。
  mod.enabled = !mod.enabled
  // 页面日志。
  gameStore.pushLog('info', `[UI][mods] ${mod.name} ${mod.enabled ? '启用' : '禁用'}`)
  // 保存状态（刷新后保留，纯函数）。
  saveModsState({ mods: mods.value, removed: removedMods.value })
}

// 删除 Mod（系统 Mod 禁止）。
function remove(mod) {
  // 系统 Mod 不可删。
  if (mod.system) return
  // 确认删除。
  if (confirm(`删除 Mod ${mod.name}？`)) {
    // 移除。
    mods.value = mods.value.filter(m => m !== mod)
    // 记录已删除（持久化，刷新后不再出现）。
    removedMods.value.push(mod.name)
    // 保存状态（纯函数）。
    saveModsState({ mods: mods.value, removed: removedMods.value })
    // 页面日志。
    gameStore.pushLog('info', `[UI][mods] 已删除 Mod ${mod.name}`)
  } else {
    // 页面日志（取消）。
    gameStore.pushLog('debug', `[UI][mods] 取消删除 ${mod.name}`)
  }
}

// 授权弹窗：首次加载需授权权限。
function requestPermission(mod) {
  // 需要授权的权限。
  const needsAuth = mod.permissions.length > 0 && mod.enabled
  // 弹窗。
  pendingAuth.value = needsAuth ? mod : null
  // 页面日志。
  if (needsAuth) gameStore.pushLog('info', `[UI][mods] ${mod.name} 请求权限弹窗（${mod.permissions.join(', ')}）`)
}

// 确认授权。
function confirmAuth() {
  // 关闭弹窗。
  pendingAuth.value = null
  // 页面日志。
  gameStore.pushLog('info', '[UI][mods] 授权弹窗确认（允许）')
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
        <button v-if="mod.name === 'ai-mod'" class="btn config" :class="{ active: aiPanelOpen }" @click="togglePanel">
          {{ aiPanelOpen ? '收起配置' : 'AI 配置' }}
        </button>
        <button v-if="!mod.system" class="btn danger" @click="remove(mod)">删除</button>
        <span v-else class="sys-hint">系统内置</span>
      </div>
      <!-- AI 配置面板（内嵌于 ai-mod 卡片，点开才展开；禁用时灰化，仅保存暂不生效） -->
      <div v-if="mod.name === 'ai-mod' && aiPanelOpen" class="ai-config" :class="{ dim: !aiModEnabled }">
        <div v-if="!aiModEnabled" class="warn-banner">⚠ AI Mod 已禁用，配置仅保存暂不生效（启用后立即生效）</div>
        <p class="ai-hint">Mod 级 API Key，用于 AI 生成天赋/事件（对应 ai-mod manifest.json 的 ai 字段）</p>

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
            {{ aiConfig.apiKey ? '已配置 Key（启用后生效）' : '未配置 Key（无法调用 AI）' }}
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
  flex-wrap: wrap;
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
.btn.config {
  background: #0f3460;
  border: 1px solid #42a5f5;
}
.btn.config.active {
  background: #42a5f5;
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
.ai-config {
  flex-basis: 100%;
  margin-top: 14px;
  background: #1a2a4e;
  border-radius: 8px;
  padding: 18px;
}
.ai-config.dim {
  opacity: 0.55;
}
.warn-banner {
  background: rgba(255, 152, 0, 0.12);
  color: #ff9800;
  border: 1px solid rgba(255, 152, 0, 0.35);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  margin-bottom: 12px;
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
