/**
 * i18n 多语言模块
 *
 * 从原版 lifeRestart-old/src/i18n/ 提取的键值翻译对象。
 * 新项目提供：
 *   1. loadLocale(name)：按语言名加载翻译对象。
 *   2. t(key, ...args)：取翻译值，支持 {n} 占位符。
 *
 * 语言注册表在下方内置 zh-cn / en-us 两个语言的关键词条，
 * 完整词条可在 Step 6 从原版 i18n 文件复制扩展。
 */

// #LOCALES
// 语言注册表：语言名 → 翻译对象。
const LOCALES = {
  // 中文。
  'zh-cn': {
    UI_Next: '下一步',
    UI_Back: '返回',
    UI_Times: '次',
    UI_Count: '个',
    UI_Property_Charm: '颜值',
    UI_Property_Intelligence: '智力',
    UI_Property_Strength: '体质',
    UI_Property_Money: '家境',
    UI_Property_Spirit: '快乐',
    UI_Title_Remake: '人生重开模拟器',
    UI_Achievement: '成就',
    GAME_Year: '{n} 岁',
    GAME_Event: '[事件]',
    GAME_Talent: '[天赋]',
    GAME_Nothing: '(无事发生)',
    GAME_Start: '开局!',
    GAME_Over: '人生结束',
    GAME_Summary: '人生总结',
    GAME_Times: '重开次数',
    CMD_Unknown: '未知命令: {cmd}（输入 help 查看）',
  },
  // 英文。
  'en-us': {
    UI_Next: 'Next',
    UI_Back: 'Back',
    UI_Times: 'times',
    UI_Count: 'count',
    UI_Property_Charm: 'Charm',
    UI_Property_Intelligence: 'Intelligence',
    UI_Property_Strength: 'Strength',
    UI_Property_Money: 'Money',
    UI_Property_Spirit: 'Spirit',
    UI_Title_Remake: 'Life Restart Simulator',
    UI_Achievement: 'Achievement',
    GAME_Year: 'Age {n}',
    GAME_Event: '[Event]',
    GAME_Talent: '[Talent]',
    GAME_Nothing: '(nothing happened)',
    GAME_Start: 'Start!',
    GAME_Over: 'Life Over',
    GAME_Summary: 'Life Summary',
    GAME_Times: 'Remake Count',
    CMD_Unknown: 'Unknown command: {cmd} (type help)',
  },
}

// #loadLocale
// 加载指定语言的翻译对象。
//
// @param {string} name - 语言名（'zh-cn' / 'en-us'）
// @returns {object} 翻译对象；未知语言回退到 zh-cn
export function loadLocale(name) {
  // 未知语言回退中文。
  return LOCALES[name] || LOCALES['zh-cn']
}

// #t
// 取翻译值并替换 {n} 或 {key} 占位符。
// {n} 按下标取 args；{key} 按 args 对象的属性取。
//
// @param {object} locale - 翻译对象
// @param {string} key - 词条键
// @param {...*} args - 占位符参数（数组元素或单个对象）
// @returns {string} 翻译结果；缺失键返回 key 本身
export function t(locale, key, ...args) {
  // 取词条。
  const template = locale[key]
  // 缺失键原样返回。
  if (template === undefined) return key
  // 替换 {n}（下标）与 {name}（对象属性）占位符。
  return template.replace(/\{([0-9a-zA-Z_-]+)\}/g, (match, name) => {
    // 按下标取。
    const idx = Number(name)
    // 数字下标 → 取 args[idx]。
    let value
    if (Number.isInteger(idx)) {
      value = args[idx]
    } else if (name === 'n') {
      // {n} 别名：取第一个参数。
      value = args[0]
    } else {
      // {name}：取 args 对象的属性。
      value = args[0] ? args[0][name] : undefined
    }
    // 有值则替换，否则保留。
    return value !== undefined ? String(value) : match
  })
}
