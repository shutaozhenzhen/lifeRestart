/**
 * achievement + character 模块测试 fixture
 *
 * 模拟原版 achievement.json / character.json 的数据结构，
 * 条件使用新语法，ID 全部为字符串。
 */

// #ACHIEVEMENTS
// 成就数据：
//   ach_001 开局达成（START）
//   ach_002 每年轨迹达成（TRAJECTORY），条件 CHR>5
//   ach_003 隐藏成就
export const ACHIEVEMENTS = {
  ach_001: {
    id: 'ach_001',
    name: '新的开始',
    description: '开始人生',
    opportunity: 'START',
    grade: 1,
  },
  ach_002: {
    id: 'ach_002',
    name: '天生丽质',
    description: '颜值超过5',
    opportunity: 'TRAJECTORY',
    condition: 'params.CHR > 5',
    grade: 2,
  },
  ach_003: {
    id: 'ach_003',
    name: '隐藏成就',
    description: '神秘',
    opportunity: 'SUMMARY',
    condition: 'params.HAGE > 10',
    grade: 3,
    hide: true,
  },
}

// #CHARACTERS
// 名人数据：
//   char_001/002 普通名人，带属性与天赋
//   char_003 额外名人（保证抽取数量充足）
export const CHARACTERS = {
  char_001: {
    id: 'char_001',
    name: '秦始皇',
    property: { CHR: 5, INT: 5, STR: 8, MNY: 9 },
    talent: ['t_001'],
  },
  char_002: {
    id: 'char_002',
    name: '李白',
    property: { CHR: 7, INT: 9, STR: 3, MNY: 4 },
    talent: ['t_002'],
  },
  char_003: {
    id: 'char_003',
    name: '诸葛亮',
    property: { CHR: 6, INT: 10, STR: 4, MNY: 5 },
    talent: ['t_001', 't_002'],
  },
}

// #PROPERTY_WEIGHT
// 唯一"我"的属性值权重表。
export const PROPERTY_WEIGHT = [['5', 1], ['7', 1], ['9', 1]]

// #TALENT_WEIGHT
// 唯一"我"的天赋数量权重表。
export const TALENT_WEIGHT = [['1', 1], ['2', 1]]
