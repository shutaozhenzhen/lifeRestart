// 零依赖前端：只读 state 的派生信息 + 消费事件流，不参与任何游戏逻辑。
import { createRuntime } from '../core/src/index.js'
import * as base from '../mods/base/index.js'

const $ = (sel) => document.querySelector(sel)
const logEl = $('#log')
const summaryEl = $('#summary')
const yearEl = $('#year')
const startBtn = $('#start')
const seedEl = $('#seed')

let runtime = null
let rendered = 0
let timer = null

function appendLine(year, text, cls = '') {
  const div = document.createElement('div')
  div.className = `line ${cls}`.trim()
  const n = document.createElement('span')
  n.className = 'n'
  n.textContent = year ? `#${year}` : ''
  const t = document.createElement('span')
  t.textContent = text
  div.append(n, t)
  logEl.append(div)
  logEl.scrollTop = logEl.scrollHeight
}

function showSummary(payload) {
  summaryEl.hidden = false
  summaryEl.replaceChildren()
  const h = document.createElement('h2')
  h.textContent = '结算'
  const p = document.createElement('p')
  p.textContent = `结束原因：${payload.reason}　共 ${payload.years} 年`
  summaryEl.append(h, p)
}

function renderNewEvents() {
  const events = runtime.events
  for (; rendered < events.length; rendered++) {
    const e = events[rendered]
    if (e.kind === 'log') appendLine(e.year, e.text)
    else if (e.kind === 'stat') appendLine(e.year, e.payload?.text ?? '', 'stat')
    else if (e.kind === 'core:error') appendLine(e.year, `[mod ${e.modId}] ${e.payload.message}`, 'err')
    else if (e.kind === 'summary') showSummary(e.payload)
  }
}

function stop() {
  if (timer) clearTimeout(timer)
  timer = null
  startBtn.disabled = false
}

async function tick() {
  if (!runtime || runtime.ended) return stop()
  await runtime.advance()
  yearEl.textContent = runtime.year
  renderNewEvents()
  if (runtime.ended) return stop()
  timer = setTimeout(tick, 140)
}

startBtn.addEventListener('click', () => {
  if (timer) clearTimeout(timer)
  logEl.replaceChildren()
  summaryEl.hidden = true
  summaryEl.replaceChildren()
  rendered = 0
  yearEl.textContent = '0'
  startBtn.disabled = true
  const seed = seedEl.value.trim() || 'life'
  runtime = createRuntime({ mods: [base], seed })
  tick()
})
