// 临时探针：用真实数据跑一遍名人模式的引擎路径（用完即删）
import { test } from 'vitest'
import { loadRealData } from './src/test-utils/real-data.js'
import { createAppLife } from './src/life/create-life.js'

test('probe: characterRandom + 点数语义', async () => {
  const data = loadRealData()
  const life = createAppLife({ data })
  await life.initial()
  life.config()
  console.log('characters 表规模 =', Object.keys(data.characters).length)
  const r = life.characterRandom()
  console.log('normal 数量 =', r.normal.length, 'unique =', JSON.stringify(r.unique))
  for (const c of r.normal) {
    console.log('  名人:', c.id, c.name, JSON.stringify(c.property), '天赋', JSON.stringify(c.talent.map((t) => (t ? t.id : null))))
    console.log('    天赋对象是否都找到:', c.talent.every((t) => t && t.name), '名称:', c.talent.map((t) => (t ? t.name : '(缺失)')).join('/'))
  }
  console.log('默认点数(未 remake) =', life.getPropertyPoints())
  life.remake([])
  const baseline = life.getPropertyPoints()
  console.log('remake([]) 后 =', baseline, '（= defaultPropertyPoints）')
  const ids = r.normal[0].talent.map((t) => t.id)
  const replaces = life.remake(ids)
  console.log('remake(名人天赋) 后 =', life.getPropertyPoints(), '→ 额外 =', life.getPropertyPoints() - baseline)
  console.log('替换链返回 =', JSON.stringify(replaces))
  console.log('属性上限 propertyAllocateLimit =', JSON.stringify(life.propertyAllocateLimit ?? null))
})
