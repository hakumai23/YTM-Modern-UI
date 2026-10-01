// Up Next で、上へスクロールするとキューを遡れる。
//
// 以前は YTM のキューのうち再生中から後ろだけを描いていたので、前に流れた
// 曲へ戻るには YTM のプレイヤーページを開くしかなかった。再生済みの曲も
// 上に並べ、描き直した時は再生中の曲を一番上に合わせる(開いた時の見え方は
// 今までどおり)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const queueSource = read('src/js/module/queue-manager.js')
const css = read('src/css/style.css')

// ── 小さな偽の DOM ──
class Node {
  constructor(tag, cls = '') { this.tagName = tag; this.className = cls; this.children = []; this.attrs = {}; this.dataset = {}; this.textContent = ''; this.offsetParent = {} ; this.listeners = {} }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c }
  hasAttribute(k) { return k in this.attrs }
  querySelector(sel) {
    const all = this.all()
    if (sel === '.queue-item.current') return all.find(n => /\bqueue-item\b/.test(n.className) && /\bcurrent\b/.test(n.className)) || null
    const cls = sel.replace(/^\./, '').split(' ')[0]
    return all.find(n => String(n.className).split(/\s+/).includes(cls)) || null
  }
  all() { return this.children.flatMap(c => [c, ...c.all()]) }
  addEventListener() { }
  getBoundingClientRect() { return { top: this.top || 0 } }
  set innerHTML(v) { if (v === '') this.children = []; this._html = v }
  get innerHTML() { return this._html || '' }
}
const queueItem = (title, { selected = false } = {}) => {
  const item = new Node('ytmusic-player-queue-item')
  if (selected) item.attrs.selected = ''
  const t = new Node('div', 'song-title'); t.textContent = title
  const b = new Node('div', 'byline'); b.textContent = 'Artist'
  item.appendChild(t); item.appendChild(b)
  return item
}

const run = (titles, currentIdx) => {
  const items = titles.map((t, i) => queueItem(t, { selected: i === currentIdx }))
  const container = new Node('div', 'queue-list-content')
  container.scrollTop = 0
  const panel = new Node('div'); panel.appendChild(container)
  panel.querySelector = (s) => (s === '.queue-list-content' ? container : null)
  const document = { querySelectorAll: () => items, querySelector: () => null }
  const createEl = (tag, id, cls) => new Node(tag, cls)
  const ctx = vm.createContext({
    document, window: {}, location: { href: 'https://music.youtube.com/watch?v=x', origin: 'https://music.youtube.com' },
    ui: { queuePanel: panel }, config: {}, createEl, escapeHtml: (s) => String(s), parseBylineArtist: (s) => s, URL, Map, Set, Array, String, setTimeout,
    chrome: { runtime: { sendMessage() { } } }, storage: { get: async () => null }, YTMLog: { log() { } }, trimMapToLimit() { },
  })
  vm.runInContext(`${queueSource}\nthis.QM = QueueManager;`, ctx)
  ctx.QM.startObserver = () => { }
  ctx.QM.observer = {}
  ctx.QM._applyLoadedLyricsHighlight = () => { }
  ctx.QM._prefetchLyrics = () => { }
  // 行の縦位置: 並んだ順に 60px ずつ
  const origAppend = container.appendChild.bind(container)
  container.appendChild = (c) => { c.top = container.children.length * 60 - container.scrollTop; return origAppend(c) }
  ctx.QM.syncQueue()
  return container
}

test('再生済みの曲を再生中の曲より上に並べ、再生中を一番上に合わせる', () => {
  const c = run(['A', 'B', 'C', 'D', 'E'], 2)
  const rows = c.children
  assert.deepEqual(rows.map(r => r.className.trim().replace(/\s+/g, ' ')), [
    'queue-item past', 'queue-item past', 'queue-item current', 'queue-item', 'queue-item',
  ])
  // 再生中(3 行目 = 120px)が上端に来るようにスクロールしている
  assert.equal(c.scrollTop, 120)
})

test('再生中が先頭なら今までどおり(再生済みの行は無い)', () => {
  const c = run(['A', 'B', 'C'], 0)
  assert.equal(c.children[0].className.trim(), 'queue-item current')
  assert.equal(c.scrollTop, 0)
})

test('再生済みの曲は控えめに表示し、乗せれば普通に見える', () => {
  assert.match(css, /\.queue-item\.past \{\s*opacity: 0\.5;/)
  assert.match(css, /\.queue-item\.past:hover \{\s*opacity: 1;/)
})

test('先読みはこれから流れる曲だけ(再生済みの行では行わない)', () => {
  const past = queueSource.slice(queueSource.indexOf('pastItems.forEach((item) => {'), queueSource.indexOf('const seenIds = new Set();'))
  assert.doesNotMatch(past, /_prefetchLyrics|YTMLyrics\.fetch/)
})
