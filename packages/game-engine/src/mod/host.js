/**
 * mod/host — 宿主桥（seam #3）：让 Mod 的浏览器侧代码调用它自己的后端入口
 *
 * 设计见根目录 `_设计方案_Mod宿主能力与双目标.md` 第四节。
 *
 * 形态是「**Mod 自己注册的命名处理器** + 调用」，不是「能力白名单表」。原因（已实证）：
 *   Mod 代码在 Node 里只注入 `gameAPI`，却已能 `import('node:fs')` / `child_process`
 *   / 访问 `process` —— 所以 Node 侧的能力白名单**不可执行**，设了只会制造"安全"的错觉。
 *   因此本模块**不做能力授权**，只做"把调用可靠地送到对方那个函数"。
 *
 * 对外接口（两个成员 + 一个便捷探测）：
 *   available      → string[]       当前在线的宿主 Mod 名（**环境探测，不是授权**）
 *   has(mod)       → boolean
 *   call(mod, handler, args) → Promise<any>
 *
 * 适配器（本模块只依赖这 3 个成员中的 2 个）：
 *   host-node.js  Node 进程内直接调用（import 各 Mod 的 server.js）
 *   host-rpc.js   浏览器 → 本地 Node 服务（可选，见设计文档阶段 4）
 *   createDenyHost() 静态站 / 无后端：available 为空，调用给出可读错误（**优雅降级**）
 *
 * 序列化边界：host-node 同进程**按引用传递**（不强制 JSON）；只有 RPC 适配器才需要
 * JSON 序列化。调用方按最低公分母（JSON 可序列化）写代码即可两端通用。
 */

// #createHostBridge
// 把平台适配器包成统一宿主桥：校验 + 错误归一化。
//
// @param {object} adapter - 适配器 { available: string[], call(mod, handler, args) }
// @returns {{available: string[], has: Function, call: Function}} 宿主桥
export function createHostBridge(adapter) {
  // 适配器（容错：缺省视为"无能力"）。
  const impl = adapter || {}
  // 在线 Mod 名快照（复制一份，避免外部后续改动影响已建好的桥）。
  const names = Array.isArray(impl.available) ? impl.available.map((n) => String(n)) : []

  // 返回桥。
  return {
    // 在线的宿主 Mod 名（每次返回新数组，调用方改不到内部状态）。
    get available() {
      // 返回副本。
      return [...names]
    },

    // #has
    // 该 Mod 的后端入口是否在线（环境探测）。
    //
    // @param {string} mod - Mod 名
    // @returns {boolean} 是否在线
    has(mod) {
      // 判断。
      return names.includes(String(mod))
    },

    // #call
    // 调用某个 Mod 注册的命名处理器。
    //
    // @param {string} mod - Mod 名
    // @param {string} handler - 处理器名
    // @param {*} [args] - 参数（RPC 适配器要求 JSON 可序列化）
    // @returns {Promise<*>} 处理器返回值
    async call(mod, handler, args) {
      // 目标 Mod 不在线：明确报错，不静默返回 undefined（静默最难查）。
      if (!names.includes(String(mod))) {
        // 报错（带上在线清单，便于定位）。
        throw new Error(`宿主 Mod 未注册: ${mod}（在线：${names.length ? names.join(', ') : '无'}）`)
      }
      // 适配器没有实现 call（配置错误）。
      if (typeof impl.call !== 'function') {
        // 报错。
        throw new Error('宿主适配器未实现 call()')
      }
      // 转发；处理器自己抛错时补上"哪个 Mod 的哪个处理器"，并保留原始错误为 cause。
      try {
        // 调用。
        return await impl.call(String(mod), String(handler), args)
      } catch (e) {
        // 包装（原始错误挂在 cause 上，便于调试）。
        throw new Error(`Mod ${mod} 处理器 ${handler} 失败: ${e?.message ?? e}`, { cause: e })
      }
    },
  }
}

// #createDenyHost
// 无后端环境（纯静态站）的宿主桥：available 恒为空，调用给出可读错误。
//
// 为什么是"空桥"而不是 null：Mod 代码可以无条件写 `gameAPI.host.has('x')`，
// 不必到处判空 —— 这是**降级契约**的一半（见设计文档第八节）。
//
// @returns {object} 宿主桥
export function createDenyHost() {
  // 用统一桥包装一个空适配器。
  return createHostBridge({
    // 无任何宿主 Mod。
    available: [],
    // 调用一律失败。
    call: async () => {
      // 报错（提示当前环境的限制与替代做法）。
      throw new Error('当前环境没有后端宿主（纯静态站）：请在桌面版/CLI 运行，或改用包内自带数据')
    },
  })
}
