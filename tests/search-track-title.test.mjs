// 歌詞検索に投げる曲名の正規化。
//
// 以前の /\s*[\(-\[].*?[\)-]].*/ は、末尾の [\)-]] が「) または - の直後に
// リテラルの ]」を要求するため、普通の曲名には一度も当たっていなかった。
// "(feat. X)" や " - Remix" が付いたまま各プロバイダへ飛んでいた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const namespaceSource = fs.readFileSync(
  new URL('../src/js/module/namespace.js', import.meta.url),
  'utf8',
)

const start = namespaceSource.indexOf("const normalizeSearchTrackTitle = (s, artist = '') => {")
assert.notEqual(start, -1, 'normalizeSearchTrackTitle should be present')
const end = namespaceSource.indexOf('\n};', start) + 3
const context = vm.createContext({})
vm.runInContext(`${namespaceSource.slice(start, end)}\nthis.fn = normalizeSearchTrackTitle`, context)
const normalize = context.fn

test('括弧の中身を落とす', () => {
  assert.equal(normalize('Song (Live)'), 'Song')
  assert.equal(normalize('Song [MV]'), 'Song')
  assert.equal(normalize('Song (feat. X)'), 'Song')
  assert.equal(normalize('曲名（TVサイズ）'), '曲名')
  assert.equal(normalize('曲名【MV】'), '曲名')
})

test('スペースで挟まれたハイフン以降を落とす', () => {
  assert.equal(normalize('Song - Remix'), 'Song')
  assert.equal(normalize('Song – Live Version'), 'Song')
  assert.equal(normalize('Song (feat. X) - Live'), 'Song')
})

test('曲名の一部のハイフンは残す', () => {
  assert.equal(normalize('Re-Bye'), 'Re-Bye')
  assert.equal(normalize('X-Ray'), 'X-Ray')
})

test('全部落ちる曲名は元のまま返す', () => {
  assert.equal(normalize('(Interlude)'), '(Interlude)')
  assert.equal(normalize(''), '')
  assert.equal(normalize(null), '')
})

test('普通の曲名は変えない', () => {
  assert.equal(normalize('Song'), 'Song')
  assert.equal(normalize('  Song  '), 'Song')
})

// ライブ映像・MV に多い「アーティスト – 曲名」。前を曲名と取ると、アーティスト名
// だけで検索して別の曲が当たっていた(星野源「Family Song」のライブ映像で
// Superorganism「Into The Sun feat. 星野源」の歌詞が出た)
test('「アーティスト – 曲名」は、前がアーティスト名なら後ろを曲名にする', () => {
  assert.equal(normalize('星野源 – Family Song (Live at Saitama Super Arena 2017)', '星野源'), 'Family Song')
  assert.equal(normalize('星野源 - DOME TOUR “POP VIRUS” at TOKYO DOME (YouTube Music Weekend vol.6)', '星野源'), 'DOME TOUR “POP VIRUS” at TOKYO DOME')
  // チャンネル名のようにアーティスト名が長い・短い時も
  assert.equal(normalize('星野源 – Family Song (Live)', '星野源 Gen Hoshino'), 'Family Song')
  assert.equal(normalize('Daft Punk - Get Lucky (Official Video)', 'Daft Punk'), 'Get Lucky')
  // 前がアーティストでなければ今までどおり(後ろは版の説明)
  assert.equal(normalize('Song - Remix', 'Someone'), 'Song')
  assert.equal(normalize('Song – Live Version', 'Someone'), 'Song')
  // アーティスト名が分からなければ今までどおり
  assert.equal(normalize('星野源 – Family Song'), '星野源')
})

test('曲名を検索に使う所は、アーティスト名も渡す', () => {
  const ui = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
  const calls = ui.match(/normalizeSearchTrackTitle\([^)]*\)/g) || []
  assert.ok(calls.length >= 2)
  for (const c of calls) assert.match(c, /, artist\)$/, c)
})
