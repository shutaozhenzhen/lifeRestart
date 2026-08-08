// AI Mod code.js — 通过 gameAPI 注册 AI 增强钩子。
// 由 loader 加载执行，作用域隔离（new Function），仅注入 gameAPI。
// 未配置 API Key 时静默跳过（不注册钩子，游戏正常跑原版）。

// 检查 AI 客户端是否可用。
const aiAvailable = gameAPI.ai && gameAPI.ai.available

// 不可用：跳过（原版体验）。
if (aiAvailable) {
  // 注册：天赋池生成时注入 AI 天赋。
  gameAPI.on('onTalentPoolGenerate', async (payload) => {
    try {
      // 调用 AI 生成天赋。
      const talent = await gameAPI.ai.generate({
        system: '你是人生重开模拟器的天赋设计器。输出 JSON：{"id":"字符串ID","name":"天赋名","description":"描述","condition":"用 params.XXX 的条件，如 params.CHR > 5","effect":{"属性键":数值},"grade":数字}。只输出 JSON。',
        user: '请生成一个有趣的天赋。',
      })
      // 结构校验（简单防御）。
      if (talent && talent.id && talent.name) {
        // 注入天赋池。
        payload.pool.push(talent)
      }
    } catch (e) {
      // 失败静默（不影响原版流程）。
    }
  })

  // 注册：翻年时注入 AI 事件（异步补充）。
  gameAPI.on('onYearAdvance', async (payload) => {
    try {
      // 调用 AI 生成事件。
      const event = await gameAPI.ai.generate({
        system: '你是人生重开模拟器的剧情生成器。输出 JSON：{"id":"字符串ID","event":"事件描述","effect":{"属性键":数值},"include":"可选条件"}。只输出 JSON。',
        user: `当前年龄 ${payload.age}，请生成一个人生事件。`,
      })
      // 校验。
      if (event && event.id && event.event) {
        // 注入事件流水。
        payload.content.push({ type: 'EVT', description: event.event, grade: 0 })
      }
    } catch (e) {
      // 失败静默。
    }
  })
}
