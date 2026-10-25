// 点路径状态容器：只存 JSON、写入可追踪、快照可深拷贝。

import { assertJson } from './json.js'

export { assertJson }

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])

function splitPath(path) {
  if (typeof path !== 'string' || path === '') throw new TypeError('path 必须是非空字符串')
  const parts = path.split('.')
  if (parts.some((p) => p === '')) throw new TypeError(`非法 path: ${path}`)
  for (const part of parts) {
    if (FORBIDDEN.has(part)) throw new TypeError(`path 不允许使用 ${part}: ${path}`)
  }
  return parts
}

function flatten(node, prefix, out) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out.push(key)
  }
  return out
}

export function createState(initial = {}) {
  assertJson(initial, 'initial')
  let tree = clone(initial) ?? {}
  const changes = []

  function get(path) {
    let node = tree
    for (const part of splitPath(path)) {
      if (node === null || typeof node !== 'object' || !Object.hasOwn(node, part)) return undefined
      node = node[part]
    }
    return clone(node)
  }

  function set(path, value, meta = {}) {
    const parts = splitPath(path)
    assertJson(value, path)
    let node = tree
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(node, part) || node[part] === null || typeof node[part] !== 'object' || Array.isArray(node[part])) {
        node[part] = {}
      }
      node = node[part]
    }
    const last = parts[parts.length - 1]
    const oldValue = clone(node[last])
    node[last] = clone(value)
    changes.push({ year: meta.year ?? null, path, modId: meta.modId ?? null, oldValue })
  }

  // 必须走 api.set（而不是闭包里的 set）：runtime 会替换 api.set 来挂冲突检测。
  function update(path, fn, meta = {}) {
    api.set(path, fn(get(path)), meta)
  }

  function keys(prefix = '') {
    return flatten(tree, '', []).filter((k) => k.startsWith(prefix)).sort()
  }

  const api = {
    get,
    set,
    update,
    keys,
    snapshot: () => clone(tree),
    load(snapshot) {
      assertJson(snapshot, 'snapshot')
      tree = clone(snapshot) ?? {}
      changes.length = 0
    },
    get changes() {
      return changes
    },
  }
  return api
}
