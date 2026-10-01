/**
 * create-life — 应用侧唯一的 Life 构造入口
 *
 * 为什么需要它（真实故障复盘）：
 *   此前 Life 的构造散落在 store.init 里，`storage` 一度没传 → 引擎悄悄退回
 *   内存实现，重开次数/成就/事件收集全部无法跨局保留，而"该传哪些依赖"这个
 *   事实只存在于一个函数体里，没有任何测试能把它钉住。
 *
 * 现在：**所有应用侧依赖只在这一处决定**，任何页面/模块要用 Life 都必须经过它；
 * 接线的正确性由 create-life.spec.js 的契约测试守护。
 */

// 引擎主控制器。
import Life from 'game-engine/src/modules/life.js'
// localStorage 适配器（跨局持久化：重开次数 TMS / 成就 ACHV / 已见事件 AEVT）。
import { createLifeStorage } from '../utils/life-storage.js'

// #createAppLife
// 创建一局游戏的 Life 实例（应用标准依赖组合）。
//
// @param {object} params
// @param {object} params.data - 游戏数据（age/talents/events/achievements/characters）
// @param {object} [params.logger] - 日志器（缺省静默）
// @param {object} [params.storage] - 存储适配器（缺省 localStorage 适配器；模拟传内存实现）
// @param {Function} [params.random] - 随机源（缺省 Math.random；批量模拟传种子 RNG 以复现）
// @returns {Life} 引擎实例
export function createAppLife({ data, logger, storage, random } = {}) {
  // 组装：数据 + 日志 + **持久化存储**（三者缺一都会造成静默功能缺失）。
  return new Life({
    // 游戏数据。
    data,
    // 日志器。
    logger,
    // 存储：缺省用 localStorage 适配器（测试/模拟可换成内存实现）。
    storage: storage || createLifeStorage(),
    // 随机源：显式传入则用（可复现），否则引擎默认 Math.random。
    random,
  })
}
