// キューを開くきっかけの帯。
//
// 右端 20px にマウスを載せると開く作りだった。単一モニタなら画面の端が
// カーソルを止めてくれるので乱暴に右へ振れば必ず当たるが、デュアルモニタで
// 左側にウィンドウを置くと、ウィンドウの右端は画面の端ではないので止まらない。
// 20px を狙って止める必要があり、行き過ぎると隣のモニタへ抜ける。
//
// 帯を広げるだけだと、今度は隣のモニタへ移動する途中や右端のスクロールバーを
// 掴みに行く途中で掠めて開いてしまう。広げるのと短い滞留は対で必要。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const cssSource = read('src/css/style.css')
const queueSource = read('src/js/module/queue-manager.js')

const triggerRule = cssSource.slice(
  cssSource.indexOf('#ytm-queue-trigger {'),
  cssSource.indexOf('}', cssSource.indexOf('#ytm-queue-trigger {')),
)

test('帯が端を頼らずに当たる幅になっている', () => {
  const width = triggerRule.match(/width:\s*(\d+)px/)
  assert.ok(width, '幅の指定が見つからない')
  assert.ok(
    Number(width[1]) >= 40,
    `幅 ${width[1]}px は狭い。画面の端が無い側では狙えない`,
  )
})

test('帯は上端とプレイヤーバーの高さを避け、その間はいっぱいに覆う', () => {
  // 上から下まで覆うと、見えない帯が右上の「曲 / 動画」や、窓が狭い時の
  // プレイヤーバー右端のボタンの上に乗って押せなかった
  assert.match(triggerRule, /top:\s*72px/)
  assert.match(triggerRule, /bottom:\s*calc\(48px \+ 80px \* var\(--ytm-ui-scale\)\)/)
  assert.doesNotMatch(triggerRule, /height:\s*100vh/)
  assert.match(triggerRule, /right:\s*0/)
})

test('入った瞬間には開かない', () => {
  assert.match(queueSource, /const QUEUE_OPEN_DWELL_MS = \d+;/)
  const ms = Number(queueSource.match(/const QUEUE_OPEN_DWELL_MS = (\d+);/)[1])
  assert.ok(ms >= 100 && ms <= 400, `滞留 ${ms}ms は極端`)
  assert.doesNotMatch(
    queueSource,
    /trigger\.addEventListener\('mouseenter', openPanel\)/,
    '即座に開く形に戻っている',
  )
})

test('滞留の途中で離れたら開かない', () => {
  const block = queueSource.slice(
    queueSource.indexOf("trigger.addEventListener('mouseenter'"),
    queueSource.indexOf("panel.addEventListener('mouseenter'"),
  )
  assert.match(block, /trigger\.matches\(':hover'\)/, '離れたあとに開いてしまう')
})

test('離れたら滞留の予約を取り消す', () => {
  const leave = queueSource.slice(
    queueSource.indexOf("trigger.addEventListener('mouseleave'"),
    queueSource.indexOf("trigger.addEventListener('mouseleave'") + 300,
  )
  assert.match(leave, /cancelDwell\(\)/)
})

// Immersion の外では帯も Up Next も出さない。
// 実機(1440px 幅、ミニプレイヤーでホームを表示)では、見えない帯が右端
// 1373〜1425px を覆い、畳んだプレイヤーバーの「プレイヤーを開く」ボタンの
// クリックを奪っていた。そこに留まるとホーム画面の上に Up Next が滑り出た。
test('Immersion の外では帯と Up Next を隠す', () => {
  const hide = cssSource.match(
    /body:not\(\.ytm-custom-layout\) #ytm-queue-trigger,\s*body:not\(\.ytm-custom-layout\) #ytm-queue-panel \{\s*display: none !important;/,
  )
  assert.ok(hide, 'Immersion の外でも帯が YTM の上に乗っている')
})

test('Immersion の外では留まっても開かない', () => {
  const enter = queueSource.slice(
    queueSource.indexOf("trigger.addEventListener('mouseenter'"),
    queueSource.indexOf("panel.addEventListener('mouseenter'"),
  )
  const guard = enter.indexOf("if (!document.body.classList.contains('ytm-custom-layout')) return;")
  assert.ok(guard !== -1, 'Immersion の外でも開いてしまう')
  assert.ok(guard < enter.indexOf('openPanel()'))
})
