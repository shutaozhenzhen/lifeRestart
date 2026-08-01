/**
 * property 模块测试 fixture
 *
 * 模拟原版 age.json 的数据结构：
 *   age[a] = { event: [...], talent: [...] }
 *   event 条目可为字符串 "id*weight" 形式（带概率权重）。
 *
 * 供 property.spec.js 使用，避免测试依赖真实 xlsx 产物。
 */

// #AGE_DATA
// 0-2 岁数据（键从 0 开始，与 restart 后 AGE=-1 → ageNext 得 0 对齐）：
//   事件含纯数字 ID、字符串 ID、带权重 ID 三种形式。
//   天赋为字符串 ID 数组（新项目约束）。
export const AGE_DATA = {
  0: {
    event: ['ev_001'],
    talent: [],
  },
  1: {
    event: ['ev_001', 'ev_002'],
    talent: [],
  },
  2: {
    event: ['ev_002*2', 'ev_003*0.5', 'ev_004'],
    talent: ['t_001', 't_002'],
  },
  3: {
    event: ['ev_001'],
    talent: [],
  },
  4: {
    event: ['ev_002'],
    talent: [],
  },
  5: {
    event: ['ev_003', 'ev_004'],
    talent: [],
  },
  6: {
    event: ['ev_005'],
    talent: [],
  },
  7: {
    event: ['ev_006'],
    talent: [],
  },
  8: {
    event: ['ev_001', 'ev_002'],
    talent: [],
  },
  9: {
    event: ['ev_003'],
    talent: ['t_002'],
  },
}

// #TOTAL
// 总数数据：供 TTLT/TEVT/TACHV 读取。
export const TOTAL = {
  TTLT: 5,
  TEVT: 10,
  TACHV: 3,
}

// #JUDGE_CONFIG
// 评价配置：分档从低到高排列（原版语义，遍历从尾到首，最高档最后匹配）。
export const JUDGE_CONFIG = {
  CHR: [
    [0, 1, 'Judge_Normal'],
    [5, 2, 'Judge_Good'],
    [8, 3, 'Judge_Great'],
  ],
}
