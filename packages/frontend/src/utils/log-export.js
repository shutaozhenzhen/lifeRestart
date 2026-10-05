/**
 * log-export — 「复制到剪贴板 / 下载为文件」（注入式，可测试）
 *
 * 谁在用：日志悬浮窗（复制/下载日志报告）、模拟统计页（导出 CSV/JSON/MD）、
 * Mod 管理页与 Mod 数据详情页（导出 Mod 为 zip → `downloadBytes` + application/zip）。
 *
 * 背景：
 *   悬浮窗要支持「一键复制」和「下载 txt」，但浏览器 API
 *   （navigator.clipboard / document / URL.createObjectURL / Blob）
 *   在 Node 测试环境里不存在，直接调用会让测试变成环境探测。
 *
 * 处理：
 *   所有浏览器对象都可通过参数注入，缺省才回退到全局对象；
 *   任一 API 缺失时**返回 false 而不是抛错**——问题报告工具本身必须最稳，
 *   拿不到剪贴板权限时调用方可以提示用户手动选择文本。
 */

// #copyText
// 复制文本到剪贴板：优先 Clipboard API，失败回退 execCommand（http 环境/旧浏览器）。
//
// @param {string} text - 待复制文本
// @param {object} [deps]
// @param {object} [deps.clipboard] - 剪贴板适配器（writeText）
// @param {object} [deps.doc] - document（创建 textarea 回退用）
// @returns {Promise<boolean>} 是否成功
export async function copyText(text, { clipboard, doc } = {}) {
  // 优先 Clipboard API。
  const cb = clipboard || (typeof navigator !== 'undefined' ? navigator.clipboard : null)
  // 存在则尝试。
  if (cb && typeof cb.writeText === 'function') {
    try {
      // 写入。
      await cb.writeText(text)
      // 成功。
      return true
    } catch {
      // 失败（多为非 HTTPS 或权限被拒）→ 继续走回退路径。
    }
  }
  // 回退：临时 textarea + execCommand('copy')。
  const d = doc || (typeof document !== 'undefined' ? document : null)
  // 没有 document 或 execCommand：无法复制。
  if (!d || !d.body || typeof d.execCommand !== 'function' || typeof d.createElement !== 'function') {
    return false
  }
  // 尝试回退。
  try {
    // 创建 textarea。
    const area = d.createElement('textarea')
    // 写入内容。
    area.value = text
    // 只读 + 不可见（避免页面滚动跳动）。
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    // 入文档才能选中。
    d.body.appendChild(area)
    // 选中。
    area.select()
    // 执行复制。
    const ok = d.execCommand('copy')
    // 清理。
    d.body.removeChild(area)
    // 返回结果（execCommand 返回布尔）。
    return !!ok
  } catch {
    // 任何异常都视为失败。
    return false
  }
}

// #downloadBytes
// 把字节下载为文件（Blob + `<a download>`）—— 文本与 zip 共用的唯一实现。
//
// @param {Uint8Array|ArrayBuffer|Array|string} bytes - 文件内容
// @param {string} fileName - 文件名
// @param {object} [deps]
// @param {string} [deps.mime] - MIME 类型（缺省 text/plain;charset=utf-8）
// @param {object} [deps.doc] - document
// @param {object} [deps.urlApi] - URL（createObjectURL/revokeObjectURL）
// @param {Function} [deps.BlobCtor] - Blob 构造函数
// @returns {boolean} 是否触发下载
export function downloadBytes(bytes, fileName, { mime = 'text/plain;charset=utf-8', doc, urlApi, BlobCtor } = {}) {
  // 取依赖（缺省回退全局）。
  const d = doc || (typeof document !== 'undefined' ? document : null)
  const url = urlApi || (typeof URL !== 'undefined' ? URL : null)
  const BlobImpl = BlobCtor || (typeof Blob !== 'undefined' ? Blob : null)
  // 依赖不全：直接失败（调用方可提示用户手动复制）。
  if (!d || !d.body || typeof d.createElement !== 'function' || !url || typeof url.createObjectURL !== 'function' || !BlobImpl) {
    return false
  }
  // 对象 URL。
  let objectUrl = null
  // 尝试。
  try {
    // Blob（文本带 charset，Windows 记事本打开不乱码；zip 用 application/zip）。
    const blob = new BlobImpl([bytes], { type: mime })
    // 生成对象 URL。
    objectUrl = url.createObjectURL(blob)
    // 隐藏锚点。
    const a = d.createElement('a')
    // 指向对象 URL。
    a.href = objectUrl
    // 下载文件名。
    a.download = fileName
    // 不可见。
    a.style.display = 'none'
    // 入文档。
    d.body.appendChild(a)
    // 触发点击。
    a.click()
    // 清理锚点。
    d.body.removeChild(a)
    // 延迟释放对象 URL：立即释放会让部分浏览器来不及开始下载。
    const revoke = () => {
      // 有 revokeObjectURL 才调用。
      if (objectUrl && typeof url.revokeObjectURL === 'function') url.revokeObjectURL(objectUrl)
    }
    // 有定时器则延迟，否则立即。
    if (typeof setTimeout === 'function') setTimeout(revoke, 1000)
    else revoke()
    // 成功。
    return true
  } catch {
    // 失败。
    return false
  }
}

// #downloadText
// 把文本下载为文件（Blob + <a download>）。
//
// @param {string} text - 文件内容
// @param {string} fileName - 文件名
// @param {object} [deps] - 同 downloadBytes（doc / urlApi / BlobCtor）
// @returns {boolean} 是否触发下载
export function downloadText(text, fileName, deps) {
  // 走字节版（唯一实现）：字符串按 UTF-8 文本处理。
  return downloadBytes(text, fileName, { ...(deps || {}), mime: 'text/plain;charset=utf-8' })
}
