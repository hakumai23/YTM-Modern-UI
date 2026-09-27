// Up Next の先読みが、利用者の歌詞を上書きしていた。
//
// 歌詞が取れた時の分岐だけ、保存済みの記録を確かめずに書いていた。
// Up Next を開いたまま次の曲へ進むと、その曲に読み込んでおいた LRC や
// 手で選んだ候補が、先読みの結果で消えた(歌詞が無かった時の分岐は
// 既に確かめていた)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const queueSource = fs.readFileSync(new URL('../src/js/module/queue-manager.js', import.meta.url), 'utf8')
const cacheSource = fs.readFileSync(new URL('../src/js/module/lyrics-cache.js', import.meta.url), 'utf8')

const start = queueSource.indexOf('_prefetchLyrics: function (meta) {')
const end = queueSource.indexOf('\n    },\n', start)
assert.ok(start !== -1 && end !== -1)
const prefetchSource = queueSource.slice(start, end + '\n    }'.length + 1)

const run = async (existing, response) => {
  const store = new Map([['Song///Artist', existing]])
  const context = vm.createContext({
    Date,
    Map,
    Set,
    console,
    YTMLog: { log() {} },
    trimMapToLimit() {},
    LYRICS_CACHE_VERSION: 2,
    NO_LYRICS_SENTINEL: '__NO_LYRICS__',
    config: { lyricSourceMode: 'ytm' },
    ui: {},
    storage: {
      get: async (k) => store.get(k),
      set: async (k, v) => { store.set(k, v) },
    },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (_msg, cb) => { cb(response) },
      },
    },
  })
  vm.runInContext(`${cacheSource.replace(/^const LyricsCache =/m, 'this.LyricsCache =')}`, context)
  vm.runInContext(`var LyricsCache = this.LyricsCache; this.q = {
    PREFETCH_DEDUP_MS: 0, PREFETCH_HISTORY_LIMIT: 50,
    _prefetchLastAt: new Map(), _prefetchInFlight: new Set(),
    _refreshHighlights() {},
    ${prefetchSource}
  }`, context)
  context.q._prefetchLyrics({ title: 'Song', artist: 'Artist', videoId: 'vid1' })
  await new Promise((r) => setTimeout(r, 10))
  return store.get('Song///Artist')
}

const fetched = { success: true, lyrics: '[00:01.00]fetched', source: 'lrclib' }

test('読み込んだ LRC は先読みで上書きしない', async () => {
  const mine = { lyrics: '[00:01.00]mine', manualLyrics: true, video_id: 'vid1' }
  const after = await run(mine, fetched)
  assert.equal(after.lyrics, '[00:01.00]mine')
  assert.equal(after.manualLyrics, true)
})

test('手で選んだ候補も上書きしない', async () => {
  const chosen = { lyrics: '[00:01.00]chosen', manualChoice: true, video_id: 'vid1' }
  const after = await run(chosen, fetched)
  assert.equal(after.lyrics, '[00:01.00]chosen')
})

test('自動で取った記録や空の所には、これまでどおり先読みを書く', async () => {
  const auto = await run({ lyrics: '[00:01.00]old', video_id: 'vid1' }, fetched)
  assert.equal(auto.lyrics, '[00:01.00]fetched')
  const empty = await run(undefined, fetched)
  assert.equal(empty.lyrics, '[00:01.00]fetched')
  assert.equal(empty.video_id, 'vid1')
})
