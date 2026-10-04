/**
 * 测试专用：天赋池容量补充（**仅测试使用，不进任何产品路径**）
 *
 * 为什么需要：
 *   抽卡按**等级分池**进行，而且"池空即停"（见 modules/talent.js 的 talentRandom：
 *   某等级池为空时直接 break，不会继续往下级找）。fixture 只有 9 个天赋、
 *   其中等级 0 只有 1 个 → 抽卡往往一两格就停，池子小到"不同种子抽出同一批"，
 *   于是「种子确实驱动抽取」这类断言变得不可观测（曾经用名为「填充天赋1/2/3」
 *   的 fixture 条目凑池容量 —— 那三个条目会被前端降级路径当内容显示给玩家，
 *   已删除；补池容量改成**在需要的用例里显式调用本模块**）。
 *
 * 与"默认填充天赋"的区别（重要）：
 *   引擎不内置任何游戏内容 —— 产品路径没有数据源时就是**空内容**。
 *   本模块只被 *.spec.js 引用，名字也刻意用「占位」而不是「填充」。
 */

// #padTalents
// 给天赋表补一批占位天赋（默认补 12 个：等级 0/1 各 4、等级 2/3 各 2）。
//
// @param {object} talents - 原天赋表（id → 天赋对象）
// @param {object} [counts] - 各等级补充数量
// @returns {object} 新天赋表（不修改入参）
export function padTalents(talents, { 0: g0 = 4, 1: g1 = 4, 2: g2 = 2, 3: g3 = 2 } = {}) {
  // 浅拷贝一份（值仍是原对象引用；调用方通常还会 clone）。
  const out = { ...talents }
  // 逐等级补充。
  const add = (grade, count) => {
    // 逐个造。
    for (let i = 1; i <= count; i++) {
      // ID 前缀刻意用 pad_（一眼能看出是测试占位，不是内容）。
      const id = `pad_${grade}_${i}`
      // 写入。
      out[id] = { id, name: `占位天赋 g${grade}-${i}`, description: '测试用池容量占位', grade }
    }
  }
  // 四个等级都补（等级 3 只剩 t_009，也补上）。
  add(0, g0)
  add(1, g1)
  add(2, g2)
  add(3, g3)
  // 返回。
  return out
}
