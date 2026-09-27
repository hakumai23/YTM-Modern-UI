// Immersion のボタン列に名前を付ける。
//
// 統計(Daily Replay)・別バージョン・設定は絵だけのボタンで、title も
// aria-label も無かった(実機で確認)。何のボタンかホバーしても分からず、
// 読み上げでも名前が無い。表示言語を変えたら付け直す。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const ui = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
const ns = fs.readFileSync(new URL('../src/js/module/namespace.js', import.meta.url), 'utf8')

test('ボタン列のすべてのボタンに名前の鍵がある', () => {
  const start = ui.indexOf('const lyricsBtnConfig = {')
  const end = ui.indexOf('btns.push(lyricsBtnConfig', start)
  const configs = ui.slice(start, end)
  for (const key of ['btn_lyrics_menu', 'btn_pip', 'btn_replay', 'btn_switch_version', 'settings_title']) {
    assert.match(configs, new RegExp(`label: '${key}'`), `${key} が付いていない`)
  }
})

test('名前は title と aria-label の両方に入り、言語を変えたら付け直す', () => {
  assert.match(ui, /function applyButtonLabels\(\) \{[\s\S]*btn\.title = label;[\s\S]*btn\.setAttribute\('aria-label', label\);/)
  assert.match(ui, /if \(uiLanguageChanged\) \{\s*applyButtonLabels\(\);/)
})

test('名前の文言は 4 言語ぶんある', () => {
  for (const key of ['btn_lyrics_menu', 'btn_pip', 'btn_replay', 'btn_switch_version']) {
    assert.equal((ns.match(new RegExp(`${key}:`, 'g')) || []).length, 4, key)
  }
})
