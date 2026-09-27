// 標準の取得元(YTM / LRCHub / LrcLib / SimpMusic / LyricsPlus)のオン・オフ。
//
// 設定は options.js が storage に書き、background と lyrics-ui.js が読む。
// 崩れやすいのは次の3つ:
//   - lyrics-ui.js(classic script)が持つキー名・ID の写しが本体とずれる
//   - 設定画面に出す通信先が manifest と食い違う
//   - background のどこかの経路がオフを見ずに叩く

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const manifest = JSON.parse(read('manifest.json'))
const background = read('src/js/background.js')
const lyricsUi = read('src/js/module/lyrics-ui.js')
const Sources = await import('../src/js/module/lyric-sources.js')

test('lyrics-ui.js の写しが本体と同じ', () => {
  assert.match(lyricsUi, new RegExp(`const DISABLED_LYRIC_SOURCES_KEY = '${Sources.DISABLED_LYRIC_SOURCES_KEY}';`))
  const ids = lyricsUi.match(/const BUILTIN_LYRIC_SOURCE_IDS = (\[[^\]]*\]);/)
  assert.ok(ids, 'BUILTIN_LYRIC_SOURCE_IDS が無い')
  assert.deepEqual(JSON.parse(ids[1].replace(/'/g, '"')), Sources.BUILTIN_SOURCE_IDS)
})

test('設定画面に出す通信先は manifest の host_permissions にある', () => {
  for (const [id, hosts] of Object.entries(Sources.BUILTIN_SOURCE_HOSTS)) {
    for (const host of hosts) {
      assert.ok(manifest.host_permissions.includes(`https://${host}/*`), `${id}: ${host} が manifest に無い`)
    }
  }
  assert.deepEqual(Object.keys(Sources.BUILTIN_SOURCE_HOSTS), Sources.BUILTIN_SOURCE_IDS)
})

test('知らない ID や壊れた値は捨てる(止める側に倒さない)', () => {
  assert.deepEqual(Sources.normalizeDisabledSources(null), [])
  assert.deepEqual(Sources.normalizeDisabledSources('lrchub'), [])
  assert.deepEqual(Sources.normalizeDisabledSources(['LRCHub', 'lrchub', 'kugou', 42]), ['lrchub'])
})

test('設定のリセットで消える', () => {
  const keys = lyricsUi.slice(lyricsUi.indexOf('const SETTINGS_STORAGE_KEYS = ['), lyricsUi.indexOf('];', lyricsUi.indexOf('const SETTINGS_STORAGE_KEYS = [')))
  assert.ok(keys.includes(`'${Sources.DISABLED_LYRIC_SOURCES_KEY}'`), 'リセットで消えない')
})

test('YTM は content script でオフを見てから取りにいく', () => {
  assert.match(lyricsUi, /\(window\.YTMLyrics && video_id && isLyricSourceOn\('ytm'\)\)/)
  assert.match(read('src/js/module/queue-manager.js'), /disabledLyricSources\.includes\('ytm'\)/)
})

test('background は歌詞取得のどの経路でもオフを見る', () => {
  const getLyrics = background.slice(background.indexOf("req.type === 'GET_LYRICS'"), background.indexOf("req.type === 'FIND_ALTERNATE_LYRICS'"))
  assert.match(getLyrics, /await Sources\.loadDisabledSources\(\)/)
  assert.match(getLyrics, /const primaryRawTask = lrchubOn/)
  assert.match(getLyrics, /const searchRawTask = lrchubOn/)
  assert.match(getLyrics, /if \(!lrchubOn\) return null;/)
  assert.match(getLyrics, /\(use_lrclib && sourceOn\('lrclib'\)\)/)
  assert.match(getLyrics, /sourceOn\('simpmusic'\) && typeof API\.fetchFromSimpMusic/)
  assert.match(getLyrics, /sourceOn\('lyricsplus'\) && typeof API\.fetchFromLyricsPlus/)

  const alternate = background.slice(background.indexOf("req.type === 'FIND_ALTERNATE_LYRICS'"), background.indexOf("req.type === 'GET_CANDIDATE_LYRICS'"))
  assert.match(alternate, /for \(const providerId of await Sources\.loadDisabledSources\(\)\) skip\.add\(providerId\);/)
})

test('設定パネルに歌詞ソースのタブがあり、優先の選択と取得元一覧がそこにある', () => {
  assert.match(lyricsUi, /data-tab="sources"/)
  const panel = lyricsUi.slice(lyricsUi.indexOf('id="panel-sources"'), lyricsUi.indexOf('id="panel-translation"'))
  assert.match(panel, /id="lyric-source-group"/)
  assert.match(panel, /id="extra-providers-embed"/)
  const visuals = lyricsUi.slice(lyricsUi.indexOf('id="panel-visuals"'), lyricsUi.indexOf('id="panel-sources"'))
  assert.ok(!visuals.includes('lyric-source-group'), '表示タブに残っている')
})
