// 左カラム(ジャケット・曲名・ボタン・曲/動画)が縦に収まる。
//
// ジャケットの大きさを幅(42vw)でしか抑えていなかったので、ノート PC の
// 高さ(実機 1280×680)ではジャケットの上が画面から切れ、取得元の表示と
// 曲/動画の切り替えがプレイヤーバーの下に潜っていた。1440×813 でも
// 曲/動画の切り替えがバーに 7px 食い込んでいた。
// 実機で 1024×640 / 1280×680 / 1366×600 / 1440×813 / 1920×1080 を測り、
// どれもはみ出さず、1920×1080 では従来どおり 400px のままであることを確かめた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const css = fs.readFileSync(new URL('../src/css/style.css', import.meta.url), 'utf8')

const rule = (selector) => {
  // 行頭から始まる規則だけを見る(歌詞が無い時の上書きも同じ語で終わる)
  const start = css.indexOf(`\n${selector} {`)
  assert.notEqual(start, -1, `${selector} が無い`)
  return css.slice(start, css.indexOf('\n}', start))
}

test('ジャケットの大きさは画面の高さでも抑える', () => {
  const art = rule('#ytm-artwork-container')
  assert.match(art, /width: min\([\s\S]*400px[\s\S]*42vw[\s\S]*100vh - \d+px - \d+px \* var\(--ytm-ui-scale\)/)
  // 極端に低い画面でも潰れすぎない下限
  assert.match(art, /max\(calc\(48px \* var\(--ytm-ui-scale\)\)/)
})

// UI サイズ 150% の 1000×700 では、下限(以前は 160px × UI サイズ = 240px)と
// UI サイズで伸びない分まで 1.5 倍にした差し引きのせいで、ジャケットの上が
// 画面から切れ、曲/動画の切り替えがプレイヤーバーの下に完全に潜っていた(実機)。
// 差し引きは「伸びない分 + 伸びる分」で持ち、100% の時は従来と同じ値にする。
const reserve = (text, vh) => {
  const m = text.match(new RegExp(`${vh} - (\\d+)px - (\\d+)px \\* var\\(--ytm-ui-scale\\)`))
  assert.ok(m, `${vh} の差し引きが見つからない`)
  return (scale) => Number(m[1]) + Number(m[2]) * scale
}

test('100% の時の大きさは変えず、150% でも 1000×700 に収まる', () => {
  const normal = reserve(rule('#ytm-artwork-container'), '100vh')
  assert.equal(normal(1), 480, '100% の時のジャケットが変わる')
  // 実機の 1000×700・150%: 絵が 80px になり、曲/動画の切り替えとバーの間が 27px
  const art = 700 - normal(1.5)
  assert.ok(art >= 48 * 1.5, `下限を割って潜る: ${art}px`)
  const noLyricsStart = css.indexOf('body.ytm-custom-layout.ytm-no-lyrics #ytm-artwork-container {')
  const noLyrics = reserve(css.slice(noLyricsStart, noLyricsStart + 400), '91vh')
  assert.equal(noLyrics(1), 460, '歌詞が無い時の 100% の大きさが変わる')
})

test('下の余白はプレイヤーバーの実際の高さに合わせる(100% では従来どおり)', () => {
  const wrapper = rule('#ytm-custom-wrapper')
  assert.match(wrapper, /calc\(60px \+ 80px \* var\(--ytm-ui-scale\)\)/)
  const bar = css.slice(css.indexOf('body.ytm-custom-layout ytmusic-player-bar {'))
  assert.match(bar.slice(0, 800), /bottom: 40px !important;/)
  assert.match(bar.slice(0, 800), /height: calc\(80px \* var\(--ytm-ui-scale\)\) !important;/)
})

// 左カラムの幅は画面の幅で決まるのに、ボタン列だけ UI サイズで伸びていた。
// 1000px 幅・150% で 428px になり、370px の枠から左右に約 30px はみ出した(実機)。
test('ボタン列の間隔は画面の幅でも抑える', () => {
  const area = rule('#ytm-btn-area')
  assert.match(area, /gap: min\(calc\(10px \* var\(--ytm-ui-scale\)\), 1\.1vw\);/)
  // 1000px 幅以上・100% では従来と同じ値(1.1vw ≥ 10px)
  assert.ok(1000 * 0.011 >= 10)
})

test('歌詞が無い時(1.1 倍)の上限は広い画面だけに掛ける', () => {
  const start = css.indexOf('@media (min-width: 901px) {\n  body.ytm-custom-layout.ytm-no-lyrics #ytm-artwork-container {')
  assert.notEqual(start, -1, '狭い画面の 64px の絵まで上書きしてしまう')
  assert.match(css.slice(start, start + 400), /91vh - \d+px - \d+px \* var\(--ytm-ui-scale\)/)
})
