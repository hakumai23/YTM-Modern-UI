// 歌詞カードを作っている間に曲が変わったら、前の曲のカードを開かない。
//
// make() はジャケットの読み込みを待ってから画像を作る。その間に曲送りや
// 広告の開始で cancel() されても、戻ってきた後に showDialog を呼んでいた。
// 画像の読み込みが遅い時に曲を送ると、旧曲のカードが後から開く。
//
// ここではジャケットの読み込みを手で止めておき、その間に選ぶ状態を
// 閉じてから読み込みを終わらせる。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const cardSource = fs.readFileSync(new URL('../src/js/module/lyric-card.js', import.meta.url), 'utf8')

// ── 最小限の DOM ───────────────────────────────────────
const makeClassList = () => {
  const set = new Set()
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c) },
    contains: (c) => set.has(c),
  }
}

const makeEl = () => {
  const children = new Map()
  const el = {
    textContent: '',
    disabled: false,
    onclick: null,
    classList: makeClassList(),
    setAttribute() {},
    appendChild() {},
    remove() { el.removed = true },
    focus() {},
    querySelector: (sel) => {
      if (!children.has(sel)) children.set(sel, makeEl())
      return children.get(sel)
    },
  }
  return el
}

const makeRow = (text, active) => {
  const row = makeEl()
  row.isRow = true
  row.classList.toggle('lyric-line', true)
  if (active) row.classList.add('active')
  row.querySelector = (sel) => {
    if (sel === '.lyric-main') return { textContent: text }
    return null
  }
  return row
}

// 何を呼んでも何もしない 2D コンテキスト(寸法だけ返す)
const fakeContext = () => new Proxy({}, {
  get: (target, prop) => {
    if (prop in target) return target[prop]
    if (prop === 'measureText') return (s) => ({ width: String(s).length * 10 })
    if (prop === 'createRadialGradient') return () => ({ addColorStop() {} })
    if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(16 * 16 * 4) })
    return () => {}
  },
  set: (target, prop, value) => { target[prop] = value; return true },
})

const setup = () => {
  const images = []
  const created = []
  const toasts = []
  const els = {}
  const rows = [makeRow('君は完璧で究極のアイドル', true), makeRow('金輪際現れない', false)]
  const lyrics = {
    querySelectorAll: () => rows,
    addEventListener() {},
    removeEventListener() {},
    contains: () => true,
    // 画面に出ている(動画モードでは歌詞の列ごと消えて、ここが空になる)
    getClientRects: () => [{}],
  }
  class FakeImage {
    constructor() { images.push(this) }
    set src(v) { this._src = v }
    get src() { return this._src }
  }
  const context = vm.createContext({
    console: { error() {}, warn() {}, log() {} },
    Intl,
    Promise,
    Uint8ClampedArray,
    Image: FakeImage,
    MutationObserver: class { observe() {} disconnect() {} },
    URL: { createObjectURL: () => 'blob:card', revokeObjectURL() {} },
    navigator: {},
    setTimeout: (fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h },
    t: (key) => key,
    showToast: (text) => toasts.push(text),
    createEl: (tag, id) => { const el = makeEl(); created.push(id); els[id] = el; return el },
    ui: {
      lyrics,
      lyricsStage: makeEl(),
      title: { textContent: 'アイドル' },
      artist: { textContent: 'YOASOBI' },
      artwork: { querySelector: () => ({ src: 'https://example.invalid/art.jpg', currentSrc: 'https://example.invalid/art.jpg' }) },
    },
    document: {
      body: { classList: makeClassList(), appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
      getElementById: () => null,
      createElement: (tag) => (tag === 'canvas'
        ? { width: 0, height: 0, getContext: () => fakeContext(), toBlob: (cb) => cb({ fake: 'png' }) }
        : makeEl()),
    },
    setLyricsAutoFollowHold() {},
  })
  vm.runInContext(`${cardSource}\nthis.LyricCard = LyricCard;`, context)
  return { card: context.LyricCard, images, created, toasts, els }
}

// ジャケットの読み込みを終わらせ、描画の続きが走り切るのを待つ
const finishArtwork = async (images) => {
  assert.ok(images.length >= 1, 'ジャケットを読みに行っていない')
  images[0].onload()
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r))
}

// 利用者と同じく、選ぶ状態のバーの「カードを作る」から作る
const pressMake = (els) => els['ytm-lyric-card-bar'].querySelector('.ytm-card-bar-make').onclick()

test('ジャケットの読み込みを待っている間に曲が変わったら、カードを開かない', async () => {
  const { card, images, created, toasts, els } = setup()
  card.start()
  const making = pressMake(els)
  // 読み込みの途中で曲送り(lyrics-ui.js の tick が cancel を呼ぶ)
  card.cancel()
  await finishArtwork(images)
  await making
  assert.ok(!created.includes('ytm-lyric-card-share'), '前の曲のカードが後から開いた')
  assert.deepEqual(toasts, [], '捨てた結果で失敗の知らせを出している')
  assert.equal(card.isSelecting(), false)
})

test('やめた後に新しく選び直しても、前の回の結果では開かない', async () => {
  const { card, images, created, els } = setup()
  card.start()
  const making = pressMake(els)
  card.cancel()
  card.start() // 次の曲で選び直した
  await finishArtwork(images)
  await making
  assert.ok(!created.includes('ytm-lyric-card-share'), '前の回の結果で開いた')
  assert.equal(card.isSelecting(), true, '選び直した状態まで閉じてしまった')
})

test('何も起きなければ、読み込みが終わった所でカードを開く', async () => {
  const { card, images, created, els } = setup()
  card.start()
  const making = pressMake(els)
  await finishArtwork(images)
  await making
  assert.ok(created.includes('ytm-lyric-card-share'), 'カードが開かない')
  assert.equal(card.isSelecting(), false)
})
