/**
 * param 注册表 — 参数即配置（type 驱动）
 *
 * 把「params 上挂着的参数」从硬编码 switch 改为数据驱动注册表。
 * 每个参数由一份 JSON 定义，type 决定引擎如何生成 get/set/change：
 *
 *   type: 'local'    本局标量/数组，直接存 data（restart 时 reset）
 *   type: 'derived'  派生值，get 时实时算（from/op/formula）
 *   type: 'storage'  跨局持久化，走注入式 storage（storeKey）
 *   type: 'function' 自定义函数体（JSON 字符串，new Function 编译）
 *   type: 'special'  特殊逻辑（不在 condition params 中暴露）
 *
 * 所有参数统一走注册表：
 *   get(name)  → 查表调用该参数的 get（递归 + 循环依赖检测）
 *   set/change 同理
 *   getAll()   → 展开全部参数，即 condition 引擎的 params
 *
 * 与 condition check() 同一哲学：无沙箱，ctx 是唯一注入依赖。
 */

// util 工具（注入 ctx）。
import { min, max, sum, clone } from '../functions/util.js'

// #createParamRegistry
// 创建参数注册表。
//
// @param {object} deps
// @param {object} [deps.storage] - 注入式 storage（getItem/setItem）
// @param {Function} [deps.cloneFn] - 深拷贝函数（数组参数 get 防外部篡改）
// @param {object} [deps.util] - 额外工具函数（合并进 ctx）
// @param {() => number} [deps.random] - 随机源（RDM 等用）
// @param {object} [deps.log] - 日志器
// @returns {object} 注册表
export function createParamRegistry({ storage, cloneFn = clone, util = {}, random = Math.random, log } = {}) {
  // 日志器。
  const logger = log || { debug: () => {}, error: () => {} }
  // 参数表：name → { type, get, set, change }。
  const params = {}
  // 本局数据（local 类型存这里，restart 时 reset）。
  let data = {}
  // 跨局总数（initial 注入）。
  let total = {}
  // 正在求值的集合（循环依赖检测）。
  const resolving = new Set()

  // #resolveGet
  // 读参数（递归 + 循环检测）。
  //
  // @param {string} name - 参数名
  // @returns {*} 参数值
  function resolveGet(name) {
    // 未定义。
    const p = params[name]
    // 不存在。
    if (!p) return undefined
    // 循环检测。
    if (resolving.has(name)) {
      // 记录。
      logger.error(`参数循环依赖: ${name}`)
      // 中断。
      return undefined
    }
    // 入栈。
    resolving.add(name)
    // 求值。
    const value = p.get()
    // 出栈。
    resolving.delete(name)
    // 返回。
    return value
  }

  // #resolveSet
  // 覆盖写。
  //
  // @param {string} name - 参数名
  // @param {*} value - 新值
  // @returns {void}
  function resolveSet(name, value) {
    // 未定义或无 set。
    if (!params[name] || !params[name].set) return
    // 调用。
    params[name].set(value)
  }

  // #resolveChange
  // 增量/添加。
  //
  // @param {string} name - 参数名
  // @param {*} value - 增量或 ID
  // @returns {void}
  function resolveChange(name, value) {
    // 未定义。
    if (!params[name]) return
    // 有自定义 change。
    if (params[name].change) {
      // 调用。
      params[name].change(value)
      // 完成。
      return
    }
    // 通用：set(get() + v)（仅数字语义）。
    if (params[name].set) {
      // 读当前 + 加增量。
      resolveSet(name, resolveGet(name) + Number(value))
    }
  }

  // #ctx
  // 注入给 function 类型与公式的上下文（唯一依赖）。
  const ctx = {
    // 本局数据（只读视图）。
    data,
    // 跨局总数。
    total,
    // storage。
    storage,
    // 随机源。
    random,
    // 读其他参数。
    get: resolveGet,
    // 写其他参数。
    set: resolveSet,
    // 增量其他参数。
    change: resolveChange,
    // util 工具。
    min, max, sum,
    ...util,
  }

  // #compileFunction
  // 编译 function 类型的函数体字符串。
  // 编译结果通过闭包捕获 ctx（调用时无需传参）。
  //
  // @param {string} code - 函数体（如 "return ctx.get('CHR') * 2"）
  // @param {string[]} [args] - 额外形参（如 ['v']）
  // @returns {Function} 编译后的函数
  function compileFunction(code, args = []) {
    // 空代码 no-op。
    if (!code) return null
    // 编译（ctx 作为形参，调用时由闭包注入）。
    const fn = new Function('ctx', ...args, '"use strict";\n' + code)
    // 返回闭包：预绑 ctx。
    return (...callArgs) => fn(ctx, ...callArgs)
  }

  // #compileFormula
  // 编译派生公式：把属性名替换为 ctx.get('NAME')。
  //
  // @param {string} formula - 公式，如 "(HCHR+HINT+HSTR+HMNY+HSPR)*2+HAGE/2"
  // @returns {Function} 求值函数（注入 ctx）
  function compileFormula(formula) {
    // 替换大写属性名。
    const code = formula.replace(/\b[A-Z][A-Z0-9_]*\b/g, (m) => `ctx.get('${m}')`)
    // 编译（ctx 闭包捕获）。
    const fn = new Function('ctx', '"use strict"; return (' + code + ')')
    // 返回闭包。
    return () => fn(ctx)
  }

  // #buildParam
  // 根据 type 生成参数实现。
  //
  // @param {string} name - 参数名
  // @param {object} def - JSON 定义
  // @returns {object} { type, get, set, change }
  function buildParam(name, def) {
    // 按类型分发。
    switch (def.type) {
      // 自定义函数体。
      case 'function':
        return {
          type: 'function',
          get: compileFunction(def.get) || (() => undefined),
          set: compileFunction(def.set, ['v']),
          change: def.change ? compileFunction(def.change, ['v']) : null,
        }

      // 本局标量/数组（local）。
      case 'local':
      case 'number':
      case 'array': {
        // 数组参数。
        const isArray = def.type === 'array' || def.array === true
        // 派生联动（low/high）。
        const low = def.low
        const high = def.high
        // 返回。
        return {
          type: 'local',
          // 读 data（数组返回深拷贝，防外部篡改）。
          get: () => (isArray ? cloneFn(data[name]) : data[name]),
          // 写 data。
          set: (v) => { data[name] = v },
          // change：默认数字累加 + 派生联动；数组参数用自定义 change。
          change: def.change
            // 自定义 change（如 TLT 添加/移除）。
            ? compileFunction(def.change, ['v'])
            // 标量：累加 + 更新 low/high。
            : (v) => {
              // 数组不做通用累加。
              if (isArray) return
              // 累加。
              const value = Number(data[name] || 0) + Number(v)
              // 写回。
              data[name] = value
              // 派生联动。
              if (low) data[low] = Math.min(data[low], value)
              if (high) data[high] = Math.max(data[high], value)
            },
        }
      }

      // 派生值。
      case 'derived':
        // 公式求值。
        if (def.formula) {
          // 编译（闭包捕获 ctx）。
          const fn = compileFormula(def.formula)
          // 返回。
          return {
            type: 'derived',
            get: () => fn(),
            set: null,
            change: null,
          }
        }
        // from + op。
        return {
          type: 'derived',
          get: () => {
            // 当前存储值。
            const base = data[name]
            // 目标基础值。
            const target = ctx.get(def.from)
            // 按 op。
            if (def.op === 'max') return Math.max(base, target)
            if (def.op === 'min') return Math.min(base, target)
            // 无 op。
            return base
          },
          set: (v) => { data[name] = v },
          change: null,
        }

      // storage 持久化。
      case 'storage':
        return {
          type: 'storage',
          // 读 storage（JSON 解析，缺省 def.default）。
          get: () => {
            // 键。
            const key = def.storeKey || name
            // 读。
            const raw = storage ? storage.getItem(key) : null
            // 缺失用默认。
            if (raw === null) return def.default !== undefined ? def.default : (def.array ? [] : 0)
            // 解析。
            try { return JSON.parse(raw) } catch { return def.default }
          },
          // 写 storage。
          set: (v) => {
            // 键。
            const key = def.storeKey || name
            // 写。
            if (storage) storage.setItem(key, JSON.stringify(v))
          },
          // 数组存储的 change（如 ATLT 合并）。
          change: def.change ? compileFunction(def.change, ['v']) : null,
        }

      // 特殊（不在 params 暴露）。
      case 'special':
        return {
          type: 'special',
          get: () => data[name],
          set: (v) => { data[name] = v },
          change: null,
        }

      // 未知类型。
      default:
        // 记录。
        logger.error(`未知参数类型: ${def.type} (${name})`)
        // 空实现。
        return { type: def.type, get: () => undefined, set: null, change: null }
    }
  }

  // 返回注册表。
  return {
    // #define
    // 注册一个参数。
    define(name, def) {
      // 构建并注册。
      params[name] = buildParam(name, def)
    },

    // #defineAll
    // 批量注册。
    defineAll(defs) {
      // 逐个。
      for (const name in defs) this.define(name, defs[name])
    },

    // #reset
    // 重置本局数据（restart 时调用）。
    //
    // @param {object} [initial] - 初始 data
    // @returns {void}
    reset(initial = {}) {
      // 替换引用。
      data = initial
      // 同步 ctx.data 引用。
      ctx.data = data
    },

    // #setTotal
    // 注入跨局总数（initial 时调用）。
    //
    // @param {object} t - { TACHV, TEVT, TTLT }
    // @returns {void}
    setTotal(t) {
      // 保存。
      total = t || {}
      // 同步 ctx.total。
      ctx.total = total
    },

    // #get
    get: resolveGet,

    // #set
    set: resolveSet,

    // #change
    change: resolveChange,

    // #has
    has(name) {
      // 判断。
      return name in params
    },

    // #names
    get names() {
      // 键列表。
      return Object.keys(params)
    },

    // #getAll
    // 展开全部参数（供 condition 引擎作 params）。
    getAll() {
      // 结果。
      const all = {}
      // 逐个。
      for (const name in params) {
        // 跳过 special。
        if (params[name].type === 'special') continue
        // 读。
        all[name] = resolveGet(name)
      }
      // 返回。
      return all
    },

    // #schema
    // 原始定义（只读）。
    get schema() {
      // 返回映射。
      return params
    },
  }
}
