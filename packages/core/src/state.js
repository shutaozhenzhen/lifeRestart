// 点路径状态容器：只存 JSON、写入可追踪、快照可深拷贝。

import { assertJson } from './json.js'

export { assertJson }

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function splitPath(path) {
  if (typeof path !== 'string' || path === '') throw new TypeError('path 必须是非空字符串')
  const parts = path.split('.')
  if (parts.some((p) => p === '')) throw new TypeError(`非法 path: ${path}`)
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
      if (node === null || typeof node !== 'object' || !(part in node)) return undefined
      node = node[part]
    }
    return clone(node)
  }

  function set(path, value, meta = {}) {
    const parts = splitPath(path)
    assertJson(value, path)
    let node = tree
    for (const part of parts.slice(0, -1)) {
      if (node[part] === null || typeof node[part] !== 'object' || Array.isArray(node[part])) {
        node[part] = {}
      }
      node = node[part]
    }
    const last = parts[parts.length - 1]
    const oldValue = clone(node[last])
    node[last] = clone(value)
    changes.push({ year: meta.year ?? null, path, modId: meta.modId ?? null, oldValue })
  }

  function update(path, fn, meta = {}) {
    set(path, fn(get(path)), meta)
  }

  function keys(prefix = '') {
    return flatten(tree, '', []).filter((k) => k.startsWith(prefix)).sort()
  }

  return {
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
}
