// 事件总线：引擎与 Mod 唯一的输出通道。

import { assertJson } from './json.js'

const FREEZABLE = ['text', 'payload', 'delta']

export function createBus() {
  const list = []

  function emit(raw) {
    if (raw === null || typeof raw !== 'object') throw new TypeError('entry 必须是对象')
    const { kind, year, modId } = raw
    if (typeof kind !== 'string' || kind === '') throw new TypeError('entry.kind 必须是非空字符串')
    if (!Number.isInteger(year)) throw new TypeError('entry.year 必须是整数')
    if (typeof modId !== 'string' || modId === '') throw new TypeError('entry.modId 必须是非空字符串')

    const entry = { kind, year, modId }
    for (const key of FREEZABLE) {
      if (raw[key] === undefined) continue
      if (key === 'text') {
        if (typeof raw.text !== 'string') throw new TypeError('entry.text 必须是字符串')
        entry.text = raw.text
      } else {
        assertJson(raw[key], `entry.${key}`)
        entry[key] = JSON.parse(JSON.stringify(raw[key]))
      }
    }
    Object.freeze(entry)
    list.push(entry)
    return entry
  }

  return {
    emit,
    get events() {
      return list.slice()
    },
    clear() {
      list.length = 0
    },
  }
}
