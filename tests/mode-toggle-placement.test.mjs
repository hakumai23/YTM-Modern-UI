// IMMERSION ボタンの置き場所。
//
// 以前は .right-controls-buttons 決め打ちで差し込んでいて、YTM が
// プレイヤーバーの作りを変えるとボタンが出ず、Immersion を開く手段が
// 無くなっていた。候補を前から順に試し、どれも使えなければ画面の隅に
// 浮かせる。消されたり監視先が作り直されたりしても、見張りが戻す。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ui = read('src/js/module/lyrics-ui.js')
const css = read('src/css/style.css')

// 置き場所を選ぶ部分だけを、偽の document の上で動かす
const pickSrc = ui.slice(ui.indexOf('const MODE_TOGGLE_HOSTS = ['), ui.indexOf('const placeModeToggle ='))
const el = (name, shown = true, visibility = 'visible') => ({ name, visibility, isConnected: true, getClientRects: () => (shown ? [{}] : []) })
const pickWith = (nodes) => {
  const document = { querySelector: (s) => nodes[s] || null, body: el('body') }
  // バーは PlayerBar(player-bar.js)が探す。ここでは知っている作りの旧バーだけ
  const PlayerBar = { get: () => nodes['ytmusic-player-bar'] || null, query: (s) => document.querySelector(s) }
  const getComputedStyle = (e) => ({ visibility: e.visibility || 'visible' })
  const pick = new Function('document', 'window', 'PlayerBar', 'moviemode', 'getComputedStyle', `${pickSrc}\nreturn pickModeToggleHost;`)(document, {}, PlayerBar, false, getComputedStyle)
  const host = pick()
  return host && { name: host.el.name, how: host.how, ...(host.primary && host.el.name === 'right' ? { primary: true } : {}) }
}

test('今の作りでは .right-controls-buttons の先頭に入れる', () => {
  const rcb = el('rcb')
  assert.deepEqual(pickWith({
    'ytmusic-player-bar .right-controls-buttons': rcb,
    '.right-controls-buttons': rcb,
    'ytmusic-player-bar .right-controls': el('rc'),
    'ytmusic-player-bar': el('bar'),
  }), { name: 'rcb', how: 'prepend' })
})

test('.right-controls-buttons が無くなっても右側の操作列に入れる', () => {
  assert.deepEqual(pickWith({
    'ytmusic-player-bar .right-controls': el('rc'),
    'ytmusic-player-bar': el('bar'),
  }), { name: 'rc', how: 'prepend' })
})

test('新しいバー(ytmusic-miniplayer)では右側の列の一番端に入れる', () => {
  // PR #114: IMMERSION は ⋮ メニューの右、バーの右端に寄せる
  assert.deepEqual(pickWith({
    'ytmusic-miniplayer .ytMusicMiniPlayerRightSection': el('right'),
    'ytmusic-player-bar': null,
  }), { name: 'right', how: 'append', primary: true })
})

test('置き場所が隠れていれば次の候補へ、見える所が無ければ浮かせる', () => {
  assert.deepEqual(pickWith({
    '.right-controls-buttons': el('rcb', false),
    'ytmusic-player-bar .right-controls': el('rc'),
    'ytmusic-player-bar': el('bar'),
  }), { name: 'rc', how: 'prepend' })
  // バーは見えているのに、置ける所がどこにも無い/見えない
  assert.equal(pickWith({ 'ytmusic-player-bar': el('bar') }).how, 'float')
  assert.equal(pickWith({
    '.right-controls-buttons': el('rcb', false),
    'ytmusic-player-bar': el('bar'),
  }).how, 'float')
})

test('バーごと隠れている間(まだ何も再生していない)は浮かせない', () => {
  assert.deepEqual(pickWith({
    '.right-controls-buttons': el('rcb', false),
    'ytmusic-player-bar': el('bar', false),
  }), { name: 'rcb', how: 'prepend' })
  assert.equal(pickWith({ 'ytmusic-player-bar': el('bar', false) }), null)
})

test('再生中に YTM がバーを visibility で隠したら(狭い窓のプレイヤーページ)浮かせる', () => {
  // 場所は取ったまま visibility:hidden。場所だけで見ていた頃は、隠れたバーの中に
  // ボタンが残って押せなかった
  assert.equal(pickWith({
    '.right-controls-buttons': el('rcb', true, 'hidden'),
    'ytmusic-player-bar': el('bar', true, 'hidden'),
    video: { currentSrc: 'blob:x' },
  }).how, 'float')
  // まだ何も再生していなければ浮かせない(今までどおり)
  assert.deepEqual(pickWith({
    '.right-controls-buttons': el('rcb', true, 'hidden'),
    'ytmusic-player-bar': el('bar', true, 'hidden'),
  }), { name: 'rcb', how: 'prepend' })
  // 閉じている間も見張りが選び直す
  const watch = ui.slice(ui.indexOf('const watchModeToggle = () => {'), ui.indexOf('const BAR_RESOLVE_EVERY'))
  assert.match(watch, /\} else if \(!shown && !isShownOnScreen\(btn\)\) \{\s*\/\/[^\n]*\n\s*ensureModeToggle\(true\);/)
})

test('プレイヤーバー自体が見つからなくても、再生中なら浮かせて出す', () => {
  assert.equal(pickWith({ video: { currentSrc: 'blob:x' } }).how, 'float')
  assert.equal(pickWith({}), null)
})

test('見張りがボタンと監視先を戻す', () => {
  assert.match(ui, /setInterval\(watchModeToggle, MODE_TOGGLE_WATCH_MS\)/)
  const watch = ui.slice(ui.indexOf('const watchModeToggle = () => {'), ui.indexOf('const setupObserver = () => {'))
  assert.match(watch, /ensureModeToggle\(true\)/)
  // 普段の見張りは要素を探さず、位置も測らない(測るのは消えた・浮いている時だけ)
  const normal = watch.slice(0, watch.indexOf('ensureModeToggle(true)'))
  assert.match(normal, /if \(!btn \|\| !btn\.isConnected \|\| _modeToggleAway\) \{\s*$/)
  assert.doesNotMatch(normal, /querySelector|getClientRects|getBoundingClientRect/)
  // 隠されたことはブラウザに知らせてもらう
  assert.match(ui, /new IntersectionObserver\(\(entries\) => \{\s*if \(entries\.some\(e => !e\.isIntersecting\)\) ensureModeToggle\(true\);/)
  assert.match(watch, /!_observedBar\.isConnected/)
  assert.match(watch, /_barObserver\?\.disconnect\(\)/)
  // tick からは位置を測らない(変化のたびに測ると重い)
  assert.match(ui, /\n  ensureModeToggle\(false\);\n/)
  assert.doesNotMatch(ui, /document\.querySelector\('\.right-controls-buttons'\)/)
})

test('浮かせたボタンは画面の隅に固定される', () => {
  const rule = css.slice(css.indexOf('#my-mode-toggle.ytm-mode-toggle-floating {'))
  assert.match(rule.slice(0, rule.indexOf('}')), /position: fixed;/)
})
