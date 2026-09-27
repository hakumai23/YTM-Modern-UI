// Daily Replay の、再生しながら使った時の振る舞い。
//
// 1. ランキングのスクロール位置が 5 秒ごとに先頭へ戻っていた。
//    実機で 30 件を超える履歴を入れ、ランキングを 300px 送ると、再生中は
//    1 秒以内に .replay-list が作り直されて 0 に戻った。
// 2. 1 曲リピートで何周しても再生回数が 1 回のままだった。
// 3. 英語表示で回数に日本語の「回」が付いていた(共有画像にも出る)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const replaySource = fs.readFileSync(new URL('../src/js/module/replay-manager.js', import.meta.url), 'utf8')
const namespaceSource = fs.readFileSync(new URL('../src/js/module/namespace.js', import.meta.url), 'utf8')

const method = (name, next) => {
  const start = replaySource.indexOf(`${name}: async function () {`)
  const end = replaySource.indexOf(next, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${name}`)
  return replaySource.slice(start, end).replace(/,\s*$/, '')
}

// ── ランキングのスクロール位置 ───────────────────────────
const makeContainer = () => ({
  scrollTop: 0,
  _list: null,
  builds: 0,
  set innerHTML(value) {
    this._html = value
    this.builds += 1
    this._list = { scrollTop: 0 }
  },
  get innerHTML() { return this._html },
  querySelector(selector) { return selector === '.replay-list' ? this._list : null },
})

const makeStats = (totalTime) => ({
  totalPlays: 40,
  totalTime,
  totalLyrics: 10,
  topArtists: [{ name: 'A', count: 3 }],
  topArtistShare: '10%',
  mostPlayedArtist: { name: 'A', count: 3 },
  mostPlayedSong: { title: 'S', artist: 'A', count: 3, src: '' },
  topSongs: Array.from({ length: 30 }, (_, i) => ({ title: `S${i}`, artist: 'A', count: 1, src: '', totalDuration: 100 })),
})

const makePanel = () => {
  const container = makeContainer()
  const state = { stats: makeStats('1m'), range: 'day' }
  const panel = {
    dataset: {},
    querySelector: (selector) => (selector === '.ytm-replay-content' ? container : null),
    querySelectorAll: () => [],
  }
  const context = vm.createContext({
    ui: { replayPanel: panel },
    t: (key) => key,
    escapeHtml: (v) => String(v ?? ''),
  })
  vm.runInContext(`this.manager = {
    _aliasBackfilled: true,
    formatDuration: (s) => String(s),
    getStats: async () => __state.stats,
    _ensureFooter: () => {},
    ${method('renderUI', '// フッターは中身が変わらないので')}
  }`, Object.assign(context, { __state: state }))
  Object.defineProperty(panel.dataset, 'range', { get: () => state.range })
  return { container, state, manager: context.manager }
}

test('再生中の更新でランキングのスクロール位置を保つ', async () => {
  const { container, state, manager } = makePanel()
  await manager.renderUI()
  container._list.scrollTop = 300
  container.scrollTop = 40

  state.stats = makeStats('1m 5s') // 5 秒後の更新で総再生時間だけ変わる
  await manager.renderUI()
  assert.equal(container.builds, 2)
  assert.equal(container._list.scrollTop, 300, 'ランキングが先頭へ戻った')
  assert.equal(container.scrollTop, 40)
})

test('中身が変わっていなければ作り直さない', async () => {
  const { container, manager } = makePanel()
  await manager.renderUI()
  const list = container._list
  await manager.renderUI()
  assert.equal(container.builds, 1)
  assert.equal(container._list, list)
})

test('期間を切り替えた時はランキングの頭から見せる', async () => {
  const { container, state, manager } = makePanel()
  await manager.renderUI()
  container._list.scrollTop = 300
  state.range = 'week'
  state.stats = makeStats('9m')
  await manager.renderUI()
  assert.equal(container._list.scrollTop, 0)
})

// ── 1 曲リピート ─────────────────────────────────────
const checkSource = method('check', 'recordNewPlay: async function () {')

const makeManager = () => {
  const state = { videoId: 'song', time: 0, duration: 200, records: 0 }
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (selector === '.ad-interrupting, .ad-showing') return null
        if (selector === 'video') return { paused: false, duration: state.duration, currentTime: state.time }
        throw new Error(`Unexpected selector: ${selector}`)
      },
    },
    getCurrentVideoId: () => state.videoId,
  })
  vm.runInContext(`this.manager = {
    currentVideoId: null, currentPlayTime: 0, lastSaveTime: 0,
    hasRecordedCurrent: false, isRecording: false,
    currentLyricLines: 0, recordedLyricLines: 0,
    recordNewPlay: async function () { __state.records++ },
    updateDuration: async function () {},
    ${checkSource}
  }`, Object.assign(context, { __state: state }))
  return { state, manager: context.manager }
}

const playSeconds = async ({ state, manager }, seconds) => {
  for (let i = 0; i < seconds; i++) {
    await manager.check()
    state.time = (state.time + 1) % state.duration // 1 曲リピートで頭へ戻る
  }
}

test('1 曲リピートで 2 周聴いたら 2 回と数える', async () => {
  const m = makeManager()
  await playSeconds(m, 200 * 2 + 40)
  assert.equal(m.state.records, 3, `記録 ${m.state.records} 回`)
})

test('曲の途中で少し戻しただけでは数え直さない', async () => {
  const m = makeManager()
  await playSeconds(m, 60)
  assert.equal(m.state.records, 1)
  m.state.time = 30 // 前半で巻き戻し
  await playSeconds(m, 20)
  m.state.time = 1 // 前半から頭へ(聴き終えていない)
  await playSeconds(m, 10)
  assert.equal(m.state.records, 1)
})

// ── 英語の回数の単位 ──────────────────────────────────
const loadT = (uiLang) => {
  const start = namespaceSource.indexOf('const LOCAL_FALLBACK_TEXTS = {')
  const tStart = namespaceSource.indexOf('const t = (key) => {', start)
  const end = namespaceSource.indexOf('return key;\n  };', tStart)
  assert.ok(start !== -1 && tStart !== -1 && end !== -1)
  const context = vm.createContext({ config: { uiLang } })
  vm.runInContext(`${namespaceSource.slice(start, end)}return key;\n  };\nthis.t = t;`, context)
  return context.t
}

test('英語表示の回数に「回」を付けない', () => {
  const t = loadT('en')
  assert.equal(t('replay_unit_count'), '')
  assert.equal(loadT('ja')('replay_unit_count'), '回')
})

test('表に無い言語や項目は、これまでどおり日本語・キー名で出す', () => {
  const ja = loadT('ja')
  const fr = loadT('fr')
  assert.equal(fr('replay_unit_count'), '回')
  assert.equal(fr('replay_today'), ja('replay_today'))
  assert.equal(loadT('en')('__no_such_key__'), '__no_such_key__')
})
