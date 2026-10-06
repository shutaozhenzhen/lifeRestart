<script setup>
// Mod 管理页（对应设计文档 6.5）。
// 展示 Mod 列表、启用/禁用开关、权限声明、安装（zip / 从 GitHub 拉源码）、导出 zip、
// 以及**完全移除**（预装/系统 Mod 一视同仁；移除后可恢复或重新安装）。
// 启停/移除状态经 localStorage 持久化（键 modsState），刷新后保留用户选择。
// 真实文件系统操作在引擎侧（mod/manager.js），浏览器侧为 UI 层（未接 API）。
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
// 权限说明。
import { PERMISSION_LABELS } from 'game-engine/src/mod/permissions.js'
// Mod 目录（原型清单 ↔ 服务器上发现的真实 Mod 合并）与发现接口。
import { loadModCatalog } from '../utils/mod-catalog.js'
import { discoverMods, installModFromZip } from '../utils/mod-runtime.js'
// 导出 Mod 为 zip（下载按钮；与引擎读 Mod 同一套清单/兜底规则）。
import { exportModZip } from '../utils/mod-export.js'
// 从 GitHub 链接拉源码安装（api.github.com + raw；zipball 端点被 CORS 挡，走不通）。
import { installModFromGitHub } from '../utils/mod-github.js'
// 触发浏览器下载（文本与 zip 共用；注入式，取不到浏览器 API 时返回 false）。
import { downloadBytes } from '../utils/log-export.js'
// 已安装 Mod 的本地存储（IndexedDB，含内存回退）。
import { getModStore } from '../utils/mod-store.js'
// 游戏 store（页面操作行为日志：进入页面/按钮操作都记入日志面板）。
import { useGameStore } from '../stores/game.js'
// Mod 启停/删除状态持久化（纯函数，可测试）。
import { loadModsState, saveModsState, applyModsState, addRemoved, dropRemoved } from '../utils/mods-state.js'

// 路由。
const router = useRouter()
// 游戏 store。
const gameStore = useGameStore()

// 页面挂载：记录进入 + **发现服务器上的真实 Mod**（有 code.js/数据的才算能跑）。
// 发现失败（离线/没跑 sync-mods）时目录仍由原型清单兜底，界面不会空。
onMounted(async () => {
  // 记录（UI 日志常显，不随引擎级别过滤）。
  gameStore.pushLog('info', '[UI][mods] 进入 Mod 管理页')
  // 取本地已安装 Mod 的存储（无 IndexedDB 时自动退回内存）。
  modStore.value = await getModStore()
  // 刷新目录（本地已安装 + 服务器，本地优先）。
  await refreshCatalog()
})

// #refreshCatalog
// 重新发现 Mod 并刷新目录（本地已安装 + 服务器）。
//
// @returns {Promise<void>}
async function refreshCatalog() {
  // 发现（超时/404 都会降级，不影响界面）。
  const { mods: found, errors } = await discoverMods({ store: modStore.value })
  // 错误记为 warn（报告里可见为什么不生效）。
  for (const e of errors) gameStore.pushLog('warn', `[UI][mods] ${e}`)
  // 合并出真实目录。
  mods.value = loadModCatalog(found)
  // 记录哪些是本地安装的（界面区分来源 + 提供卸载）。
  const installed = modStore.value ? await modStore.value.list() : []
  installedNames.value = installed.map((m) => m.name)
  // 日志：实际可用的 Mod。
  gameStore.pushLog('info', `[UI][mods] 可用 Mod ${found.length} 个（本地安装 ${installedNames.value.length} 个）：${found.map((m) => m.name).join(', ') || '（无）'}`)
}

// #pickZip
// 打开文件选择框（安装 Mod）。
//
// @returns {void}
function pickZip() {
  // 触发隐藏的 file input。
  fileInput.value?.click()
}

// #onZipPicked
// 选好 zip 后：解析 + 安装到本地存储 + 刷新目录。
//
// @param {Event} event - change 事件
// @returns {Promise<void>}
async function onZipPicked(event) {
  // 取文件。
  const file = event?.target?.files?.[0]
  // 清空 input（同一个文件可以再次选择）。
  if (event?.target) event.target.value = ''
  // 没选。
  if (!file) return
  // 忙状态。
  installBusy.value = true
  // 清错误。
  installError.value = ''
  // 安装。
  try {
    // 读字节。
    const bytes = new Uint8Array(await file.arrayBuffer())
    // 第一遍：解析 + 写入本地存储（解析/校验/安全防护都在引擎 zip 模块里）。
    let r = await installModFromZip({ bytes, store: modStore.value })
    // 系统 Mod 名：默认被拒（防"随手一个 zip 静默顶掉数据源 / AI 通道"）。
    // 这里问一句再重试 —— 这正是「完全移除 → 重新上传装回来」需要的能力。
    if (!r.ok && r.system) {
      // 二次确认（讲清这是在覆盖系统预装）。
      const yes = confirm(`这个包是系统预装 Mod「${r.name}」。\n\n装回去会用你上传的文件**覆盖**它（数据源 / AI 通道都由它提供）。\n确定要装吗？`)
      // 用户拒绝。
      if (!yes) {
        // 反馈 + 日志。
        installError.value = `已取消安装系统 Mod ${r.name}`
        gameStore.pushLog('warn', `[UI][mods] 取消安装系统 Mod ${r.name}（需二次确认）`)
        // 结束。
        return
      }
      // 确认后重试（显式放行系统名）。
      r = await installModFromZip({ bytes, store: modStore.value, allowSystem: true })
    }
    // 失败：把原因显示出来（不合格的 zip 必须有可读反馈）。
    if (!r.ok) {
      // 展示。
      installError.value = r.errors.join('；')
      // 日志。
      gameStore.pushLog('warn', `[UI][mods] 安装 ${file.name} 失败：${r.errors.join('；')}`)
      // 结束。
      return
    }
    // 成功提示 + 日志 + 清「已移除」标记 + 刷新（zip 与 GitHub 两条安装路径共用一份收尾）。
    installError.value = ''
    await afterInstall(r, `来自 ${file.name}`)
  } catch (e) {
    // 读文件/解压异常。
    installError.value = `安装失败：${e.message}`
    // 日志。
    gameStore.pushLog('warn', `[UI][mods] 安装失败：${e.message}`)
  } finally {
    // 解除忙状态。
    installBusy.value = false
  }
}

// #afterInstall
// 安装成功后的统一收尾（**zip 与 GitHub 两条路共用**）。
//
// 抽出来的理由：这里有两件"漏了就会看起来像 bug"的事 ——
//   1. 装上的 Mod 可能正躺在「已移除」列表里（用户先移除、又装回来）：
//      不清掉标记，装完它还是不出现、不加载，用户只会以为"没装上"。
//   2. 关闭确认过的警告（路径/尺寸/非文本）必须逐条进日志，不许静默。
// 两份复制迟早会分叉，所以只留一份。
//
// @param {object} r - 安装结果（installModFromZip / installModFromGitHub）
// @param {string} from - 来源描述（文件名 / owner/repo@commit），仅用于提示与日志
// @param {object} [opts]
// @param {boolean} [opts.setMessage] - 是否写「安装成功」提示（GitHub 路径自己在输入框下面显示来源更细）
// @returns {Promise<void>}
async function afterInstall(r, from, { setMessage = true } = {}) {
  // 来源后缀（GitHub 会在后面追一句它是哪一版）。
  const origin = r.source ? `${from}（${r.source.owner}/${r.source.repo}@${String(r.source.commit).slice(0, 7)}）` : from
  // 成功提示。
  if (setMessage) installMessage.value = `已安装 ${r.name}（${r.files} 个文件）${r.system ? ' · 覆盖了系统预装 Mod' : ''}`
  // 日志。
  gameStore.pushLog('info', `[UI][mods] 已安装 Mod ${r.name}（${origin}，${r.files} 个文件${r.system ? '，覆盖系统预装' : ''}）`)
  // 它可能正在「已移除」里 —— 上传成功就必须清掉标记，否则装完还是看不见（用户会以为没装上）。
  if (removedMods.value.includes(r.name)) {
    // 清标记（纯函数返回新数组）。
    removedMods.value = dropRemoved(removedMods.value, r.name)
    // 保存。
    saveModsState({ mods: mods.value, removed: removedMods.value })
    // 日志。
    gameStore.pushLog('info', `[UI][mods] ${r.name} 原在「已移除」列表里，安装后已自动恢复`)
  }
  // 警告（路径/尺寸/二进制）逐条记。
  for (const w of r.errors) gameStore.pushLog('warn', `[UI][mods] ${w}`)
  // 刷新目录。
  await refreshCatalog()
}

// #installFromGitHub
// 从 GitHub 链接安装 Mod（输入框回车、按钮点击、候选目录点击都走这里）。
//
// 流程与 zip 安装**完全一致**（同一套落地链路），只有"包从哪来"不同：
//   拉取 → 若仓库里有多个 Mod 则让用户选目录 → 系统 Mod 名二次确认 → 复用 afterInstall。
//
// @param {string} [url] - 链接（缺省用输入框里的值；候选目录点击时传候选自带的链接）
// @returns {Promise<void>}
async function installFromGitHub(url) {
  // 链接。
  const link = String(url ?? ghUrl.value ?? '').trim()
  // 空输入。
  if (!link) {
    // 提示。
    ghError.value = '请输入 GitHub 链接'
    // 结束。
    return
  }
  // 忙状态（防重复点击：一次安装要花 API 配额，重复点很亏）。
  ghBusy.value = true
  // 清反馈。
  ghError.value = ''
  ghMessage.value = ''
  ghProgress.value = ''
  ghCandidates.value = []
  // 取消控制器。
  ghAbort = new AbortController()
  // 执行。
  try {
    // 日志（把用户输入的链接记下来，出问题可复现）。
    gameStore.pushLog('info', `[UI][mods] 从 GitHub 安装：${link}`)
    // 拉取 + 安装（第一遍：系统 Mod 名会被拒，但包已经拉好了）。
    let r = await installModFromGitHub({
      // 链接。
      input: link,
      // 落地到本地存储。
      store: modStore.value,
      // 取消。
      signal: ghAbort.signal,
      // 进度（多文件时让用户看到在动）。
      onProgress: (p) => {
        // 文本。
        ghProgress.value = `已拉取 ${p.done}/${p.total} 个文件…`
      },
    })
    // 需要选目录：把候选渲染出来（每个候选都钉在同一个 commit 上，点谁就是谁）。
    if (!r.ok && r.needsChoice) {
      // 候选。
      ghCandidates.value = r.candidates
      // 原因。
      ghError.value = r.errors.join('；')
      // 日志。
      gameStore.pushLog('warn', `[UI][mods] 该仓库有多个 Mod，等待选择目录：${r.candidates.map((c) => c.path).join('、')}`)
      // 结束。
      return
    }
    // 系统 Mod 名：默认被拒（防"随手一个链接静默顶掉数据源 / AI 通道"）。
    if (!r.ok && r.system) {
      // 二次确认（讲清这是在覆盖系统预装）。
      const yes = confirm(`这个仓库里是系统预装 Mod「${r.name}」。\n\n装上去会用仓库里的文件**覆盖**它（数据源 / AI 通道都由它提供）。\n确定要装吗？`)
      // 用户拒绝。
      if (!yes) {
        // 反馈 + 日志。
        ghError.value = `已取消安装系统 Mod ${r.name}`
        gameStore.pushLog('warn', `[UI][mods] 取消安装系统 Mod ${r.name}（需二次确认）`)
        // 结束。
        return
      }
      // 确认后重试：用已经拉好的包（**不再拉一次**，否则用户的"确定"要再花掉 2~3 次配额）。
      r = await installModFromGitHub({ prefetched: r.prefetched, store: modStore.value, allowSystem: true })
    }
    // 失败：把原因显示出来。
    if (!r.ok) {
      // 取消：单独一句话（别把它报成"下载失败"）。
      if (r.aborted) {
        // 提示。
        ghError.value = '已取消拉取'
        // 日志。
        gameStore.pushLog('warn', '[UI][mods] 已取消从 GitHub 安装')
        // 结束。
        return
      }
      // 展示原因。
      ghError.value = r.errors.join('；')
      // 日志。
      gameStore.pushLog('warn', `[UI][mods] 从 GitHub 安装失败：${r.errors.join('；')}`)
      // 结束。
      return
    }
    // 成功：走与 zip 安装同一份收尾（提示由下面这行自己写，带上"哪一版"）。
    await afterInstall(r, '来自 GitHub', { setMessage: false })
    // 成功提示补上来源（哪一版）——用户之后想复现/汇报时全靠它。
    if (r.source) {
      // 提示（覆盖系统预装时也要明说，与 zip 路径的措辞一致）。
      ghMessage.value = `已从 ${r.source.owner}/${r.source.repo} 安装 ${r.name}（${r.files} 个文件 · 分支 ${r.source.ref} · commit ${String(r.source.commit).slice(0, 7)}${r.source.path ? ` · 目录 ${r.source.path}` : ''}${r.system ? ' · 覆盖了系统预装 Mod' : ''}）`
    } else {
      // 没有来源信息（理论上不会）也要给一句。
      ghMessage.value = `已安装 ${r.name}（${r.files} 个文件）`
    }
    // 进度收起。
    ghProgress.value = ''
  } catch (e) {
    // 异常兜底（不该发生：模块内部全捕获，但界面不能因此卡住）。
    ghError.value = `安装失败：${e.message}`
    // 日志。
    gameStore.pushLog('warn', `[UI][mods] 从 GitHub 安装异常：${e.message}`)
  } finally {
    // 解除忙状态。
    ghBusy.value = false
    // 释放控制器。
    ghAbort = null
  }
}

// #cancelGitHub
// 取消正在进行的 GitHub 拉取（多文件 + raw 连不上时会等一会儿，必须能取消）。
//
// @returns {void}
function cancelGitHub() {
  // 触发。
  ghAbort?.abort()
  // 日志。
  gameStore.pushLog('info', '[UI][mods] 请求取消 GitHub 拉取')
}

// #uninstall
// 卸载本地安装的 Mod（只删本地存储里的副本；服务器上的 Mod 不受影响）。
//
// @param {object} mod - 目录项
// @returns {Promise<void>}
async function uninstall(mod) {
  // 确认。
  if (!confirm(`卸载本地安装的 Mod ${mod.name}？`)) return
  // 删除。
  await modStore.value?.remove(mod.name)
  // 日志。
  gameStore.pushLog('info', `[UI][mods] 已卸载本地 Mod ${mod.name}`)
  // 刷新。
  await refreshCatalog()
}

// #download
// 下载某个 Mod：把它打包成 zip 存到本地（备份 / 分享 / 改造后装回来）。
//
// 打包逻辑全在 utils/mod-export.js（与引擎读 Mod 同一套规则：清单 + 数据目录兜底），
// 这里只负责"忙状态 / 反馈 / 触发浏览器下载"。
//
// 为什么用 `dir` 而不是 `name`：文件源是按**目录名**寻址的（与「查看数据」页同一个键）。
//
// @param {object} mod - 目录项
// @returns {Promise<void>}
async function download(mod) {
  // 目录名（老数据没有 dir 时退回 name）。
  const dir = mod.dir || mod.name
  // 忙状态（同一时刻只打一个包）。
  downloadBusy.value = dir
  // 清上一次的反馈。
  downloadError.value = ''
  downloadMessage.value = ''
  // 行为日志（打包可能要点时间：系统 Data Mod 有 4MB）。
  gameStore.pushLog('info', `[UI][mods] 打包下载 ${mod.name}（目录 ${dir}）…`)
  // 打包。
  try {
    // 导出（不抛：错误在返回值里）。
    const r = await exportModZip({ name: dir, store: modStore.value })
    // 致命错误：把原因显示出来（不许静默失败）。
    if (!r.ok) {
      // 展示 + 日志。
      downloadError.value = `打包 ${mod.name} 失败：${r.errors.join('；')}`
      gameStore.pushLog('warn', `[UI][mods] 打包 ${mod.name} 失败：${r.errors.join('；')}`)
      // 结束。
      return
    }
    // 非致命问题逐条记（缺文件 / manifest 校验问题）。
    for (const w of r.warnings) gameStore.pushLog('warn', `[UI][mods] ${mod.name}：${w}`)
    // 触发下载（浏览器对象 URL + 隐藏锚点；取不到浏览器 API 时返回 false）。
    const started = downloadBytes(r.bytes, r.filename, { mime: 'application/zip' })
    // 环境不支持。
    if (!started) {
      // 提示（把文件信息也说清楚：能手动救）。
      downloadError.value = `当前环境不支持文件下载（${r.filename}，${r.count} 个文件已打包好）`
      gameStore.pushLog('warn', `[UI][mods] 下载 ${r.filename} 失败：浏览器不支持 Blob/URL API`)
      // 结束。
      return
    }
    // 成功提示（大小按 zip 字节算）。
    downloadMessage.value = `已下载 ${r.filename}（${r.count} 个文件，${(r.bytes.length / 1024).toFixed(1)} KB）${r.system ? ' · 系统 Mod：这个包可作备份/改造，也能直接重新上传装回来（会再确认一次）' : ''}`
    // 日志（成功路径）。
    gameStore.pushLog('info', `[UI][mods] 已下载 ${r.filename}（${r.count} 个文件，${r.bytes.length} 字节${r.dataFrom ? `，数据来自 ${r.dataFrom}` : ''}）`)
  } catch (e) {
    // 打包/下载异常。
    downloadError.value = `打包 ${mod.name} 失败：${e.message}`
    // 日志。
    gameStore.pushLog('warn', `[UI][mods] 打包 ${mod.name} 失败：${e.message}`)
  } finally {
    // 解除忙状态。
    downloadBusy.value = ''
  }
}

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
// Mod 列表：原型清单兜底（发现结果在 onMounted 里合并进来，真实 manifest 覆盖展示字段）。
// 启停/删除状态经 localStorage 持久化（applyModsState 纯函数，刷新后保留用户选择）。
const mods = ref(loadModCatalog([]))
// 本地已安装 Mod 的存储（IndexedDB/内存）。
const modStore = ref(null)
// 本地已安装的 Mod 名（界面标来源 + 提供卸载）。
const installedNames = ref([])
// 文件选择框（zip 安装）。
const fileInput = ref(null)
// 安装中（防重复点击）。
const installBusy = ref(false)
// 安装错误 / 成功提示。
const installError = ref('')
const installMessage = ref('')
// 从 GitHub 安装：输入的链接 / 忙状态 / 反馈 / 进度 / 候选目录 / 取消控制器。
const ghUrl = ref('')
const ghBusy = ref(false)
const ghError = ref('')
const ghMessage = ref('')
const ghProgress = ref('')
const ghCandidates = ref([])
// 取消用（非响应式：只用来 abort，界面不需要 watch 它）。
let ghAbort = null
// 正在打包下载的 Mod（目录名；空 = 没有在打包，防重复点击）。
const downloadBusy = ref('')
// 下载错误 / 成功提示（与安装提示分开：两件事的反馈不该互相覆盖）。
const downloadError = ref('')
const downloadMessage = ref('')

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

// #openDetail
// 打开某个 Mod 的**数据详情页**（/mods/<目录名>）。
//
// 为什么用 `dir` 而不是 `name`：目录名才是文件源寻址用的键，
// manifest 里的 name 允许与目录名不同（见 utils/mod-catalog.js）。
//
// @param {object} mod - 目录项
// @returns {void}
function openDetail(mod) {
  // 目录名（老数据没有 dir 时退回 name）。
  const dir = mod.dir || mod.name
  // 行为日志。
  gameStore.pushLog('info', `[UI][mods] 查看数据：${mod.name}（目录 ${dir}）`)
  // 跳转。
  router.push(`/mods/${encodeURIComponent(dir)}`)
}

// 切换启用状态。
function toggle(mod) {
  // 启停与"移除"是两件事：移除过的 Mod 不在目录里，这里只管还在目录里的。
  mod.enabled = !mod.enabled
  // 页面日志。
  gameStore.pushLog('info', `[UI][mods] ${mod.name} ${mod.enabled ? '启用' : '禁用'}`)
  // 保存状态（刷新后保留，纯函数）。
  saveModsState({ mods: mods.value, removed: removedMods.value })
}

// #remove
// **完全移除**一个 Mod（预装/系统 Mod 一视同仁）：
//   1. 删掉本地安装的副本（"完全"：浏览器里不留东西）
//   2. 记入 `removed`（持久化）——**同时表示"不加载"**（`mods-state.isModRemoved` 被
//      `game-data.loadModState` 用；内容 Mod 被移除后游戏确实是空内容，不是"界面假象"）
//   3. 从当前目录移除 + 刷新
//
// 老实说清边界：**服务器上的预装文件删不掉**（静态站，浏览器没有那个权限），
// 所以"完全移除"是**本机视角**的彻底移除 —— 而这也正是「已移除的 Mod」面板能「恢复」的原因。
//
// @param {object} mod - 目录项
// @returns {Promise<void>}
async function remove(mod) {
  // 后果说明（内容 Mod 要单独讲清楚：移除后游戏没有内容）。
  const why = mod.name === 'lifeRestart-data'
    ? '它是内容 Mod：移除后游戏将没有内容（天赋/事件/成就/名人全空），并在主页数据源标出原因。'
    : mod.system
      ? '这是系统预装 Mod，移除后相关能力（AI 通道等）失效。'
      : '移除后它不再出现在目录里、也不会被加载。'
  // 二次确认（服务器文件不会删，这一点必须让用户知道，否则会以为"删不干净"）。
  if (!confirm(`完全移除 Mod ${mod.name}？\n\n${why}\n\n（服务器上的文件不会被删，只是这台浏览器不再使用它；随时可在「已移除的 Mod」里恢复，或重新上传 zip）`)) {
    // 页面日志（取消）。
    gameStore.pushLog('debug', `[UI][mods] 取消完全移除 ${mod.name}`)
    // 结束。
    return
  }
  // 本地安装的副本一并删掉。
  if (installedNames.value.includes(mod.name)) {
    // 删（只删浏览器里的副本）。
    await modStore.value?.remove(mod.name)
    // 日志。
    gameStore.pushLog('info', `[UI][mods] 已删除本地安装的 ${mod.name}（随完全移除一并清理）`)
  }
  // 记入移除（持久化，去重；纯函数返回新数组）。
  removedMods.value = addRemoved(removedMods.value, mod.name)
  // 从当前目录移除（刷新后也会因 removed 被过滤）。
  mods.value = mods.value.filter(m => m !== mod)
  // 保存状态（纯函数）。
  saveModsState({ mods: mods.value, removed: removedMods.value })
  // 页面日志。
  gameStore.pushLog('info', `[UI][mods] 已完全移除 Mod ${mod.name}（服务器文件未删，可恢复/重新上传）`)
  // 刷新目录（本地已安装列表也要跟着更新）。
  await refreshCatalog()
}

// #restore
// 恢复一个被完全移除的 Mod（**预装 Mod 的回头路**：服务器文件从来没被删，清掉标记即可）。
//
// @param {string} name - Mod 名
// @returns {Promise<void>}
async function restore(name) {
  // 确认。
  if (!confirm(`恢复 Mod ${name}？（它只是从这台浏览器的目录里被移除）`)) return
  // 清标记（纯函数返回新数组）。
  removedMods.value = dropRemoved(removedMods.value, name)
  // 保存。
  saveModsState({ mods: mods.value, removed: removedMods.value })
  // 日志。
  gameStore.pushLog('info', `[UI][mods] 已恢复 Mod ${name}`)
  // 刷新（重新出现在目录里）。
  await refreshCatalog()
}

// #restoreAll
// 一次恢复全部被移除的 Mod。
//
// @returns {Promise<void>}
async function restoreAll() {
  // 空列表就不问。
  if (removedMods.value.length === 0) return
  // 确认。
  if (!confirm(`恢复全部 ${removedMods.value.length} 个被移除的 Mod？`)) return
  // 清空标记（新数组）。
  const names = [...removedMods.value]
  // 清。
  removedMods.value = []
  // 保存。
  saveModsState({ mods: mods.value, removed: removedMods.value })
  // 日志。
  gameStore.pushLog('info', `[UI][mods] 已恢复全部被移除的 Mod：${names.join(', ')}`)
  // 刷新。
  await refreshCatalog()
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

    <!-- zip 安装（纯前端：解析与校验走引擎共用 zip 模块，装进浏览器本地存储） -->
    <div class="install-bar">
      <input ref="fileInput" class="hidden-file" type="file" accept=".zip,application/zip" @change="onZipPicked" />
      <button class="btn primary" :disabled="installBusy" @click="pickZip">
        {{ installBusy ? '安装中…' : '+ 安装 Mod（.zip）' }}
      </button>
      <span class="install-hint">zip 里需含 manifest.json（支持包装一层目录；系统 Mod 名会再问一次）</span>
    </div>
    <p v-if="installError" class="install-error">⚠ {{ installError }}</p>
    <p v-if="installMessage" class="install-ok">{{ installMessage }}</p>

    <!-- 从 GitHub 安装（浏览器侧只能走 api.github.com + raw：zipball 端点不允许跨域） -->
    <div class="gh-bar">
      <input
        v-model="ghUrl"
        class="gh-input"
        placeholder="https://github.com/owner/repo（可带 /tree/分支/目录）"
        :disabled="ghBusy"
        @keyup.enter="installFromGitHub()"
      />
      <button class="btn primary" :disabled="ghBusy" @click="installFromGitHub()">
        {{ ghBusy ? '拉取中…' : '⬇ 从 GitHub 安装' }}
      </button>
      <button v-if="ghBusy" class="btn" @click="cancelGitHub">取消</button>
    </div>
    <p class="gh-hint">
      走 api.github.com + raw（GitHub 的 zipball 下载不允许跨域，浏览器里用不了）：匿名限流 60 次/小时，装一个约 3 次；
      链接不给分支就用仓库默认分支，仓库里有多个 Mod 会让你选目录。
    </p>
    <p v-if="ghProgress" class="gh-progress">{{ ghProgress }}</p>
    <p v-if="ghError" class="install-error">⚠ {{ ghError }}</p>
    <p v-if="ghMessage" class="install-ok">{{ ghMessage }}</p>
    <!-- 候选目录：仓库里有多个 Mod 时让用户选（每个候选都钉在同一个 commit 上） -->
    <div v-if="ghCandidates.length" class="gh-candidates">
      <span class="gh-candidates-title">选一个目录安装：</span>
      <button v-for="c in ghCandidates" :key="c.path" class="btn gh-candidate" @click="installFromGitHub(c.url)">{{ c.path }}</button>
    </div>
    <!-- 下载（导出 zip）的反馈：与安装提示分开显示，两件事不该互相覆盖 -->
    <p v-if="downloadError" class="download-error">⚠ {{ downloadError }}</p>
    <p v-if="downloadMessage" class="download-ok">{{ downloadMessage }}</p>

    <!-- 已移除的 Mod：完全移除是**本机视角**的（服务器文件从未被删），所以这里给一条回头路 -->
    <div v-if="removedMods.length" class="removed-panel">
      <div class="removed-head">
        <span class="removed-title">已移除的 Mod（{{ removedMods.length }}）</span>
        <button class="btn restore" @click="restoreAll">全部恢复</button>
      </div>
      <p class="removed-hint">完全移除只作用于这台浏览器：不再出现在列表、不再被加载、本地副本也已删除。服务器上的预装文件仍在，点「恢复」即可取回，也可以用上面的「+ 安装 Mod（.zip）」上传包、或「⬇ 从 GitHub 安装」从仓库装回来。</p>
      <div v-for="n in removedMods" :key="n" class="removed-row">
        <span class="removed-name">{{ n }}</span>
        <button class="btn restore" @click="restore(n)">恢复</button>
      </div>
    </div>

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
        <!-- 查看数据：进该 Mod 的数据详情页（可视化它装了什么） -->
        <button class="btn detail" @click="openDetail(mod)">查看数据 →</button>
        <!-- 下载：把该 Mod 打包成 zip 存到本地（备份/分享；系统 Mod 的包要改名才能装回来） -->
        <button
          class="btn download"
          :disabled="downloadBusy === (mod.dir || mod.name)"
          :title="mod.system ? '系统 Mod：zip 可作备份/改造，重新上传时二次确认即可装回来' : '把这个 Mod 打包成 zip 下载'"
          @click="download(mod)"
        >{{ downloadBusy === (mod.dir || mod.name) ? '打包中…' : '⬇ 下载 zip' }}</button>
        <button class="btn toggle" :class="{ on: mod.enabled }" @click="mod.name === 'ai-mod' ? toggleAI(mod) : (toggle(mod), requestPermission(mod))">
          {{ mod.enabled ? '已启用' : '已禁用' }}
        </button>
        <button v-if="mod.name === 'ai-mod'" class="btn config" :class="{ active: aiPanelOpen }" @click="togglePanel">
          {{ aiPanelOpen ? '收起配置' : 'AI 配置' }}
        </button>
        <!-- 完全移除：预装/系统 Mod 一视同仁（服务器文件不会删，可恢复或重新上传） -->
        <button class="btn danger" @click="remove(mod)">完全移除</button>
        <!-- 本地安装的 Mod 可以卸载（只删浏览器里的副本） -->
        <button v-if="installedNames.includes(mod.name)" class="btn danger" @click="uninstall(mod)">卸载</button>
        <span v-if="installedNames.includes(mod.name)" class="sys-hint">本地安装</span>
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
/* zip 安装条 */
.install-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.install-hint {
  font-size: 12px;
  color: #8f9bb3;
}
/* 从 GitHub 安装：输入框 + 按钮 + 说明 + 候选目录 */
.gh-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 14px 0 6px;
}
.gh-input {
  flex: 1;
  min-width: 240px;
  background: #0f3460;
  border: 1px solid #1a4a7a;
  border-radius: 6px;
  color: #e8e8e8;
  padding: 8px 10px;
  font-size: 13px;
}
.gh-input:disabled {
  opacity: 0.6;
}
.gh-hint {
  font-size: 12px;
  color: #8f9bb3;
  line-height: 1.7;
  margin-bottom: 8px;
}
.gh-progress {
  font-size: 12px;
  color: #8f9bb3;
  margin-bottom: 8px;
}
.gh-candidates {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: #16213e;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.gh-candidates-title {
  font-size: 12px;
  color: #8f9bb3;
}
.gh-candidate {
  font-size: 12px;
  padding: 4px 10px;
}
.hidden-file {
  display: none;
}
.install-error {
  font-size: 12px;
  color: #ffb84d;
  line-height: 1.6;
  margin-bottom: 8px;
}
.install-ok {
  font-size: 12px;
  color: #4d9de0;
  margin-bottom: 8px;
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
.btn.detail {
  background: #22304f;
  border: 1px solid #ffd700;
  color: #ffd700;
}
.btn.detail:hover {
  background: #ffd700;
  color: #16213e;
}
/* 下载（导出 zip）：蓝色描边，与「查看数据」（金色）区分开 */
.btn.download {
  background: #16213e;
  border: 1px solid #4d9de0;
  color: #4d9de0;
}
.btn.download:hover:not(:disabled) {
  background: #4d9de0;
  color: #16213e;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
/* 下载反馈（与安装反馈同形，颜色区分：错误用橙、成功用蓝） */
.download-error {
  font-size: 12px;
  color: #ffb84d;
  line-height: 1.6;
  margin-bottom: 8px;
}
.download-ok {
  font-size: 12px;
  color: #4d9de0;
  line-height: 1.6;
  margin-bottom: 8px;
}
.sys-hint {
  color: #888;
  font-size: 12px;
}
/* 「已移除的 Mod」面板：完全移除后的回头路（恢复预装 / 重新上传的入口提示） */
.removed-panel {
  background: #1a2a4e;
  border: 1px solid #2a3a5e;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.removed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.removed-title {
  font-size: 14px;
  font-weight: bold;
}
.removed-hint {
  font-size: 12px;
  color: #8f9bb3;
  line-height: 1.6;
  margin-bottom: 8px;
}
.removed-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
  border-top: 1px solid #22304f;
}
.removed-name {
  font-size: 13px;
  color: #cfd8e3;
}
.btn.restore {
  background: #16213e;
  border: 1px solid #4d9de0;
  color: #4d9de0;
  padding: 4px 12px;
  font-size: 12px;
}
.btn.restore:hover {
  background: #4d9de0;
  color: #16213e;
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
