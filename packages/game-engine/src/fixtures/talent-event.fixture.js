/**
 * talent + event 模块测试 fixture
 *
 * 模拟原版 talents.json / events.json 的数据结构，
 * 但条件使用新项目的新语法（params.X > n），ID 全部为字符串。
 *
 * 供 talent.spec.js / event.spec.js 使用。
 */

// #TALENTS
// 天赋数据：
//   t_001 无条件触发，提供 INT 加成
//   t_002 条件触发（INT>3），提供 STR 加成
//   t_003 与 t_004 互相 exclude（互斥）
//   t_004 与 t_003 互相 exclude
//   t_005 exclusive 天赋（不入抽取池）
//   t_006 replacement.talent 替换链：抽到 t_006 会替换为 t_007 或 t_008
//   t_007 replacement.grade 按等级替换
//   t_008 无 replacement（替换链终点）
export const TALENTS = {
  t_001: {
    id: 't_001',
    name: '智力+1',
    description: '智力+1',
    grade: 1,
    effect: { INT: 1 },
  },
  t_002: {
    id: 't_002',
    name: '体质+1',
    description: '需要智力大于3',
    grade: 1,
    condition: 'params.INT > 3',
    effect: { STR: 1 },
    maxTriggers: 2,
  },
  t_003: {
    id: 't_003',
    name: '男性',
    description: '性别为男',
    grade: 2,
    exclude: ['t_004'],
  },
  t_004: {
    id: 't_004',
    name: '女性',
    description: '性别为女',
    grade: 2,
    exclude: ['t_003'],
  },
  t_005: {
    id: 't_005',
    name: '专属天赋',
    description: '不可抽取',
    grade: 3,
    exclusive: true,
  },
  t_006: {
    id: 't_006',
    name: '运气好',
    description: '可能变成其他天赋',
    grade: 0,
    replacement: {
      talent: ['t_007', 't_008'],
    },
  },
  t_007: {
    id: 't_007',
    name: '好运结果A',
    description: '替换候选A',
    grade: 1,
  },
  t_008: {
    id: 't_008',
    name: '好运结果B',
    description: '替换候选B',
    grade: 1,
  },
  t_009: {
    id: 't_009',
    name: '传世名将',
    description: '等级3天赋',
    grade: 3,
  },
  t_010: {
    id: 't_010',
    name: '填充天赋1',
    description: '填充池容量',
    grade: 0,
  },
  t_011: {
    id: 't_011',
    name: '填充天赋2',
    description: '填充池容量',
    grade: 0,
  },
  t_012: {
    id: 't_012',
    name: '填充天赋3',
    description: '填充池容量',
    grade: 0,
  },
}

// #EVENTS
// 事件数据：
//   ev_001 无条件事件，LIF 变化
//   ev_002 有 include 条件（CHR>5 才触发）
//   ev_003 有 exclude 条件（INT>3 时不触发）
//   ev_004 NoRandom 事件（不参与随机抽取）
//   ev_005 有分支：CHR>7 走 ev_006，否则走自身效果
//   ev_006 分支目标事件（无分支，直接效果）
export const EVENTS = {
  ev_001: {
    id: 'ev_001',
    event: '你死了。',
    effect: { LIF: -1 },
  },
  ev_002: {
    id: 'ev_002',
    event: '你变漂亮了。',
    include: 'params.CHR > 5',
    effect: { CHR: 1 },
  },
  ev_003: {
    id: 'ev_003',
    event: '你变聪明了。',
    exclude: 'params.INT > 3',
    effect: { INT: 1 },
  },
  ev_004: {
    id: 'ev_004',
    event: '这是关键剧情。',
    NoRandom: 1,
    effect: { MNY: 10 },
  },
  ev_005: {
    id: 'ev_005',
    event: '你遇到贵人。',
    branch: [
      'params.CHR > 7:ev_006',
      'params.INT > 3:ev_006',
    ],
  },
  ev_006: {
    id: 'ev_006',
    event: '贵人相助。',
    effect: { MNY: 50 },
  },
}
