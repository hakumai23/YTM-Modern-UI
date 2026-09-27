// background が「表示中の歌詞は他の取得元と合わない」と判断して送る訂正を、
// UI 側が品質に関わらず受けること。
//
// 以前の差し替えは「品質が上がる時だけ」だったので、外れの単語同期を
// 正しい行同期で直すことができなかった。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const ui = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
const fnStart = ui.indexOf('async function applyLateLyricsUpgrade(payload) {')
const fnEnd = ui.indexOf('const parseMeaningTimeToSecLocal', fnStart)
const lateUpgrade = ui.slice(fnStart, fnEnd)
const agreeFrom = ui.indexOf('const LYRICS_AGREE_MIN = ')
const agreeTo = ui.indexOf('const selectLyricsPayload = (payload) => {', agreeFrom)
const agreement = ui.slice(agreeFrom, agreeTo)

const lrc = (lines) => lines.map((line, i) => `[00:${String(10 + i * 3).padStart(2, '0')}.00] ${line}`).join('\n')
const RIGHT = lrc(['君の名前を呼んでいた', '夜が明けるまでずっと', '忘れられない約束を', '胸の奥にしまったまま'])
const WRONG = lrc(['雨の降る街を歩いて', '傘もささずに笑ってた', '知らない誰かの声がした', '遠くで鐘が鳴っている'])

const createHarness = ({ shown = WRONG, source = 'kugou', quality = 3, selected = null, priority = 2 } = {}) => {
  const applied = []
  const context = vm.createContext({
    applied,
    document: { body: { classList: { contains: () => false } } },
  })
  vm.runInContext(`
    let currentKey = 'Song///Artist';
    let activeLyricsRequestId = 'request-1';
    let currentLyricsVideoId = 'video-1';
    let selectedCandidateId = ${JSON.stringify(selected)};
    let currentLyricsResultPriority = ${priority};
    let currentLyricsQuality = ${quality};
    let currentLyricsSource = ${JSON.stringify(source)};
    let currentLyricsFromPreferredYtm = false;
    let lastRawLyricsText = ${JSON.stringify(shown)};
    let lyricsCandidates = null, lyricsRequests = null, lyricsConfig = null, lyricsTranslationMap = {};
    let dynamicLines = null, duetSubLyricsRaw = '', duetSubDynamicLines = null, _duetExcludedTimes = null;
    let lyricsMeaning = null, lyricsLockState = null;
    const storage = { get: async () => null };
    const LyricsCache = { stripCandidateLyrics: v => v };
    const normalizeTranslationsToLrcMapLocal = () => ({});
    const setLyricsMeaningData = () => {};
    const syncLyricsLockState = () => {};
    const refreshCandidateMenu = () => {};
    const refreshLockMenu = () => {};
    const requestSingerMetadataForLyrics = () => {};
    const updateLyricsSourceState = () => {};
    const clearLyricsLateRetry = () => {};
    const enqueueLyricsCacheWrite = async () => true;
    const applyLyricsText = async (text) => { applied.push(text); };
    // 本物と同じ形: 行同期は 2、単語同期は 3
    const selectLyricsPayload = (p) => ({
      text: p.lyrics, lyrics: p.lyrics, animatedLyrics: '',
      dynamicLines: p.dynamicLines || null,
      mode: p.dynamicLines ? 'dynamic' : 'synced',
      quality: p.dynamicLines ? 3 : 2,
    });
    ${agreement}
    ${lateUpgrade}
    this.run = applyLateLyricsUpgrade;
  `, context)
  return context
}

const base = { success: true, track_key: 'Song///Artist', request_id: 'request-1', video_id: 'video-1' }

test('訂正は、品質が下がっても(単語同期 → 行同期)受ける', async () => {
  const h = createHarness()
  await h.run({ ...base, lyricsSource: 'lrclib', lyrics: RIGHT, correction: true, replaces: 'kugou' })
  assert.deepEqual(h.applied, [RIGHT])
})

test('訂正でなければ、品質の下がる差し替えは今までどおり受けない', async () => {
  const h = createHarness()
  await h.run({ ...base, lyricsSource: 'lrchub', lyrics: RIGHT })
  assert.deepEqual(h.applied, [])
})

test('他の取得元が裏付けた歌詞が表示中のものと違えば、訂正として扱う', async () => {
  const h = createHarness({ source: 'simpmusic' })
  await h.run({ ...base, lyricsSource: 'lrchub', lyrics: RIGHT, agreement: 'confirmed' })
  assert.deepEqual(h.applied, [RIGHT])
  // 同じ歌詞(中身が合っている)なら、品質が上がらない限り替えない
  const same = createHarness({ shown: RIGHT, source: 'simpmusic' })
  await same.run({ ...base, lyricsSource: 'lrchub', lyrics: RIGHT, agreement: 'confirmed' })
  assert.deepEqual(same.applied, [])
})

test('訂正の相手が表示中の取得元でなければ受けない(YouTube Music を出している時など)', async () => {
  const h = createHarness({ source: 'ytm' })
  await h.run({ ...base, lyricsSource: 'lrclib', lyrics: RIGHT, correction: true, replaces: 'lrchub' })
  assert.deepEqual(h.applied, [])
})

test('本人が選んだ歌詞は訂正でも替えない', async () => {
  const chosen = createHarness({ selected: 'cand-1' })
  await chosen.run({ ...base, lyricsSource: 'lrclib', lyrics: RIGHT, correction: true, replaces: 'kugou' })
  assert.deepEqual(chosen.applied, [])
  const uploaded = createHarness({ priority: 3 })
  await uploaded.run({ ...base, lyricsSource: 'lrclib', lyrics: RIGHT, correction: true, replaces: 'kugou' })
  assert.deepEqual(uploaded.applied, [])
})

test('YouTube Music の歌詞を票として background へ渡している', () => {
  assert.match(ui, /type: 'LYRICS_REFERENCE',\s*payload: \{ request_id: requestId, lyrics: ytmRes\.lyrics \}/)
  assert.match(ui, /void ytmPromise\.then\(sendYtmReference\)/)
  assert.match(ui, /noteYtmCandidate\(upgraded\);\s*sendYtmReference\(upgraded\);/)
})

test('最初の応答でも、キャッシュの外れは裏付けのある歌詞に替える', () => {
  const load = ui.slice(ui.indexOf('const responsePriority = hasResponseLyrics'), ui.indexOf('// A late LRCHub event can overtake'))
  assert.match(load, /res\?\.agreement === 'confirmed'/)
  assert.match(load, /currentLyricsResultPriority < 3/)
  assert.match(load, /lyricsAgreement\(data, responseLyrics \|\| preferredLyrics\) < LYRICS_AGREE_MIN/)
})
