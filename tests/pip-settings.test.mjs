// PiP の背景・ジャケットと、タブを離れた時に自動で開く設定。
//
//   - 背景の明るさは通常画面に合わせる(設定は無く、全員この動き): 通常画面は
//     「背景の明るさ」× ジャケットごとの減光(--ytm-bg-art-dim)。PiP は別文書で
//     CSS 変数が届かないので、掛けた値を --pip-bg-brightness として渡す。
//   - ジャケットは通常画面で差し替わった時に写す。曲が変わった瞬間の ui.artwork は
//     まだ前の曲の画像なので、そこで写すと PiP だけ1曲ずれていた。
//   - タブを離れた時に自動で開く: Chrome の自動 PiP(Media Session の
//     "enterpictureinpicture")に登録する。オフの時は登録を外す。Immersion を
//     一度も開いていないと器が無いので、開く前に組む。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const pipSource = read('src/js/module/pip-manager.js')
const uiSource = read('src/js/module/lyrics-ui.js')

const setup = ({ rootVars = {}, config = {}, lyricsBuilt = true } = {}) => {
  const pipVars = new Map()
  const handlers = new Map()
  const calls = []
  const ui = { lyrics: lyricsBuilt ? {} : undefined }
  const context = vm.createContext({
    config: { pipAutoOpen: false, ...config },
    DEFAULT_BG_BRIGHTNESS: 0.65,
    ui,
    initLayout: () => { calls.push('initLayout'); ui.lyrics = {} },
    document: { documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: (name) => rootVars[name] ?? '' }),
    navigator: {
      mediaSession: {
        setActionHandler: (action, fn) => { handlers.set(action, fn) },
      },
    },
  })
  vm.runInContext(`${pipSource}\nthis.PipManager = PipManager;`, context)
  const pip = context.PipManager
  const els = {
    'pip-title': { textContent: '' },
    'pip-artist': { textContent: '' },
    'pip-img': { src: 'old.jpg' },
    'pip-bg-layer': { style: { backgroundImage: 'url("old.jpg")' } },
  }
  const openPip = () => {
    pip.pipWindow = {
      document: {
        getElementById: (id) => els[id] || null,
        documentElement: {
          style: {
            setProperty: (k, v) => pipVars.set(k, v),
            removeProperty: (k) => pipVars.delete(k),
          },
        },
      },
    }
  }
  pip.start = async () => { calls.push('start') }
  pip.updateLikeState = () => {}
  return { pip, config: context.config, pipVars, handlers, calls, openPip, els }
}

test('通常画面の明るさ × ジャケットの減光を PiP に渡す', () => {
  const env = setup({ rootVars: { '--ytm-bg-brightness': '0.6', '--ytm-bg-art-dim': '0.5' } })
  env.openPip()
  env.pip.syncBackgroundBrightness()
  assert.equal(env.pipVars.get('--pip-bg-brightness'), '0.300')
})

test('明るさを保存していない人は既定の明るさ、減光が無い曲は 1 として掛ける', () => {
  const env = setup()
  env.openPip()
  env.pip.syncBackgroundBrightness()
  assert.equal(env.pipVars.get('--pip-bg-brightness'), '0.650')
})

test('明るさは設定に出さない(全員が通常画面と同じ明るさ)', () => {
  assert.ok(!/pipMatchBg|pip-match-bg|ytm_pip_match_bg/.test(pipSource + uiSource), '明るさの切り替えが残っている')
})

test('PiP を開いていない時は何もしない', () => {
  const env = setup()
  assert.doesNotThrow(() => env.pip.syncBackgroundBrightness())
  assert.doesNotThrow(() => env.pip.updateArtwork('new.jpg'))
})

test('開いた時に一度合わせる', () => {
  assert.match(pipSource, /pipDoc\.head\.appendChild\(forceStyle\);\s*this\.syncBackgroundBrightness\(\);/)
})

test('曲が変わった瞬間(updateMeta)にはジャケットを写さない', () => {
  const env = setup()
  env.openPip()
  env.pip.updateMeta('拝啓、少年よ', 'Hump Back')
  assert.equal(env.els['pip-title'].textContent, '拝啓、少年よ')
  assert.equal(env.els['pip-img'].src, 'old.jpg', '前の曲の画像を写し直していないこと')
})

test('ジャケットが差し替わった時に、PiP の画像と背景も差し替える', () => {
  const env = setup()
  env.openPip()
  env.pip.updateArtwork('https://lh3.googleusercontent.com/new=w544')
  assert.equal(env.els['pip-img'].src, 'https://lh3.googleusercontent.com/new=w544')
  assert.equal(env.els['pip-bg-layer'].style.backgroundImage, 'url("https://lh3.googleusercontent.com/new=w544")')
  // 通常画面の差し替えと同じ所から呼んでいる
  assert.match(uiSource, /ui\.artwork\.replaceChildren\(img\);[\s\S]{0,300}PipManager\.updateArtwork\(img\.src\);/)
})

test('自動で開く: オンで登録し、オフで外す', () => {
  const env = setup()
  env.pip.setAutoOpen(true)
  assert.equal(typeof env.handlers.get('enterpictureinpicture'), 'function')
  env.pip.setAutoOpen(false)
  assert.equal(env.handlers.get('enterpictureinpicture'), null)
})

test('自動で開く: Immersion を開いていなければ器を組んでから開く', () => {
  const env = setup({ lyricsBuilt: false })
  env.pip.setAutoOpen(true)
  env.handlers.get('enterpictureinpicture')()
  assert.deepEqual(env.calls, ['initLayout', 'start'])
})

test('自動で開く: 既に開いている時は開き直さない', () => {
  const env = setup()
  env.pip.setAutoOpen(true)
  env.openPip()
  env.handlers.get('enterpictureinpicture')()
  assert.deepEqual(env.calls, [])
})

test('自動で開く: 自動 PiP の無い Chrome でも落ちない', () => {
  const context = vm.createContext({
    navigator: { mediaSession: { setActionHandler: () => { throw new TypeError('not supported') } } },
  })
  vm.runInContext(`${pipSource}\nthis.PipManager = PipManager;`, context)
  assert.doesNotThrow(() => context.PipManager.setAutoOpen(true))
})
