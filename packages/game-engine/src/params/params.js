/**
 * 内置参数定义 — params.js
 *
 * 用数据驱动方式声明 params 上挂着的全部参数（等价原 property.js 的 TYPES 语义）。
 * type 决定引擎如何生成 get/set：
 *   local    — 本局数据（restart 时 reset）
 *   derived  — 派生值（from/op 或 formula）
 *   storage  — 跨局持久化（storeKey，注入式 storage）
 *   function — 自定义函数体（JSON 字符串，new Function 编译，ctx 唯一依赖）
 *   special  — 特殊逻辑（RDM，不在 condition params 暴露）
 *
 * 此文件内容与 property.js 的原 switch 语义一一对应，可整体替换或作为 JSON 落盘。
 */

// #BUILTIN_PARAMS
// 内置参数表。
export const BUILTIN_PARAMS = {
  // === 本局属性 ===
  AGE: { type: 'local', label: '年龄', low: 'LAGE', high: 'HAGE' },
  CHR: { type: 'local', label: '颜值', low: 'LCHR', high: 'HCHR' },
  INT: { type: 'local', label: '智力', low: 'LINT', high: 'HINT' },
  STR: { type: 'local', label: '体质', low: 'LSTR', high: 'HSTR' },
  MNY: { type: 'local', label: '家境', low: 'LMNY', high: 'HMNY' },
  SPR: { type: 'local', label: '快乐', low: 'LSPR', high: 'HSPR' },
  LIF: { type: 'local', label: '生命' },
  TLT: {
    type: 'array',
    label: '已获天赋',
    // 数组 change：添加/移除 ID（'-' 前缀或负数移除）；仅添加时累计 ATLT。
    change: "if (Array.isArray(v)) { v.forEach(x => ctx.change('TLT', x)); return; } const id = String(v); const isRemove = (typeof v === 'number' && v < 0) || id.startsWith('-'); const target = isRemove ? id.slice(1) : id; const arr = ctx.data.TLT; if (isRemove) { const i = arr.indexOf(target); if (i !== -1) arr.splice(i, 1); } else { if (!arr.includes(id)) arr.push(id); ctx.change('ATLT', id); }",
  },
  EVT: {
    type: 'array',
    label: '已触事件',
    change: "if (Array.isArray(v)) { v.forEach(x => ctx.change('EVT', x)); return; } const id = String(v); const isRemove = (typeof v === 'number' && v < 0) || id.startsWith('-'); const target = isRemove ? id.slice(1) : id; const arr = ctx.data.EVT; if (isRemove) { const i = arr.indexOf(target); if (i !== -1) arr.splice(i, 1); } else { if (!arr.includes(id)) arr.push(id); ctx.change('AEVT', id); }",
  },

  // === 派生属性 ===
  LAGE: { type: 'derived', from: 'AGE', op: 'min', label: '最低年龄' },
  HAGE: { type: 'derived', from: 'AGE', op: 'max', label: '最高年龄' },
  LCHR: { type: 'derived', from: 'CHR', op: 'min', label: '最低颜值' },
  HCHR: { type: 'derived', from: 'CHR', op: 'max', label: '最高颜值' },
  LINT: { type: 'derived', from: 'INT', op: 'min', label: '最低智力' },
  HINT: { type: 'derived', from: 'INT', op: 'max', label: '最高智力' },
  LSTR: { type: 'derived', from: 'STR', op: 'min', label: '最低体质' },
  HSTR: { type: 'derived', from: 'STR', op: 'max', label: '最高体质' },
  LMNY: { type: 'derived', from: 'MNY', op: 'min', label: '最低家境' },
  HMNY: { type: 'derived', from: 'MNY', op: 'max', label: '最高家境' },
  LSPR: { type: 'derived', from: 'SPR', op: 'min', label: '最低快乐' },
  HSPR: { type: 'derived', from: 'SPR', op: 'max', label: '最高快乐' },

  // 总评公式。
  SUM: {
    type: 'derived',
    label: '总评',
    formula: 'Math.floor((HCHR+HINT+HSTR+HMNY+HSPR)*2+HAGE/2)',
  },

  // === storage 持久化 ===
  TMS: { type: 'storage', storeKey: 'times', label: '重开次数', default: 0 },
  EXT: { type: 'storage', storeKey: 'extendTalent', label: '继承天赋', default: null },

  ATLT: {
    type: 'storage',
    array: true,
    label: '拥有天赋',
    default: [],
    // 合并新 ID（去重）。
    change: "if (Array.isArray(v)) { v.forEach(x => ctx.change('ATLT', x)); return; } const raw = ctx.storage ? ctx.storage.getItem('ATLT') : null; let cur = []; if (raw !== null) { try { cur = JSON.parse(raw) } catch { cur = [] } } if (!cur.includes(String(v))) { cur.push(String(v)); ctx.storage.setItem('ATLT', JSON.stringify(cur)); }",
  },
  AEVT: {
    type: 'storage',
    array: true,
    label: '触发事件',
    default: [],
    change: "if (Array.isArray(v)) { v.forEach(x => ctx.change('AEVT', x)); return; } const raw = ctx.storage ? ctx.storage.getItem('AEVT') : null; let cur = []; if (raw !== null) { try { cur = JSON.parse(raw) } catch { cur = [] } } if (!cur.includes(String(v))) { cur.push(String(v)); ctx.storage.setItem('AEVT', JSON.stringify(cur)); }",
  },
  ACHV: {
    type: 'storage',
    array: true,
    label: '达成成就',
    default: [],
    // 追加 [id, 时间戳]。
    change: "if (Array.isArray(v)) { v.forEach(x => ctx.change('ACHV', x)); return; } const raw = ctx.storage ? ctx.storage.getItem('ACHV') : null; let cur = []; if (raw !== null) { try { cur = JSON.parse(raw) } catch { cur = [] } } cur.push([String(v), Date.now()]); ctx.storage.setItem('ACHV', JSON.stringify(cur));",
  },

  // === 统计（function 类型示例）===
  CTLT: {
    type: 'function',
    label: '天赋选择数',
    get: "return (ctx.get('ATLT') || []).length",
  },
  CEVT: {
    type: 'function',
    label: '事件收集数',
    get: "return (ctx.get('AEVT') || []).length",
  },
  CACHV: {
    type: 'function',
    label: '成就达成数',
    get: "return (ctx.get('ACHV') || []).length",
  },
  TTLT: {
    type: 'function',
    label: '总天赋数',
    get: "return ctx.total && ctx.total.TTLT",
  },
  TEVT: {
    type: 'function',
    label: '总事件数',
    get: "return ctx.total && ctx.total.TEVT",
  },
  TACHV: {
    type: 'function',
    label: '总成就数',
    get: "return ctx.total && ctx.total.TACHV",
  },
  RTLT: {
    type: 'function',
    label: '天赋选择率',
    get: "return ctx.get('CTLT') / (ctx.get('TTLT') || 1)",
  },
  REVT: {
    type: 'function',
    label: '事件收集率',
    get: "return ctx.get('CEVT') / (ctx.get('TEVT') || 1)",
  },
  RACHV: {
    type: 'function',
    label: '成就达成率',
    get: "return ctx.get('CACHV') / (ctx.get('TACHV') || 1)",
  },

  // === 特殊 ===
  RDM: { type: 'special', label: '随机属性' },
}
