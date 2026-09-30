// YTM がプレイヤーバーを作り直しても Immersion に入れること。
//
// 以前は「知っている要素名のバーにボタンを差し込み、player-page-open 属性が
// 在る時だけ Immersion を出す」作りで、YTM が画面を変えるたびに
// 「ボタンが出ない」「押しても何も起きない」「入るとバーが消える」になった。
// 依存を層ごとに外し、YTM の部品は「見つかれば使う」にした:
//  ・入口: ツールバーのアイコンとショートカット(YTM の画面に依存しない)
//  ・出す条件: 属性に加えて URL(/watch)と、利用者の明示の「開く」
//  ・バー: 知っている作り → 形で探す → 押せなければ自前の最小限のバー
//  ・曲の切り替わり: <video> のイベントと MediaSession(バーを監視できなくても回る)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ui = read('src/js/module/lyrics-ui.js')
const barSrc = read('src/js/module/player-bar.js')
const bg = read('src/js/background.js')
const pip = read('src/js/module/pip-manager.js')
const css = read('src/css/style.css')
const manifest = JSON.parse(read('manifest.json'))

// ── PlayerBar を動かすための小さな偽の DOM ──────────────────────
// 使うセレクタ(要素名・#id・[属性]・[属性="値"]・input[type="range"]・
// .class)だけを解釈する。
class El {
  constructor(tag, { rect = null, style = {}, attrs = {}, id = '' } = {}) {
    this.tagName = tag.toUpperCase()
    this.id = id
    this.children = []
    this.parentElement = null
    this.attrs = { ...attrs }
    this.rect = rect || { left: 0, top: 0, width: 0, height: 0 }
    this.computed = { position: 'static', display: 'block', ...style }
    this.style = { props: {}, setProperty(k, v) { this.props[k] = v }, getPropertyValue(k) { return this.props[k] || '' } }
    this.className = ''
  }
  get isConnected() { let e = this; while (e.parentElement) e = e.parentElement; return e.tagName === 'HTML' }
  append(...kids) { kids.forEach(k => { k.parentElement = this; this.children.push(k) }); return this }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null }
  hasAttribute(k) { return k in this.attrs }
  removeAttribute(k) { delete this.attrs[k] }
  getBoundingClientRect() {
    const r = this.rect
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height }
  }
  getClientRects() { return this.rect.width ? [this.getBoundingClientRect()] : [] }
  contains(o) { for (let e = o; e; e = e.parentElement) if (e === this) return true; return false }
  matches(sel) { return sel.split(',').some(s => matchOne(this, s.trim())) }
  closest(sel) { for (let e = this; e; e = e.parentElement) if (e.matches(sel)) return e; return null }
  *walk() { for (const c of this.children) { yield c; yield* c.walk() } }
  querySelectorAll(sel) { return [...this.walk()].filter(e => e.matches(sel)) }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  get dataset() {
    const el = this
    return new Proxy({}, {
      set(_, k, v) { el.attrs['data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase())] = String(v); return true },
      get(_, k) { return el.attrs['data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase())] },
    })
  }
}
const matchOne = (el, s) => {
  const m = s.match(/^([a-z][\w-]*)?(?:#([\w-]+))?(?:\.([\w-]+))?((?:\[[^\]]+\])*)$/i)
  if (!m) return false
  const [, tag, id, cls, attrs] = m
  if (tag && el.tagName !== tag.toUpperCase()) return false
  if (id && el.id !== id) return false
  if (cls && !String(el.className).split(/\s+/).includes(cls)) return false
  for (const a of (attrs || '').match(/\[[^\]]+\]/g) || []) {
    const am = a.match(/^\[([\w-]+)(?:([*^$]?=)"([^"]*)")?\]$/)
    if (!am) return false
    const [, name, op, val] = am
    const v = name === 'id' ? el.id : (name === 'class' ? el.className : el.getAttribute(name))
    if (v == null || v === '') { if (name === 'id' || name === 'class' || v == null) { if (!op && v != null) continue; return false } }
    if (!op) continue
    if (op === '=' && v !== val) return false
    if (op === '^=' && !String(v).startsWith(val)) return false
    if (op === '*=' && !String(v).includes(val)) return false
  }
  return true
}

const VW = 1440
const VH = 813
const makeWorld = () => {
  const html = new El('html')
  const body = new El('body')
  html.append(body)
  const app = new El('ytmusic-app')
  const layout = new El('ytmusic-app-layout')
  body.append(app)
  app.append(layout)
  const document = {
    documentElement: html,
    body,
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    elementsFromPoint: () => [],
    getElementById: (id) => [...html.walk()].find(e => e.id === id) || null,
  }
  const context = {
    document,
    window: { innerWidth: VW, innerHeight: VH },
    getComputedStyle: (el) => el.computed,
    performance: { now: () => context.__now },
    YTMLog: { log() { } },
    HTMLMediaElement: class { },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    __now: 0,
  }
  vm.createContext(context)
  vm.runInContext(`${barSrc}\nthis.PlayerBar = PlayerBar;`, context)
  return { context, document, html, body, layout, PlayerBar: context.PlayerBar }
}
// 画面の下に固定された、シークバーと操作を持つ横長の要素
const barLike = (tag, extra = {}) => {
  const bar = new El(tag, { rect: { left: 0, top: VH - 72, width: VW, height: 72 }, style: { position: 'fixed', display: 'flex' }, ...extra })
  bar.append(new El('button'), new El('button'), new El('button'), new El('input', { attrs: { type: 'range' } }))
  return bar
}

test('知っている作りのバーは要素名で見つけ、印を付ける', () => {
  const w = makeWorld()
  const bar = barLike('ytmusic-player-bar')
  w.layout.append(bar)
  assert.equal(w.PlayerBar.get(), bar)
  assert.equal(w.PlayerBar.variant(), 'classic')
  assert.equal(bar.getAttribute('data-ytmi-bar'), 'classic')
  // 祖先には印(CSS が「祖先ごと隠す」を打ち消すのに使う)
  assert.ok(w.layout.hasAttribute('data-ytmi-bar-path'))
  // 状態は <html> に出す。バーの印と同じ名前にすると、<html> にバー用の
  // CSS が当たってしまう(実機で見つけた)
  assert.equal(w.html.getAttribute('data-ytmi-bar-status'), 'classic')
  assert.equal(w.html.getAttribute('data-ytmi-bar'), null)
})

test('知らない作りのバーは形(画面下の固定・シークバー・操作)で見つける', () => {
  const w = makeWorld()
  const bar = barLike('future-player-bar')
  w.layout.append(bar)
  assert.equal(w.PlayerBar.get(), bar)
  assert.equal(w.PlayerBar.variant(), 'generic')
  assert.equal(bar.getAttribute('data-ytmi-bar'), 'generic')
})

test('形が違うもの(上に固定・細い・シークバーが無い)は拾わない', () => {
  const w = makeWorld()
  const top = barLike('top-bar')
  top.rect = { left: 0, top: 0, width: VW, height: 64 }
  const narrow = barLike('toast')
  narrow.rect = { left: 0, top: VH - 60, width: 300, height: 48 }
  const noSlider = new El('cookie-banner', { rect: { left: 0, top: VH - 80, width: VW, height: 80 }, style: { position: 'fixed' } })
  noSlider.append(new El('button'), new El('button'), new El('button'))
  w.layout.append(top, narrow, noSlider)
  assert.equal(w.PlayerBar.get(), null)
  assert.equal(w.html.getAttribute('data-ytmi-bar-status'), 'none')
})

test('旧バーが空のまま残っていても、再生中に描かれていなければ別のバーを探す', () => {
  const w = makeWorld()
  const stale = new El('ytmusic-player-bar')
  const video = new El('video', { attrs: { src: 'blob:x' } })
  video.src = 'blob:x'
  const fresh = barLike('future-player-bar')
  w.layout.append(stale, fresh, video)
  assert.equal(w.PlayerBar.get(), fresh)
  assert.equal(w.PlayerBar.variant(), 'generic')
})

test('まだ何も再生していない間は、隠れている旧バーを使う(探し回らない)', () => {
  const w = makeWorld()
  const stale = new El('ytmusic-player-bar')
  w.layout.append(stale)
  assert.equal(w.PlayerBar.get(), stale)
  assert.equal(w.PlayerBar.variant(), 'classic')
})

test('YTM がバーを別の親へ移したら、祖先の印を付け直す', () => {
  const w = makeWorld()
  const bar = barLike('ytmusic-player-bar')
  w.layout.append(bar)
  w.PlayerBar.get()
  const page = new El('ytmusic-player-page', { id: 'player-page' })
  w.layout.append(page)
  w.layout.children = w.layout.children.filter(c => c !== bar)
  page.append(bar)
  w.context.__now += 10000
  w.PlayerBar.get()
  assert.ok(page.hasAttribute('data-ytmi-bar-path'))
})

test('押せるかは、その位置で何に当たるかで決める', () => {
  const w = makeWorld()
  const bar = barLike('ytmusic-player-bar')
  const inner = bar.children[0]
  const wrapper = new El('div', { id: 'ytm-custom-wrapper' })
  const popup = new El('ytmusic-popup-container')
  w.layout.append(bar)
  w.body.append(wrapper, popup)
  const probe = (top) => { w.document.elementsFromPoint = () => [top]; return w.PlayerBar.probeUsable(bar, []) }
  assert.equal(probe(inner), true)
  // Immersion の全面の層の下に潜っている
  assert.equal(probe(wrapper), false)
  // メニューが一時的に被さっているだけなら判断しない
  assert.equal(probe(popup), null)
  // 大きさが無い・画面の外
  bar.rect = { left: 0, top: VH + 10, width: VW, height: 72 }
  assert.equal(probe(inner), false)
})

test('続けて押せなかった時だけ自前のバーを出し、押せるようになれば戻す', () => {
  const src = barSrc.slice(barSrc.indexOf('const FAIL_THRESHOLD'), barSrc.indexOf('const configure ='))
  assert.match(src, /const FAIL_THRESHOLD = 2;/)
  assert.match(src, /if \(usable === null\) return false;/)
  assert.match(src, /failCount = 0;\s*return setFallback\(false\);/)
  assert.match(src, /if \(failCount >= FAIL_THRESHOLD\) return setFallback\(true\);/)
  // 閉じている間は必ず引っ込める
  assert.match(src, /if \(!shown\) \{\s*failCount = 0;\s*return setFallback\(false\);/)
})

test('自前のバーは YTM の DOM に頼らず、<video> と YTM のキー操作で動く', () => {
  const ctl = barSrc.slice(barSrc.indexOf('const controls = {'), barSrc.indexOf('const ICONS'))
  assert.match(ctl, /next: \(\) => pressYtmKey\('j', 'KeyJ'\)/)
  assert.match(ctl, /prev: \(\) => pressYtmKey\('k', 'KeyK'\)/)
  assert.match(ctl, /v\.paused/)
  assert.doesNotMatch(ctl, /ytmusic-/)
  // シークは曲内の時刻(連続再生で video の時刻が 0 に戻らない分を引く)
  assert.match(barSrc, /v\.currentTime = dragTime \+ currentOffset\(\)/)
  // 音量は YTM のキーで動かす(<video> へ直に入れると YTM の音量と食い違う)
  assert.match(ctl, /pressYtmKey\(key\[0\], key\[1\]\)/)
  assert.match(ctl, /pressYtmKey\('m', 'KeyM'\)/)
  // 高評価・リピートは置かない(状態を読めず、誤って取り消す)
  assert.doesNotMatch(barSrc, /pressYtmKey\('\+'|pressYtmKey\('r'/)
  assert.match(ui, /PlayerBar\.configure\(\{ offset: \(\) => timeOffset, canMinimize: canMinimizeImmersion, minimize: minimizeImmersion \}\)/)
})

test('時刻の表示', () => {
  const w = makeWorld()
  assert.equal(w.PlayerBar._formatTime(0), '0:00')
  assert.equal(w.PlayerBar._formatTime(65.9), '1:05')
  assert.equal(w.PlayerBar._formatTime(3725), '1:02:05')
  assert.equal(w.PlayerBar._formatTime(NaN), '0:00')
})

// ── Immersion を出す条件 ──────────────────────────────────
const showSrc = ui.slice(ui.indexOf('let _immersionManualOpen = false;'), ui.indexOf('const applyImmersionShown ='))
const makeShow = () => {
  const env = {
    location: { pathname: '/watch', search: '?v=a' },
    layout: { attr: true, isConnected: true, hasAttribute() { return env.layout.attr } },
    config: { mode: true },
  }
  const document = { querySelector: () => env.layout }
  const f = new Function('document', 'location', 'config', `let _cachedLayoutEl = null;\n${showSrc}\nreturn {
    show: shouldShowImmersion,
    open: (href) => { _immersionManualOpen = true; _immersionManualHref = href; },
  };`)
  return { env, ...f(document, env.location, env.config) }
}

test('プレイヤーページが開いていて config.mode なら出す(今までどおり)', () => {
  const s = makeShow()
  assert.equal(s.show(), true)
  s.env.config.mode = false
  assert.equal(s.show(), false)
})

test('属性が無い作りでも、URL が /watch なら開いているとみなす', () => {
  const s = makeShow()
  s.env.layout.attr = false
  assert.equal(s.show(), true)
  s.env.location.pathname = '/'
  assert.equal(s.show(), false)
})

test('閲覧ページの上でも、明示して開けば出す。別のページへ移ったら閉じる', () => {
  const s = makeShow()
  s.env.layout.attr = false
  s.env.location.pathname = '/'
  s.env.location.search = ''
  assert.equal(s.show(), false)
  s.open('/')
  assert.equal(s.show(), true)
  // 曲が変わっても URL が同じなら出したまま
  assert.equal(s.show(), true)
  s.env.location.pathname = '/explore'
  assert.equal(s.show(), false)
  s.env.location.pathname = '/'
  assert.equal(s.show(), false, '一度取り消したら戻らない')
})

test('プレイヤーページを畳んだ(開→閉)時は、明示の「開く」も取り消す', () => {
  const s = makeShow()
  s.open('/watch?v=a')
  assert.equal(s.show(), true)
  s.env.layout.attr = false
  s.env.location.pathname = '/'
  s.env.location.search = ''
  assert.equal(s.show(), false)
})

test('出ていない時に押したら開く(以前は切れるだけで画面が変わらなかった)', () => {
  const toggle = ui.slice(ui.indexOf('const toggleImmersionMode = () => {'), ui.indexOf('chrome.runtime.onMessage.addListener((msg) => {\n  if (!msg || typeof msg !== \'object\') return;\n  if (msg.type !== \'YTMI_IMMERSION\')'))
  assert.match(toggle, /setImmersionOpen\(!document\.body\.classList\.contains\('ytm-custom-layout'\)\)/)
  // 動画モードの組み替えで失敗しても、開閉は止めない
  const open = ui.slice(ui.indexOf('const setImmersionOpen = (open) => {'), ui.indexOf('const toggleImmersionMode = () => {'))
  assert.match(open, /try \{\s*if \(isYTMPremiumUser\(\)\) changeIModeUIWithMovieMode\(config\.mode\);\s*\} catch/)
})

// ── 入口 ──────────────────────────────────────────────
test('ツールバーのアイコンとショートカットから開ける', () => {
  assert.ok(manifest.action, 'action が無い')
  assert.ok(manifest.commands?.['toggle-immersion']?.suggested_key?.default)
  assert.match(bg, /chrome\.action\?\.onClicked\.addListener/)
  assert.match(bg, /command !== 'toggle-immersion'/)
  assert.match(ui, /if \(msg\.type !== 'YTMI_IMMERSION'\) return;/)
  // 権限は増やしていない(タブの URL は music.youtube.com の権限で読める)
  assert.ok(!manifest.permissions.includes('tabs'))
  assert.ok(!manifest.permissions.includes('scripting'))
})

test('アイコンを押した所に応じて、切り替える・YTM のタブへ移る・YTM を開く', async () => {
  const block = bg.slice(bg.indexOf('const YTM_ORIGIN ='), bg.indexOf('chrome.action?.onClicked'))
  const calls = []
  const make = (tabs) => ({
    tabs: {
      sendMessage: async (id, msg) => { calls.push(['send', id, msg.action]) },
      query: async () => tabs,
      update: async (id) => { calls.push(['activate', id]) },
      create: async (o) => { calls.push(['create', o.url]) },
    },
    windows: { update: async (id) => { calls.push(['focus', id]) } },
  })
  const run = async (chrome, tab) => {
    calls.length = 0
    const open = new Function('chrome', 'YTMLog', `${block}\nreturn openImmersionFrom;`)(chrome, { log() { } })
    await open(tab)
    return [...calls]
  }
  assert.deepEqual(await run(make([]), { id: 1, url: 'https://music.youtube.com/watch?v=a' }), [['send', 1, 'toggle']])
  assert.deepEqual(await run(make([{ id: 7, windowId: 3 }]), { id: 2, url: undefined }), [['activate', 7], ['focus', 3], ['send', 7, 'open']])
  assert.deepEqual(await run(make([]), { id: 2 }), [['create', 'https://music.youtube.com/']])
})

// ── バーの見た目(CSS) ──────────────────────────────────
test('隠す対象の入れ物にバーが入っていても、バーごと消さない', () => {
  for (const sel of ['#player-page', '#main-panel', '#browse-page']) {
    assert.ok(css.includes(`body.ytm-custom-layout ${sel}:not([data-ytmi-bar-path])`), sel)
  }
  const path = css.slice(css.indexOf('body.ytm-custom-layout [data-ytmi-bar-path] {'))
  const rule = path.slice(0, path.indexOf('}'))
  for (const d of ['opacity: 1', 'transform: none', 'filter: none', 'z-index: auto']) {
    assert.ok(rule.includes(d), d)
  }
  // position:fixed の入れ物は z-index を外しても箱を作る。見えない入れ物ごと持ち上げる
  const lift = css.slice(css.indexOf(':is(#player-bar-background, #guide-wrapper'))
  assert.match(lift.slice(0, lift.indexOf('}')), /z-index: 2000 !important;/)
})

test('知らない作りのバーも Immersion の上に浮かせ、押せるようにする', () => {
  const g = css.slice(css.indexOf('body.ytm-custom-layout [data-ytmi-bar="generic"] {'))
  const rule = g.slice(0, g.indexOf('}'))
  assert.match(rule, /position: fixed !important;/)
  assert.match(rule, /z-index: 2000 !important;/)
  assert.match(rule, /visibility: visible !important;/)
  assert.match(css, /body\.ytm-custom-layout \[data-ytmi-bar\] \{\s*pointer-events: auto !important;/)
  // YTM が display:none にしても、見えていた時の display で出す
  assert.match(css, /\[style\*="--ytmi-bar-display"\] \{\s*display: var\(--ytmi-bar-display\) !important;/)
})

test('自前のバーは押せない時だけ出る', () => {
  assert.match(css, /#ytmi-fallback-bar \{\s*display: none;/)
  assert.match(css, /body\.ytm-custom-layout\.ytmi-fallback-bar-on #ytmi-fallback-bar \{/)
  // IMMERSION ボタンの置き場所の先頭(出ている時だけ見えるので選ばれる)
  assert.match(ui, /const MODE_TOGGLE_HOSTS = \[\s*\['#ytmi-fallback-bar \.ytmi-fb-toggle-slot', 'append'\],/)
})

// ── 更新の独立 ─────────────────────────────────────────
test('バーを監視できなくても、曲の切り替わりで tick が回る', () => {
  const drivers = ui.slice(ui.indexOf('const setupTickDrivers = () => {'), ui.indexOf('let _barRetryTimer'))
  assert.match(drivers, /\['loadedmetadata', 'emptied', 'play', 'durationchange'\]/)
  assert.match(drivers, /document\.addEventListener\(type, [\s\S]*?, true\);/)
  assert.match(drivers, /attributeFilter: \['player-page-open'\]/)
  // バーが見つからない時も tick を予約してから探し直す
  const setup = ui.slice(ui.indexOf('const setupObserver = () => {'))
  const noBar = setup.slice(setup.indexOf('if (!targetNode) {'), setup.indexOf('const observer = new MutationObserver'))
  assert.match(noBar, /scheduleTick\(\);\s*return;/)
  // 見張りは MediaSession と URL の変わり目でも tick を起こす
  assert.match(ui, /if \(signature !== _watchSignature\) \{\s*_watchSignature = signature;\s*requestImmersionTick\(\);/)
})

test('動画モードで YTM がバーを隠している間は、押せるかを測らない', () => {
  assert.match(ui, /const barMayBeAutoHidden = \(\) => !!moviemode;/)
  assert.match(ui, /PlayerBar\.check\(\{ shown, skip: !!moviemode \}\)/)
})

test('PiP の前へ・次へは、ボタンが見つからなければキー操作で送る', () => {
  assert.match(pip, /PlayerBar\.controls\.prev\(\);/)
  assert.match(pip, /PlayerBar\.controls\.next\(\);/)
})

test('player-bar.js は使う側より先に読み込む', () => {
  const js = manifest.content_scripts[0].js
  assert.ok(js.indexOf('src/js/module/player-bar.js') >= 0)
  assert.ok(js.indexOf('src/js/module/player-bar.js') < js.indexOf('src/js/module/pip-manager.js'))
  assert.ok(js.indexOf('src/js/module/player-bar.js') < js.indexOf('src/js/module/lyrics-ui.js'))
})

test('音量のつまみは YTM の音量の段(1 段ごとに約 0.73 倍)に沿って動く', () => {
  const w = makeWorld()
  const { _volumeToLevel: toLevel, _levelToVolume: toVolume } = w.PlayerBar
  assert.equal(toLevel(1), 1)
  assert.equal(toLevel(0), 0)
  // 実機で = / - を押した時の音量。1 段ごとにつまみが約 1 割動く
  const steps = [1, 0.74, 0.55, 0.4, 0.29, 0.2, 0.13].map(toLevel)
  for (let i = 1; i < steps.length; i++) {
    const d = steps[i - 1] - steps[i]
    assert.ok(d > 0.08 && d < 0.14, `${i}: ${d}`)
  }
  for (const p of [0.25, 0.5, 0.9]) assert.ok(Math.abs(toLevel(toVolume(p)) - p) < 1e-9)
})

test('▼(プレイヤーを畳む)はいつも出し、使える中で一番よい方法で畳む', () => {
  // Immersion を出している間はいつも出す(曲のリンクから直接開いた時に出ていなかった)
  assert.match(ui, /const canMinimizeImmersion = \(\) => document\.body\.classList\.contains\('ytm-custom-layout'\);/)
  const min = ui.slice(ui.indexOf('const minimizeImmersion = () => {'), ui.indexOf('\n};', ui.indexOf('const minimizeImmersion = () => {')))
  // 1. 閲覧ページの上なら隠すだけ
  assert.match(min, /if \(!readPlayerPageOpen\(\)\) \{\s*_immersionManualOpen = false;/)
  // 2. YTM の畳むボタン(旧バーの ▼ / 新バーのプレイヤーページの最小化)
  assert.match(ui, /'ytmusic-player-bar \.toggle-player-page-button',\s*'ytmusic-player-page \.player-minimize-button',/)
  assert.match(min, /btn\.click\(\);[\s\S]*setTimeout\(fallback, MINIMIZE_CONFIRM_MS\);/)
  // 3. 畳まれなければ、YTM の中へ読み込み直さずに戻れる時だけ「戻る」、4. だめなら閉じる
  assert.match(min, /if \(canGoBackInApp\(\)\) history\.back\(\);\s*else setImmersionOpen\(false\);/)
  const back = ui.slice(ui.indexOf('const canGoBackInApp = () => {'), ui.indexOf('const canMinimizeImmersion'))
  assert.match(back, /prev\.sameDocument === false\) return false;/)
  assert.match(back, /url\.origin === location\.origin && url\.pathname !== '\/watch'/)
})

test('バーを満たす色は、ジャケットの真ん中(主役)で一番広い色から取る', () => {
  const w = makeWorld()
  const SIZE = 64
  // 実機のジャケット(乃木坂46「My respect」)を模す: 上と両脇が青いカーテン、
  // 真ん中に紫の卓。鮮やかさで選ぶと青になり「どこから来た色か分からない」
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4
      const center = x > 14 && x < 50 && y > 22 && y < 56
      const [r, g, b] = center ? [177, 139, 174] : [14, 134, 170]
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
    }
  }
  const tint = w.PlayerBar.tintFromPixels(data, SIZE)
  assert.ok(tint[0] > tint[1] && tint[2] > tint[1], `紫になる: ${tint}`)
  // 白いアイコンと文字が読める深さに沈める(白とのコントラスト比 4.5:1 以上)
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const lum = 0.2126 * lin(tint[0]) + 0.7152 * lin(tint[1]) + 0.0722 * lin(tint[2])
  assert.ok(1.05 / (lum + 0.05) >= 4.5, `白い文字が読めない: ${tint}`)
  // 色の無いジャケットには色を付けない
  const gray = new Uint8ClampedArray(SIZE * SIZE * 4).fill(128)
  assert.equal(w.PlayerBar.tintFromPixels(gray, SIZE), null)
  assert.match(ui, /PlayerBar\.setTint\(PlayerBar\.tintFromPixels\(ctx\.getImageData\(0, 0, 64, 64\)\.data, 64\)\);/)
  assert.match(css, /:root\[style\*="--ytmi-tint"\] #ytmi-fallback-bar \.ytmi-fb-fill \{\s*background-color: rgb\(var\(--ytmi-tint\)\);/)
})

test('置き換わったことは、ページを開いてから最初の 1 回だけ、時刻の欄に文で伝える', () => {
  const notice = barSrc.slice(barSrc.indexOf('const showNotice = () => {'), barSrc.indexOf('const hideNotice = () => {'))
  assert.match(notice, /if \(noticeShown \|\| !fallbackEl\) return;\s*noticeShown = true;/)
  assert.match(notice, /setTimeout\(hideNotice, NOTICE_MS\)/)
  assert.match(barSrc, /class="ytmi-fb-notice" role="status" aria-live="polite"/)
  assert.match(css, /#ytmi-fallback-bar\.is-noticing \.ytmi-fb-time \{\s*opacity: 0;/)
  const ns = read('src/js/module/namespace.js')
  assert.equal((ns.match(/fb_notice: /g) || []).length, 4, '4 言語')
})

test('GPU を無駄に使わない: すりガラスを使わず、進み具合は transform のアニメーション 1 本', () => {
  const block = css.slice(css.indexOf('/* 自前のバー。'), css.indexOf('/* 作り直された新しいプレイヤーバー'))
  // 動く背景の上のすりガラスは、毎フレームぼかし直しになる
  assert.doesNotMatch(block, /backdrop-filter/)
  // 満ちていく色は transform だけで動かす
  const fill = block.slice(block.indexOf('#ytmi-fallback-bar .ytmi-fb-fill {'))
  assert.match(fill.slice(0, fill.indexOf('}')), /transform: translateX\(-100%\);\s*will-change: transform;/)
  const sync = barSrc.slice(barSrc.indexOf('const syncFill = () => {'), barSrc.indexOf('const fillDrifted'))
  assert.match(sync, /parts\.fill\.animate\(/)
  assert.match(sync, /const remainingMs = Math\.max\(0, \(dur - cur\) \/ rate\) \* 1000;/)
  assert.match(sync, /easing: 'linear'/)
  // 毎フレーム JS で描く仕組みは持たない
  assert.doesNotMatch(barSrc, /requestAnimationFrame/)
  // 組み直すのは、再生・停止・シーク・速度や長さが変わった時と、ずれた時だけ
  assert.match(barSrc, /'seeked', 'ratechange', 'play', 'pause', 'playing', 'waiting', 'ended', 'emptied'/)
  assert.match(barSrc, /if \(fillDrifted\(\) && !getVideo\(\)\?\.paused\) syncFill\(\);/)
})

test('動きを減らす設定では、出入りや乗せた時の動きを付けない', () => {
  const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  body.ytm-custom-layout.ytmi-fallback-bar-on #ytmi-fallback-bar'))
  assert.match(rm.slice(0, 400), /animation: none;/)
  assert.match(rm.slice(0, 400), /transition: none !important;/)
})
