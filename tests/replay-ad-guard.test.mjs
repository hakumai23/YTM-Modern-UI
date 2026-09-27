import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync(
  new URL('../src/js/module/replay-manager.js', import.meta.url),
  'utf8',
)
const start = source.indexOf('check: async function () {')
const end = source.indexOf('recordNewPlay: async function () {', start)
assert.notEqual(start, -1)
assert.notEqual(end, -1)
const checkSource = source.slice(start, end).replace(/,\s*$/, '')

const makeManager = () => {
  const state = { ad: false, videoId: 'song', paused: false, duration: 200, writes: 0 }
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (selector === '.ad-interrupting, .ad-showing') return state.ad ? {} : null
        if (selector === 'video') return { paused: state.paused, duration: state.duration }
        throw new Error(`Unexpected selector: ${selector}`)
      },
    },
    getCurrentVideoId: () => state.videoId,
  })
  vm.runInContext(`this.manager = {
    currentVideoId: 'song', currentPlayTime: 30, lastSaveTime: 0,
    hasRecordedCurrent: false, isRecording: false,
    currentLyricLines: 0, recordedLyricLines: 0,
    recordNewPlay: async function () { __state.writes++ },
    updateDuration: async function () { __state.writes++ },
    ${checkSource}
  }`, Object.assign(context, { __state: state }))
  return { state, manager: context.manager }
}

test('広告中は広告の動画 ID と再生時間を履歴に反映しない', async () => {
  const { state, manager } = makeManager()
  state.ad = true
  state.videoId = 'ad'
  await manager.check()

  assert.equal(manager.currentVideoId, 'song')
  assert.equal(manager.currentPlayTime, 30)
  assert.equal(state.writes, 0)

  state.ad = false
  state.videoId = 'song'
  await manager.check()
  assert.equal(manager.currentPlayTime, 31)
  assert.equal(state.writes, 1)
})
