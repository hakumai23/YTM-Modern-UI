// 広告の間の Immersion。
//
// 広告は同じ <video> で流れる。実機(ログアウト状態)では曲の切り替えの
// 直前に広告が入ると、前の曲の題名・次の曲のアーティスト名・Loading... が
// 広告のあいだ並んでいた。曲の切り替えを待つようにした後は、今度は前の曲の
// 歌詞が広告の再生位置で頭から流れ直す。広告の間は歌詞を塗らず、
// 歌詞の場所に「終わると曲に戻ります」とだけ出す。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const uiSource = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
const cssSource = fs.readFileSync(new URL('../src/css/style.css', import.meta.url), 'utf8')
const nsSource = fs.readFileSync(new URL('../src/js/module/namespace.js', import.meta.url), 'utf8')

const sliceBetween = (from, to) => {
  const start = uiSource.indexOf(from)
  const end = uiSource.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return uiSource.slice(start, end)
}

const makeEl = () => {
  const el = {
    className: '',
    textContent: '',
    children: [],
    attrs: {},
    classes: new Set(),
    classList: {
      contains: (c) => el.classes.has(c),
      toggle: (c, on) => (on ? el.classes.add(c) : el.classes.delete(c)),
    },
    setAttribute: (k, v) => { el.attrs[k] = v },
    append: (...kids) => el.children.push(...kids),
    appendChild: (kid) => el.children.push(kid),
    querySelector: (sel) => {
      const name = sel.replace(/^\./, '')
      const walk = (node) => {
        for (const k of node.children) {
          if (k.className === name) return k
          const hit = walk(k)
          if (hit) return hit
        }
        return null
      }
      return walk(el)
    },
    isConnected: true,
  }
  return el
}

const load = () => {
  const player = makeEl()
  const body = makeEl()
  const stage = makeEl()
  const state = { paused: 0 }
  const context = vm.createContext({
    document: {
      body,
      getElementById: (id) => (id === 'movie_player' ? player : null),
      createElement: () => makeEl(),
    },
    ui: { lyricsStage: stage },
    t: (key) => ({ ad_notice_title: '広告', ad_notice_sub: '終わると曲に戻ります' })[key] || key,
    pauseAllLyricWordMotion: () => { state.paused += 1 },
  })
  vm.runInContext(
    `${sliceBetween('let _cachedMoviePlayer = null;', 'function startLyricRafLoop() {')}
    this.isAd = isAdPlayingNow; this.setAd = setAdPlayingState;`,
    context,
  )
  return { player, body, stage, state, ...context }
}

test('広告の間は body に印を付け、歌詞の場所に知らせを出す', () => {
  const h = load()
  h.player.classes.add('ad-showing')
  assert.equal(h.isAd(), true)
  h.setAd(true)
  assert.ok(h.body.classes.has('ytm-ad-playing'))
  const notice = h.stage.querySelector('.ytm-ad-notice')
  assert.ok(notice, '知らせが無い')
  assert.equal(notice.attrs.role, 'status')
  assert.equal(notice.querySelector('.ytm-ad-notice-label').textContent, '広告')
  assert.equal(h.state.paused, 1, '文字の動きを止めていない')
})

test('広告が終われば印を外し、知らせは使い回す', () => {
  const h = load()
  h.setAd(true)
  h.setAd(false)
  assert.ok(!h.body.classes.has('ytm-ad-playing'))
  h.setAd(true)
  assert.equal(h.stage.children.length, 1, '知らせが二重にできた')
})

test('歌詞のループは広告の時刻で歌詞を塗らない', () => {
  const loop = sliceBetween('const loop = () => {', '// 窓の大きさが変わったら、いまの行へ寄せ直す。')
  const adAt = loop.indexOf('if (isPlaying && isAdPlayingNow()) {')
  assert.ok(adAt !== -1)
  assert.ok(adAt < loop.indexOf('updateLyricHighlight(t)'), '広告を見る前に歌詞を塗っている')
  assert.match(loop.slice(adAt, adAt + 300), /scheduleNextFrame\(\);\s*return;/)
})

test('tick は広告の状態を反映してから戻る', () => {
  const tick = sliceBetween('const tick = async () => {', 'let toggleBtn')
  assert.match(tick, /setAdPlayingState\(adPlaying\);\s*if \(adPlaying\) return;/)
})

test('広告の間は歌詞を隠して知らせを出す(CSS)', () => {
  assert.match(cssSource, /body\.ytm-custom-layout\.ytm-ad-playing #my-lyrics-container \{\s*opacity: 0;/)
  assert.match(cssSource, /body\.ytm-custom-layout\.ytm-ad-playing \.ytm-ad-notice \{[^}]*display: flex;/)
})

test('知らせの文言は 4 言語ぶんある', () => {
  assert.equal((nsSource.match(/ad_notice_title:/g) || []).length, 4)
  assert.equal((nsSource.match(/ad_notice_sub:/g) || []).length, 4)
})
