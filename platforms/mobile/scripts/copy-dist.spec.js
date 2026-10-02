/**
 * copy-dist.js 单测（Step 25）
 *
 * 覆盖点（都对应真实踩过的坑）：
 *   1. 产物完整性判据 —— 缺 data/age.json 的残缺产物绝不能当成"可复用"，否则打进 APK 就是白屏
 *   2. 复用已有产物 —— CI 已经先跑过 `pnpm --filter frontend build`，这里不该再建一遍
 *   3. 产物缺失/--rebuild —— 必须自己构建，且构建后仍残缺时**抛错**（不静默复制）
 *   4. www/ 先清空 —— 上一轮残留文件不能被带进新的 APK
 */

// 测试框架。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// 文件系统（造临时目录与假产物）。
import fs from 'node:fs/promises'
// 临时目录。
import os from 'node:os'
// 路径。
import path from 'node:path'
// 被测对象。
import { isDistReady, shouldBuildFrontend, syncDist, REQUIRED_DIST_FILES } from './copy-dist.js'

// 每个用例独立的临时根目录。
let tmp

// 建临时目录。
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-copy-'))
})

// 清理（避免污染系统临时目录）。
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

// #writeDist
// 造一份「完整」的前端产物（index.html + data/age.json）。
async function writeDist(dist) {
  await fs.mkdir(path.join(dist, 'data'), { recursive: true })
  await fs.writeFile(path.join(dist, 'index.html'), '<div id="app"></div>')
  await fs.writeFile(path.join(dist, 'data', 'age.json'), '[]')
}

// #exists
// 文件是否存在（断言辅助）。
async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

describe('shouldBuildFrontend（是否构建前端）', () => {
  it('产物缺失时构建', () => {
    expect(shouldBuildFrontend({ distReady: false })).toBe(true)
  })

  it('产物完整时复用（不构建）', () => {
    expect(shouldBuildFrontend({ distReady: true })).toBe(false)
  })

  it('显式 --rebuild 时即使产物完整也构建', () => {
    expect(shouldBuildFrontend({ distReady: true, forceRebuild: true })).toBe(true)
  })
})

describe('isDistReady（产物完整性）', () => {
  it('必备文件齐全 → 可复用', async () => {
    const dist = path.join(tmp, 'dist')
    await writeDist(dist)
    expect(await isDistReady(dist)).toBe(true)
  })

  it('目录不存在 → 不可复用', async () => {
    expect(await isDistReady(path.join(tmp, 'nope'))).toBe(false)
  })

  it('有 index.html 但缺数据文件 → 不可复用（防止白屏产物进 APK）', async () => {
    const dist = path.join(tmp, 'dist')
    await fs.mkdir(dist, { recursive: true })
    await fs.writeFile(path.join(dist, 'index.html'), '<div id="app"></div>')
    expect(await isDistReady(dist)).toBe(false)
  })

  it('判据与 REQUIRED_DIST_FILES 一致（改动判据必须同步）', () => {
    expect(REQUIRED_DIST_FILES).toContain('index.html')
    expect(REQUIRED_DIST_FILES).toContain('data/age.json')
  })
})

describe('syncDist（同步到 www）', () => {
  it('产物已完整：复用且不调用构建函数', async () => {
    // 前端目录 + 完整产物。
    const frontend = path.join(tmp, 'frontend')
    await writeDist(path.join(frontend, 'dist'))
    // 目标目录。
    const www = path.join(tmp, 'www')
    // 构建函数一旦被调用就让用例失败（复用场景不该构建）。
    let buildCalls = 0
    const build = async () => {
      buildCalls += 1
    }
    // 日志收集（断言提示语）。
    const logs = []
    // 执行。
    const result = await syncDist({ frontend, www, build, log: (m) => logs.push(m) })
    // 断言：没构建、结果标记为复用。
    expect(buildCalls).toBe(0)
    expect(result.built).toBe(false)
    // 断言：文件确实复制过去了。
    expect(await exists(path.join(www, 'index.html'))).toBe(true)
    expect(await exists(path.join(www, 'data', 'age.json'))).toBe(true)
    // 断言：提示语说明是复用。
    expect(logs.some((m) => m.includes('复用已有前端产物'))).toBe(true)
  })

  it('产物缺失：调用构建并复制新产物', async () => {
    // 前端目录存在但没有 dist。
    const frontend = path.join(tmp, 'frontend')
    await fs.mkdir(frontend, { recursive: true })
    // 目标目录。
    const www = path.join(tmp, 'www')
    // 假构建：产出完整产物。
    let buildCalls = 0
    const build = async () => {
      buildCalls += 1
      await writeDist(path.join(frontend, 'dist'))
    }
    // 执行。
    const result = await syncDist({ frontend, www, build, log: () => {} })
    // 断言：构建了一次，且标记为 built。
    expect(buildCalls).toBe(1)
    expect(result.built).toBe(true)
    // 断言：新产物到位。
    expect(await exists(path.join(www, 'data', 'age.json'))).toBe(true)
  })

  it('--rebuild：产物完整也强制构建', async () => {
    // 完整产物。
    const frontend = path.join(tmp, 'frontend')
    await writeDist(path.join(frontend, 'dist'))
    // 目标。
    const www = path.join(tmp, 'www')
    // 构建计数。
    let buildCalls = 0
    const build = async () => {
      buildCalls += 1
    }
    // 执行（forceRebuild）。
    const result = await syncDist({ frontend, www, forceRebuild: true, build, log: () => {} })
    // 断言：确实重新构建了。
    expect(buildCalls).toBe(1)
    expect(result.built).toBe(true)
  })

  it('构建后产物仍残缺 → 抛错（不静默复制白屏产物）', async () => {
    // 前端目录存在，构建函数什么也不产出。
    const frontend = path.join(tmp, 'frontend')
    await fs.mkdir(frontend, { recursive: true })
    // 目标。
    const www = path.join(tmp, 'www')
    // 执行 + 断言报错文案（要能看出缺什么）。
    await expect(syncDist({ frontend, www, build: async () => {}, log: () => {} })).rejects.toThrow(/产物仍不完整/)
  })

  it('复制前清空 www（上一轮残留不进入新产物）', async () => {
    // 完整产物。
    const frontend = path.join(tmp, 'frontend')
    await writeDist(path.join(frontend, 'dist'))
    // 目标目录里先放一个"上一轮残留"。
    const www = path.join(tmp, 'www')
    await fs.mkdir(www, { recursive: true })
    await fs.writeFile(path.join(www, 'stale.js'), '// 旧版本残留')
    // 执行。
    await syncDist({ frontend, www, build: async () => {}, log: () => {} })
    // 断言：残留文件已被删除。
    expect(await exists(path.join(www, 'stale.js'))).toBe(false)
    // 断言：新产物在。
    expect(await exists(path.join(www, 'index.html'))).toBe(true)
  })
})
