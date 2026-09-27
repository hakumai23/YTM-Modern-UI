// 日本語の行の折り返し位置を BudouX の文節で決める。
//
// 語区切り(Intl.Segmenter)を助詞の表で繋ぎ直す従来の方式は、語区切りが
// 細かすぎる所を追いかけきれず、「何 / 度でも」「笑って / み / せた」の
// ように語の途中に切れ目が残っていた。各まとまりは inline-block なので、
// まとまりの切れ目がそのまま行の折り返し位置になる。
//
// サンプル行は既存曲の歌詞ではなく、歌詞に出やすい言い回しを書き起こしたもの。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')
const budouxSource = read('src/js/module/budoux-ja.js')

const unitsStart = uiSource.indexOf('const isSpaceGlyph')
const unitsEnd = uiSource.indexOf('// ── 行ぜんたいの「時刻 → 進んだ px」表を作る')
const phraseStart = uiSource.indexOf('const _jaWordSegmenter')
const phraseEnd = uiSource.indexOf('function renderLyrics', phraseStart)
assert.ok(unitsStart !== -1 && unitsEnd !== -1 && phraseStart !== -1 && phraseEnd !== -1,
  '切り出しの目印が変わっていないか確認')

const load = ({ withBudoux }) => {
  const sandbox = {
    console,
    Intl,
    WORD_DEFAULT_SEC: 0.4,
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  }
  vm.createContext(sandbox)
  vm.runInContext(
    `${withBudoux ? budouxSource : ''}
     ${uiSource.slice(unitsStart, unitsEnd)}
     ${uiSource.slice(phraseStart, phraseEnd)}
     globalThis._api = { buildLyricWordUnits, groupLyricUnitsIntoPhrases, optimizeLineBreaks, budouxPhraseBoundaries }`,
    sandbox,
  )
  return sandbox._api
}

const api = load({ withBudoux: true })
const legacy = load({ withBudoux: false })

// 同期なしの行が実際に組まれるまとまり
const phrases = (text, from = api) =>
  [...from.optimizeLineBreaks(text).matchAll(/<span class="lyric-phrase">(.*?)<\/span>/g)]
    .map(m => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))

// 同期ありの行: 1文字ずつ時刻が付いたデータから語の単位を作ってまとめる
const syncedPhrases = (text) => {
  const chars = Array.from(text).map((c, i) => ({ c, t: i * 200 }))
  const units = api.buildLyricWordUnits(chars, null)
  return api.groupLyricUnitsIntoPhrases(units).map(p => p.map(u => u.text).join(''))
}

test('BudouX は同梱の JS 1本で、公式の解析と同じ切れ目を出す', () => {
  assert.match(budouxSource, /Apache License, Version 2\.0/, 'ライセンス表記が無い')
  assert.match(budouxSource, /^const BudouxJa = /m)
  // 公式 parser の既知の出力 (budoux 0.9.2 / ja)
  const { BudouxJa } = (() => {
    const s = { }
    vm.createContext(s)
    vm.runInContext(`${budouxSource}\nglobalThis.BudouxJa = BudouxJa`, s)
    return s
  })()
  const cuts = (t) => Array.from(BudouxJa.scores(t)).flatMap((v, i) => (v > 0 ? [i] : []))
  assert.deepEqual(cuts('今日は天気です。'), [3])
})

test('content script で lyrics-ui.js より先に読む', () => {
  const js = JSON.parse(read('manifest.json')).content_scripts[0].js
  const b = js.indexOf('src/js/module/budoux-ja.js')
  assert.ok(b !== -1, 'manifest に無い')
  assert.ok(b < js.indexOf('src/js/module/lyrics-ui.js'), 'lyrics-ui.js より後に読んでいる')
})

test('語の途中で切らない', () => {
  const cases = {
    '何度でも何度でも名前を呼ぶよ': ['何度でも', '何度でも'],
    'さよならの代わりに笑ってみせたんだ': ['笑ってみせたんだ'],
    '名前を呼んでほしかった': ['呼んでほしかった'],
    '振り返ってみればすべてが眩しかった': ['振り返ってみれば'],
    'がむしゃらに差し伸べた 僕の手を振り払う君': ['差し伸べた ', '振り払う君'],
    '夏祭りの帰り道で君を見失った': ['夏祭りの', '見失った'],
  }
  for (const [line, mustContain] of Object.entries(cases)) {
    const parts = phrases(line)
    assert.equal(parts.join(''), line)
    for (const chunk of mustContain) {
      assert.ok(parts.includes(chunk), `「${chunk}」が割れている: ${parts.join(' / ')}`)
    }
  }
})

test('辞書で1語の漢字・カタカナ語を BudouX が割っても、そこでは切らない', () => {
  // BudouX 単体の出力: その笑 / 顔で、唯一無 / 二じゃなくちゃ、生まれ / 変わり
  const cases = {
    'その笑顔で荒らすメディア': '笑顔',
    '唯一無二じゃなくちゃイヤイヤ': '唯一無二',
    '一番星の生まれ変わりあぁ': '生まれ変わり',
  }
  for (const [line, word] of Object.entries(cases)) {
    const parts = phrases(line)
    assert.ok(parts.some(p => p.includes(word)), `「${word}」が割れている: ${parts.join(' / ')}`)
  }
})

test('同じ語の繰り返しは割らない', () => {
  // BudouX 単体の出力: はいは / いあの
  const parts = phrases('はいはいあの子は特別です')
  assert.ok(parts[0].startsWith('はいはい'), parts.join(' / '))
})

test('仮名が続く所は語区切りの変な塊に引きずられない', () => {
  // 語区切りは「伝え|ら|れ|な|いままで|いる」と切る
  assert.ok(phrases('どうしても伝えられないままでいる').includes('伝えられないままで'))
  // 「もう一度」は語区切りでは1語だが、長い塊を割るなら「もう」の後がよい
  assert.deepEqual(phrases('もう一度だけやり直せたら'), ['もう', '一度だけやり直せたら'])
})

test('「〜て」の後の補助動詞を切り離さない', () => {
  const cases = {
    '沈むように溶けてゆくように': '溶けてゆくように',
    '君を待っていたんだ': '待っていたんだ',
    '手を取っていこう': '取っていこう',
  }
  for (const [line, chunk] of Object.entries(cases)) {
    const parts = phrases(line)
    assert.ok(parts.includes(chunk), `「${chunk}」が割れている: ${parts.join(' / ')}`)
  }
})

test('1字だけのまとまりを作らない', () => {
  for (const line of [
    '片思いのままで終わらせたくない',
    'walking home 一人きりの帰り道',
    'ありふれた日々こそ宝物だって気づいた',
    'きらめく街の灯りに溶けてしまいそう',
    '日が沈み出した空と君の姿',
    '釣られて言葉にした時',
  ]) {
    const parts = phrases(line)
    assert.ok(!parts.some(p => p.trim().length === 1), parts.join(' / '))
  }
})

test('行頭に来てはいけない字で始まるまとまりを作らない', () => {
  for (const line of [
    'あの日の約束、覚えてる?',
    'ねぇ、もう一回だけ…',
    '「さよなら」なんて言わないで',
    'ちょっとだけ待ってよ!',
  ]) {
    const parts = phrases(line)
    assert.ok(!parts.slice(1).some(p => /^[、。!?！？…」』)）ーっゃゅょぁぃぅぇぉ]/.test(p)),
      parts.join(' / '))
  }
})

test('開き括弧は次の語に付き、行末に残らない', () => {
  for (const line of ['君を知りたい(君を知りたい)', '夢で見ていた「またね」']) {
    const parts = phrases(line)
    assert.ok(!parts.some(p => /[(（「『]$/.test(p)), parts.join(' / '))
    assert.ok(parts.some(p => /^[(「]/.test(p)), `括弧の前で切れていない: ${parts.join(' / ')}`)
  }
})

test('英語の塊は割らず、英語のすぐ後の助詞は前に付ける', () => {
  assert.deepEqual(phrases('Baby 今夜だけは離さないで')[0], 'Baby ')
  assert.ok(phrases('I don\'t wanna say goodbye 君に').includes('I don\'t wanna say goodbye '))
  assert.equal(phrases('face to face でいたかった')[0], 'face to face で')
  assert.equal(phrases('answer はいつも風の中')[0], 'answer は')
})

test('長すぎるまとまりは割る', () => {
  const parts = phrases('何度も繰り返し確かめていたのに')
  assert.ok(parts.every(p => p.length <= 10), parts.join(' / '))
})

test('仮名の無い行(英語・中国語・韓国語)は従来どおり', () => {
  for (const line of ['Hello (world) again', '我爱你，永远在一起', '사랑해 너를 정말로', 'I <3 you']) {
    assert.equal(api.budouxPhraseBoundaries(line), null)
    assert.deepEqual(phrases(line), phrases(line, legacy))
  }
})

test('BudouX が読めなくても歌詞は出る(従来の規則に戻る)', () => {
  assert.equal(legacy.budouxPhraseBoundaries('君を探していた'), null)
  assert.equal(phrases('君を探していた', legacy).join(''), '君を探していた')
})

test('HTML はエスケープしてから組む', () => {
  assert.ok(!api.optimizeLineBreaks('<b>君</b>を探していた').includes('<b>'))
})

test('同期ありの行も同期なしの行と同じ位置で折り返す', () => {
  for (const line of [
    '忘れかけていた約束をもう一度思い出す',
    'さよならの代わりに笑ってみせたんだ',
    '何度でも何度でも名前を呼ぶよ',
    'シャッター音だけが夏を閉じ込めた',
    'oh baby もう戻れないと知っていた',
  ]) {
    const synced = syncedPhrases(line)
    assert.equal(synced.join(''), line)
    // 語の単位より細かくは割れないので、同期ありの切れ目は同期なしの切れ目の一部
    const plainCuts = new Set()
    let offset = 0
    for (const p of phrases(line)) { offset += p.length; plainCuts.add(offset) }
    offset = 0
    for (const p of synced) {
      offset += p.length
      assert.ok(plainCuts.has(offset), `同期ありだけの切れ目: ${synced.join(' / ')} / ${phrases(line).join(' / ')}`)
    }
  }
})

// ── 曲名 ────────────────────────────────────────────────
// 曲名は inline-block の塊にせず <wbr> を置く。狭い画面では1行表示で
// 省略記号(…)を出していて、inline-block の塊だと省略が効かなくなるため。

const titleStart = uiSource.indexOf('function setTitleText')
const titleEnd = uiSource.indexOf('function updateMetaUI', titleStart)
assert.ok(titleStart !== -1 && titleEnd !== -1, '曲名の組み立ての目印が変わっていないか確認')

const renderTitle = (title) => {
  const nodes = []
  const classes = new Set()
  const el = {
    set textContent(v) { nodes.length = 0; if (v) nodes.push(v) },
    appendChild(n) { nodes.push(n) },
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
  }
  const sandbox = {
    console,
    Intl,
    document: { createElement: (tag) => `<${tag}>`, createTextNode: (t) => t },
  }
  vm.createContext(sandbox)
  vm.runInContext(
    `${budouxSource}
     ${uiSource.slice(phraseStart, phraseEnd)}
     ${uiSource.slice(titleStart, titleEnd)}
     globalThis._setTitleText = setTitleText`,
    sandbox,
  )
  sandbox._setTitleText(el, title)
  return { html: nodes.join(''), phrased: classes.has('ytm-title-phrased') }
}

test('日本語の曲名は文節の切れ目にだけ <wbr> を置く', () => {
  const { html, phrased } = renderTitle('最後に階段を駆け上がったのはいつだ？')
  assert.equal(phrased, true)
  assert.equal(html.replace(/<wbr>/g, ''), '最後に階段を駆け上がったのはいつだ？')
  assert.ok(html.includes('駆け上がったのは'), `語の途中に切れ目がある: ${html}`)
  assert.ok(html.includes('<wbr>いつだ？'), html)
})

test('仮名の無い曲名は今までどおり素の文字列', () => {
  for (const title of ['Lemon', '我爱你', '<b>x</b>']) {
    const { html, phrased } = renderTitle(title)
    assert.equal(phrased, false)
    assert.equal(html, title)
  }
})

test('曲名は文字列として入れる(innerHTML を使わない)', () => {
  const fn = uiSource.slice(titleStart, titleEnd)
  assert.ok(!/innerHTML/.test(fn))
  assert.match(uiSource, /function updateMetaUI\(meta\) \{\n  setTitleText\(ui\.title, meta\.title\);/)
})

test('keep-all は <wbr> を置いた曲名にだけ掛ける', () => {
  const css = read('src/css/style.css')
  const rule = css.slice(css.indexOf('#ytm-custom-title.ytm-title-phrased {'))
  assert.match(rule.slice(0, rule.indexOf('}')), /word-break: keep-all;/)
})

test('狭い画面の1行表示では <wbr> を消す(Chrome は nowrap でも <wbr> で折り返す)', () => {
  const css = read('src/css/style.css')
  const at = css.indexOf('body.ytm-custom-layout #ytm-custom-title wbr {')
  assert.ok(at !== -1, '1行表示の曲名で <wbr> を消していない')
  assert.match(css.slice(at, css.indexOf('}', at)), /display: none;/)
})
