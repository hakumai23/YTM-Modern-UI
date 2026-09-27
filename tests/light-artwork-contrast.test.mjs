// 明るいジャケットでも歌詞を読めるようにする。
//
// 背景はジャケットをぼかして一律に暗くしていたので、明るいジャケットほど
// 背景が明るく残り、白い歌詞が沈んでいた。実機で測った白文字の
// コントラスト比(いまの行 / 次の行):
//   アイドル(暗い)     13.8:1 / 4.8:1
//   夜に駆ける(淡い桃)  4.3:1 / 2.0:1  → 直した後 7.6:1 / 3.0:1
// 暗いジャケットは変えない(直した後も 14.1:1 / 4.9:1)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const ui = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/css/style.css', import.meta.url), 'utf8')

const load = () => {
  const start = ui.indexOf('const BG_TARGET_LUMINANCE')
  const end = ui.indexOf('const applyArtworkDim', start)
  assert.ok(start !== -1 && end !== -1)
  const context = vm.createContext({ Math, Number, DEFAULT_BG_BRIGHTNESS: 0.65 })
  vm.runInContext(`${ui.slice(start, end)}; this.dimFor = artworkDimFor; this.measure = measureArtworkLuminance;`, context)
  return context
}

test('暗いジャケットは暗くしない', () => {
  const { dimFor } = load()
  assert.equal(dimFor(0.067), 1) // アイドル相当
  assert.equal(dimFor(0.1), 1)
})

test('明るいジャケットほど背景を暗くする(下限あり)', () => {
  const { dimFor } = load()
  const pink = dimFor(0.5) // 夜に駆ける相当
  const white = dimFor(0.95)
  assert.ok(pink < 1 && pink > 0.6, `淡い桃 ${pink}`)
  assert.ok(white < pink, '白いほど暗くなっていない')
  assert.ok(white >= 0.45, `暗くしすぎ ${white}`)
})

test('測れなかった時は今までどおり', () => {
  const { dimFor } = load()
  assert.equal(dimFor(null), 1)
  assert.equal(dimFor(Number.NaN), 1)
})

test('ジャケットの平均輝度を測る', () => {
  const { measure } = load()
  const px = (r, g, b, n) => Array.from({ length: n }, () => [r, g, b, 255]).flat()
  const ctx = (data) => ({ getImageData: () => ({ data: Uint8ClampedArray.from(data) }) })
  assert.ok(Math.abs(measure(ctx(px(255, 255, 255, 4)), 2) - 1) < 1e-6)
  assert.equal(measure(ctx(px(0, 0, 0, 4)), 2), 0)
})

test('背景の明るさは設定の値とジャケットの補正の積', () => {
  const uses = css.match(/brightness\(calc\(var\(--ytm-bg-brightness, 0\.65\) \* var\(--ytm-bg-art-dim, 1\)\)\)/g) || []
  assert.equal(uses.length, 6)
  assert.doesNotMatch(css, /brightness\(var\(--ytm-bg-brightness, 0\.65\)\)/)
})
