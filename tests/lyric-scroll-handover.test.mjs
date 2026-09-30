// 手で歌詞をスクロールした後、自動の追従が二度と戻らなかった。
//
// 実機(music.youtube.com)で、ホイールで先の歌詞を読みに行って手を離すと、
// 3 秒後に「手で見ている」状態は解けるのに scrollTop が止まったままで、
// 歌っている行は画面外に置き去りになった。その間 Daily Replay の累計行数が
// 2 秒ごとに 140 ずつ増えていた。
//
// 当時は「前回自分が書いた位置」からずれていたら今の位置をばねの起点として
// 引き継ぐ時に、「自分が書いた位置」を更新していなかったので、毎フレーム手を引き、
// 印を戻し、また頼み直す、を繰り返していた。いまは行の動きを合成側に渡して
// いるが、同じ取りこぼしが無いことをここで見ている。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { makeLyrics } from './lyric-scroll-harness.mjs'

const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

const sliceBetween = (from, to) => {
  const start = uiSource.indexOf(from)
  const end = uiSource.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return uiSource.slice(start, end)
}

test('手で動かした後でも、次に頼まれた行まで追従する', () => {
  const h = makeLyrics()
  h.goTo(10, true)
  h.goTo(11)
  h.settle()

  // 利用者がホイールで先を読みに行く(自動スクロールの外で scrollTop が変わる)
  h.container.scrollTop = 1800
  h.fireScroll()
  // 手を離して 3 秒たつと、強調側が印を戻して頼み直す
  h.container._lastScrolledIndex = -1

  let requests = 0
  for (let f = 0; f < 180; f++) {
    if (h.container._lastScrolledIndex !== 11) {
      requests += 1
      h.goTo(11)
    }
    h.clock.advance(1000 / 60)
  }
  const center = h.rows[11].visualTop() + 43 / 2
  assert.ok(Math.abs(center - h.container.clientHeight / 2) < 1, `歌っている行へ戻っていない: ${center}`)
  assert.equal(requests, 1, '同じ行への頼み直しが繰り返されている')
})

test('動いている最中に手で触ったら、印を戻して出し直せるようにする', () => {
  const h = makeLyrics()
  h.goTo(10, true)
  h.goTo(11)
  for (let f = 0; f < 5; f++) h.clock.advance(1000 / 60)
  h.container.scrollTop += 200 // 動いている途中で利用者がスクロールした
  h.fireScroll()
  assert.equal(h.container._lastScrolledIndex, -1)
})

test('Daily Replay の累計行数は、行が進んだ時だけ数える', () => {
  const highlight = sliceBetween('if (isPrimary && idx !== (container._lastScrolledIndex ?? -1)) {', '// 【PIP（小窓）】')
  const calls = highlight.split('ReplayManager.incrementLyricCount()').length - 1
  assert.equal(calls, 1)
  assert.match(
    highlight,
    /if \(idx !== _lastCountedLyricIndex\) \{\s*_lastCountedLyricIndex = idx;\s*ReplayManager\.incrementLyricCount\(\);/,
    '寄せ直しのたびに同じ行を数え直している',
  )
  // 曲が変われば数え直す
  const songChange = sliceBetween('lastActiveIndex = -1;\n    _previousActiveIndices.clear();', 'isUserScrolling = false;')
  assert.match(songChange, /_lastCountedLyricIndex = -1;/)
})
