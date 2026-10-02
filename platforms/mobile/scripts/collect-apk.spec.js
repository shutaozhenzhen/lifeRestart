/**
 * collect-apk.js 单测（Step 25）
 *
 * 这个脚本的存在本身就是为了修一个真实事故：
 *   upload-artifact v4 以「通配符之前的前缀」为压缩根 → 上传 `apk/**\/*.apk` 解包后多一层 debug/，
 *   下游用平铺的 `artifacts/*.apk` 就匹配不到 → release 里没有 APK（job 还全绿）。
 * 所以这里必须钉住：**递归查找**、**固定目标文件名**、找不到就**抛错**。
 */

// 测试框架。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// 文件系统。
import fs from 'node:fs/promises'
// 临时目录。
import os from 'node:os'
// 路径。
import path from 'node:path'
// 被测对象。
import { findApk, collectApk, APK_NAME } from './collect-apk.js'

// 每个用例独立的临时根目录。
let tmp

// 建临时目录。
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-apk-'))
})

// 清理。
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

// #writeFile
// 写一个文件（自动建父目录）。
async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

describe('findApk（递归查找 APK）', () => {
  it('APK 在子目录里也能找到（Gradle 的真实布局是 debug/app-debug.apk）', async () => {
    // 模拟 Gradle 输出布局。
    const apk = path.join(tmp, 'debug', 'app-debug.apk')
    await writeFile(apk, 'APK')
    // 断言：递归下探能找到。
    expect(await findApk(tmp)).toBe(apk)
  })

  it('多层嵌套（apk/debug/x/y.apk）同样能找到', async () => {
    const apk = path.join(tmp, 'debug', 'nested', 'app-debug.apk')
    await writeFile(apk, 'APK')
    expect(await findApk(tmp)).toBe(apk)
  })

  it('忽略非 .apk 文件（如 Gradle 的 output-metadata.json）', async () => {
    await writeFile(path.join(tmp, 'debug', 'output-metadata.json'), '{}')
    expect(await findApk(tmp)).toBe(null)
  })

  it('多个 APK 时结果稳定（按路径排序取第一个，可复现）', async () => {
    // 故意后写 aaa，确保结论来自排序而不是写入顺序。
    const later = path.join(tmp, 'debug', 'zzz.apk')
    const earlier = path.join(tmp, 'aaa.apk')
    await writeFile(later, 'B')
    await writeFile(earlier, 'A')
    // 同层优先：根目录下的 aaa.apk 先被选中。
    expect(await findApk(tmp)).toBe(earlier)
    // 再来一次，结果必须一致。
    expect(await findApk(tmp)).toBe(earlier)
  })

  it('目录不存在 → null（而不是抛错）', async () => {
    expect(await findApk(path.join(tmp, 'never-built'))).toBe(null)
  })

  it('空目录 → null', async () => {
    expect(await findApk(tmp)).toBe(null)
  })

  it('大小写不敏感（.APK）', async () => {
    const apk = path.join(tmp, 'debug', 'APP.APK')
    await writeFile(apk, 'APK')
    expect(await findApk(tmp)).toBe(apk)
  })
})

describe('collectApk（收集到固定路径）', () => {
  it('复制成固定文件名，并返回来源/目标/大小', async () => {
    // 源：Gradle 布局。
    const from = path.join(tmp, 'apk')
    await writeFile(path.join(from, 'debug', 'app-debug.apk'), 'APK-CONTENT')
    // 目标。
    const to = path.join(tmp, 'out')
    // 执行。
    const result = await collectApk({ from, to })
    // 断言：目标文件名固定（release 资源名稳定）。
    expect(result.target).toBe(path.join(to, APK_NAME))
    expect(APK_NAME).toBe('liferestart-mobile-debug.apk')
    // 断言：内容与大小正确（非空）。
    expect(result.size).toBe(Buffer.byteLength('APK-CONTENT'))
    expect(await fs.readFile(result.target, 'utf8')).toBe('APK-CONTENT')
    // 断言：来源指向真实 APK。
    expect(result.source).toBe(path.join(from, 'debug', 'app-debug.apk'))
  })

  it('目标目录不存在时自动创建', async () => {
    const from = path.join(tmp, 'apk')
    await writeFile(path.join(from, 'debug', 'app-debug.apk'), 'X')
    // 目标是一个还不存在的两级目录。
    const to = path.join(tmp, 'out', 'nested')
    const result = await collectApk({ from, to })
    expect(result.target).toBe(path.join(to, APK_NAME))
  })

  it('找不到 APK → 抛错并说明查了哪个目录', async () => {
    const from = path.join(tmp, 'apk')
    await fs.mkdir(from, { recursive: true })
    await expect(collectApk({ from, to: path.join(tmp, 'out') })).rejects.toThrow(/没有找到 APK/)
    // 报错必须带上源目录，便于 CI 里一眼看出问题。
    await expect(collectApk({ from, to: path.join(tmp, 'out') })).rejects.toThrow(from)
  })

  it('APK 是 0 字节 → 抛错（Gradle 可能留下空占位产物）', async () => {
    const from = path.join(tmp, 'apk')
    await writeFile(path.join(from, 'debug', 'app-debug.apk'), '')
    await expect(collectApk({ from, to: path.join(tmp, 'out') })).rejects.toThrow(/空文件/)
  })

  it('重复收集会覆盖上一次的产物（滚动发布不会留下旧 APK）', async () => {
    const from = path.join(tmp, 'apk')
    const apk = path.join(from, 'debug', 'app-debug.apk')
    const to = path.join(tmp, 'out')
    // 第一次。
    await writeFile(apk, 'FIRST')
    await collectApk({ from, to })
    // 第二次（内容变化）。
    await writeFile(apk, 'SECOND-LONGER')
    const result = await collectApk({ from, to })
    // 断言：内容被覆盖。
    expect(await fs.readFile(result.target, 'utf8')).toBe('SECOND-LONGER')
  })
})
