import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const lyricsUiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

// 1行ぶんの塗りは updateLyricHighlight から切り出してある。実物を一緒に動かす。
const functionStart = lyricsUiSource.indexOf('function paintActiveLyricRow(r, t)')
const functionEnd = lyricsUiSource.indexOf('function setupPlayerBarBlankClickGuard', functionStart)
assert.notEqual(functionStart, -1, 'updateLyricHighlight should be present')
assert.notEqual(functionEnd, -1, 'updateLyricHighlight end marker should be present')
const updateSource = lyricsUiSource.slice(functionStart, functionEnd)

// 「いまの行を次の行まで明るく保つ」判断は updateLyricHighlight の外にある。
// コピーを置くと本体とずれるので、実物を切り出して一緒に動かす。
const litStart = lyricsUiSource.indexOf('const isPrimaryRowLitAtTime')
const litEnd = lyricsUiSource.indexOf('const isSameTimestamp', litStart)
assert.notEqual(litStart, -1, 'isPrimaryRowLitAtTime should be present')
const litSource = lyricsUiSource.slice(litStart, litEnd)

class FakeClassList {
  constructor(...names) {
    this.names = new Set(names)
  }

  add(...names) {
    names.forEach(name => this.names.add(name))
  }

  remove(...names) {
    names.forEach(name => this.names.delete(name))
  }

  contains(name) {
    return this.names.has(name)
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.names.has(name) : !!force
    if (enabled) this.names.add(name)
    else this.names.delete(name)
    return enabled
  }
}

function makeRow() {
  return {
    classList: new FakeClassList('lyric-line'),
    dataset: {},
    querySelectorAll() { return [] },
  }
}

function createHighlightHarness(lyricsData, hasDynamicRanges) {
  const rows = lyricsData.map(() => makeRow())
  const container = {
    children: rows,
    _lastScrolledIndex: -1,
  }
  const context = {
    DYNAMIC_OVERLAP_TOLERANCE: 0.05,
    DUET_DUPLICATE_TOLERANCE: 1,
    PipManager: { pipWindow: null, pipLyricsContainer: null },
    ReplayManager: { incrementLyricCount() {} },
    dynamicLines: hasDynamicRanges ? [{}] : null,
    lyricsData,
    rows,
    ui: { lyrics: container },
    hasTimestamp: true,
    isUserScrolling: false,
    meaningPanelVisible: false,
    isLineDynamicallyActiveAtTime(line, time, tolerance = 0.05) {
      return Number.isFinite(line?._dynamicRenderStartSec) &&
        Number.isFinite(line?._dynamicRenderEndSec) &&
        time + tolerance >= line._dynamicRenderStartSec &&
        time <= line._dynamicRenderEndSec + tolerance
    },
    isSameTimestamp(a, b, tolerance = 0.05) {
      return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance
    },
    normalizeLyricCompareTextStrict(value) {
      return String(value || '').replace(/\s+/g, '').toLowerCase()
    },
    scoreLyricTextMatch(a, b) { return a === b ? 100 : 0 },
    syncMeaningPanelToPlayback() {},
    // 行を止める位置。CSS の指定が無い時の既定(中央)と同じ
    lyricAnchorOffset: (c, rowHeight) => (c.clientHeight / 2) - (rowHeight / 2),
    clearTimeout() {},
    setTimeout() { return 1 },
  }

  vm.runInNewContext(`
    ${litSource}
    let lastActiveIndex = -1;
    let _hasDynamicRenderRanges = ${hasDynamicRanges ? 'true' : 'false'};
    let _previousActiveIndices = new Set();
    let _activeRowsHaveCharSpans = false;
    let isProgrammaticScrolling = false;
    let programmaticScrollTimeout = null;
    let programmaticScrollMaxTimeout = null;
    ${updateSource}
    globalThis.runAt = (time, expectedPrimaryIndex) => {
      ui.lyrics._lastScrolledIndex = expectedPrimaryIndex;
      updateLyricHighlight(time);
      return rows.map(row => ({
        active: row.classList.contains('active'),
        past: row.classList.contains('lyric-past'),
      }));
    };
  `, context, { filename: 'lyrics-highlight-state.js' })

  return {
    runAt(...args) {
      return JSON.parse(JSON.stringify(context.runAt(...args)))
    },
  }
}

test('DynamicLRC rows fade after their own end and recover after a backward seek', () => {
  const harness = createHighlightHarness([
    { time: 1, text: 'First', _dynamicRenderStartSec: 1, _dynamicRenderEndSec: 2 },
    { time: 8, text: 'Second', _dynamicRenderStartSec: 8, _dynamicRenderEndSec: 9 },
  ], true)

  assert.deepEqual(harness.runAt(1.5, 0), [
    { active: true, past: false },
    { active: false, past: false },
  ])
  // 歌い終わっても、次の行が始まるまでは明るいまま残す。
  // ここで active を外すと色が #fff → rgba(255,255,255,0.3)、大きさが
  // 1.05 → 0.95 に落ち、文字同期では塗りのグラデーションごと消える。
  // 行間が空く曲ではそれが数秒続き、点いて消えて点いて消えて、に見える。
  assert.deepEqual(harness.runAt(3, 0), [
    { active: true, past: false },
    { active: false, past: false },
  ])
  assert.deepEqual(harness.runAt(8.5, 1), [
    { active: false, past: true },
    { active: true, past: false },
  ])
  // 最後の行も同じ。次が無いので明るいまま画面に残る
  assert.deepEqual(harness.runAt(10, 1), [
    { active: false, past: true },
    { active: true, past: false },
  ])
  assert.deepEqual(harness.runAt(1.5, 0), [
    { active: true, past: false },
    { active: false, past: false },
  ])
})

test('regular LRC keeps the current row active until the next timestamp', () => {
  const harness = createHighlightHarness([
    { time: 1, text: 'First' },
    { time: 8, text: 'Second' },
  ], false)

  assert.deepEqual(harness.runAt(3, 0), [
    { active: true, past: false },
    { active: false, past: false },
  ])
  assert.deepEqual(harness.runAt(8.5, 1), [
    { active: false, past: true },
    { active: true, past: false },
  ])
})

// 3行が重なる所。以前は「前の行が1秒以内なら一緒に光らせる」規則が、
// 他に光っている行が無い時だけ効いていた。重なった行が先に終わると消え、
// 残りの行が終わった瞬間にこの規則が効き直して、歌い終わった2行目が
// もう一度光っていた(語の動きも頭から流れ直す)。
const lightsOf = (states) => states.map(s => (s.active ? 'A' : (s.past ? 'p' : '.'))).join('')

test('3行が重なっても、歌い終わった行はもう一度光らない', () => {
  const lines = [
    { time: 0, text: 'Long', _dynamicRenderStartSec: 0, _dynamicRenderEndSec: 8 },
    { time: 2, text: 'Short', _dynamicRenderStartSec: 2, _dynamicRenderEndSec: 4 },
    { time: 3, text: 'Last', _dynamicRenderStartSec: 3, _dynamicRenderEndSec: 5 },
    { time: 12, text: 'Next', _dynamicRenderStartSec: 12, _dynamicRenderEndSec: 13 },
  ]
  const harness = createHighlightHarness(lines, true)
  const seen = []
  for (let t = 0.5; t < 12; t += 0.1) {
    const idx = lines.findLastIndex(l => l.time <= t)
    seen.push(lightsOf(harness.runAt(t, idx))[1])
  }
  // 2行目は 2 秒から 4 秒まで光り、そのあとは一度も光らない
  const firstOff = seen.indexOf('p', seen.indexOf('A'))
  assert.ok(firstOff > 0)
  assert.ok(!seen.slice(firstOff).includes('A'), seen.join(''))
})

test('他の行が歌っている間に消えた行は、その行が終わっても点き直さない', () => {
  const lines = [
    { time: 0, text: 'Backing', _dynamicRenderStartSec: 0, _dynamicRenderEndSec: 8 },
    { time: 2, text: 'Main', _dynamicRenderStartSec: 2, _dynamicRenderEndSec: 4 },
    { time: 12, text: 'Next', _dynamicRenderStartSec: 12, _dynamicRenderEndSec: 13 },
  ]
  const harness = createHighlightHarness(lines, true)
  assert.equal(lightsOf(harness.runAt(3, 1)), 'AA.')
  assert.equal(lightsOf(harness.runAt(5, 1)), 'A..')
  // Backing が終わっても、4 秒で歌い終わった Main は点け直さない
  assert.equal(lightsOf(harness.runAt(8.5, 1)), 'p..')
  assert.equal(lightsOf(harness.runAt(12.5, 2)), 'ppA')
})

test('重なりが無ければ、歌い終わった行は次の行まで明るいまま', () => {
  const lines = [
    { time: 0, text: 'First', _dynamicRenderStartSec: 0, _dynamicRenderEndSec: 1.9 },
    { time: 2, text: 'Second', _dynamicRenderStartSec: 2, _dynamicRenderEndSec: 4 },
    { time: 9, text: 'Next', _dynamicRenderStartSec: 9, _dynamicRenderEndSec: 10 },
  ]
  const harness = createHighlightHarness(lines, true)
  assert.equal(lightsOf(harness.runAt(3, 1)), 'pA.')
  assert.equal(lightsOf(harness.runAt(6, 1)), 'pA.')
})
