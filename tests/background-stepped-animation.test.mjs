// 背景のアニメーションを 1 秒に 10 回だけ描き直す。
//
// 背景(ジャケットをぼかしたもの)の漂いと回転は CSS アニメーションで、毎秒 60 回
// 画面全体が描き直しになっていた。背景はぼかしてあるので 100ms 進めても
// 色の差は 255 段階で最大 2 段。
//
// 以前は CSS で止めておき、JS が 100ms ごとに document.getAnimations() で探して
// currentTime を進めていた。動きが合成スレッドから外れ、100ms ごとにメインスレッドで
// スタイル確定・全アニメーションの列挙・描き直しが走る(Windows で重いと声があった)。
// いまは合成スレッドのまま、効果全体の easing を steps にして刻む。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const ui = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/css/style.css', import.meta.url), 'utf8')

const source = ui.slice(
  ui.indexOf('const BG_ANIMATION_NAMES'),
  ui.indexOf('// 背景の CSS アニメーションは、Immersion の入切'),
)

const makeAnimation = (animationName, duration, easing = 'linear') => {
  const timing = { duration, easing }
  return {
    animationName,
    updates: 0,
    effect: {
      getTiming: () => ({ ...timing }),
      updateTiming(next) { Object.assign(timing, next); this.owner.updates += 1 },
    },
  }
}

const setup = (animations, { supported = true } = {}) => {
  animations.forEach(a => { a.effect.owner = a })
  const context = vm.createContext({
    document: supported ? { getAnimations: () => animations } : {},
  })
  vm.runInContext(`${source}\nthis.quantize = quantizeBackgroundAnimations;`, context)
  return { quantize: context.quantize }
}

test('背景の 3 つだけを 100ms 刻みにする(キーフレームのイージングは触らない)', () => {
  const animations = [
    makeAnimation('ytmBgDrift', 40000),
    makeAnimation('amFluid1', 25000),
    makeAnimation('amFluid2', 30000),
    makeAnimation('ytmLyricsBounce', 1000), // 背景以外は触らない
  ]
  const env = setup(animations)
  env.quantize()
  assert.deepEqual(
    animations.map(a => a.effect.getTiming().easing),
    ['steps(400, jump-none)', 'steps(250, jump-none)', 'steps(300, jump-none)', 'linear'],
  )
})

test('刻み済みなら何もしない・使えない環境では何もしない', () => {
  const animations = [makeAnimation('amFluid1', 25000, 'steps(250, jump-none)')]
  setup(animations).quantize()
  assert.equal(animations[0].updates, 0)
  assert.doesNotThrow(() => setup([], { supported: false }).quantize())
})

test('100ms ごとに JS で進める仕組みは残っていない', () => {
  assert.doesNotMatch(ui, /setInterval\(stepBackgroundAnimations/)
  assert.doesNotMatch(ui, /ytm-bg-stepped/)
  assert.doesNotMatch(css, /ytm-bg-stepped/)
  // ページ全体を探すのは、アニメーションが作り直された時だけ
  assert.equal((ui.match(/quantizeBackgroundAnimations\(\)/g) || []).length, 2)
})

test('作り直された背景のアニメーションにも刻みを入れ直す', () => {
  assert.match(ui, /document\.addEventListener\('animationstart', \(event\) => \{\s*if \(BG_ANIMATION_NAMES\.has\(event\.animationName\)\) quantizeBackgroundAnimations\(\);/)
  assert.match(ui, /const BG_ANIMATION_STEP_MS = 100;/)
})

test('刻む名前は CSS のキーフレームと一致している', () => {
  for (const name of ['ytmBgDrift', 'amFluid1', 'amFluid2']) {
    assert.match(css, new RegExp(`@keyframes ${name} \\{`), name)
    assert.match(ui, new RegExp(`'${name}'`), name)
  }
})
