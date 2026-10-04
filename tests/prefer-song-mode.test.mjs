// 曲が変わるたびの「動画 → 曲」強制切り替え。
//
// 以前は設定が無く、利用者が「動画」を選んでいても毎曲 .song-button を
// click していた(最大 10 回リトライ)。動画モードに留まる手段が無かった。
// 既定 ON = 今までどおりで、OFF にすれば動画モードを維持できる。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')
const namespaceSource = read('src/js/module/namespace.js')

test('既定は ON (今までの動き)', () => {
  assert.match(namespaceSource, /preferSongMode: true,/)
})

test('OFF なら切り替えない', () => {
  const start = uiSource.indexOf('function preferLyricsDefault(targetKey, attempt = 0) {')
  assert.notEqual(start, -1)
  const fn = uiSource.slice(start, uiSource.indexOf('\n}', start))
  assert.match(fn, /if \(!config\.preferSongMode\) return;/)
  // 打ち切りは click より先であること
  const guardAt = fn.indexOf('if (!config.preferSongMode) return;')
  const clickAt = fn.indexOf('songBtn.click()')
  assert.ok(guardAt !== -1 && clickAt !== -1 && guardAt < clickAt)
})

test('設定パネルに出て保存される', () => {
  assert.match(uiSource, /id="prefer-song-mode-toggle"/)
  assert.match(uiSource, /config\.preferSongMode = document\.getElementById\('prefer-song-mode-toggle'\)\.checked;/)
  assert.match(uiSource, /storage\.set\('ytm_prefer_song_mode', config\.preferSongMode\)/)
  assert.match(uiSource, /storage\.get\('ytm_prefer_song_mode'\)/)
})

test('4 言語ぶんの文言がある', () => {
  const hits = namespaceSource.match(/settings_prefer_song_mode: "/g) || []
  assert.equal(hits.length, 4)
})

// 読み込み直後のトグルは playback-mode が "NONE" のまま在り、少しして
// OMV_PREFERRED に決まる(実機)。"NONE" で諦めていたので、リンクから
// 開いたり読み込み直したりすると動画のまま残った
test('playback-mode が決まる前("NONE")は待ち、動画に決まったら「曲」へ切り替える', () => {
  const start = uiSource.indexOf('const PREFER_SONG_MAX_ATTEMPTS')
  const end = uiSource.indexOf('\n}', uiSource.indexOf('function preferLyricsDefault('))
  assert.ok(start !== -1 && end !== -1)
  const timers = []
  let clicks = 0
  const songBtn = { dispatchEvent: () => { clicks++; switcher.mode = 'ATV_PREFERRED' }, click: () => {} }
  const switcher = {
    mode: 'NONE',
    getAttribute: (k) => (k === 'playback-mode' ? switcher.mode : null),
    querySelector: () => songBtn,
  }
  const preferLyricsDefault = new Function('document', 'config', 'currentKey', 'setTimeout', 'MouseEvent',
    `${uiSource.slice(start, end + 2)}\nreturn preferLyricsDefault;`)(
    { querySelector: () => switcher }, { preferSongMode: true }, 'song', (fn) => timers.push(fn), class { })
  preferLyricsDefault('song')
  assert.equal(clicks, 0)
  assert.equal(timers.length, 1, '"NONE" では待ち直す')
  timers.shift()()
  assert.equal(clicks, 0)
  switcher.mode = 'OMV_PREFERRED'
  timers.shift()()
  assert.equal(clicks, 1)
  // 曲に決まっていれば何もしない
  switcher.mode = 'ATV_PREFERRED'
  timers.length = 0
  preferLyricsDefault('song')
  assert.equal(timers.length, 0)
})
