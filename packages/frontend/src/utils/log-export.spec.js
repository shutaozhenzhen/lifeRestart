/**
 * log-export 单元测试 — 复制 / 下载（注入式依赖）
 *
 * 覆盖：
 *   1. copyText：Clipboard API 成功；被拒后回退 execCommand；两者都不可用返回 false
 *   2. downloadText：Blob + 锚点点击 + 延迟释放对象 URL；依赖缺失返回 false
 */

// 导入 vitest DSL。
import { describe, test, expect, vi, afterEach } from 'vitest'
// 被测模块。
import { copyText, downloadText } from './log-export.js'

// #makeDoc
// 造一个最小 document 替身（记录创建的元素与 body 增删）。
function makeDoc() {
  // 已创建元素。
  const created = []
  // body 替身。
  const body = {
    // 子元素。
    children: [],
    // 追加。
    appendChild(el) { this.children.push(el) },
    // 移除。
    removeChild(el) { this.children = this.children.filter(c => c !== el) },
  }
  // document 替身。
  return {
    body,
    created,
    // execCommand 返回值开关（测试里改）。
    execOk: true,
    // 最近一次 execCommand 参数。
    lastExec: null,
    // execCommand 替身。
    execCommand(cmd) { this.lastExec = cmd; return this.execOk },
    // 元素替身。
    createElement(tag) {
      // 元素。
      const el = {
        tag,
        style: {},
        // 属性记录。
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v },
        select() { el.selected = true },
        click() { el.clicked = true },
      }
      // 记录。
      created.push(el)
      // 返回。
      return el
    },
  }
}

// 每个用例后恢复真实定时器。
afterEach(() => {
  // 恢复。
  vi.useRealTimers()
})

describe('log-export - copyText', () => {
  test('uses Clipboard API when available', async () => {
    // 注入可用的剪贴板。
    const writeText = vi.fn().mockResolvedValue(undefined)
    // 复制。
    const ok = await copyText('hello', { clipboard: { writeText } })
    // 成功且内容正确。
    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  test('falls back to execCommand when Clipboard API rejects', async () => {
    // 剪贴板被拒（非 HTTPS / 权限不足）。
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    // document 替身。
    const doc = makeDoc()
    // 复制。
    const ok = await copyText('fallback-text', { clipboard: { writeText }, doc })
    // 回退成功。
    expect(ok).toBe(true)
    // 走了 execCommand('copy')。
    expect(doc.lastExec).toBe('copy')
    // textarea 内容正确、被选中、且已清理出 body。
    expect(doc.created[0].value).toBe('fallback-text')
    expect(doc.created[0].selected).toBe(true)
    expect(doc.body.children.length).toBe(0)
  })

  test('returns false when both paths unavailable', async () => {
    // 只有会失败的剪贴板。
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    // 无 doc。
    const ok = await copyText('x', { clipboard: { writeText }, doc: null })
    // 失败（由调用方提示手动选择）。
    expect(ok).toBe(false)
  })

  test('returns false when execCommand reports failure', async () => {
    // document 替身：execCommand 返回 false。
    const doc = makeDoc()
    doc.execOk = false
    // 无剪贴板。
    const ok = await copyText('x', { clipboard: null, doc })
    // 失败。
    expect(ok).toBe(false)
  })
})

describe('log-export - downloadText', () => {
  test('creates blob link, clicks it and revokes url later', () => {
    // 假定时器（验证延迟释放）。
    vi.useFakeTimers()
    // document 替身。
    const doc = makeDoc()
    // URL 替身。
    const urlApi = { createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() }
    // Blob 替身。
    const BlobCtor = class {
      constructor(parts, options) { this.parts = parts; this.options = options }
    }
    // 下载。
    const ok = downloadText('report-body', 'liferestart-log.txt', { doc, urlApi, BlobCtor })
    // 成功。
    expect(ok).toBe(true)
    // 生成了对象 URL。
    expect(urlApi.createObjectURL).toHaveBeenCalledTimes(1)
    // 锚点属性与点击。
    const anchor = doc.created[0]
    expect(anchor.tag).toBe('a')
    expect(anchor.href).toBe('blob:fake')
    expect(anchor.download).toBe('liferestart-log.txt')
    expect(anchor.clicked).toBe(true)
    // 锚点已清理。
    expect(doc.body.children.length).toBe(0)
    // 尚未释放（延迟 1s）。
    expect(urlApi.revokeObjectURL).not.toHaveBeenCalled()
    // 推进定时器。
    vi.advanceTimersByTime(1000)
    // 已释放。
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  test('returns false when Blob is unavailable', () => {
    // Node 24 自带全局 Blob，需临时移除才能模拟"浏览器不支持 Blob"。
    const savedBlob = globalThis.Blob
    delete globalThis.Blob
    try {
      // 有 document / URL，但无 Blob（全局也没有）。
      const ok = downloadText('x', 'a.txt', { doc: makeDoc(), urlApi: { createObjectURL: () => 'blob:x' } })
      // 失败。
      expect(ok).toBe(false)
    } finally {
      // 恢复全局，避免影响其它用例。
      globalThis.Blob = savedBlob
    }
  })

  test('returns false when document is unavailable', () => {
    // 无 document。
    const ok = downloadText('x', 'a.txt', { doc: null, urlApi: { createObjectURL: () => 'blob:x' }, BlobCtor: class {} })
    // 失败。
    expect(ok).toBe(false)
  })
})
