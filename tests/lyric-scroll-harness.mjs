// 行送りのスクロールを node で動かすための道具。
//
// 本物は scrollTop をその場で飛ばし、行ごとの translate を Web Animations で
// 0 へ戻す。ここではアニメーションを自前の時計で進める偽物に置き換え、
// 「画面の上で行がどこに見えるか」を毎フレーム読めるようにする。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

export const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

export const sliceBetween = (from, to) => {
  const start = uiSource.indexOf(from)
  const end = uiSource.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return uiSource.slice(start, end)
}

export const FRAME_MS = 1000 / 60

class FakeAnimation {
  constructor(clock, frames, timing) {
    this.clock = clock
    this.start = clock.now
    this.path = frames.map(f => parseFloat(String(f.translate).split(' ')[1]))
    this.delay = timing.delay
    this.duration = timing.duration
    this.fill = timing.fill
    this.cancelled = false
    this.finished = false
    this.onfinish = null
    clock.anims.add(this)
  }

  get currentTime() {
    if (this.cancelled) return null
    return Math.min(this.clock.now - this.start, this.delay + this.duration)
  }

  cancel() {
    this.cancelled = true
    this.clock.anims.delete(this)
  }

  // いま画面に効いている translate の縦(px)
  value() {
    if (this.cancelled || this.finished) return 0
    const t = this.clock.now - this.start - this.delay
    if (t < 0) return this.fill === 'backwards' || this.fill === 'both' ? this.path[0] : 0
    if (t >= this.duration) return 0
    const p = (t / this.duration) * (this.path.length - 1)
    const i = Math.floor(p)
    return this.path[i] + (this.path[i + 1] - this.path[i]) * (p - i)
  }
}

// 行の高さ・間隔は実物に近い値(1行 ≒ 43px + 余白 35px)
export function makeLyrics({ rowCount = 60, rowHeight = 43, gap = 35, padTop = 300, clientHeight = 530, withAnimate = true } = {}) {
  const clock = { now: 0, anims: new Set() }
  clock.advance = (ms) => {
    clock.now += ms
    for (const anim of [...clock.anims]) {
      if (anim.clock.now - anim.start >= anim.delay + anim.duration) {
        anim.finished = true
        clock.anims.delete(anim)
        anim.onfinish?.()
      }
    }
  }

  const listeners = {}
  let top = 0
  const container = {
    clientHeight,
    classes: new Set(),
    classList: {
      add: (n) => container.classes.add(n),
      remove: (n) => container.classes.delete(n),
      contains: (n) => container.classes.has(n),
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
    getBoundingClientRect: () => ({ top: 0, height: clientHeight }),
    get scrollTop() { return top },
    // ブラウザと同じく 0〜最大量に収め、Retina の画素(0.5px)に丸める
    set scrollTop(v) {
      const max = container.scrollHeight - clientHeight
      top = Math.round(Math.min(Math.max(0, Number(v) || 0), max) * 2) / 2
    },
  }

  const rows = []
  for (let i = 0; i < rowCount; i++) {
    const naturalTop = padTop + i * (rowHeight + gap)
    const row = {
      index: i,
      naturalTop,
      parentNode: container,
      anims: [],
      classList: { contains: (n) => n === 'lyric-line' },
      translate() { return this.anims.reduce((sum, a) => sum + a.value(), 0) },
      // 画面(器の上端 = 0)の上で見えている位置
      visualTop() { return naturalTop - container.scrollTop + this.translate() },
      getBoundingClientRect() { return { top: this.visualTop(), height: rowHeight } },
    }
    if (withAnimate) {
      row.animate = (frames, timing) => {
        const anim = new FakeAnimation(clock, frames, timing)
        row.anims = row.anims.filter(a => !a.cancelled && !a.finished)
        row.anims.push(anim)
        return anim
      }
    }
    rows.push(row)
  }
  container.children = rows
  container.scrollHeight = padTop * 2 + rowCount * (rowHeight + gap)

  // 行 i を器の中央に置く scrollTop(本物の updateLyricHighlight と同じ式)
  const targetFor = (i) => {
    const row = rows[i]
    return container.scrollTop + row.visualTop() - api.offsetOf(row) - clientHeight / 2 + rowHeight / 2
  }

  const fireScroll = () => {
    for (const fn of listeners.scroll || []) fn({ currentTarget: container, type: 'scroll' })
  }

  const config = { lyricStagger: true, lowCpuMode: false }
  const context = vm.createContext({
    Math, Number, Map, Array, String,
    performance: { now: () => clock.now },
    config,
    ui: { lyrics: null },
    PipManager: { pipLyricsContainer: null },
    suppressUserScrollDetection() {},
  })
  vm.runInContext(
    `${sliceBetween('// ── 行送りのスクロール', '// ── 広告の間')}
    this.request = requestLyricScroll;
    this.resetState = resetLyricScrollState;
    this.resetMotion = resetLyricRowMotion;
    this.offsetOf = lyricRowScrollOffset;
    this.spring = sampleLyricSpring;`,
    context,
  )

  const api = {
    clock,
    config,
    container,
    rows,
    targetFor,
    fireScroll,
    request: (target, instant, primaryIndex) => context.request(container, target, instant, primaryIndex),
    // 行 i が歌い出した時に本物がやること
    goTo: (i, instant = false) => {
      context.request(container, targetFor(i), instant, i)
      container._lastScrolledIndex = i
    },
    resetState: (t) => context.resetState(container, t),
    resetMotion: () => context.resetMotion(container),
    offsetOf: (row) => context.offsetOf(row),
    spring: (...args) => context.spring(...args),
    // 1フレームずつ進め、行の見た目の位置を記録する
    record: (row, frames, onFrame) => {
      const ys = []
      for (let f = 0; f < frames; f++) {
        onFrame?.(f)
        ys.push(row.visualTop())
        clock.advance(FRAME_MS)
      }
      return ys
    },
    settle: (seconds = 3) => {
      for (let f = 0; f < seconds * 60; f++) clock.advance(FRAME_MS)
    },
  }
  return api
}
