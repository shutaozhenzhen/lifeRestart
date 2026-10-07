/**
 * asset-bridge 单测 —— `gameAPI.asset` 的唯一实现（Mod 包内二进制资源）
 *
 * 为什么单测要这么细：资源链路有四个**静默失败**的经典坑，每一个都只会表现成
 * "图是破的/没声音"，而不会报错：
 *   1. 读不到却返回空字节（表现为 0 字节的破图）→ 这里要求**可读错误**；
 *   2. URL 不缓存（同一张图每帧新建一个 blob URL → 内存疯长）→ 这里要求同路径同 URL；
 *   3. 不 revoke（每个 URL 都把字节钉在内存里 → 长时间游玩后爆内存）→ 这里用假
 *      `URL.createObjectURL/revokeObjectURL` 断言 dispose 真的释放了；
 *   4. 路径穿越（`../../`）→ 这里要求拒绝。
 *
 * 全部 IO 都用注入的替身，**不碰真实网络与文件系统**。
 */
import { describe, test, expect, vi } from 'vitest'
// 被测模块。
import { createAssetBridge, createUnavailableAssetBridge, isSafeAssetPath } from './asset-bridge.js'
// MIME 判定（资源 URL 的 type 依赖它）。
import { getMimeType } from './zip.js'

// #fakeSource
// 造一对注入的 IO 替身（清单 + 字节）。
//
// @param {object} files - { 路径: Uint8Array }
// @returns {{listFiles: Function, readBytes: Function, reads: string[]}} 替身
function fakeSource(files) {
  // 记录读了哪些路径（断言"不预读"与"只读一次"）。
  const reads = []
  // 返回。
  return {
    // 读到的路径记录。
    reads,
    // 清单。
    listFiles: vi.fn(async () => Object.keys(files)),
    // 读字节（不存在 → null，与真实源一致）。
    readBytes: vi.fn(async (_mod, path) => {
      // 记录。
      reads.push(path)
      // 命中。
      return files[path] ?? null
    }),
  }
}

// #fakeUrlApi
// 假的 URL 原语（Node 里没有 createObjectURL，必须注入才能真正测到缓存与释放）。
//
// @returns {object} { createObjectURL, revokeObjectURL, Blob, created, revoked }
function fakeUrlApi() {
  // 造出来的 URL。
  const created = []
  // 释放掉的 URL。
  const revoked = []
  // 自增序号。
  let seq = 0
  // 返回。
  return {
    // 观测点。
    created,
    revoked,
    // Blob：只留下 type 便于断言 MIME（真实 Blob 在 Node 里也有，但这里不需要字节）。
    Blob: class {
      // 构造。
      constructor(parts, opts) {
        // 记下类型。
        this.type = opts?.type
        // 记下字节（便于断言"给的是原始字节"）。
        this.parts = parts
      }
    },
    // 造 URL。
    createObjectURL(blob) {
      // 生成。
      const url = `blob:fake/${++seq}`
      // 记录。
      created.push({ url, type: blob?.type })
      // 返回。
      return url
    },
    // 释放。
    revokeObjectURL(url) {
      // 记录。
      revoked.push(url)
    },
  }
}

describe('asset-bridge - 路径安全', () => {
  test('isSafeAssetPath：放行正常相对路径，拒绝穿越/绝对/反斜杠', () => {
    // 放行。
    expect(isSafeAssetPath('icon.png')).toBe(true)
    expect(isSafeAssetPath('assets/a/b.png')).toBe(true)
    expect(isSafeAssetPath('assets/..hidden.png')).toBe(true)   // 点是文件名的一部分
    expect(isSafeAssetPath('.gitignore')).toBe(true)
    // 拒绝：穿越。
    expect(isSafeAssetPath('../evil.png')).toBe(false)
    expect(isSafeAssetPath('a/../../evil.png')).toBe(false)
    expect(isSafeAssetPath('a/./b.png')).toBe(false)
    expect(isSafeAssetPath('..')).toBe(false)
    expect(isSafeAssetPath('.')).toBe(false)
    // 拒绝：绝对路径。
    expect(isSafeAssetPath('/etc/passwd')).toBe(false)
    expect(isSafeAssetPath('C:/x.png')).toBe(false)
    // 拒绝：反斜杠（Windows 分隔符）。
    expect(isSafeAssetPath('assets\\a.png')).toBe(false)
    // 拒绝：空/非字符串/空段。
    expect(isSafeAssetPath('')).toBe(false)
    expect(isSafeAssetPath(null)).toBe(false)
    expect(isSafeAssetPath('a//b.png')).toBe(false)
    expect(isSafeAssetPath('a/')).toBe(false)
  })

  test('bytes/url/text 对非法路径抛可读错误，且**不发起任何读取**', async () => {
    // 替身。
    const src = fakeSource({ 'icon.png': new Uint8Array([1]) })
    // 桥。
    const bridge = createAssetBridge({ modName: 'm', listFiles: src.listFiles, readBytes: src.readBytes, urlApi: fakeUrlApi() })
    // 三种写法都被挡。
    await expect(bridge.bytes('../x.png')).rejects.toThrow(/资源路径不合法/)
    await expect(bridge.url('/etc/passwd')).rejects.toThrow(/资源路径不合法/)
    await expect(bridge.text('a\\b.png')).rejects.toThrow(/资源路径不合法/)
    // 关键：一次 IO 都没发生（拒绝发生在读之前）。
    expect(src.reads).toEqual([])
    // has 是探测语义 → 给 false 而不是抛。
    expect(await bridge.has('../x.png')).toBe(false)
  })
})

describe('asset-bridge - 清单与读取', () => {
  test('list() 只列资源后缀（数据表与 code.js 不算资源）', async () => {
    // 混合包。
    const src = fakeSource({
      'manifest.json': new Uint8Array([1]),
      'code.js': new Uint8Array([1]),
      'talents.json': new Uint8Array([1]),
      'assets/logo.png': new Uint8Array([2]),
      'assets/bgm.ogg': new Uint8Array([3]),
      'assets/font.woff2': new Uint8Array([4]),
      'assets/readme.txt': new Uint8Array([5]),
    })
    // 桥。
    const bridge = createAssetBridge({ modName: 'm', listFiles: src.listFiles, readBytes: src.readBytes })
    // 可用。
    expect(bridge.available).toBe(true)
    // 只有资源后缀（大小写不敏感也有覆盖，见下）。
    expect(await bridge.list()).toEqual(['assets/logo.png', 'assets/bgm.ogg', 'assets/font.woff2'])
  })

  test('has()：清单里有 → true；没有 → false；清单未知（null）→ false', async () => {
    // 替身。
    const src = fakeSource({ 'assets/logo.png': new Uint8Array([2]) })
    // 桥。
    const bridge = createAssetBridge({ modName: 'm', listFiles: src.listFiles, readBytes: src.readBytes })
    // 命中。
    expect(await bridge.has('assets/logo.png')).toBe(true)
    // 不在清单里（**不做 IO 猜测**：只看清单）。
    expect(await bridge.has('assets/nope.png')).toBe(false)
    // 清单未知。
    const unknown = createAssetBridge({ modName: 'm', listFiles: async () => null, readBytes: src.readBytes })
    expect(await unknown.has('assets/logo.png')).toBe(false)
    expect(await unknown.list()).toEqual([])
  })

  test('bytes() 逐字节返回；读不到给可读错误（不返回空字节）', async () => {
    // 真实字节。
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    // 替身。
    const src = fakeSource({ 'assets/logo.png': png })
    // 桥。
    const bridge = createAssetBridge({ modName: 'my-mod', listFiles: src.listFiles, readBytes: src.readBytes })
    // 逐字节一致。
    const bytes = await bridge.bytes('assets/logo.png')
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect([...bytes]).toEqual([...png])
    // 读不到 → 可读错误（带 Mod 名、路径与"用 list() 看清单"的指引）。
    await expect(bridge.bytes('assets/nope.png')).rejects.toThrow(/my-mod 里没有资源 assets\/nope\.png/)
    await expect(bridge.bytes('assets/nope.png')).rejects.toThrow(/asset\.list\(\)/)
  })

  test('text() 解码 UTF-8（svg 这类既是图片又是文本的资源）', async () => {
    // UTF-8 的 svg 文本。
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    // 替身。
    const src = fakeSource({ 'assets/a.svg': svg })
    // 桥。
    const bridge = createAssetBridge({ modName: 'm', listFiles: src.listFiles, readBytes: src.readBytes })
    // 文本一致。
    expect(await bridge.text('assets/a.svg')).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>')
  })
})

describe('asset-bridge - url()：blob URL、缓存与 dispose', () => {
  test('浏览器形态：blob URL 带正确 MIME，且**同路径同一个 URL**、只读一次字节', async () => {
    // 替身。
    const src = fakeSource({ 'assets/logo.png': new Uint8Array([137, 80, 78, 71]) })
    // 假的 URL 原语。
    const urlApi = fakeUrlApi()
    // 桥。
    const bridge = createAssetBridge({ modName: 'm', listFiles: src.listFiles, readBytes: src.readBytes, urlApi })
    // 两次取同一个路径。
    const u1 = await bridge.url('assets/logo.png')
    const u2 = await bridge.url('assets/logo.png')
    // **同一个 URL**（缓存生效）。
    expect(u1).toBe(u2)
    expect(urlApi.created).toHaveLength(1)
    // 字节只读了一次（缓存命中不重新读）。
    expect(src.reads).toEqual(['assets/logo.png'])
    // MIME 正确（否则 <img> 会拒渲染）。
    expect(urlApi.created[0].type).toBe('image/png')
  })

  test('dispose() 撤销全部 blob URL，且幂等；释放后再读给可读错误', async () => {
    // 替身。
    const src = fakeSource({ 'a.png': new Uint8Array([1]), 'b.ogg': new Uint8Array([2]) })
    // 假 API。
    const urlApi = fakeUrlApi()
    // 桥。
    const bridge = createAssetBridge({ modName: 'm', listFiles: src.listFiles, readBytes: src.readBytes, urlApi })
    // 造两个 URL。
    const ua = await bridge.url('a.png')
    const ub = await bridge.url('b.ogg')
    // 释放。
    const n = bridge.dispose()
    // 两个都撤销了（**不撤销就是内存泄漏**）。
    expect(n).toBe(2)
    expect(urlApi.revoked).toEqual([ua, ub])
    // 幂等。
    expect(bridge.dispose()).toBe(0)
    // 释放后：读操作给可读错误（而不是返回失效 URL / 空字节）。
    await expect(bridge.bytes('a.png')).rejects.toThrow(/已 dispose/)
    await expect(bridge.url('a.png')).rejects.toThrow(/已 dispose/)
    // 探测语义给空。
    expect(await bridge.list()).toEqual([])
    expect(await bridge.has('a.png')).toBe(false)
  })

  test('Node 形态（没有 createObjectURL）：降级为绝对路径，同路径同 URL', async () => {
    // 替身。
    const src = fakeSource({ 'assets/logo.png': new Uint8Array([1]) })
    // 桥（urlApi 显式给一个"没有 createObjectURL"的对象，模拟 Node）。
    const bridge = createAssetBridge({
      modName: 'm',
      listFiles: src.listFiles,
      readBytes: src.readBytes,
      baseDir: 'C:/mods/my-mod',
      urlApi: { Blob: undefined },
    })
    // 绝对路径。
    const u1 = await bridge.url('assets/logo.png')
    expect(u1).toBe('C:/mods/my-mod/assets/logo.png')
    // 同路径同 URL。
    expect(await bridge.url('assets/logo.png')).toBe(u1)
    // 没有 blob，dispose 返回 0（但语义一致：释放后不能再读）。
    expect(bridge.dispose()).toBe(0)
    await expect(bridge.url('assets/logo.png')).rejects.toThrow(/已 dispose/)
  })

  test('url() 对不存在的资源给可读错误（不造一个指向空气的 blob）', async () => {
    // 替身（清单里有，但字节读不到 —— 模拟"清单漏列/文件被删"）。
    const src = { listFiles: async () => ['assets/logo.png'], readBytes: async () => null }
    // 假 API。
    const urlApi = fakeUrlApi()
    // 桥。
    const bridge = createAssetBridge({ modName: 'm', listFiles: src.listFiles, readBytes: src.readBytes, urlApi })
    // 报错且**没有造 URL**。
    await expect(bridge.url('assets/logo.png')).rejects.toThrow(/没有资源/)
    expect(urlApi.created).toEqual([])
  })
})

describe('asset-bridge - 降级（没有资源能力时）', () => {
  test('缺 listFiles / readBytes → available:false、list() 空、其余抛可读错误', async () => {
    // 三种缺法都该降级。
    const a = createAssetBridge({ modName: 'm' })
    const b = createAssetBridge({ modName: 'm', listFiles: async () => [] })
    const c = createAssetBridge({ modName: 'm', readBytes: async () => null })
    // 逐个断言。
    for (const bridge of [a, b, c]) {
      // 不可用。
      expect(bridge.available).toBe(false)
      // 清单空（探测语义不抛）。
      expect(await bridge.list()).toEqual([])
      expect(await bridge.has('a.png')).toBe(false)
      // 读操作明确报错（**静默返回空字节是最难查的问题**）。
      expect(() => bridge.bytes('a.png')).toThrow(/资源能力不可用/)
      expect(() => bridge.url('a.png')).toThrow(/资源能力不可用/)
      expect(() => bridge.text('a.png')).toThrow(/资源能力不可用/)
      // dispose 幂等。
      expect(bridge.dispose()).toBe(0)
    }
    // 错误信息里带上 Mod 名与"先判断 available"的指引。
    expect(() => createUnavailableAssetBridge('cool-mod').bytes('x.png')).toThrow(/cool-mod/)
    expect(() => createUnavailableAssetBridge('cool-mod').bytes('x.png')).toThrow(/available/)
  })
})

describe('asset-bridge - MIME 判定（URL 能不能被浏览器渲染就靠它）', () => {
  test('覆盖任务要求的后缀，未知给 application/octet-stream', () => {
    // 图片。
    expect(getMimeType('a.png')).toBe('image/png')
    expect(getMimeType('a.jpg')).toBe('image/jpeg')
    expect(getMimeType('a.JPEG')).toBe('image/jpeg')      // 大小写不敏感
    expect(getMimeType('a.gif')).toBe('image/gif')
    expect(getMimeType('a.webp')).toBe('image/webp')
    expect(getMimeType('a.svg')).toBe('image/svg+xml')
    // 音频。
    expect(getMimeType('a.mp3')).toBe('audio/mpeg')
    expect(getMimeType('a.ogg')).toBe('audio/ogg')
    expect(getMimeType('a.wav')).toBe('audio/wav')
    // 字体。
    expect(getMimeType('a.woff')).toBe('font/woff')
    expect(getMimeType('a.woff2')).toBe('font/woff2')
    expect(getMimeType('a.ttf')).toBe('font/ttf')
    // 未知 / 无后缀。
    expect(getMimeType('a.xyz')).toBe('application/octet-stream')
    expect(getMimeType('noext')).toBe('application/octet-stream')
    expect(getMimeType('')).toBe('application/octet-stream')
  })
})
