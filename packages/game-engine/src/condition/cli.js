/**
 * condition 引擎 CLI 工具
 *
 * 用法：node src/condition/cli.js <子命令> [选项]
 *
 * 子命令：
 *   check    加载属性 → 求值条件 → 输出结果（条件可修改属性）
 *   convert  旧语法 → 新语法转换（无需属性）
 *   props    加载属性 → 输出（验证属性加载/解析）
 *
 * 选项：
 *   -f, --props-file <path>   属性 JSON 文件
 *       --props-json <str>    内联属性 JSON 字符串（二选一，与 -f 互斥）
 *   -c, --check <cond>        新语法条件，可多次
 *   -l, --legacy <cond>       旧语法条件，可多次（自动 convertLegacy）
 *   -t, --types <json>        数组属性标注，如 '{"TLT":"array"}'
 *   -j, --json                输出 JSON
 *       --log-level <level>   日志级别（trace/debug/info/warn/error）
 *   -h, --help                帮助
 *
 * 参数解析使用 Node 内置 util.parseArgs，零依赖。
 * 该文件是可运行脚本（node cli.js），逻辑集中在 runCli() 便于测试。
 */

// #imports
// 从同一目录导入核心函数。
// 使用相对路径，保持 ES module 兼容。
import { check } from './index.js' // check() — 条件求值
import { convertLegacy } from './compat.js' // convertLegacy() — 旧语法转换
// Node 内置：命令行参数解析器（Node 18.3+ 可用）。
import { parseArgs } from 'node:util'
// 日志系统。
import { createLogger, parseLogLevel } from '../functions/logger.js'
// Node 内置：同步文件读取（属性 JSON 文件）。
import { readFileSync } from 'node:fs'
// Node 内置：把文件路径转为 file:// URL，用于判断是否直接运行本文件。
import { pathToFileURL } from 'node:url'

// #HELP_TEXT
// 帮助文本，--help 或 -h 时打印。
const HELP_TEXT = `condition 引擎 CLI 工具

用法：
  node cli.js <子命令> [选项]

子命令：
  check    加载属性 → 求值条件 → 输出结果（条件可修改属性）
  convert  旧语法 → 新语法转换（无需属性）
  props    加载属性 → 输出

选项：
  -f, --props-file <path>   属性 JSON 文件
      --props-json <str>    内联属性 JSON 字符串（与 -f 互斥）
  -c, --check <cond>        新语法条件，可多次
  -l, --legacy <cond>       旧语法条件，可多次（自动 convertLegacy）
  -t, --types <json>        数组属性标注，如 '{"TLT":"array"}'
  -j, --json                输出 JSON
  -h, --help                帮助

示例：
  node cli.js check -f props.json -c "params.CHR > 5"
  node cli.js check --props-json '{"CHR":10,"TLT":["t_001"]}' -l -t '{"TLT":"array"}' -c "TLT?[t_001]&CHR>5"
  node cli.js convert -l "CHR>5&AGE?[18,30]"
  node cli.js props -f props.json -j
`

// #parseTypes
// 解析 -t/--types 选项：把 JSON 字符串转成 propTypes 映射。
// 解析失败时返回错误消息，由调用方决定如何处理。
//
// @param {string} str - 用户传入的 JSON 字符串
// @returns {{ types: object, error: string | null }} 解析结果
function parseTypes(str) {
  // 未传 -t 时返回空映射，无错误。
  if (str === undefined) return { types: {}, error: null }
  // try...catch 包裹 JSON.parse，非法 JSON 给出友好错误。
  try {
    // JSON.parse 解析为对象，作为 propTypes 使用。
    return { types: JSON.parse(str), error: null }
  } catch (e) {
    // 返回错误，不抛出，由调用方决定退出码。
    return { types: {}, error: `--types 不是合法 JSON: ${e.message}` }
  }
}

// #loadProps
// 根据 --props-file 或 --props-json 加载属性对象。
// 两者互斥；都不提供时报错。
// 注意：--props-json 也处理为 JSON 字符串（与文件内容一致）。
//
// @param {object} values - parseArgs 解析出的选项值
// @returns {{ props: object, error: string | null }} 属性对象或错误
function loadProps(values) {
  // 是否提供了文件路径和内联 JSON。
  const hasFile = values['props-file'] !== undefined
  const hasInline = values['props-json'] !== undefined

  // 两者都提供 → 冲突，报错。
  if (hasFile && hasInline) {
    return { props: null, error: '--props-file 与 --props-json 互斥，只能提供一个' }
  }

  // 从文件读取：readFileSync 读 UTF-8 文本，再 JSON.parse。
  if (hasFile) {
    // try...catch 覆盖两种情况：文件不存在/不可读，或 JSON 非法。
    try {
      const text = readFileSync(values['props-file'], 'utf8')
      return { props: JSON.parse(text), error: null }
    } catch (e) {
      // 区分错误类型给出更明确的提示。
      return { props: null, error: `读取属性文件失败: ${e.message}` }
    }
  }

  // 从内联字符串解析。
  if (hasInline) {
    // try...catch 覆盖 JSON 非法的情况。
    try {
      return { props: JSON.parse(values['props-json']), error: null }
    } catch (e) {
      return { props: null, error: `--props-json 不是合法 JSON: ${e.message}` }
    }
  }

  // 两者都没提供 → 报错（check 命令必须有属性）。
  return { props: null, error: '缺少属性来源：请用 --props-file 或 --props-json 提供属性' }
}

// #evaluateCondition
// 求值一个条件，捕获 check() 抛出的错误。
// 条件允许修改 params（副作用设计约定），会真实改写传入的 props 对象。
//
// @param {string} source - 用户输入的条件字符串（新语法或旧语法原文）
// @param {string} expr - 实际传给 check() 的 JS 表达式
// @param {object} props - 属性对象（会被条件副作用修改）
// @returns {{ source: string, expr: string, result: boolean, error: string | null }}
function evaluateCondition(source, expr, props) {
  // try...catch 捕获 check() 抛出的求值错误。
  try {
    // 求值并记录结果；条件内的副作用会同步修改 props。
    const result = check(expr, props)
    // 成功：无错误，返回结果。
    return { source, expr, result, error: null }
  } catch (e) {
    // 失败：返回错误消息，不中断后续条件的求值。
    return { source, expr, result: null, error: e.message }
  }
}

// #runCli
// CLI 主逻辑：解析参数 → 分发子命令 → 返回结构化结果。
// 与 process/console 解耦，便于测试直接调用并断言返回结构。
//
// @param {string[]} argv - 命令行参数数组（不含 node 和脚本路径）
// @returns {object} 结构化结果，含 command、results、errors、json 等字段
export function runCli(argv) {
  // #parse
  // 用 util.parseArgs 解析参数。
  // allowPositionals: true 允许位置参数（子命令名）。
  // options 声明各选项：type 为 string/boolean，multiple 允许重复。
  try {
    // parseArgs 配置：
    //   props-file（-f）：字符串，属性文件路径
    //   props-json：字符串，内联属性 JSON
    //   check（-c）：字符串数组，新语法条件（可多次）
    //   legacy（-l）：字符串数组，旧语法条件（可多次）
    //   types（-t）：字符串，数组属性标注 JSON
    //   json（-j）：布尔，JSON 输出
    //   help（-h）：布尔，帮助
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'props-file': { type: 'string', short: 'f' },
        'props-json': { type: 'string' },
        check: { type: 'string', short: 'c', multiple: true },
        legacy: { type: 'string', short: 'l', multiple: true },
        types: { type: 'string', short: 't' },
        json: { type: 'boolean', short: 'j' },
        'log-level': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })

    // 创建日志器（从 --log-level 解析级别）。
    const logger = createLogger({ level: parseLogLevel(argv), prefix: 'condition' })

    // 是否要求 JSON 输出。
    const json = values.json === true

    // --help 优先处理，任何子命令下都打印帮助。
    if (values.help) {
      // 返回帮助文本，直接打印。
      return { command: 'help', helpText: HELP_TEXT, json, errors: [] }
    }

    // 子命令：第一个位置参数，缺省为 check。
    const command = positionals[0] ?? 'check'

    // 未知子命令报错。
    const validCommands = ['check', 'convert', 'props']
    if (!validCommands.includes(command)) {
      // 返回错误结果，不退出进程。
      return { command, results: [], json, errors: [`未知子命令: ${command}（可用: ${validCommands.join(', ')}）`] }
    }

    // 解析 -t 选项。
    const { types, error: typesError } = parseTypes(values.types)

    // #collect errors
    // 汇总各步骤的错误：types 解析失败、属性加载失败。
    // check/props 必须有属性，convert 必须有 -l 条件。
    const errors = []

    // types 解析失败时，旧语法转换将无法正确标注数组属性。
    if (typesError) errors.push(typesError)

    // check 和 props 需要属性，convert 不需要。
    const needsProps = command === 'check' || command === 'props'
    let props = null
    if (needsProps) {
      // 加载属性，失败时记录错误。
      const loaded = loadProps(values)
      props = loaded.props
      if (loaded.error) errors.push(loaded.error)
    }

    // convert 必须至少提供一条 -l 旧语法条件。
    if (command === 'convert' && (values.legacy ?? []).length === 0) {
      // 无旧语法条件，报错。
      errors.push('convert 子命令需要至少一条 --legacy/-l 条件')
    }

    // #results
    // 收集每条求值/转换的结果。
    const results = []

    // 已有致命错误时直接返回，不再执行子命令逻辑。
    if (errors.length === 0) {
      // #switch
      // 按子命令分发逻辑。
      switch (command) {
        case 'check': {
          // check：逐个求值新语法和旧语法条件。
          // 记录命令。
          logger.debug(`check: 新语法 ${(values.check ?? []).length} 条, 旧语法 ${(values.legacy ?? []).length} 条`)
          // 新语法条件直接 check()。
          for (const cond of values.check ?? []) {
            // trace 级记录条件。
            logger.trace(`条件: ${cond}`)
            // 求值并加入结果。
            results.push(evaluateCondition(cond, cond, props))
          }
          // 旧语法条件：先 convertLegacy 再 check()。
          for (const cond of values.legacy ?? []) {
            // 转换为新语法。
            const converted = convertLegacy(cond, types)
            // trace 级记录转换。
            logger.trace(`转换: ${cond} → ${converted}`)
            // 求值转换后的表达式。
            results.push(evaluateCondition(cond, converted, props))
          }
          // 返回结果，附带最终属性（条件副作用可能已修改 props）。
          return { command, props, results, json, errors }
        }
        case 'convert': {
          // convert：只转换旧语法为新语法，不求值，不需要属性。
          for (const cond of values.legacy ?? []) {
            // 转换。
            const converted = convertLegacy(cond, types)
            // trace 级记录。
            logger.trace(`转换: ${cond} → ${converted}`)
            // 转换并加入结果（无求值，result 为 null）。
            results.push({ source: cond, converted, result: null, error: null })
          }
          // 返回结果，无属性字段。
          return { command, results, json, errors }
        }
        case 'props': {
          // props：只输出加载后的属性，不求值。
          // 返回结果，无 conditions。
          return { command, props, results, json, errors }
        }
        default:
          // 不可达分支（已在上方校验），防御性返回。
          return { command, results, json, errors }
      }
    }

    // 有错误：返回错误列表（props 未加载时为 null）。
    return { command, props, results, json, errors }
  } catch (e) {
    // parseArgs 抛错（未知选项等）或意外错误。
    // 返回错误结果，不退出进程。
    return { command: null, results: [], json: false, errors: [e.message] }
  }
}

// #formatProps
// 将属性对象格式化为便于阅读的单行文本。
//
// @param {object} props - 属性对象
// @returns {string} 格式化后的文本
function formatProps(props) {
  // 简单转成 JSON 字符串。
  return JSON.stringify(props ?? {})
}

// #printResults
// 将 runCli() 的结构化结果打印到终端。
// 不修改任何逻辑，只负责格式化输出。
//
// @param {object} result - runCli() 返回的结构化结果
function printResults(result) {
  // 是否要求 JSON 输出。
  if (result.json) {
    // JSON 输出：直接打印结构化结果。
    // 去掉 helpText（过长的帮助文本不属于 JSON 输出内容）。
    const { helpText, ...rest } = result
    console.log(JSON.stringify(rest, null, 2))
    return
  }

  // help 命令：直接打印帮助文本。
  if (result.command === 'help') {
    // 打印帮助文本。
    console.log(result.helpText)
    return
  }

  // 打印子命令标题。
  console.log(`=== ${result.command} ===`)

  // 打印错误（如有）。
  if (result.errors.length > 0) {
    // 逐条打印错误到 stderr。
    for (const err of result.errors) {
      console.error(`  ✗ 错误: ${err}`)
    }
  }

  // props 命令：打印加载的属性。
  if (result.command === 'props') {
    // 打印属性对象。
    console.log(`  属性: ${formatProps(result.props)}`)
  }

  // check 命令：打印每条条件的结果 + 最终属性。
  if (result.command === 'check') {
    // 逐条打印求值结果。
    for (const r of result.results) {
      // 成功：✓ 结果；失败：✗ 错误。
      if (r.error) {
        // 求值失败。
        console.log(`  ✗ ${r.source}`)
        console.log(`      表达式: ${r.expr}`)
        console.log(`      错误: ${r.error}`)
      } else {
        // 求值成功。
        // 旧语法条件会附带转换后的表达式。
        const converted = r.converted !== undefined && r.converted !== r.expr ? `  →  ${r.converted}` : ''
        console.log(`  ${r.result ? '✓' : '✗'} ${r.source}${converted} = ${r.result}`)
      }
    }
    // 打印最终属性（条件副作用可能已修改）。
    console.log(`  最终属性: ${formatProps(result.props)}`)
  }

  // convert 命令：打印转换结果。
  if (result.command === 'convert') {
    // 逐条打印转换结果。
    for (const r of result.results) {
      // 打印旧语法 → 新语法。
      console.log(`  ${r.source}  →  ${r.converted}`)
    }
  }
}

// #entryPoint
// 仅当直接以 node cli.js 运行时执行（import.meta.url 判断）。
// 被测试 import 时不执行，避免测试时副作用打印。
// 判断依据：import.meta.url 与进程入口 argv[1] 的绝对路径相同。
// pathToFileURL 处理 Windows 路径（盘符、反斜杠）与 file:// URL 的转换。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 运行 CLI 主逻辑。
  const result = runCli(process.argv.slice(2))
  // 打印结果（含帮助）。
  printResults(result)
}
