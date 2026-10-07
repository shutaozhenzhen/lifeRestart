/**
 * asset-text 单测 —— 轨迹文本里的受控资源占位符 `{{asset:相对路径}}`
 *
 * 这是**纯函数**模块（不碰 DOM、不做 IO），所以覆盖的是"切分边界"：
 *   · 正常文本原样返回；空串/非字符串给空数组；
 *   · 一个字符串里多个占位符（含相邻、含开头/结尾）；
 *   · **严格**拒绝：`..`、绝对路径、反斜杠、`http:`/`data:`、空路径、
 *     大小写不匹配（`{{Asset:`）、缺花括号 —— 一律**原样当文本**；
 *   · 片段拼起来必须等于输入（不丢字符、不重复）。
 */
import { describe, test, expect } from 'vitest'
// 被测模块。
import { collectAssetPaths, hasAssetPlaceholder, isSafeAssetPath, resolveAssetText, splitAssetText } from './asset-text.js'

// #textsOf
// 取片段里的文本部分（便于断言"原样文本"）。
//
// @param {Array<object>} parts - 片段
// @returns {string[]} 文本数组
function textsOf(parts) {
  // 收集。
  return parts.filter((p) => p.type === 'text').map((p) => p.text)
}

describe('asset-text - 切分边界', () => {
  test('空串与非字符串 → 空数组', () => {
    // 空。
    expect(splitAssetText('')).toEqual([])
    // 非字符串（调用方常见：description 可能是 undefined）。
    expect(splitAssetText(undefined)).toEqual([])
    expect(splitAssetText(null)).toEqual([])
    expect(splitAssetText(123)).toEqual([])
    expect(splitAssetText({})).toEqual([])
  })

  test('普通文本原样返回（单个文本片段）', () => {
    // 无占位符。
    expect(splitAssetText('你在路边捡到一枚硬币。')).toEqual([{ type: 'text', text: '你在路边捡到一枚硬币。' }])
    // 只像一半的写法也当文本。
    expect(splitAssetText('{{asset}}')).toEqual([{ type: 'text', text: '{{asset}}' }])
    expect(splitAssetText('{asset:x.png}')).toEqual([{ type: 'text', text: '{asset:x.png}' }])
  })

  test('单个占位符：文本 + 资源 + 文本', () => {
    // 切分。
    const parts = splitAssetText('你翻出了照片 {{asset:assets/logo.png}}，上面画着海边。')
    // 三段。
    expect(parts).toEqual([
      { type: 'text', text: '你翻出了照片 ' },
      { type: 'asset', path: 'assets/logo.png' },
      { type: 'text', text: '，上面画着海边。' },
    ])
    // 拼回去等于原文（不丢字符）。
    expect(parts.map((p) => (p.type === 'text' ? p.text : `{{asset:${p.path}}}`)).join('')).toBe('你翻出了照片 {{asset:assets/logo.png}}，上面画着海边。')
  })

  test('多个占位符：相邻、开头、结尾都支持', () => {
    // 两个相邻。
    expect(splitAssetText('{{asset:a.png}}{{asset:b.png}}')).toEqual([
      { type: 'asset', path: 'a.png' },
      { type: 'asset', path: 'b.png' },
    ])
    // 开头 + 结尾。
    expect(splitAssetText('{{asset:a.png}}中间{{asset:b.ogg}}')).toEqual([
      { type: 'asset', path: 'a.png' },
      { type: 'text', text: '中间' },
      { type: 'asset', path: 'b.ogg' },
    ])
    // 三个（夹两个文本）。
    const three = splitAssetText('x{{asset:1.png}}y{{asset:2.png}}z{{asset:3.png}}')
    expect(three.filter((p) => p.type === 'asset').map((p) => p.path)).toEqual(['1.png', '2.png', '3.png'])
    expect(textsOf(three)).toEqual(['x', 'y', 'z'])
  })

  test('大小写与空格敏感：写法不标准就原样当文本（不猜、不宽容）', () => {
    // 大写 Asset 不认。
    expect(splitAssetText('{{Asset:a.png}}')).toEqual([{ type: 'text', text: '{{Asset:a.png}}' }])
    // 冒号后有空格不认。
    expect(splitAssetText('{{asset: a.png}}')).toEqual([{ type: 'text', text: '{{asset: a.png}}' }])
    // 三个花括号不认。
    expect(splitAssetText('{{{asset:a.png}}}')).toEqual([{ type: 'text', text: '{{{asset:a.png}}}' }])
  })

  test('非法路径一律原样当文本（XSS 与穿越的边界）', () => {
    // 逐个必须"完全没有资源片段"。
    const bads = [
      '{{asset:../evil.png}}',
      '{{asset:a/../../evil.png}}',
      '{{asset:/etc/passwd}}',
      '{{asset:C:/x.png}}',
      '{{asset:a\\b.png}}',
      '{{asset:http://evil.com/x.png}}',
      '{{asset:data:text/html,<script>}}',
      '{{asset:javascript:alert(1)}}',
      '{{asset:}}',
      '{{asset:.}}',
      '{{asset:..}}',
      '{{asset:a/./b.png}}',
    ]
    // 逐个。
    for (const input of bads) {
      // 切分。
      const parts = splitAssetText(input)
      // 没有资源片段。
      expect(parts.some((p) => p.type === 'asset'), `${input} 不该被当成资源`).toBe(false)
      // 整段原样是文本。
      expect(parts).toEqual([{ type: 'text', text: input }])
    }
  })

  test('路径字符集：允许字母数字下划线连字符点与斜杠，必须首字符是字母数字或下划线', () => {
    // 允许。
    expect(splitAssetText('{{asset:a/b/c_1-2.png}}')[0]).toEqual({ type: 'asset', path: 'a/b/c_1-2.png' })
    expect(splitAssetText('{{asset:.hidden.svg}}')).toEqual([{ type: 'text', text: '{{asset:.hidden.svg}}' }])   // 首字符是点 → 不认
    // 点开头的非隐藏文件写法用路径形式即可。
    expect(splitAssetText('{{asset:a/.hidden.svg}}')[0]).toEqual({ type: 'asset', path: 'a/.hidden.svg' })
  })

  test('hasAssetPlaceholder：有/没有两种情形', () => {
    // 有。
    expect(hasAssetPlaceholder('看 {{asset:a.png}}')).toBe(true)
    // 没有（含非法写法）。
    expect(hasAssetPlaceholder('看 {{asset:../a.png}}')).toBe(false)
    expect(hasAssetPlaceholder('普通文本')).toBe(false)
    expect(hasAssetPlaceholder('')).toBe(false)
  })
})

describe('asset-text - 路径校验与引擎侧同规则', () => {
  test('isSafeAssetPath 的判定与 asset-bridge 一致（同一组样本）', () => {
    // 同一组样本必须给出同样的结论（两份规则分叉 = "正则放进来、引擎读不到"）。
    const samples = {
      'icon.png': true,
      'assets/a/b.png': true,
      'assets/..hidden.png': true,
      '../evil.png': false,
      'a/../../evil.png': false,
      'a/./b.png': false,
      '/etc/passwd': false,
      'C:/x.png': false,
      'a\\b.png': false,
      '': false,
      'a//b.png': false,
      '..': false,
      '.': false,
    }
    // 逐个。
    for (const [path, expected] of Object.entries(samples)) {
      // 断言。
      expect(isSafeAssetPath(path), `${JSON.stringify(path)} 判定不对`).toBe(expected)
    }
  })
})

describe('asset-text - collectAssetPaths', () => {
  test('从嵌套结构里收集去重、保持出现顺序', () => {
    // 嵌套轨迹（与 store.history 同形）。
    const history = [
      { age: 30, items: [{ description: '照片 {{asset:assets/logo.png}}' }, { description: '再来一张 {{asset:assets/logo.png}}' }] },
      { age: 31, items: [{ description: '两首曲子 {{asset:a.ogg}} 和 {{asset:b.ogg}}' }, { description: '纯文本' }] },
    ]
    // 收集（重复的只出现一次，顺序 = 首次出现顺序）。
    expect(collectAssetPaths(history)).toEqual(['assets/logo.png', 'a.ogg', 'b.ogg'])
    // 空输入。
    expect(collectAssetPaths(null)).toEqual([])
    expect(collectAssetPaths([])).toEqual([])
    expect(collectAssetPaths('没有占位符')).toEqual([])
    // 非法路径不算。
    expect(collectAssetPaths('{{asset:../x.png}}')).toEqual([])
  })
})

describe('asset-text - resolveAssetText（资源缺失时的降级）', () => {
  test('拿到 URL 的片段带 url；拿不到的 url 为 null（且不抛）', () => {
    // 解析（只有 a.png 有 URL）。
    const parts = resolveAssetText('x {{asset:a.png}} y {{asset:b.png}}', {
      getUrl: (path) => (path === 'a.png' ? 'blob:fake/1' : null),
    })
    // 三段。
    expect(parts).toEqual([
      { type: 'text', text: 'x ' },
      { type: 'asset', path: 'a.png', url: 'blob:fake/1' },
      { type: 'text', text: ' y ' },
      { type: 'asset', path: 'b.png', url: null },
    ])
  })

  test('getUrl 缺失 / 抛错 / 返回非字符串 → 一律 null（不炸页面）', () => {
    // 没有 getUrl。
    expect(resolveAssetText('{{asset:a.png}}')).toEqual([{ type: 'asset', path: 'a.png', url: null }])
    // getUrl 抛错。
    expect(resolveAssetText('{{asset:a.png}}', { getUrl: () => { throw new Error('boom') } })).toEqual([{ type: 'asset', path: 'a.png', url: null }])
    // 返回非字符串。
    expect(resolveAssetText('{{asset:a.png}}', { getUrl: () => 123 })).toEqual([{ type: 'asset', path: 'a.png', url: null }])
  })

  test('纯文本走原样（页面不必为"没有资源"多分支）', () => {
    // 文本。
    expect(resolveAssetText('平安无事', { getUrl: () => 'blob:x' })).toEqual([{ type: 'text', text: '平安无事' }])
    // 空。
    expect(resolveAssetText('')).toEqual([])
  })
})
