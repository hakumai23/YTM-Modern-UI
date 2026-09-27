// 背景のアニメーションを 1 秒に 10 回だけ進める。
//
// 背景(ジャケットをぼかしたもの)の漂いと回転は CSS アニメーションで、毎秒 60 回
// 画面全体が描き直しになっていた。隔離した Chrome でこの拡張のページが使う
// GPU 時間(macOS の GPU プロセスの累計)を測ると、再生中 226ms/秒のうち 94% が
// これだった(背景を止めると 15ms/秒)。背景はぼかしてあるので 100ms 進めても
// 色の差は 255 段階で最大 2 段。CSS では止めておき、JS が 100ms ごとに進める。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const ui = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/css/style.css', import.meta.url), 'utf8')

const source = ui.slice(
  ui.indexOf('const BG_ANIMATION_NAMES'),
  ui.indexOf("if (typeof document.getAnimations === 'function') {"),
)

const setup = ({ classes = ['ytm-custom-layout'] } = {}) => {
  const bodyClasses = new Set(classes)
  let now = 1000
  const animations = [
    { animationName: 'amFluid1', currentTime: 0 },
    { animationName: 'amFluid2', currentTime: 5000 },
    { animationName: 'ytmBgDrift', currentTime: null },
    { animationName: 'ytmLyricsBounce', currentTime: 0 }, // 背景以外は触らない
  ]
  const context = vm.createContext({
    performance: { now: () => now },
    document: {
      body: { classList: { contains: c => bodyClasses.has(c) } },
      getAnimations: () => animations,
    },
  })
  vm.runInContext(`${source}\nthis.step = stepBackgroundAnimations;`, context)
  return { step: context.step, animations, bodyClasses, advance: (ms) => { now += ms } }
}

test('背景の 3 つだけを、経った時間ぶん進める', () => {
  const env = setup()
  env.step() // 最初の 1 回は 100ms
  env.advance(100)
  env.step()
  assert.deepEqual(env.animations.map(a => a.currentTime), [200, 5200, 200, 0])
})

test('見えていない時・一時停止中・Immersion の外では進めない', () => {
  for (const classes of [['ytm-custom-layout', 'ytm-anim-idle'], []]) {
    const env = setup({ classes })
    env.step()
    env.advance(100)
    env.step()
    assert.deepEqual(env.animations.map(a => a.currentTime), [0, 5000, null, 0], classes.join(','))
  }
})

test('タイマーが間引かれた後も一度に大きく飛ばさない', () => {
  const env = setup()
  env.step()
  env.advance(5000) // 裏に回っていた
  env.step()
  assert.equal(env.animations[0].currentTime, 100 + 200)
})

test('CSS では止めておき、JS が動く時だけそうする', () => {
  assert.match(css, /body\.ytm-bg-stepped #ytm-custom-bg,\s*body\.ytm-bg-stepped #ytm-custom-bg::before,\s*body\.ytm-bg-stepped #ytm-custom-bg::after \{\s*animation-play-state: paused !important;/)
  const install = ui.slice(ui.indexOf("if (typeof document.getAnimations === 'function') {"))
  assert.match(install.slice(0, 200), /document\.body\.classList\.add\('ytm-bg-stepped'\);\s*setInterval\(stepBackgroundAnimations, BG_ANIMATION_STEP_MS\);/)
  assert.match(ui, /const BG_ANIMATION_STEP_MS = 100;/)
})

test('進める名前は CSS のキーフレームと一致している', () => {
  for (const name of ['ytmBgDrift', 'amFluid1', 'amFluid2']) {
    assert.match(css, new RegExp(`@keyframes ${name} \\{`), name)
    assert.match(ui, new RegExp(`'${name}'`), name)
  }
})
