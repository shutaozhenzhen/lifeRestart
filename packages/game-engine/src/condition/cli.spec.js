/**
 * condition 引擎 CLI 单元测试 — cli.spec.js
 *
 * 覆盖范围：19 个测试用例，分为 6 组：
 *   1. 子命令分发（默认 check、未知子命令、help）
 *   2. 属性来源（--props-json、--props-file、互斥、缺属性）
 *   3. check 求值（新语法、旧语法、多条件、条件修改属性）
 *   4. convert 转换（有 -l、无 -l）
 *   5. props 输出
 *   6. 错误处理（非法 JSON、非法 types）
 *
 * 直接调用 runCli() 断言结构化结果，不经过进程，便于精确验证。
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// runCli()：CLI 主逻辑，接受 argv 数组返回结构化结果。
import { runCli } from './cli.js'
// Node 内置：临时文件读写（用于 --props-file 测试）。
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
// Node 内置：临时目录路径。
import { tmpdir } from 'node:os'
// Node 内置：路径拼接。
import { join } from 'node:path'

// #tempPropsFile
// 创建临时属性文件供 --props-file 测试使用，用完删除。
//
// @param {object} data - 要写入的属性对象
// @returns {string} 临时文件路径
function tempPropsFile(data) {
  // 在系统临时目录创建唯一子目录，避免文件名冲突。
  const dir = mkdtempSync(join(tmpdir(), 'cli-test-'))
  // 生成文件路径。
  const file = join(dir, 'props.json')
  // 写入 JSON 内容。
  writeFileSync(file, JSON.stringify(data))
  // 返回路径。
  return file
}

// #cleanup
// 删除临时文件。
//
// @param {string} file - 文件路径
function cleanup(file) {
  // 忽略删除失败（文件可能不存在）。
  try { unlinkSync(file) } catch { /* 文件已删除 */ }
}

// ========== 测试组 1：子命令分发 ==========
describe('cli - command dispatch', () => {
  test('defaults to check command', () => {
    // 无位置参数时默认走 check。
    const result = runCli(['--props-json', '{"CHR":10}'])
    // 默认命令应为 check。
    expect(result.command).toBe('check')
  })

  test('unknown command returns error', () => {
    // 传一个不存在的子命令。
    const result = runCli(['bogus'])
    // 应报未知子命令错误。
    expect(result.errors.length).toBeGreaterThan(0)
    // 错误消息应包含命令名。
    expect(result.errors[0]).toContain('未知子命令')
  })

  test('--help returns help text', () => {
    // 传 --help。
    const result = runCli(['--help'])
    // 命令标记为 help。
    expect(result.command).toBe('help')
    // 帮助文本应包含子命令说明。
    expect(result.helpText).toContain('check')
  })
})

// ========== 测试组 2：属性来源 ==========
describe('cli - property sources', () => {
  test('props from --props-json', () => {
    // 用内联 JSON 字符串提供属性。
    const result = runCli(['check', '--props-json', '{"CHR":10,"INT":8}'])
    // 无错误。
    expect(result.errors).toEqual([])
    // 属性正确解析。
    expect(result.props.CHR).toBe(10)
  })

  test('props from --props-file', () => {
    // 创建临时属性文件。
    const file = tempPropsFile({ CHR: 10, TLT: ['t_001'] })
    try {
      // 从文件读取属性。
      const result = runCli(['check', '--props-file', file])
      // 无错误。
      expect(result.errors).toEqual([])
      // 属性正确解析，数组类型保留。
      expect(result.props.TLT).toEqual(['t_001'])
    } finally {
      // 删除临时文件。
      cleanup(file)
    }
  })

  test('--props-file and --props-json are mutually exclusive', () => {
    // 同时提供两个来源。
    const result = runCli(['check', '--props-file', 'a.json', '--props-json', '{"CHR":1}'])
    // 应报互斥错误。
    expect(result.errors[0]).toContain('互斥')
  })

  test('missing props source reports error', () => {
    // 不提供任何属性来源。
    const result = runCli(['check', '-c', 'params.CHR > 5'])
    // 应报缺少属性来源错误。
    expect(result.errors[0]).toContain('缺少属性来源')
  })

  test('nonexistent props file reports error', () => {
    // 指向不存在的文件。
    const result = runCli(['check', '--props-file', './nope-404.json'])
    // 应报读取失败错误。
    expect(result.errors[0]).toContain('读取属性文件失败')
  })
})

// ========== 测试组 3：check 求值 ==========
describe('cli - check command', () => {
  test('evaluates new-syntax condition', () => {
    // 内联属性 + 新语法条件。
    const result = runCli(['check', '--props-json', '{"CHR":10}', '-c', 'params.CHR > 5'])
    // 无错误。
    expect(result.errors).toEqual([])
    // 一条结果，求值为 true。
    expect(result.results.length).toBe(1)
    expect(result.results[0].result).toBe(true)
    expect(result.results[0].error).toBeNull()
  })

  test('evaluates legacy-syntax condition with types', () => {
    // 内联属性 + 旧语法条件 + 数组标注。
    const result = runCli(['check', '--props-json', '{"CHR":10,"TLT":["t_001"]}', '-l', 'TLT?[t_001]&CHR>5', '-t', '{"TLT":"array"}'])
    // 无错误。
    expect(result.errors).toEqual([])
    // 求值为 true。
    expect(result.results[0].result).toBe(true)
  })

  test('evaluates multiple conditions', () => {
    // 同一条命令传多个 -c。
    const result = runCli(['check', '--props-json', '{"CHR":10}', '-c', 'params.CHR > 5', '-c', 'params.CHR > 15'])
    // 两条结果。
    expect(result.results.length).toBe(2)
    // 第一条 true，第二条 false。
    expect(result.results[0].result).toBe(true)
    expect(result.results[1].result).toBe(false)
  })

  test('condition side effects modify props', () => {
    // 条件内对属性做 += 副作用。
    const result = runCli(['check', '--props-json', '{"MNY":100}', '-c', 'params.MNY += 500'])
    // 求值为 true（+= 返回 600，truthy）。
    expect(result.results[0].result).toBe(true)
    // 副作用真实作用到 props。
    expect(result.props.MNY).toBe(600)
  })

  test('no conditions yields empty results', () => {
    // 只有属性没有条件。
    const result = runCli(['check', '--props-json', '{"CHR":10}'])
    // 结果为空但不报错。
    expect(result.results).toEqual([])
    expect(result.errors).toEqual([])
  })

  test('json output flag is recorded', () => {
    // 传 -j。
    const result = runCli(['check', '--props-json', '{"CHR":10}', '-c', 'params.CHR > 5', '-j'])
    // json 标记为 true。
    expect(result.json).toBe(true)
  })
})

// ========== 测试组 4：convert 转换 ==========
describe('cli - convert command', () => {
  test('converts legacy to new syntax', () => {
    // 旧语法条件转换。
    const result = runCli(['convert', '-l', 'CHR>5&AGE?[18,30]'])
    // 无错误。
    expect(result.errors).toEqual([])
    // 转换结果包含新语法片段。
    expect(result.results[0].converted).toContain('params.CHR > 5')
    expect(result.results[0].converted).toContain('includes(params.AGE)')
    // convert 不求值，result 为 null。
    expect(result.results[0].result).toBeNull()
  })

  test('convert without -l reports error', () => {
    // convert 必须有旧语法条件。
    const result = runCli(['convert'])
    // 应报缺少 -l 错误。
    expect(result.errors[0]).toContain('--legacy')
  })
})

// ========== 测试组 5：props 输出 ==========
describe('cli - props command', () => {
  test('prints loaded props', () => {
    // props 子命令只加载属性。
    const result = runCli(['props', '--props-json', '{"CHR":10,"INT":8}'])
    // 无错误。
    expect(result.errors).toEqual([])
    // 属性正确。
    expect(result.props.CHR).toBe(10)
    // 无求值结果。
    expect(result.results).toEqual([])
  })
})

// ========== 测试组 6：错误处理 ==========
describe('cli - error handling', () => {
  test('invalid --props-json reports error', () => {
    // 非法 JSON 字符串。
    const result = runCli(['check', '--props-json', '{not json}'])
    // 应报 JSON 解析错误。
    expect(result.errors[0]).toContain('不是合法 JSON')
  })

  test('invalid --types reports error', () => {
    // 非法 types JSON。
    const result = runCli(['convert', '-l', 'TLT?[t_001]', '-t', '{oops}'])
    // 应报 types 解析错误。
    expect(result.errors[0]).toContain('--types 不是合法 JSON')
  })

  test('invalid CLI option reports error', () => {
    // 传未声明的选项，parseArgs 会抛错。
    const result = runCli(['check', '--bogus-flag'])
    // 应返回错误。
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
