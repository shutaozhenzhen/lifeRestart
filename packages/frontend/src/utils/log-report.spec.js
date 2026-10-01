/**
 * log-report 单元测试 — 日志格式化与问题报告构建
 *
 * 覆盖：
 *   1. formatLogLine（时间戳 + 级别格式）
 *   2. countByLevel（级别统计 + 无级别行只计总数）
 *   3. formatDateTime / buildLogFileName（导出时间与文件名）
 *   4. collectLogMeta（注入 location/navigator/screen 的环境采集 + 缺失降级）
 *   5. buildLogReport（头部字段、日志顺序、空日志、缺字段降级）
 */

// 导入 vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import {
  formatLogLine,
  countByLevel,
  formatDateTime,
  buildLogFileName,
  collectLogMeta,
  buildLogReport,
} from './log-report.js'

// 固定时间（本地时区解析；断言只依赖「同一 Date 的本地字段」）。
const FIXED = new Date(2026, 9, 1, 9, 5, 3, 7) // 2026-10-01 09:05:03.007

describe('log-report - formatLogLine', () => {
  test('formats time and level', () => {
    // 时间补零 + 级别大写。
    expect(formatLogLine('info', 'hello', FIXED)).toBe('[09:05:03.007] [INFO] hello')
  })

  test('keeps message as-is', () => {
    // 消息里的方括号（如 [UI][home]）原样保留，不参与级别解析。
    expect(formatLogLine('warn', '[UI][home] x', FIXED)).toBe('[09:05:03.007] [WARN] [UI][home] x')
  })
})

describe('log-report - countByLevel', () => {
  test('counts each level and total', () => {
    // 混合日志（含一条没有级别的原始行）。
    const counts = countByLevel([
      '[09:00:00.000] [INFO] a',
      '[09:00:00.001] [ERROR] b',
      '[09:00:00.002] [ERROR] c',
      '[09:00:00.003] [WARN] d',
      'raw line without level',
    ])
    // 逐项断言。
    expect(counts.error).toBe(2)
    expect(counts.warn).toBe(1)
    expect(counts.info).toBe(1)
    expect(counts.trace).toBe(0)
    expect(counts.debug).toBe(0)
    // 无级别行只计入总数。
    expect(counts.total).toBe(5)
  })

  test('tolerates empty/missing input', () => {
    // 空数组。
    expect(countByLevel([]).total).toBe(0)
    // undefined 不抛。
    expect(countByLevel(undefined).total).toBe(0)
  })
})

describe('log-report - 时间与文件名', () => {
  test('formatDateTime includes date, time and timezone offset', () => {
    // 文本。
    const text = formatDateTime(FIXED)
    // 日期时间部分。
    expect(text.startsWith('2026-10-01 09:05:03 (')).toBe(true)
    // 时区偏移格式 ±HH:MM。
    expect(/\(\+|-?\d{2}:\d{2}\)$/.test(text)).toBe(true)
  })

  test('buildLogFileName is sortable and descriptive', () => {
    // 文件名。
    expect(buildLogFileName(FIXED)).toBe('liferestart-log-20261001-090503.txt')
  })
})

describe('log-report - collectLogMeta', () => {
  test('collects injected environment', () => {
    // 注入三个环境对象。
    const meta = collectLogMeta({
      location: { href: 'https://example.com/app/#/property', hash: '#/property', pathname: '/app/' },
      navigatorLike: { userAgent: 'UA/1.0' },
      screenLike: { width: 1280, height: 720 },
      devicePixelRatio: 2,
    })
    // 逐项断言。
    expect(meta.pageUrl).toBe('https://example.com/app/#/property')
    expect(meta.route).toBe('/property')
    expect(meta.userAgent).toBe('UA/1.0')
    expect(meta.viewport).toBe('1280x720 @2dppx')
  })

  test('falls back to pathname when no hash route', () => {
    // 无 hash。
    const meta = collectLogMeta({ location: { href: 'https://x/y', hash: '', pathname: '/y' } })
    // 退化到 pathname。
    expect(meta.route).toBe('/y')
  })

  test('degrades to null without browser globals', () => {
    // Node 环境（什么都不注入）：必须是 null 而不是抛错。
    const meta = collectLogMeta()
    // 全空。
    expect(meta).toEqual({ pageUrl: null, route: null, userAgent: null, viewport: null })
  })

  test('viewport omits dpr when unavailable', () => {
    // 无 dpr。
    const meta = collectLogMeta({ screenLike: { width: 800, height: 600 } })
    // 只有尺寸。
    expect(meta.viewport).toBe('800x600')
  })
})

describe('log-report - buildLogReport', () => {
  test('includes header fields, counts and all logs in order', () => {
    // 报告。
    const report = buildLogReport({
      logs: ['[09:00:00.000] [INFO] 第一条', '[09:00:01.000] [ERROR] 第二条'],
      meta: {
        level: 'trace',
        pageUrl: 'https://example.com/#/game',
        route: '/game',
        userAgent: 'UA/1.0',
        viewport: '1280x720',
        game: 'initialized=true',
        dataSource: 'lifeRestart-data',
        mods: 'ai-mod=off',
      },
      now: FIXED,
    })
    // 头部关键字段。
    expect(report).toContain('导出时间 : 2026-10-01 09:05:03')
    expect(report).toContain('日志级别 : trace')
    expect(report).toContain('日志条数 : 2（error 1 / warn 0')
    expect(report).toContain('当前路由 : /game')
    expect(report).toContain('数据源   : lifeRestart-data')
    // 日志正文按原顺序。
    expect(report.indexOf('第一条')).toBeLessThan(report.indexOf('第二条'))
    // 完整的起止标记。
    expect(report).toContain('===== 日志开始（最旧 → 最新） =====')
    expect(report).toContain('===== 日志结束 =====')
  })

  test('marks empty logs and missing fields', () => {
    // 空日志 + 空 meta。
    const report = buildLogReport({ logs: [], meta: {}, now: FIXED })
    // 空日志有提示（报告看起来不会像被截断）。
    expect(report).toContain('（暂无日志）')
    // 缺字段降级。
    expect(report).toContain('页面地址 : （未知）')
    expect(report).toContain('运行环境 : （未知）')
  })

  test('never throws without arguments', () => {
    // 无参调用（防御）。
    expect(() => buildLogReport()).not.toThrow()
    // 也能产出可读文本。
    expect(buildLogReport()).toContain('===== 人生重开模拟器 日志报告 =====')
  })
})
