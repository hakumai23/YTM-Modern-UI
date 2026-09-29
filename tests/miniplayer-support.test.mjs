// 作り直された新しいプレイヤーバー(ytmusic-miniplayer)への対応。
//
// 2026-09 から一部の人に、ytmusic-player-bar の代わりに ytmusic-miniplayer
// (試験スイッチ music_web_enable_wiz_miniplayer)が出ている。旧バー決め打ちの
// ままだと、IMMERSION ボタンが出ず、Immersion 中は操作バーが画面の下に潜って
// 再生も曲送りもできず、曲の切り替わりの監視も組めなかった(実機で確認)。
// どちらのバーでも動くよう、探す所に新しいバーを並べる。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ui = read('src/js/module/lyrics-ui.js')
const pip = read('src/js/module/pip-manager.js')
const css = read('src/css/style.css')

test('バーを探す所は新旧どちらも見る', () => {
  assert.match(ui, /const PLAYER_BAR_SELECTOR = 'ytmusic-player-bar, ytmusic-miniplayer';/)
  // 監視・余白クリック・動画モードの印・ボタンの置き場所の判断
  assert.match(ui, /const targetNode = document\.querySelector\(PLAYER_BAR_SELECTOR\);/)
  assert.match(ui, /function setupPlayerBarBlankClickGuard\(\) \{\s*const bar = document\.querySelector\(PLAYER_BAR_SELECTOR\);/)
  // 旧バー決め打ちで残るのは、旧バーのシークバーのホバー時刻だけ
  // (新しいバーは YTM 自身がホバー時刻を出す。見つからなければ 60 秒で探すのをやめる)
  const hover = ui.slice(ui.indexOf('const adjustHoverTimeInfoPosition'), ui.indexOf('const parseLRCNoFlag'))
  const rest = ui.replace(hover, '')
  assert.doesNotMatch(rest, /document\.querySelector\(['"]ytmusic-player-bar['"]\)/)
})

test('曲名とアーティストは新しいバーからも読む', () => {
  assert.match(ui, /PLAYER_BAR_TITLE_SELECTOR = '[^']*ytmusic-player-bar, ytmusic-miniplayer \.ytmusicTrackInfoTitle'/)
  assert.match(ui, /PLAYER_BAR_BYLINE_SELECTOR = '[^']*ytmusic-player-bar, ytmusic-miniplayer \.ytmusicTrackInfoByline'/)
  assert.match(ui, /a\.yt-simple-endpoint, a\.ytAttributedStringLink/)
  assert.match(read('src/js/module/replay-manager.js'), /ytmusic-miniplayer \.ytmusicTrackInfoByline/)
})

test('再生中ずっと動く所では tick を起こさない(新しいバーの時刻・シークバーも)', () => {
  const noise = ui.slice(ui.indexOf('const PLAYER_BAR_NOISE_SELECTOR'), ui.indexOf(';', ui.indexOf('const PLAYER_BAR_NOISE_SELECTOR')))
  for (const s of ['.ytMusicMiniPlayerProgressBarWrapper', '.ytMusicMiniPlayerTimeInfo', '#right-controls', '.time-info']) {
    assert.ok(noise.includes(s), s)
  }
})

test('PiP の前へ・再生・次へは新しいバーのボタンも押せる', () => {
  for (const cls of ['PreviousButton', 'PlayPauseButton', 'NextButton']) {
    assert.match(pip, new RegExp(`ytmusic-miniplayer \\.ytmusicPlayerControls${cls}`), cls)
  }
})

test('Immersion 中は新しいバーも浮いた角丸のバーにし、Immersion の上に出す', () => {
  const rule = css.slice(css.indexOf('body.ytm-custom-layout ytmusic-miniplayer {'))
  const body = rule.slice(0, rule.indexOf('}'))
  assert.match(body, /position: fixed !important;/)
  assert.match(body, /z-index: 2000 !important;/)
  // 曲の情報は Immersion 側に出ているので隠し、YTM が狭い幅で隠す時刻は出す
  assert.match(css, /body\.ytm-custom-layout ytmusic-miniplayer \.ytMusicMiniPlayerTrackInfo \{\s*display: none !important;/)
  assert.match(css, /body\.ytm-custom-layout ytmusic-miniplayer \.ytMusicMiniPlayerTimeInfo \{\s*display: block !important;/)
})
