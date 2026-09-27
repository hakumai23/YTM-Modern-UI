// 取得元どうしの歌詞を突き合わせて、間違った歌詞を見分ける。
//
// どの取得元も、登録されている中身そのものが違うことがある(実測 23 曲 × 8 取得元):
//   別の曲(夜に駆ける TFT の SimpMusic が「群青」)、ローマ字(怪獣の花唄 の LrcLib)、
//   切れ端(Blinding Lights の LRC Hub がクレジット1行)、訳が混ざる(Lemon の LrcLib)。
// 曲名・アーティスト名・長さは正しいので、メタデータでは気づけない。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const Agreement = await import('../src/js/module/lyrics-agreement.js')
const lyricsUi = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')

const lrc = (lines) => lines.map((line, i) => `[00:${String(10 + i * 3).padStart(2, '0')}.00] ${line}`).join('\n')

// 同じ曲の2通りの書き起こし(記号・空白・クレジットの有無が違う)
const SONG_A = lrc(['君の名前を呼んでいた', '夜が明けるまでずっと', '忘れられない約束を', '胸の奥にしまったまま', '風が吹いて花が散る', '二人で見た景色の中'])
const SONG_A2 = `[00:00.00] 作詞：誰か\n${lrc(['君の名前を 呼んでいた', '夜が明けるまで ずっと', '忘れられない約束を…', '胸の奥に しまったまま', '風が吹いて 花が散る', '二人で見た景色の中'])}`
const SONG_B = lrc(['雨の降る街を歩いて', '傘もささずに笑ってた', '知らない誰かの声がした', '遠くで鐘が鳴っている', '僕らはまだ子供のままで', '明日のことは分からない'])
const ROMAJI_A = lrc(['kimi no namae wo yonde ita', 'yoru ga akeru made zutto', 'wasurerarenai yakusoku wo', 'mune no oku ni shimatta mama', 'kaze ga fuite hana ga chiru', 'futari de mita keshiki no naka'])
const FRAGMENT_A = lrc(['君の名前を呼んでいた'])

test('同じ歌詞の書き起こし違いは合う、別の曲・ローマ字は合わない', () => {
  assert.ok(Agreement.lyricsAgreement(SONG_A, SONG_A2) >= Agreement.LYRICS_AGREE_MIN)
  assert.ok(Agreement.lyricsAgreement(SONG_A, SONG_B) < 0.3)
  assert.ok(Agreement.lyricsAgreement(SONG_A, ROMAJI_A) < 0.1)
  // 切れ端は全部が相手に含まれるが、両方向で見るので合わない
  assert.ok(Agreement.lyricsAgreement(SONG_A, FRAGMENT_A) < Agreement.LYRICS_AGREE_MIN)
})

test('突き合わせは歌い手の印(v1:)とクレジット行を見ない', () => {
  const tagged = SONG_A.replace(/\] /g, '] v1:')
  assert.ok(Agreement.lyricsAgreement(SONG_A, tagged) > 0.95)
  // 「ラベル:値」でも知らない語なら歌詞として残す
  assert.equal(Agreement.lyricTextForCompare('[00:01.00] Baby: come back'), 'babycomeback')
  assert.equal(Agreement.lyricTextForCompare('[00:01.00] Lyrics by：Someone'), '')
})

test('他の取得元どうしが合っていれば、合わないものが外れ', () => {
  const v = Agreement.judgeLyrics([
    { providerId: 'lrchub', lyrics: SONG_B },
    { providerId: 'lrclib', lyrics: SONG_A },
    { providerId: 'simpmusic', lyrics: SONG_A2 },
  ])
  assert.equal(v.get('lrchub'), 'contradicted')
  assert.equal(v.get('lrclib'), 'confirmed')
  assert.equal(v.get('simpmusic'), 'confirmed')
})

test('2つが食い違う時は、切れ端・曲名と文字の種類が違う方を外れとみなす', () => {
  const fragment = Agreement.judgeLyrics([
    { providerId: 'lrchub', lyrics: FRAGMENT_A },
    { providerId: 'lrclib', lyrics: SONG_A },
  ])
  assert.equal(fragment.get('lrchub'), 'contradicted')
  assert.equal(fragment.get('lrclib'), 'unknown')

  const romaji = Agreement.judgeLyrics([
    { providerId: 'lrchub', lyrics: SONG_A },
    { providerId: 'lrclib', lyrics: ROMAJI_A },
  ], { track: '君の名前' })
  assert.equal(romaji.get('lrclib'), 'contradicted')
  assert.equal(romaji.get('lrchub'), 'unknown')

  // 曲名がローマ字だけなら文字の種類では決めない(Lemon のような日本語の曲がある)
  const latinTitle = Agreement.judgeLyrics([
    { providerId: 'lrchub', lyrics: SONG_A },
    { providerId: 'lrclib', lyrics: ROMAJI_A },
  ], { track: 'Lemon' })
  assert.equal(latinTitle.get('lrclib'), 'unknown')

  // 決め手が無ければどちらも外れにしない
  const tie = Agreement.judgeLyrics([
    { providerId: 'lrchub', lyrics: SONG_A },
    { providerId: 'simpmusic', lyrics: SONG_B },
  ])
  assert.deepEqual([...tie.values()], ['unknown', 'unknown'])
})

test('クレジット行しか無い歌詞は、本文のある候補があれば外れ', () => {
  const v = Agreement.judgeLyrics([
    { providerId: 'lrchub', lyrics: '[00:13.41] Lyrics by：Max Martin/Abel' },
    { providerId: 'simpmusic', lyrics: SONG_A },
  ])
  assert.equal(v.get('lrchub'), 'contradicted')
})

test('選ぶ時は外れを除き、合っているもの・品質・信頼の順', () => {
  const pick = Agreement.pickAgreedLyrics([
    { providerId: 'kugou', lyrics: SONG_B, quality: 4 },
    { providerId: 'buaaa', lyrics: SONG_A2, quality: 4 },
    { providerId: 'amll', lyrics: SONG_A, quality: 4 },
  ])
  assert.equal(pick.providerId, 'amll')
  // YouTube Music の歌詞は票として効く
  const byVote = Agreement.pickAgreedLyrics([
    { providerId: 'lrchub', lyrics: SONG_B, quality: 2 },
    { providerId: 'simpmusic', lyrics: SONG_A, quality: 2 },
  ], [{ providerId: 'ytm', lyrics: SONG_A2 }])
  assert.equal(byVote.providerId, 'simpmusic')
})

test('lyrics-ui.js の写しは本体と同じ結果を返す', () => {
  const from = lyricsUi.indexOf('const LYRICS_AGREE_MIN = ')
  const to = lyricsUi.indexOf('// 表示中の歌詞が、届いた歌詞と中身が違うか', from)
  assert.ok(from > 0 && to > from)
  const context = vm.createContext({})
  vm.runInContext(`${lyricsUi.slice(from, to)}\nthis.agree = lyricsAgreement; this.text = lyricTextForCompare; this.min = LYRICS_AGREE_MIN;`, context)
  assert.equal(context.min, Agreement.LYRICS_AGREE_MIN)
  for (const [a, b] of [[SONG_A, SONG_A2], [SONG_A, SONG_B], [SONG_A, ROMAJI_A], [SONG_A, FRAGMENT_A], [SONG_A2, SONG_A2.replace(/\] /g, '] v2:')]]) {
    assert.equal(context.agree(a, b), Agreement.lyricsAgreement(a, b))
    assert.equal(context.text(a), Agreement.lyricTextForCompare(a))
  }
})

test('候補が1つだけなら外れにしない(クレジットだけでも)', () => {
  for (const lyrics of [SONG_A, FRAGMENT_A, ROMAJI_A, '[00:01.00] Lyrics by：Someone']) {
    const v = Agreement.judgeLyrics([{ providerId: 'lrchub', lyrics }], { track: '君の名前' })
    assert.equal(v.get('lrchub'), 'unknown', lyrics.slice(0, 20))
    assert.equal(Agreement.pickAgreedLyrics([{ providerId: 'lrchub', lyrics }], [], { track: '君の名前' })?.providerId, 'lrchub')
  }
  assert.equal(Agreement.judgeLyrics([]).size, 0)
  assert.equal(Agreement.pickAgreedLyrics([]), null)
})

test('桁違いに大きい歌詞が混ざっても、比べる手間は膨らまない', () => {
  const huge = SONG_A.repeat(5000)   // 約 50 万字
  const entries = [
    { providerId: 'lrchub', lyrics: SONG_A },
    { providerId: 'lrclib', lyrics: SONG_A2 },
    { providerId: 'liriqo', lyrics: huge },
  ]
  Agreement.judgeLyrics(entries)   // 1回目は下ごしらえ込み
  const started = performance.now()
  for (let i = 0; i < 50; i++) Agreement.judgeLyrics(entries)
  assert.ok((performance.now() - started) / 50 < 5, '1回 5ms を超えた')
})
