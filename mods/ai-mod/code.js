// AI Mod code.js — 通过 gameAPI 创建 AI Mod 增强器并注册钩子。
// 由 loader 加载执行，作用域隔离（new Function），仅注入 gameAPI。
// 生成逻辑（校验重试 + fallback）单一实现在 game-engine/src/ai/ai-mod.js，
// 经 gameAPI.createAIMod 暴露，这里不再重复实现。

// 工厂可用（loader 注入了 aiModFactory）且已配置 AI。
if (gameAPI.createAIMod) {
  // 创建 AI Mod 增强器（读取 gameAPI.ai 的配置）。
  const aiMod = gameAPI.createAIMod({})
  // 注册钩子（onTalentPoolGenerate / onYearAdvance）。
  aiMod.register()
  // 记录（日志经 console，loader 隔离执行）。
  console.log('[ai-mod] AI Mod 增强器已注册（工厂模式）')
}
