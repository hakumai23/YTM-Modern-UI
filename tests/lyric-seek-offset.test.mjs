// 歌詞の行を押した時のシーク、新バーのシークバーの当たり判定。
//
// ・ズレ直し(syncOffset)をした後に行を押すと、直す前のタイムスタンプへ
//   飛んでいた。歌詞は「曲内の時刻 + ズレ直し」で光らせているので、
//   シークする時はズレ直しのぶんを引いて video の時刻に戻す。
// ・新バー(ytmusic-miniplayer)は、時刻の吹き出しが出る範囲(外枠 23px)と
//   押してシークできる範囲(中の線 3px)が違い、吹き出しが出たのに押しても
//   飛ばない所があった。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ui = read('src/js/module/lyrics-ui.js')
const pip = read('src/js/module/pip-manager.js')
const css = read('src/css/style.css')

const slice = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to))

// 光らせる側(getCurrentPlaybackTimeSec)とシークする側を、同じ偽の video で動かす
const makeClock = ({ syncOffset, timeOffset = 0 }) => {
  const video = { currentTime: 0, duration: 300 }
  const context = vm.createContext({
    Math, Number,
    config: { syncOffset },
    timeOffset,
    document: { querySelector: (s) => (s === 'video' ? video : null) },
  })
  vm.runInContext(`
    ${slice(ui, 'const toLocalPlaybackTime =', 'const findMeaningIndexByTime =')}
    this.seekToLyricTime = seekToLyricTime;
    this.getCurrentPlaybackTimeSec = getCurrentPlaybackTimeSec;
  `, context)
  return { video, ...context }
}

test('ズレ直しの後に行を押すと、その行がちょうど光る位置へ飛ぶ', () => {
  for (const syncOffset of [0, 1000, 2500, -1500]) {
    const c = makeClock({ syncOffset })
    c.seekToLyricTime(32.54)
    assert.ok(Math.abs(c.getCurrentPlaybackTimeSec() - 32.54) < 1e-9, `syncOffset=${syncOffset}`)
  }
})

test('連続再生で video の時刻が曲の頭で 0 に戻っていなくても合う', () => {
  const c = makeClock({ syncOffset: 1200, timeOffset: 241.3 })
  c.seekToLyricTime(10)
  assert.ok(Math.abs(c.video.currentTime - (10 - 1.2 + 241.3)) < 1e-9)
  assert.ok(Math.abs(c.getCurrentPlaybackTimeSec() - 10) < 1e-9)
})

test('曲の頭より前へは飛ばない(ズレ直しが行の時刻より大きい時)', () => {
  const c = makeClock({ syncOffset: 3000, timeOffset: 100 })
  c.seekToLyricTime(1)
  assert.equal(c.video.currentTime, 100)
})

test('Immersion の歌詞も PiP の歌詞も、同じシークを使う', () => {
  assert.match(ui, /if \(!hasTimestamp \|\| !line \|\| line\.time == null\) return;\s*seekToLyricTime\(line\.time\);/)
  assert.match(pip, /if \(!isNaN\(time\)\) seekToLyricTime\(time\);/)
  // ズレ直しを足さずに直接シークする所が残っていない
  assert.doesNotMatch(ui, /currentTime = line\.time \+ timeOffset/)
  assert.doesNotMatch(pip, /currentTime = time \+ timeOffset/)
})

test('新バーのシークバーは、吹き出しが出る範囲ぜんぶで押せる', () => {
  const wrap = slice(css, 'body.ytm-custom-layout ytmusic-miniplayer .ytMusicMiniPlayerProgressBarWrapper {', 'body.ytm-custom-layout ytmusic-miniplayer .ytMusicMiniPlayerRightSection {')
  // 外枠の余白は 0 にして、
  assert.match(wrap, /\.ytMusicMiniPlayerProgressBarWrapper \{[^}]*padding: 0 !important;/)
  // シークバー自身が同じ 23px(上下 10px + 線 3px)を受け持つ。線は背景を中身に切って細いまま
  const bar = wrap.slice(wrap.indexOf('body.ytm-custom-layout ytmusic-miniplayer .ytMusicMiniPlayerProgressBar {'))
  assert.match(bar, /height: 23px !important;\s*padding: 10px 0 !important;/)
  assert.match(bar, /background-clip: content-box !important;/)
  // 乗せた時は線が 5px(YTM と同じ)。全体の高さは変えない
  assert.match(bar, /:is\(:hover, :active, :focus-visible\) \{\s*height: 23px !important;\s*padding: 9px 0 !important;/)
})
