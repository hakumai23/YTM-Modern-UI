// BuaaaBot(buaaa.buachi.work)の取り込み。
//
// 相手の曲名検索はかなり緩い(実測: 「Lemon」をアーティスト「Nobody」で
// 投げても別の歌手の Lemon が返る。duration も絞り込みに使われない)。
// だから videoId での完全一致を先に聞き、外れた時だけ曲名で聞いて、
// 返ってきた曲名・歌手・長さをこちらで突き合わせる。ここが崩れると
// 別の曲の歌詞が単語同期でもっともらしく流れる。
//
// 許可の問い合わせと通信を差し替えるので、ファイルを分けてある
// (node --test はファイルごとに別プロセスで走る)。
// 歌詞そのものは使わない。語はすべてこのファイルで作った仮の文字列。

import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.chrome = {
  runtime: { lastError: null },
  storage: { local: { get: (_k, cb) => cb({}) } },
  permissions: {
    contains: (_p, cb) => cb(true),          // 許可済みとして扱う
    onAdded: { addListener() {} },
    onRemoved: { addListener() {} },
  },
}

const warnings = []
console.warn = (...a) => warnings.push(a.join(' '))

const {
  buaaaLyricEndMs,
  buaaaMatchesTrack,
  convertBuaaaResponse,
  fetchFromBuaaa,
  isProviderResting,
} = await import('../src/js/module/extra-providers.js')

// ── 返ってくる形(LyricsPlus / KPoe 互換) ─────────────────────

const syllables = (start, words, step = 300) => words.map((text, i) => ({
  time: start + i * step,
  duration: step - 20,
  text,
}))

const line = (start, words, extra = {}) => {
  const syllabus = syllables(start, words)
  return {
    time: start,
    duration: words.length * 300 + 2000,     // 行の長さは余韻まで含んで長め
    text: words.join(''),
    syllabus,
    element: { key: `L${start}`, singer: 'v1', songPartIndex: 0 },
    ...extra,
  }
}

const payload = ({ title = 'テスト曲', artist = 'テスト歌手', totalDuration = '0:27.600', lines } = {}) => ({
  type: 'Word',
  metadata: { source: 'BuaaaBot', title, artist, language: 'ja', totalDuration, leadingSilence: '0.000' },
  lyrics: lines || [
    line(1000, ['あ', 'い', 'う']),
    line(5000, ['え', 'お ', 'か']),
    line(9000, ['き', 'く']),
    line(13000, ['け', 'こ']),
    line(17000, ['さ', 'し']),
    line(21000, ['す', 'せ']),
    line(25000, ['そ', 'た']),
  ],
  status: 'success',
})

// ── 変換 ────────────────────────────────────────────────────

test('音節を語ごとの絶対時刻に均す', () => {
  const result = convertBuaaaResponse(payload(), { track: 'テスト曲', artist: 'テスト歌手' })
  assert.ok(result)
  assert.equal(result.dynamicLines.length, 7)
  assert.deepEqual(result.dynamicLines[0].chars, [
    { t: 1000, c: 'あ' },
    { t: 1300, c: 'い' },
    { t: 1600, c: 'う' },
  ])
  assert.equal(result.dynamicLines[1].text, 'えお か', '語に付いた空白は本文にも残す')
  assert.match(result.lyrics, /^\[00:01\.00\] あいう\n\[00:05\.00\] えお か/)
})

// 行の長さ(duration)は余韻まで含んでいて、そのまま使うと最後の語が長く塗られる。
test('行の終わりは最後の語の終わりから採る', () => {
  const result = convertBuaaaResponse(payload(), {})
  // 最後の語は 1600ms 開始・280ms
  assert.equal(result.dynamicLines[0].endTimeMs, 1880)
})

test('ハモリ(isBackground)は本編に混ぜず、本文も語から組み直す', () => {
  const withBackground = line(1000, ['あ', 'い'])
  withBackground.syllabus.push({ time: 1100, duration: 500, text: '(ハモ)', isBackground: true })
  withBackground.text = 'あい(ハモ)'
  const lines = [withBackground, ...payload().lyrics.slice(1)]
  const result = convertBuaaaResponse(payload({ lines }), {})
  assert.equal(result.dynamicLines[0].text, 'あい')
  assert.deepEqual(result.dynamicLines[0].chars.map(ch => ch.c), ['あ', 'い'])
})

test('音節が無ければ行同期として返す(dynamicLines は渡さない)', () => {
  const lines = payload().lyrics.map(({ syllabus, ...rest }) => rest)
  const result = convertBuaaaResponse(payload({ lines }), {})
  assert.ok(result.lyrics.includes('あいう'))
  assert.equal(result.dynamicLines, null)
})

// ドキュメント上の成功時の形は { status, data: { lyrics } }。いまの実物は
// トップにも載せているが、それが無くなっても黙って止まらないように。
test('ドキュメントどおり data の下にしか無い形も読む', () => {
  const { lyrics, metadata, ...rest } = payload()
  const documented = { ...rest, data: { type: 'Word', lyrics, title: metadata.title, artist: metadata.artist } }
  const result = convertBuaaaResponse(documented, {})
  assert.equal(result?.dynamicLines?.length, 7)
  assert.equal(buaaaLyricEndMs(documented), buaaaLyricEndMs(payload()))
})

test('歌詞の終わりは行と語のいちばん遅い終わり', () => {
  // 仮の曲の最後の語は 25300ms 開始・280ms。行の長さ(余韻込み)の方が遅い
  assert.equal(buaaaLyricEndMs(payload()), Math.max(25300 + 280, 25000 + 2 * 300 + 2000))
  assert.equal(buaaaLyricEndMs({ metadata: { totalDuration: '1:02.500' }, lyrics: [] }), 62500)
  assert.equal(buaaaLyricEndMs({}), null)
})

test('中身の無い返事は歌詞にしない', () => {
  assert.equal(convertBuaaaResponse({ status: 'error', message: 'Lyrics not found' }, {}), null)
  assert.equal(convertBuaaaResponse({ lyrics: [] }, {}), null)
  assert.equal(convertBuaaaResponse(null, {}), null)
})

// ── 曲名検索の突き合わせ ────────────────────────────────────
//
// 相手の totalDuration は曲の長さではなく「最後の語の終わり」
// (実測10曲でミリ秒まで一致)。後奏のぶん必ず曲より短い。
// 数字は実測: Lemon は曲 256 秒・歌詞 246.66 秒、POP STAR は 283 秒・250.17 秒。

const lemon = { title: 'Lemon', artist: '米津玄師', lyricEndMs: 246662 }

test('後奏のぶん歌詞が短くても、曲名と歌手が合えば通す', () => {
  assert.equal(buaaaMatchesTrack(lemon, { track: 'Lemon', artist: '米津玄師', durationSec: 256 }), true)
  assert.equal(buaaaMatchesTrack(
    { title: 'POP STAR', artist: '平井堅', lyricEndMs: 250173 },
    { track: 'POP STAR', artist: '平井堅', durationSec: 283 },
  ), true)
})

test('歌手名がローマ字と漢字で比べられない時は、後奏が短ければ通す', () => {
  assert.equal(buaaaMatchesTrack(lemon, { track: 'Lemon', artist: 'Kenshi Yonezu', durationSec: 256 }), true)
  // 後奏が長すぎれば、名前を比べられない以上は採らない
  assert.equal(buaaaMatchesTrack(lemon, { track: 'Lemon', artist: 'Kenshi Yonezu', durationSec: 290 }), false)
  // 長さが分からなければ採らない
  assert.equal(buaaaMatchesTrack(lemon, { track: 'Lemon', artist: 'Kenshi Yonezu' }), false)
})

test('同じ文字の種類で名前が違えば、別の歌手の曲として採らない', () => {
  assert.equal(buaaaMatchesTrack(lemon, { track: 'Lemon', artist: '別の歌手', durationSec: 256 }), false)
  assert.equal(buaaaMatchesTrack(
    { title: 'Lemon', artist: 'Someone', lyricEndMs: 246662 },
    { track: 'Lemon', artist: 'Nobody', durationSec: 256 },
  ), false)
})

test('歌詞が曲からはみ出す版・曲の途中で尽きる版は採らない', () => {
  assert.equal(buaaaMatchesTrack(lemon, { track: 'Lemon', artist: '米津玄師', durationSec: 200 }), false)
  assert.equal(buaaaMatchesTrack(lemon, { track: 'Lemon', artist: '米津玄師', durationSec: 340 }), false)
  // 丸めの揺れ程度は許す
  assert.equal(buaaaMatchesTrack(lemon, { track: 'Lemon', artist: '米津玄師', durationSec: 245 }), true)
})

test('曲名の違いは付属物だけ許し、そのときは歌手の一致を求める', () => {
  const senbon = { title: '千本桜 (feat. 初音ミク)', artist: 'WhiteFlame', lyricEndMs: 240000 }
  assert.equal(buaaaMatchesTrack(senbon, { track: '千本桜', artist: 'WhiteFlame', durationSec: 245 }), true)
  assert.equal(buaaaMatchesTrack(senbon, { track: '千本桜', artist: 'Someone', durationSec: 245 }), false)
  assert.equal(buaaaMatchesTrack(lemon, { track: 'Lemon feat. X', artist: '米津玄師', durationSec: 256 }), true)
})

// 「どちらかがもう一方を含む」では、別の曲が長さの偶然だけで通っていた
test('先頭が同じだけの別の曲名は通さない', () => {
  const hatsu = { title: '初', artist: '初星学園', lyricEndMs: 291050 }
  assert.equal(buaaaMatchesTrack(hatsu, { track: '初恋', artist: '初星学園', durationSec: 292 }), false)
  assert.equal(buaaaMatchesTrack(lemon, { track: 'Lemonade', artist: '米津玄師', durationSec: 256 }), false)
})

test('曲名がかすりもしなければ通さない', () => {
  assert.equal(buaaaMatchesTrack(lemon, { track: 'Idol', artist: '米津玄師', durationSec: 256 }), false)
  assert.equal(buaaaMatchesTrack(null, { track: 'Lemon' }), false)
  assert.equal(buaaaMatchesTrack(lemon, {}), false)
})

// ── 通信の流れ ──────────────────────────────────────────────

let calls = []
const stubFetch = (handler) => {
  calls = []
  globalThis.fetch = async (url, options) => {
    calls.push(new URL(String(url)))
    return handler(new URL(String(url)), options)
  }
}
const reply = (status, body = {}) => new Response(JSON.stringify(body), { status })
const notFound = () => reply(404, { status: 'error', message: 'Lyrics not found in local library' })

// 仮の曲は 27.6 秒で歌い終わる。後奏つきで 30 秒の曲として流す。
const want = { track: 'テスト曲', artist: 'テスト歌手', durationSec: 30, video_id: 'vid00000001' }

test('videoId で当たれば、それだけで返す(曲名では聞かない)', async () => {
  // カバー動画は歌手名が原曲と違うのが普通。id で当たったものは突き合わせない。
  stubFetch(() => reply(200, payload({ title: '原曲の名前', artist: '別の歌い手' })))
  const result = await fetchFromBuaaa(want)
  assert.ok(result?.dynamicLines?.length)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].origin + calls[0].pathname, 'https://buaaa.buachi.work/api/v2/lyrics/get')
  assert.deepEqual([...calls[0].searchParams.keys()], ['id'], 'id と曲名を混ぜると、どちらで当たったか分からなくなる')
  assert.equal(calls[0].searchParams.get('id'), 'vid00000001')
})

test('videoId が外れたら曲名で聞き、突き合わせてから使う', async () => {
  stubFetch((url) => (url.searchParams.has('id') ? notFound() : reply(200, payload())))
  const result = await fetchFromBuaaa(want)
  assert.ok(result?.dynamicLines?.length)
  assert.equal(calls.length, 2)
  const search = calls[1].searchParams
  assert.equal(search.get('title'), 'テスト曲')
  assert.equal(search.get('artist'), 'テスト歌手')
  assert.equal(search.get('duration'), '30')
  assert.equal(search.has('id'), false)
})

test('曲名検索で別の曲が返ってきたら捨てる', async () => {
  stubFetch((url) => (url.searchParams.has('id')
    ? notFound()
    : reply(200, payload({ title: 'テスト曲', artist: '別の歌手' }))))
  assert.equal(await fetchFromBuaaa(want), null)
})

test('videoId が無ければ曲名だけで聞く', async () => {
  stubFetch(() => reply(200, payload()))
  const { video_id, ...noVideo } = want
  assert.ok(await fetchFromBuaaa(noVideo))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.has('id'), false)
})

test('どちらにも無ければ null(404 では休まない)', async () => {
  stubFetch(() => notFound())
  assert.equal(await fetchFromBuaaa(want), null)
  assert.equal(calls.length, 2)
  assert.equal(isProviderResting('buaaa'), false, '「持っていない」で止まっている')
})

// 400 などは askProvider が休止に入れずに null を返す。それでも曲名では
// 聞き直さない(休止のおかげで黙って止まるわけではない)。
test('videoId の問い合わせが想定外の応答なら、曲名では聞き直さない', async () => {
  stubFetch(() => reply(400, { status: 'error' }))
  assert.equal(await fetchFromBuaaa(want), null)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.has('title'), false)
  assert.equal(isProviderResting('buaaa'), false)
})

// カバー動画の id で当たった時に曲名で引き直すと、原曲の時刻が返ってずれる
test('videoId で当たった中身が使えなくても、曲名では聞き直さない', async () => {
  for (const body of [{ status: 'success', lyrics: [] }, '<html>oops</html>']) {
    stubFetch(() => (typeof body === 'string'
      ? new Response(body, { status: 200 })
      : reply(200, body)))
    assert.equal(await fetchFromBuaaa(want), null)
    assert.equal(calls.length, 1, '曲名で引き直している')
  }
})

test('JSON でない返事でも落ちない', async () => {
  stubFetch(() => new Response('<html>oops</html>', { status: 200 }))
  assert.equal(await fetchFromBuaaa(want), null)
})

test('断られたら曲名でも聞かず、しばらく休む', async () => {
  stubFetch(() => reply(429))
  assert.equal(await fetchFromBuaaa(want), null)
  assert.equal(calls.length, 1, '断られたのに曲名で聞き直している')
  assert.equal(isProviderResting('buaaa'), true)
  assert.ok(warnings.some(w => w.includes('buaaa') && w.includes('429')))

  const before = calls.length
  assert.equal(await fetchFromBuaaa({ ...want, video_id: 'vid00000002' }), null)
  assert.equal(calls.length, before, '休止中なのに叩いている')
})
