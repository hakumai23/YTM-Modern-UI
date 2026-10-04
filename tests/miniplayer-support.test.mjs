// 作り直された新しいプレイヤーバー(ytmusic-miniplayer)への対応。
//
// 2026-09 から一部の人に、ytmusic-player-bar の代わりに ytmusic-miniplayer
// (試験スイッチ music_web_enable_wiz_miniplayer)が出ている。旧バー決め打ちの
// ままだと、IMMERSION ボタンが出ず、Immersion 中は操作バーが画面の下に潜って
// 再生も曲送りもできず、曲の切り替わりの監視も組めなかった(実機で確認)。
// どちらのバーでも動くよう、探す所に新しいバーを並べる。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ui = read('src/js/module/lyrics-ui.js')
const pip = read('src/js/module/pip-manager.js')
const css = read('src/css/style.css')

test('バーを探す所は新旧どちらも見る', () => {
  // 探すのは PlayerBar(player-bar.js)。知っている作りは新旧の両方
  const bar = read('src/js/module/player-bar.js')
  assert.match(bar, /\['ytmusic-player-bar', 'classic'\],\s*\['ytmusic-miniplayer', 'wiz'\],/)
  // 監視・余白クリック・動画モードの印・ボタンの置き場所の判断
  assert.match(ui, /const targetNode = PlayerBar\.get\(\);/)
  assert.match(ui, /function setupPlayerBarBlankClickGuard\(\) \{\s*const bar = PlayerBar\.get\(\);/)
  // 旧バー決め打ちで残るのは、旧バーのシークバーのホバー時刻だけ
  // (新しいバーは YTM 自身がホバー時刻を出す。見つからなければ 60 秒で探すのをやめる)
  const hover = ui.slice(ui.indexOf('const adjustHoverTimeInfoPosition'), ui.indexOf('const parseLRCNoFlag'))
  const rest = ui.replace(hover, '')
  assert.doesNotMatch(rest, /document\.querySelector\(['"]ytmusic-player-bar['"]\)/)
})

test('曲名とアーティストは新しいバーからも読む', () => {
  assert.match(ui, /PLAYER_BAR_TITLE_SELECTOR = '[^']*ytmusic-player-bar, ytmusic-miniplayer \.ytmusicTrackInfoTitle'/)
  assert.match(ui, /PLAYER_BAR_BYLINE_SELECTOR = '[^']*ytmusic-player-bar, ytmusic-miniplayer \.ytmusicTrackInfoByline'/)
  assert.match(ui, /a\.yt-simple-endpoint, a\.ytAttributedStringLink/)
  assert.match(read('src/js/module/replay-manager.js'), /ytmusic-miniplayer \.ytmusicTrackInfoByline/)
})

test('再生中ずっと動く所では tick を起こさない(新しいバーの時刻・シークバーも)', () => {
  const noise = ui.slice(ui.indexOf('const PLAYER_BAR_NOISE_SELECTOR'), ui.indexOf(';', ui.indexOf('const PLAYER_BAR_NOISE_SELECTOR')))
  for (const s of ['.ytMusicMiniPlayerProgressBarWrapper', '.ytMusicMiniPlayerTimeInfo', '#right-controls', '.time-info']) {
    assert.ok(noise.includes(s), s)
  }
})

test('PiP の前へ・再生・次へは新しいバーのボタンも押せる', () => {
  for (const cls of ['PreviousButton', 'PlayPauseButton', 'NextButton']) {
    assert.match(pip, new RegExp(`ytmusic-miniplayer \\.ytmusicPlayerControls${cls}`), cls)
  }
})

test('Immersion 中は新しいバーも浮いた角丸のバーにし、Immersion の上に出す', () => {
  const rule = css.slice(css.indexOf('body.ytm-custom-layout ytmusic-miniplayer {'))
  const body = rule.slice(0, rule.indexOf('}'))
  assert.match(body, /position: fixed !important;/)
  assert.match(body, /z-index: 2000 !important;/)
  // 音量の縦スライダー・シークバーのつまみ・ホバーの時刻はバーの外へはみ出す。切り取ると使えない
  assert.match(body, /overflow: visible !important;/)
  assert.doesNotMatch(body, /overflow: hidden/)
  // 曲の情報は Immersion 側に出ているので隠し、YTM が狭い幅で隠す時刻は出す
  assert.match(css, /body\.ytm-custom-layout ytmusic-miniplayer \.ytMusicMiniPlayerTrackInfo \{\s*display: none !important;/)
  assert.match(css, /body\.ytm-custom-layout ytmusic-miniplayer \.ytMusicMiniPlayerTimeInfo \{\s*display: block !important;/)
})

test('新UIでも Immersion のナビバー(検索欄)は画面の内側に収める', () => {
  // 新UIの YTM は ytmusic-app-layout[is-wiz-miniplayer-enabled] > [slot="nav-bar"] で
  // width: 100% を指定し、こちらより強い。左だけ 10% ずれて右端が切れていた
  const rule = css.slice(css.indexOf('body.ytm-custom-layout ytmusic-nav-bar {'))
  const body = rule.slice(0, rule.indexOf('}'))
  assert.match(body, /--ytmi-nav-width: min\(max\(80%, 860px\), calc\(100% - 24px\)\);/)
  assert.match(body, /left: calc\(\(100% - var\(--ytmi-nav-width\)\) \/ 2\) !important;/)
  assert.match(body, /width: var\(--ytmi-nav-width\) !important;/)
  // 動画モードは 60%。窓が狭くても中身が収まる幅より狭くしない
  assert.match(css, /body\.ytm-custom-layout ytmusic-nav-bar\.moviemode \{\s*--ytmi-nav-width: min\(max\(60%, 860px\), calc\(100% - 24px\)\);/)
})

test('隠れているナビバーは押下を下へ通し、ナビバーの高さに乗せたら出す(押せるものの上では出さない)', () => {
  const rule = css.slice(css.indexOf('body.ytm-custom-layout ytmusic-nav-bar {'))
  assert.match(rule.slice(0, rule.indexOf('}')), /pointer-events: none !important;/)
  const shown = css.slice(css.indexOf('body.ytm-custom-layout.ytmi-nav-peek ytmusic-nav-bar,'))
  assert.match(shown.slice(0, shown.indexOf('}')), /ytmusic-nav-bar:hover,[\s\S]*opacity: 1 !important;\s*pointer-events: auto !important;/)
  assert.doesNotMatch(css, /ytmusic-nav-bar::before/)
  // カーソルの位置で出す。押せるものの上では出さない
  const src = ui.slice(ui.indexOf('const NAV_PEEK_CLASS'), ui.indexOf("document.addEventListener('mousemove', onNavPeekMove"))
  const run = (y, target, shownLayout = true) => {
    const body = { classList: { set: new Set(shownLayout ? ['ytm-custom-layout'] : []), contains(c) { return this.set.has(c) }, toggle(c, on) { on ? this.set.add(c) : this.set.delete(c) } } }
    class Element { constructor(sel) { this.sel = sel } closest(s) { return this.sel && s.split(', ').includes(this.sel) ? this : null } }
    const move = new Function('document', 'Element', `${src}\nreturn onNavPeekMove;`)({ body }, Element)
    move({ clientY: y, target: new Element(target) })
    return body.classList.set.has('ytmi-nav-peek')
  }
  assert.equal(run(40, null), true)
  assert.equal(run(70, null), true)
  assert.equal(run(80, null), false)
  assert.equal(run(40, 'button'), false)
  assert.equal(run(40, '.lyric-line'), false)
  assert.equal(run(40, 'ytmusic-av-toggle'), false)
  assert.equal(run(40, null, false), false)
})

test('新バーの右の列は、シークバーに被さった所の押下を下へ通す(Immersion の外でも)', () => {
  // YTM は音量の縦スライダーのために右の列を z-index: 2 で重ねていて、
  // 列の箱がシークバーの下半分(右 3 分の 1 では線も)を覆っていた
  assert.match(css, /\nytmusic-miniplayer \.ytMusicMiniPlayerRightSection \{\s*pointer-events: none !important;/)
  assert.match(css, /\nytmusic-miniplayer \.ytMusicMiniPlayerRightSection > \* \{\s*pointer-events: auto;/)
})

test('窓が狭い旧バー(Immersion の外・畳んだ状態)は、再生・次へと IMMERSION・▲ を重ねずに並べる', () => {
  const at = css.indexOf('@media (max-width: 615px) {')
  const block = css.slice(at, css.indexOf('\n}\n', at))
  const scope = 'body:not\\(\\.ytm-custom-layout\\) ytmusic-app-layout:not\\(\\[player-page-open\\]\\) ytmusic-player-bar:not\\(\\.top-player-bar\\)'
  // 小さな作り用の右側(再生・次へ)と普段の右側が同じ区画に入って重なっていた。区画を足す
  assert.match(block, new RegExp(scope + ' \\{\\s*grid-template-columns: auto minmax\\(0, 1fr\\) auto auto !important;\\s*grid-template-areas: "start middle mweb end" !important;'))
  assert.match(block, new RegExp(scope + ' #right-controls-mweb \\{\\s*grid-area: mweb !important;'))
  // 普段の右側は IMMERSION と ▲ だけ
  assert.match(block, new RegExp(scope + ' \\.right-controls-buttons > :not\\(#my-mode-toggle\\) \\{\\s*display: none !important;'))
  // IMMERSION が入でも再生・次へを隠さない(以前は隠していた)
  assert.doesNotMatch(block, /:has\(#my-mode-toggle\.active\) #right-controls-mweb/)
})

// 新バーのアーティスト名は href を持たない <a role="button">(押すと YTM が中で移動する)。
// href(channel/…)で拾っていたので、Immersion のアーティスト名が押せない文字になっていた
test('新バーのアーティスト名: 最初の「•」より前のリンクだけを取り、押したら YTM のリンクを押す', () => {
  const src = ui.slice(ui.indexOf('const ARTIST_BYLINE_SELECTOR'), ui.indexOf('function updateMetaUI('))
  const text = (t) => ({ nodeType: 3, textContent: t })
  const link = (t) => ({ nodeType: 1, textContent: t, clicked: 0, matches: (s) => s === 'a.ytAttributedStringLink', click() { this.clicked++ } })
  const links = [link('Daft Punk'), link('Pharrell Williams'), link('Nile Rodgers'), link('Random Access Memories')]
  const host = { childNodes: [links[0], text('、'), links[1], text('、'), links[2], text(' • '), links[3], text(' • 2013年')] }
  const byline = { classList: { contains: (c) => c === 'ytmusicTrackInfoByline' }, querySelector: () => host }
  const { readWizArtistLinks, openWizArtist } = new Function('PlayerBar', 'Node',
    `${src}\nreturn { readWizArtistLinks, openWizArtist };`)({ query: () => byline }, { ELEMENT_NODE: 1 })
  assert.deepEqual(readWizArtistLinks(byline).map(a => a.textContent), ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'])
  openWizArtist('Pharrell Williams', 1)
  assert.equal(links[1].clicked, 1)
  // 旧バー(href を持つ)は今までどおり
  assert.equal(readWizArtistLinks({ classList: { contains: () => false } }).length, 0)
  assert.match(ui, /const wizLinks = readWizArtistLinks\(bylineWrapper\);/)
})

// 右の列(時刻・字幕・音量・⋮・IMMERSION・▼)が 1 列分に収まらず、その分だけ
// 再生ボタンが左へずれていた(1440px 幅で 14px、900px 幅で 86px)
test('新バーの再生ボタンを真ん中に保つ: 要る分だけバーを広げ、足りなければ時刻を隠し、余白を詰める', () => {
  assert.match(css, /body\.ytm-custom-layout ytmusic-miniplayer\[style\*="--ytmi-bar-need"\] \{\s*max-width: min\(max\(calc\(1000px \* var\(--ytm-ui-scale\)\), var\(--ytmi-bar-need\)\), 95vw\) !important;/)
  assert.match(css, /body\.ytm-custom-layout ytmusic-miniplayer\[data-ytmi-hide-time\] \.ytMusicMiniPlayerTimeInfo \{\s*display: none !important;/)
  assert.match(css, /body\.ytm-custom-layout ytmusic-miniplayer\[data-ytmi-bar-tight\] \{\s*column-gap: 8px !important;\s*padding: 0 16px !important;/)
  assert.match(ui, /const WIZ_TIGHT_GAP = 8;\nconst WIZ_TIGHT_PADDING = 16;/)
  // 開いた時・見張り・窓の大きさ・▼ の出し入れで測り直す
  assert.match(ui, /if \(PlayerBar\.isFallbackOn\(\)\) PlayerBar\.syncMinimize\(\);\s*balanceWizBar\(\);/)
  assert.match(ui, /PlayerBar\.rememberDisplay\(PlayerBar\.current\(\), true\);\s*balanceWizBar\(\);/)
})
