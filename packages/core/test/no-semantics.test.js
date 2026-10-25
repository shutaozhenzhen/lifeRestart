import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// spec §8 禁用词表：引擎不认识任何游戏概念。
const BANNED = ['constitution', 'intelligence', 'strength', 'charm', 'talent', 'achievement', 'grade']
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')

test('packages/core/src 的非注释代码不含游戏语义词', () => {
  const hits = []
  for (const file of readdirSync(SRC).filter((f) => f.endsWith('.js'))) {
    const code = stripComments(readFileSync(join(SRC, file), 'utf8')).toLowerCase()
    for (const word of BANNED) if (code.includes(word)) hits.push(`${file}: ${word}`)
  }
  assert.deepEqual(hits, [])
})
