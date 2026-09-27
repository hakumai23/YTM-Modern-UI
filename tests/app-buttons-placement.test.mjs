// Immersion のボタン列の並び。
//
// 以前は 6 つのボタンが同じ重みで並び、統計(Daily Replay)が歌詞カードと
// 別バージョンの間に挟まっていた。今の曲と関係の無い統計や設定まで、
// 曲に対する操作に見えていた。
//
// 曲と歌詞に対する操作(歌詞メニュー・PiP・歌詞カード・別バージョン)を前に、
// アプリ全体の操作(Daily Replay・設定)を末尾の区切った組にまとめる。
// 画面の隅へ分ける案は実機で試してやめた。上端は YTM の検索バー
// (ホバーで出る)、右端は Up Next を開く帯、狭い画面と動画モードの隅は
// 曲/動画の切り替えが使っていて、右上に置いた統計のボタンは押しても
// 検索バーにクリックを取られた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ui = read('src/js/module/lyrics-ui.js')
const ns = read('src/js/module/namespace.js')
const css = read('src/css/style.css')
const card = read('src/js/module/lyric-card.js')

const configOf = (name) => {
  const start = ui.indexOf(`const ${name} = {`)
  assert.notEqual(start, -1, name)
  return ui.slice(start, ui.indexOf('\n  };', start))
}

test('曲の操作が前、統計と設定が後ろの組', () => {
  assert.match(ui, /btns\.push\(lyricsBtnConfig, pipBtnConfig, lyricCardBtnConfig, switchBtnConfig, replayBtnConfig, settingsBtnConfig\);/)
  for (const name of ['replayBtnConfig', 'settingsBtnConfig']) {
    assert.match(configOf(name), /group: 'app'/, name)
  }
  for (const name of ['lyricsBtnConfig', 'pipBtnConfig', 'lyricCardBtnConfig', 'switchBtnConfig']) {
    assert.doesNotMatch(configOf(name), /group:/, name)
  }
  assert.match(ui, /\(b\.group === 'app' \? ui\.appBtnArea : ui\.btnArea\)\.appendChild\(btn\)/)
})

test('後ろの組は同じ列の中にある(隠れ方も位置もボタン列と同じ)', () => {
  assert.match(ui, /ui\.btnArea\.appendChild\(ui\.appBtnArea\);/)
  // 列の外(position: fixed など)に出さない
  const rule = css.slice(css.indexOf('#ytm-app-btn-area {'), css.indexOf('}', css.indexOf('#ytm-app-btn-area {')))
  assert.doesNotMatch(rule, /position:/)
  // 区切りの線
  assert.match(css, /#ytm-app-btn-area::before \{[^}]*width: 1px;/)
})

test('組には読み上げ用の名前があり、4 言語ぶんある', () => {
  assert.match(ui, /ui\.appBtnArea\.setAttribute\('role', 'group'\);/)
  const fn = ui.slice(ui.indexOf('function applyButtonLabels()'), ui.indexOf('\nfunction updateMetaUI'))
  assert.match(fn, /ui\.appBtnArea\.setAttribute\('aria-label', t\('btn_group_app'\)\)/)
  assert.equal((ns.match(/btn_group_app:/g) || []).length, 4)
})

// 動画モードでは歌詞の列が画面から消える。以前はそこで歌詞カードを押すと、
// 見えない所で選ぶ状態に入り、Esc を押すまでキー操作を横取りしていた(実機)。
test('歌詞の列が画面に無ければ歌詞カードを始めない', () => {
  const start = card.slice(card.indexOf('const start = () => {'), card.indexOf('const cancel = () => {'))
  const guard = start.indexOf('!ui.lyrics.getClientRects().length')
  assert.ok(guard !== -1 && guard < start.indexOf('selecting = true'))
})

test('動画モードでは歌詞カードのボタンを出さず、歌詞の無い曲では薄くする', () => {
  assert.match(css, /#ytm-btn-area\.moviemode \.ytm-lyric-card-btn \{\s*display: none;/)
  assert.match(css, /body\.ytm-no-lyrics #ytm-btn-area \.ytm-lyric-card-btn \{\s*opacity: 0\.4;/)
  assert.match(configOf('lyricCardBtnConfig'), /cls: 'icon-btn ytm-lyric-card-btn'/)
})

// 「Lyrics」「PIP」だけが文字のボタンで、形も大きさも揃わず、英語のまま
// 表示言語に従わず、UI サイズを上げると「Lyrics」だけ横に伸びていた。
// 何のボタンかはホバーの説明と読み上げの名前で伝える(applyButtonLabels)。
test('ボタン列はすべて絵のボタンで、文字を直に出さない', () => {
  for (const name of ['lyricsBtnConfig', 'pipBtnConfig', 'lyricCardBtnConfig', 'replayBtnConfig', 'switchBtnConfig', 'settingsBtnConfig']) {
    const config = configOf(name)
    assert.match(config, /cls: 'icon-btn/, `${name} が絵のボタンになっていない`)
    const txt = config.match(/txt: '([^']*)'/)
    assert.ok(txt, name)
    assert.ok(txt[1] === '' || txt[1].startsWith('<svg'), `${name} が文字を出している: ${txt[1].slice(0, 20)}`)
  }
  // 歌詞メニューのボタンは .lyrics-btn で引かれている(候補があると跳ねる印など)
  assert.match(configOf('lyricsBtnConfig'), /cls: 'icon-btn lyrics-btn'/)
})
