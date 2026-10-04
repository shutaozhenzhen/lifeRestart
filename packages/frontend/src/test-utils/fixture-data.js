/**
 * test-utils/fixture-data — **仅测试使用**的 fixture 演示数据构造器
 *
 * 为什么单独一个模块（而不是留在 utils/game-data.js 里）：
 *   产品代码**不允许内置任何游戏内容** —— 无内容 Mod = 天赋/事件池为空。
 *   以前 `loadGameData()` 在加载失败 / `lifeRestart-data` 被禁用时会降级到
 *   引擎测试 fixture，于是玩家在「所有 Mod 关闭」时看到的是
 *   「填充天赋1/2/3」「填充池容量」这类测试占位数据 —— 既是内容泄漏，
 *   也掩盖了"没有内容 Mod"这个真实原因（界面上没有任何解释）。
 *   现在降级路径改成**空内容**（utils/game-data.js 的 buildEmptyData），
 *   fixture 只剩测试用途，因此搬到这里：只被 *.spec.js 引用，不进应用代码路径。
 *
 * 本模块**不要** import 路由 / DOM / Vue —— node 环境的单测也要能直接引用。
 */

// 克隆工具。
import { clone } from 'game-engine/src/functions/util.js'
// 引擎 fixture（测试脚手架）。
import { AGE_DATA, TOTAL } from 'game-engine/src/fixtures/property.fixture.js'
import { TALENTS, EVENTS } from 'game-engine/src/fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS, CHARACTERS } from 'game-engine/src/fixtures/achievement-character.fixture.js'
// 测试专用天赋池容量补充（理由见该模块：fixture 池太小 → 抽卡一两格就停、
// 随机性不可观测；它**不是**产品内置内容）。
import { padTalents } from 'game-engine/src/fixtures/talent-padding.js'

// #buildFixtureData
// 组装 fixture 演示数据（结构 = fetchOriginalData / buildEmptyData 的返回值）。
//
// @returns {object} { age, total, talents, events, achievements, characters }
export function buildFixtureData() {
  // 逐字段深拷贝，避免用例之间互相污染。
  return {
    age: clone(AGE_DATA),
    total: { ...TOTAL },
    // 天赋表补测试专用占位：否则「十连抽」会因为等级 0 池只有 1 个而只出 1 张卡。
    talents: clone(padTalents(TALENTS)),
    events: clone(EVENTS),
    achievements: clone(ACHIEVEMENTS),
    // 名人（名人模式：候选人 + 固定属性 + 自带天赋）。fixture 里 3 位，正好够抽一批。
    characters: clone(CHARACTERS),
  }
}
