// Immersion の外(プレイヤーを畳んだ・Immersion を切った)でも曲を追う。
//
// 実機(music.youtube.com、ミニプレイヤーでホームを表示)で確かめたこと:
//   - URL は "/" になり v= が消える
//   - プレイヤーバーに watch へのリンクが無い
//   - 埋め込みプレイヤーの a.ytp-title-link は再生中の曲を指し、
//     曲送りから 250ms 以内に書き換わる
// videoId が取れないと Daily Replay がブラウズ中の再生を一切数えず
// (再生秒数が 77 秒のまま止まった)、PiP も曲の切り替わりを追えない。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

const sliceBetween = (from, to) => {
  const start = uiSource.indexOf(from)
  const end = uiSource.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return uiSource.slice(start, end)
}

const loadVideoIdHelpers = ({ href, links = {} }) => {
  const context = vm.createContext({
    URL,
    location: { href, origin: 'https://music.youtube.com' },
    document: {
      querySelector: (selector) => {
        for (const [key, value] of Object.entries(links)) {
          if (selector.includes(key)) return { getAttribute: () => value, href: value }
        }
        return null
      },
    },
    console,
  })
  vm.runInContext(
    `${sliceBetween('const extractVideoIdFromHref = (href) => {', '// === BG からの後追いメタ更新')}
    this.getCurrentVideoId = getCurrentVideoId; this.getCurrentVideoUrl = getCurrentVideoUrl;`,
    context,
  )
  return context
}

test('ミニプレイヤーでブラウズ中は、埋め込みプレイヤーから videoId を読む', () => {
  const h = loadVideoIdHelpers({
    href: 'https://music.youtube.com/',
    links: { 'ytp-title-link': 'https://music.youtube.com/watch?list=RDAMVM1&v=mJ1N7-HyH1A' },
  })
  assert.equal(h.getCurrentVideoId(), 'mJ1N7-HyH1A')
  assert.equal(h.getCurrentVideoUrl(), 'https://youtu.be/mJ1N7-HyH1A')
})

test('プレイヤーページを開いている時は、これまでどおり URL を優先する', () => {
  const h = loadVideoIdHelpers({
    href: 'https://music.youtube.com/watch?v=NEWSONG0001',
    links: { 'ytp-title-link': 'https://music.youtube.com/watch?v=OLDSONG0001' },
  })
  assert.equal(h.getCurrentVideoId(), 'NEWSONG0001')
})

test('どこにも手がかりが無ければ null', () => {
  const h = loadVideoIdHelpers({ href: 'https://music.youtube.com/library' })
  assert.equal(h.getCurrentVideoId(), null)
})

const tickSource = sliceBetween('const tick = async () => {', '// 背景に使う画像の読み込み世代。')

test('PiP が開いていれば、Immersion の外でも曲の切り替わりまで進む', () => {
  const gate = tickSource.slice(tickSource.indexOf('const immersionShown'), tickSource.indexOf('const meta = getMetadata();'))
  assert.match(gate, /const followForPip = !immersionShown && !!\(PipManager && PipManager\.pipWindow\) && !!ui\.lyrics;/)
  // 戻るのは PiP を追わない時だけ
  assert.match(gate, /if \(!followForPip\) \{[^}]*_wasTrackingPlayback = false;\s*return;\s*\}/)
  // Immersion の器を組むのは、Immersion が見えている時だけ
  const layoutCall = gate.indexOf('initLayout();')
  assert.ok(layoutCall > gate.indexOf('} else {'), 'Immersion の外で器を組み直している')
  // 曲の切り替わりで PiP を更新している
  assert.match(tickSource, /PipManager\.updateMeta\(meta\.title, meta\.artist\);/)
})

test('IMMERSION ボタンで開いた時に、今の曲へ合わせ直す', () => {
  const onclick = uiSource.slice(uiSource.indexOf('const toggleImmersionMode = () => {'), uiSource.indexOf('const ensureModeToggle ='))
  assert.match(uiSource, /btn\.onclick = toggleImmersionMode;/)
  assert.match(onclick, /requestImmersionTick\(\);/)
  assert.match(uiSource, /requestImmersionTick = scheduleTick;/)
})
