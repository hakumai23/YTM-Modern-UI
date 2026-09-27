// 英語の句読点を前の語から離さない。
//
// 単語同期の行は語ごとに inline-block の span に分かれる。句読点が
// 別の単位だと、語と句読点の間で折り返せてしまう。実機(アイドル /
// SimpMusic 単語同期)で「(Oh, my savior」「, oh, my saving」「grace)」と、
// 行頭にカンマが来ていた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
const start = source.indexOf('const isSpaceGlyph')
const end = source.indexOf('// ── 行ぜんたいの「時刻 → 進んだ px」表を作る')
assert.ok(start !== -1 && end !== -1)
const sandbox = { console, Intl, WORD_DEFAULT_SEC: 0.4 }
vm.createContext(sandbox)
vm.runInContext(`${source.slice(start, end)}\nglobalThis._b = buildLyricWordUnits`, sandbox)
const build = sandbox._b

// SimpMusic の単語同期と同じく、語ごとに時刻(ミリ秒)を持ち、句読点も
// 独立した語で届く。句読点の前には空白を置かない。
const words = (list) => {
  const chars = []
  list.forEach(([text, sec], i) => {
    chars.push({ c: text, t: sec * 1000 })
    if (i < list.length - 1 && !/^[,.;:)…]/.test(list[i + 1][0])) chars.push({ c: ' ', t: sec * 1000 + 100 })
  })
  return chars
}

test('カンマは前の語と同じ単位になる', () => {
  const units = build(words([['(Oh', 0], [',', 0.3], ['my', 0.5], ['savior', 0.8], [',', 1.2], ['oh', 1.4]]), 2)
  const texts = units.filter(u => u.type === 'word').map(u => u.text)
  assert.ok(texts.includes('savior,'), texts.join(' | '))
  assert.ok(!texts.some(t => /^[,.;:]/.test(t)), `句読点で始まる単位: ${texts.join(' | ')}`)
})

test('ピリオド・セミコロン・コロン・三点リーダーも前に付く', () => {
  const units = build(words([['go', 0], ['.', 0.2], ['wait', 0.5], [';', 0.7], ['so', 0.9], [':', 1.1], ['oh', 1.3], ['…', 1.5]]), 2)
  const texts = units.filter(u => u.type === 'word').map(u => u.text)
  assert.deepEqual([...texts], ['go.', 'wait;', 'so:', 'oh…'])
})

test('語の時刻は崩さない(句読点の分だけ語が長くなる)', () => {
  const units = build(words([['savior', 0.8], [',', 1.2], ['oh', 1.4]]), 2000)
  const savior = units.find(u => u.text === 'savior,')
  assert.ok(Math.abs(savior.start - 0.8) < 1e-9, `start ${savior.start}`)
  assert.ok(savior.end >= 1.2 - 1e-9, `end ${savior.end}`)
})
