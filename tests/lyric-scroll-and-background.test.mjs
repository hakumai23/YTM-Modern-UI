// 稀に起きる2つの取りこぼし。
//
// ■ 背景が入れ替わらない
// 曲が変わっても前の画像の読み込みは止まらない(DOM から外しても onload は
// 発火する)。前の画像が遅れて読み終わると、新しい背景を古いもので塗り潰す。
// アートワーク本体は replaceChildren で即座に入れ替わるので、
// 「背景だけ前の曲のまま」に見える。
//
// ■ 自動スクロールが止まる
// 他の要因で scrollTop が 4px 以上動くと(翻訳の到着で行の高さが変わる、
// リサイズなど)、寄せた位置はもう合っていない。それでも「その行へスクロール
// 済み」の印が付いたままだと、次の行が来るまで追従が戻らない。
// (印を戻す所そのものは lyric-scroll-motion.test.mjs で見ている)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

// ── 背景 ──────────────────────────────────────────────

test('古い画像の読み込みは新しい背景を塗り潰さない', () => {
  const fn = uiSource.slice(
    uiSource.indexOf('function updateMetaUI(meta) {'),
    uiSource.indexOf('ui.lyrics.innerHTML', uiSource.indexOf('function updateMetaUI(meta) {')),
  )
  assert.match(fn, /const bgToken = \+\+_bgLoadToken;/)
  assert.match(fn, /if \(bgToken !== _bgLoadToken\) return;/)
  // onload と onerror の両方を塞いでいること
  const guards = fn.match(/if \(bgToken !== _bgLoadToken\) return;/g) || []
  assert.equal(guards.length, 2, `塞ぎ漏れがある (${guards.length}箇所)`)
})

test('世代は曲ごとに進む', () => {
  const sandbox = { console }
  vm.createContext(sandbox)
  vm.runInContext(`
    let _bgLoadToken = 0;
    const next = () => ++_bgLoadToken;
    const stale = (t) => t !== _bgLoadToken;
    globalThis.next = next; globalThis.stale = stale;
  `, sandbox)
  const first = sandbox.next()
  const second = sandbox.next()
  assert.equal(sandbox.stale(first), true, '前の曲の読み込みが通ってしまう')
  assert.equal(sandbox.stale(second), false, '今の曲の読み込みが捨てられている')
})

// ── 自動スクロール ────────────────────────────────────

test('即時ジャンプの意図を、見送った回に捨てない', () => {
  // 捨てると、動けるようになった時に 0 秒位置からゆっくり流れる
  const block = uiSource.slice(
    uiSource.indexOf("const scrollBehavior = container._instantNextScroll"),
    uiSource.indexOf('ReplayManager.incrementLyricCount()'),
  )
  // 歌詞カードで行を選んでいる間も同じ所で見送る
  const bail = block.match(/if \(isUserScrolling(?: \|\| _lyricsAutoFollowHold)?\) continue;/)
  const bailAt = bail ? bail.index : -1
  const clearAt = block.indexOf('container._instantNextScroll = false;')
  assert.ok(bailAt !== -1 && clearAt !== -1)
  assert.ok(bailAt < clearAt, '見送る前に意図を捨てている')
})

test('ユーザーが掴んでいる間は出し直さない', () => {
  const block = uiSource.slice(
    uiSource.indexOf("const scrollBehavior = container._instantNextScroll"),
    uiSource.indexOf('ReplayManager.incrementLyricCount()'),
  )
  assert.match(block, /if \(isUserScrolling(?: \|\| _lyricsAutoFollowHold)?\) continue;/)
})

// 端に当たった時の記録・手で動かした時の引き継ぎは lyric-scroll-motion.test.mjs で見ている。

test('先頭へ戻す2箇所は、スクロールの後始末を通している', () => {
  const render = uiSource.slice(
    uiSource.indexOf('function renderLyrics(data) {'),
    uiSource.indexOf('_previousActiveIndices.clear();'),
  )
  assert.match(render, /resetLyricScrollState\(ui\.lyrics\)/)
  assert.doesNotMatch(
    uiSource.slice(uiSource.indexOf('const tick = async () => {')),
    /ui\.lyrics\.scrollTop = 0/,
    '記録を残したまま scrollTop を書いている',
  )
})
