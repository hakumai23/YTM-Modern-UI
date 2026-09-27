// 手で歌詞をスクロールした後、自動の追従が二度と戻らなかった。
//
// 実機(music.youtube.com)で、ホイールで先の歌詞を読みに行って手を離すと、
// 3 秒後に「手で見ている」状態は解けるのに scrollTop が止まったままで、
// 歌っている行は画面外に置き去りになった。その間 Daily Replay の累計行数が
// 2 秒ごとに 140 ずつ増えていた。
//
// requestLyricScroll は「前回自分が書いた位置」からずれていたら、今の位置を
// ばねの起点として引き継ぐ。その時に「自分が書いた位置」を更新していなかった
// ので、stepLyricScroll が同じずれを見て毎回手を引き、印を戻し、次のフレームで
// また頼み直す、を繰り返していた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

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

const loadSpring = () => {
  const clock = { now: 0 }
  const context = vm.createContext({
    Math,
    Number,
    performance: { now: () => clock.now },
    ui: { lyrics: null },
    PipManager: { pipLyricsContainer: null },
    suppressUserScrollDetection() {},
  })
  vm.runInContext(
    `${sliceBetween('// ── 行送りのスクロール', 'function startLyricRafLoop')}
    this.request = requestLyricScroll; this.step = stepLyricScroll;`,
    context,
  )
  return context
}

// 歌詞の強調側がやっていることの縮図: 「まだ寄せていない」印が立っていれば
// 毎フレーム頼み直す。stepLyricScroll が手を引くと印は -1 に戻る。
const runFrames = (spring, container, target, frames) => {
  for (let f = 0; f < frames; f++) {
    if (container._lastScrolledIndex !== 7) {
      spring.request(container, target, false)
      container._lastScrolledIndex = 7
    }
    spring.step(container, 1 / 60)
  }
}

test('手で動かした後でも、次に頼まれた行まで追従する', () => {
  const spring = loadSpring()
  const container = { scrollTop: 0 }

  runFrames(spring, container, 300, 180)
  assert.ok(Math.abs(container.scrollTop - 300) < 1, `最初の行に寄っていない: ${container.scrollTop}`)

  // 利用者がホイールで先を読みに行く(ばねの外で scrollTop が変わる)
  container.scrollTop = 900
  // 手を離して 3 秒たつと、強調側が印を戻して頼み直す
  container._lastScrolledIndex = -1

  let requests = 0
  for (let f = 0; f < 180; f++) {
    if (container._lastScrolledIndex !== 7) {
      requests += 1
      spring.request(container, 400, false)
      container._lastScrolledIndex = 7
    }
    spring.step(container, 1 / 60)
  }

  assert.ok(Math.abs(container.scrollTop - 400) < 1, `歌っている行へ戻っていない: ${container.scrollTop}`)
  assert.equal(requests, 1, '同じ行への頼み直しが繰り返されている')
})

test('ばねが動いている最中に手で触ったら、そこで手を引く', () => {
  const spring = loadSpring()
  const container = { scrollTop: 0 }
  spring.request(container, 1000, false)
  for (let f = 0; f < 5; f++) spring.step(container, 1 / 60)
  assert.ok(container._scrollTarget !== undefined)

  container.scrollTop += 200 // 動いている途中で利用者がスクロールした
  spring.step(container, 1 / 60)
  assert.equal(container._scrollTarget, undefined, '利用者の操作を上書きし続けている')
  assert.equal(container._lastScrolledIndex, -1)
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
