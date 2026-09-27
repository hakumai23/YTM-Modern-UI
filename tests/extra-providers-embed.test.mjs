// 追加の歌詞サーバーの許可を、設定パネルの中で切り替える。
//
// 許可は chrome.permissions.request() でしか取れず、あれは拡張のページから
// しか呼べない。設定パネルは YouTube Music に差し込んだ content script なので、
// 許可ページ(options.html)を iframe で差し込み、その中で許可を取る。
//
// 崩れやすいのは次の3つ:
//   - web_accessible_resources に載っていないと iframe が真っ白になる
//   - 高さのやり取り(postMessage)が、差し込んだ iframe 以外からも通ってしまう
//   - 差し込めなかった時に、逃げ道(別タブで開くボタン)が出ない

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const manifest = JSON.parse(read('manifest.json'))
const lyricsUi = read('src/js/module/lyrics-ui.js')
const optionsJs = read('src/js/options.js')
const optionsHtml = read('src/options.html')
const styleCss = read('src/css/style.css')
const namespaceJs = read('src/js/module/namespace.js')

const { PROVIDER_IDS } = await import('../src/js/module/extra-providers.js')

// コメントアウトした呼び出しに正規表現が当たって素通りしないよう、行コメントを落とす
const stripLineComments = (source) => source
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n')

const between = (source, start, end) => {
  const from = source.indexOf(start)
  assert.notEqual(from, -1, `見つからない: ${start}`)
  const to = source.indexOf(end, from)
  assert.notEqual(to, -1, `見つからない: ${end}`)
  return source.slice(from, to)
}

// ── manifest ────────────────────────────────────────────────

test('許可ページを YouTube Music から iframe で読める', () => {
  const entries = manifest.web_accessible_resources.filter(entry => entry.resources.includes('src/options.html'))
  assert.equal(entries.length, 1, 'src/options.html が web_accessible_resources に無い')
  assert.deepEqual(entries[0].matches, ['https://music.youtube.com/*'])
})

// ── 差し込む側(lyrics-ui.js) ────────────────────────────────

test('設定パネルに差し込み先と逃げ道のボタンがある', () => {
  const markup = between(lyricsUi, "${t('settings_extra_providers')}</span>", '</span>\n              </div>')
  assert.match(markup, /id="extra-providers-embed"/)
  assert.match(markup, /id="extra-providers-fallback" hidden/, '逃げ道のボタンは最初は隠しておく')
  assert.match(markup, /id="extra-providers-btn"/)
  assert.match(markup, /id="extra-providers-reload" hidden/, '再読み込みの案内は最初は隠しておく')
  // 描くたびに差し込む(コメントアウトされた呼び出しは数えない)
  const render = stripLineComments(between(lyricsUi, 'function renderSettingsPanel()', '\n}\n'))
  assert.match(render, /mountExtraProvidersFrame\(\);/)
})

test('別タブのボタンは、拡張から切り離されていたら送らずに再読み込みを促す', () => {
  const handler = stripLineComments(between(lyricsUi, 'extraProvidersBtn.onclick = () => {', '};'))
  const guard = handler.indexOf('isExtensionContextAlive()')
  const send = handler.indexOf("safeRuntimeSendMessage({ type: 'OPEN_EXTRA_PROVIDERS_SETUP' })")
  assert.ok(guard !== -1 && send !== -1 && guard < send, '切り離しを確かめる前に送っている')
  assert.match(handler, /showExtraProvidersReloadNotice\(\)/)
})

test('再読み込みの案内は4言語とも持っている', () => {
  const count = (namespaceJs.match(/settings_extra_providers_reload: "/g) || []).length
  assert.equal(count, 4)
})

// 差し込み部分だけを切り出して、偽の DOM の上で動かす。
const mountSource = between(lyricsUi, 'const EXTRA_PROVIDERS_MESSAGE_TYPE', '\nfunction renderSettingsPanel()')

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'
const EXT_ORIGIN = `chrome-extension://${EXT_ID}`

const makeElement = (tag) => {
  const el = {
    tagName: tag.toUpperCase(),
    hidden: false,
    style: {},
    children: [],
    replaceChildren(...kids) { this.children = kids },
    classList: {
      removed: [],
      remove(name) { this.removed.push(name) },
    },
  }
  if (tag === 'iframe') {
    el.contentWindow = { name: 'frame-window' }
    el.clientWidth = 508
    el.blurred = 0
    el.blur = function () { this.blurred += 1 }
  }
  return el
}

const setup = ({ getURL, id = EXT_ID } = {}) => {
  const host = makeElement('div')
  const fallback = makeElement('div')
  fallback.hidden = true
  const reload = makeElement('span')
  reload.hidden = true
  const listeners = []
  const timers = []
  const settings = makeElement('div')
  const context = vm.createContext({
    URL,
    console,
    EXT: { runtime: { id, getURL: getURL || (p => `${EXT_ORIGIN}/${p}`) } },
    config: { uiLang: 'ko' },
    t: key => `[${key}]`,
    ui: { settings },
    // 閉じる処理は lyrics-ui.js の closeSettings(保存していない変更を戻す)
    closeSettings: () => settings.classList.remove('active'),
    settingsSession: { sourcesChanged: false },
    document: {
      getElementById: key => ({
        'extra-providers-embed': host,
        'extra-providers-fallback': fallback,
        'extra-providers-reload': reload,
      })[key] || null,
      createElement: makeElement,
    },
    window: {
      addEventListener: (type, fn) => listeners.push({ type, fn }),
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true },
  })
  vm.runInContext(`${mountSource}\nthis.mount = mountExtraProvidersFrame;`, context)
  const post = (data, { origin = EXT_ORIGIN, source } = {}) => {
    for (const { type, fn } of listeners) {
      if (type === 'message') fn({ origin, source: source ?? host.children[0]?.contentWindow, data })
    }
  }
  return { context, host, fallback, reload, listeners, timers, settings, post }
}

const MESSAGE_TYPE = 'ytm-immersion:extra-providers'

test('拡張の許可ページを、表示中の言語で差し込む', () => {
  const env = setup()
  env.context.mount()
  const frame = env.host.children[0]
  assert.equal(frame.tagName, 'IFRAME')
  const url = new URL(frame.src)
  // Node の URL は chrome-extension: のオリジンを 'null' にするので、組み立てて比べる
  assert.equal(`${url.protocol}//${url.host}`, EXT_ORIGIN)
  assert.equal(url.pathname, '/src/options.html')
  assert.equal(url.searchParams.get('embed'), '1')
  assert.equal(url.searchParams.get('lang'), 'ko', '保存前に切り替えた言語が中身に伝わっていない')
})

test('高さは差し込んだ iframe から、拡張のオリジンで届いたものだけ受ける', () => {
  const env = setup()
  env.context.mount()
  const frame = env.host.children[0]

  env.post({ type: MESSAGE_TYPE, kind: 'size', height: 321 }, { origin: 'https://music.youtube.com' })
  assert.equal(frame.style.height, undefined, 'ページ自身からの偽の高さを受けている')
  env.post({ type: MESSAGE_TYPE, kind: 'size', height: 321 }, { source: { name: 'other-window' } })
  assert.equal(frame.style.height, undefined, '別の窓からの高さを受けている')
  env.post({ type: 'something-else', kind: 'size', height: 321 })
  assert.equal(frame.style.height, undefined)

  env.post({ type: MESSAGE_TYPE, kind: 'size', height: 320.4 })
  assert.equal(frame.style.height, '321px')
  env.post({ type: MESSAGE_TYPE, kind: 'size', height: 99999 })
  assert.equal(frame.style.height, '2000px', '上限なしに伸ばしている')
  env.post({ type: MESSAGE_TYPE, kind: 'size', height: -5 })
  assert.equal(frame.style.height, '2000px')
})

// 横幅が決まる前に並べられた時の高さ(実測 2964px、本来は 634px)を受けて広げると、
// iframe がパネルの見えない位置まではみ出し、描画を止められて直らなくなる。
test('いまの横幅と合わない時に測った高さは受けない', () => {
  const env = setup()
  env.context.mount()
  const frame = env.host.children[0]
  env.post({ type: MESSAGE_TYPE, kind: 'size', height: 2964, width: 40 })
  assert.equal(frame.style.height, undefined, '横幅の合わない高さで広げている')
  env.post({ type: MESSAGE_TYPE, kind: 'size', height: 634, width: 508 })
  assert.equal(frame.style.height, '634px')
})

test('何も言ってこなければ、別タブで開くボタンに戻す', () => {
  const env = setup()
  env.context.mount()
  const timer = env.timers.at(-1)
  assert.ok(timer.ms >= 3000, '読み込みを待つ時間が短すぎる')
  timer.fn()
  assert.equal(env.host.hidden, true)
  assert.equal(env.fallback.hidden, false)

  // 遅れて届いたら差し込みに戻す
  env.post({ type: MESSAGE_TYPE, kind: 'ready' })
  assert.equal(env.host.hidden, false)
  assert.equal(env.fallback.hidden, true)
})

test('読み込めたと言ってきたら、待ちを取り消す', () => {
  const env = setup()
  env.context.mount()
  env.post({ type: MESSAGE_TYPE, kind: 'ready' })
  assert.equal(env.timers.at(-1).cleared, true)
  assert.equal(env.fallback.hidden, true)
})

// use_dynamic_url を付けると getURL は使い捨ての ID を返すが、読み込まれた
// ページ(=メッセージの送り主)のオリジンは本物の拡張 ID のまま。
test('送り主の確認は getURL のホストではなく拡張 ID で行う', () => {
  const env = setup({ getURL: p => `chrome-extension://0123-dynamic-guid-4567/${p}` })
  env.context.mount()
  const frame = env.host.children[0]
  env.post({ type: MESSAGE_TYPE, kind: 'size', height: 150 })
  assert.equal(frame.style.height, '150px')
  env.post({ type: MESSAGE_TYPE, kind: 'size', height: 160 }, { origin: 'chrome-extension://0123-dynamic-guid-4567' })
  assert.equal(frame.style.height, '150px')
})

// 切り離されると runtime.id が消え、getURL も sendMessage も投げる。
// 別タブで開くボタンを出しても押して何も起きないので、再読み込みを促す。
test('content script が切り離されていたら、再読み込みを促す', () => {
  const env = setup({ id: undefined, getURL: () => { throw new Error('Extension context invalidated.') } })
  env.context.mount()
  assert.equal(env.host.hidden, true)
  assert.equal(env.fallback.hidden, true, '効かないボタンを出している')
  assert.equal(env.reload.hidden, false)
  assert.equal(env.host.children.length, 0)
})

test('iframe の中で Esc を押しても設定を閉じられる', () => {
  const env = setup()
  env.context.mount()
  env.post({ type: MESSAGE_TYPE, kind: 'escape' })
  assert.deepEqual(env.settings.classList.removed, ['active'])
  // 隠れた iframe にフォーカスが残ると、YouTube Music のショートカットが効かない
  assert.equal(env.host.children[0].blurred, 1, 'フォーカスを iframe に残している')
})

// 取得元のオン・オフはその場で保存される。親の「保存」を押さずに閉じても、
// 閉じた時に今の曲を取り直せるよう、切り替えたことを覚えておく。
test('許可ページで取得元を切り替えたら、開いている設定に印を付ける', () => {
  const env = setup()
  env.context.mount()
  env.post({ type: MESSAGE_TYPE, kind: 'sources-changed' }, { source: { name: 'other' } })
  assert.equal(env.context.settingsSession.sourcesChanged, false, '差し込んだ iframe 以外からの知らせを受けた')
  env.post({ type: MESSAGE_TYPE, kind: 'sources-changed' })
  assert.equal(env.context.settingsSession.sourcesChanged, true)
  assert.deepEqual(env.settings.classList.removed, [], '切り替えただけで閉じた')
})

test('許可ページは切り替えるたびに親へ知らせる(標準・追加とも)', () => {
  assert.match(optionsJs, /const notifySourcesChanged = \(\) => postToParent\(\{ kind: 'sources-changed' \}\);/)
  assert.equal((optionsJs.match(/notifySourcesChanged\(\);/g) || []).length, 2)
})

test('描き直した iframe は直前の高さから始める(スクロールを跳ねさせない)', () => {
  const env = setup()
  env.context.mount()
  assert.equal(env.host.children[0].style.height, undefined, '最初は高さを決めつけない')
  env.post({ type: MESSAGE_TYPE, kind: 'size', height: 480 })
  env.context.mount()
  assert.equal(env.host.children[0].style.height, '480px')
})

test('描き直しても受け口は1つのまま、新しい iframe だけを相手にする', () => {
  const env = setup()
  env.context.mount()
  const oldFrame = env.host.children[0]
  env.context.mount()
  const newFrame = env.host.children[0]
  assert.notEqual(oldFrame, newFrame)
  assert.equal(env.listeners.filter(l => l.type === 'message').length, 1)
  assert.equal(env.timers[0].cleared, true, '古い待ちが残っている')

  env.post({ type: MESSAGE_TYPE, kind: 'size', height: 200 }, { source: oldFrame.contentWindow })
  assert.equal(newFrame.style.height, undefined, '古い iframe の高さを受けている')
  env.post({ type: MESSAGE_TYPE, kind: 'size', height: 200 })
  assert.equal(newFrame.style.height, '200px')
})

// ── 差し込まれる側(options.js / options.html) ─────────────────

test('高さは YouTube Music にだけ送る(宛先を * にしない)', () => {
  assert.match(optionsJs, /const EMBED_PARENT_ORIGIN = 'https:\/\/music\.youtube\.com';/)
  assert.ok(!/postMessage\([^)]*['"]\*['"]/.test(optionsJs), '宛先を限らずに送っている')
  assert.match(optionsJs, new RegExp(`const EMBED_MESSAGE_TYPE = '${MESSAGE_TYPE}';`))
  assert.match(lyricsUi, new RegExp(`const EXTRA_PROVIDERS_MESSAGE_TYPE = '${MESSAGE_TYPE}';`))
})

test('差し込む側と差し込まれる側で、URL の約束が揃っている', () => {
  const mount = stripLineComments(between(lyricsUi, 'function mountExtraProvidersFrame()', '\n}\n'))
  assert.match(mount, /url\.searchParams\.set\('embed', '1'\)/)
  assert.match(mount, /url\.searchParams\.set\('lang', /)
  const code = stripLineComments(optionsJs)
  assert.match(code, /PARAMS\.get\('embed'\) === '1'/)
  assert.match(code, /PARAMS\.get\('lang'\)/)
  // scrollHeight は iframe の表示域より小さくならず、一度広げると縮まない
  assert.ok(!/scrollHeight/.test(code))
})

// color-scheme が食い違うと、Chrome は iframe の裏に不透明な背景を敷く
// (暗いパネルの中に白い板が出る)。
test('iframe の枠と中身の配色が揃っている', () => {
  const frameRule = between(styleCss, '.ytm-extra-providers-frame {', '}')
  assert.match(frameRule, /color-scheme:\s*dark/)
  assert.match(frameRule, /background:\s*transparent/)
  const embedRule = between(optionsHtml, 'html.embed {', '}')
  assert.match(embedRule, /color-scheme:\s*dark/)
  assert.match(embedRule, /background:\s*transparent/)
})

test('逃げ道のボタンと再読み込みの案内は hidden で本当に消える', () => {
  // .setting-row.stacked .ytm-lang-group の display: flex や
  // .setting-desc の display: block が hidden 属性より強い
  const start = styleCss.indexOf('#extra-providers-fallback[hidden]')
  assert.notEqual(start, -1)
  const rule = styleCss.slice(styleCss.lastIndexOf('}', start) + 1, styleCss.indexOf('}', start))
  assert.match(rule, /#extra-providers-reload\[hidden\]/)
  assert.match(rule, /\{\s*display:\s*none;?\s*$/)
})

// options.js は読み込んだ時点で DOM と chrome を触るので、辞書だけを取り出す。
const optionsText = (() => {
  const literal = between(optionsJs, 'const TEXT = {', '\n};\n').replace('const TEXT = ', '')
  return new Function(`return (${literal}\n})`)()
})()

// 設定パネルの言語(namespace.js の LOCAL_FALLBACK_TEXTS)と同じだけ持つ
const panelLangs = [...new Set(
  [...namespaceJs.matchAll(/^\s{4}(\w{2}):\s*\{\s*$/gm)].map(m => m[1]),
)]

test('許可ページは設定パネルと同じ言語を全部持っている', () => {
  assert.ok(panelLangs.length >= 4, `パネルの言語を拾えていない: ${panelLangs}`)
  for (const lang of panelLangs) {
    assert.ok(optionsText[lang], `許可ページに ${lang} が無い`)
  }
})

test('取得元ごとの名前と説明が、どの言語にも揃っている', () => {
  for (const [lang, table] of Object.entries(optionsText)) {
    for (const key of ['title', 'lead', 'privacy', 'granted', 'denied', 'removed', 'sharedWith', 'saved']) {
      assert.ok(table[key], `${lang}.${key} が無い`)
    }
    assert.ok(table.sharedWith.includes('{name}'), `${lang}.sharedWith に {name} が無い`)
    for (const id of PROVIDER_IDS) {
      assert.ok(table.providers[id]?.name, `${lang} に ${id} の名前が無い`)
      assert.ok(table.providers[id]?.desc, `${lang} に ${id} の説明が無い`)
    }
    // 動画IDを送る相手は、送るものの説明にも名前が出ている
    for (const name of ['LiriQo', 'BuaaaBot']) {
      assert.ok(table.privacy.includes(name), `${lang}.privacy に ${name} が無い`)
    }
  }
})

test('並び順に抜けが無い(許可できない取得元を作らない)', () => {
  const order = between(optionsJs, 'const order = [', ']')
  for (const id of PROVIDER_IDS) {
    assert.ok(order.includes(`'${id}'`), `${id} が許可ページに並んでいない`)
  }
})

// ── 差し込まれる側を実際に動かす ──────────────────────────────
// options.js を偽の DOM と chrome の上で走らせ、親に送るものと
// 押した時に求める権限を確かめる(文字列の照合だけだと、送り先や
// 送る中身が変わっても気付けない)。

const { PROVIDER_ORIGINS } = await import('../src/js/module/extra-providers.js')
const LyricSources = await import('../src/js/module/lyric-sources.js')

const runOptionsPage = async ({ search = '?embed=1&lang=ko', framed = true, granted = [], innerWidth = 508, stored = {} } = {}) => {
  const posted = []
  const requested = []
  const docListeners = {}
  const byId = new Map()
  const makeNode = (tag) => {
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      listeners: {},
      hidden: false,
      checked: false,
      disabled: false,
      textContent: '',
      innerHTML: '',
      className: '',
      append(...kids) { this.children.push(...kids) },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) },
      async fire(type) { for (const fn of this.listeners[type] || []) await fn({ type }) },
    }
    return node
  }
  for (const id of [
    'title', 'lead', 'note-privacy', 'status', 'providers', 'providers-builtin',
    'group-builtin-title', 'group-builtin-note', 'group-extra-title', 'group-extra-note',
  ]) byId.set(id, makeNode('div'))
  const store = { ...stored }
  const rootClasses = new Set()
  const document = {
    title: '',
    documentElement: {
      lang: '',
      classList: { add: c => rootClasses.add(c), contains: c => rootClasses.has(c) },
      getBoundingClientRect: () => ({ height: 321.2 }),
      clientWidth: 508,
    },
    body: makeNode('body'),
    getElementById: id => byId.get(id) || null,
    createElement: makeNode,
    addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn) },
  }
  const win = { innerWidth }
  win.parent = framed ? { postMessage: (data, origin) => posted.push({ data, origin }) } : win
  const chrome = {
    runtime: { lastError: null },
    i18n: { getUILanguage: () => 'ja' },
    storage: {
      local: {
        get: (keys, cb) => cb(Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]]))),
        set: (items, cb) => { Object.assign(store, items); cb?.() },
      },
      onChanged: { addListener() {} },
    },
    permissions: {
      contains: ({ origins }, cb) => cb(origins.every(o => granted.includes(o))),
      request: ({ origins }, cb) => { requested.push(origins); cb(true) },
      remove: (_p, cb) => cb(true),
      onAdded: { addListener() {} },
      onRemoved: { addListener() {} },
    },
  }
  const code = optionsJs
    .replace(/^import \{[^}]*\} from '\.\/module\/extra-providers\.js';$/m, '')
    .replace(/^import \{[^}]*\} from '\.\/module\/lyric-sources\.js';$/m, '')
  assert.ok(!/^import /m.test(code), 'import 行を外せていない')
  // lyric-sources.js は chrome.storage を触るので、同じ偽の chrome の上で動かす
  const lyricSourcesCode = read('src/js/module/lyric-sources.js').replace(/^export /gm, '')
  vm.runInNewContext(`${lyricSourcesCode}\n${code}`, {
    PROVIDER_IDS,
    PROVIDER_ORIGINS,
    URLSearchParams,
    location: { search },
    window: win,
    document,
    chrome,
    navigator: { language: 'ja' },
    ResizeObserver: class { observe() {} },
    console,
  })
  for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve))
  const items = byId.get('providers').children
  const builtinItems = byId.get('providers-builtin').children
  const status = byId.get('status')
  return { posted, requested, rootClasses, document, docListeners, items, builtinItems, store, status }
}

test('差し込まれた時は、読み込めたことと高さを YouTube Music にだけ送る', async () => {
  const page = await runOptionsPage()
  assert.ok(page.rootClasses.has('embed'))
  assert.equal(page.document.documentElement.lang, 'ko', '親が渡した言語で出していない')
  const kinds = page.posted.map(p => p.data.kind)
  assert.ok(kinds.includes('ready'), 'ready を送っていない')
  const size = page.posted.find(p => p.data.kind === 'size')
  assert.equal(size?.data.height, 322)
  assert.equal(size?.data.width, 508, '測った時の横幅を添えていない')
  for (const { data, origin } of page.posted) {
    assert.equal(origin, 'https://music.youtube.com')
    assert.equal(data.type, MESSAGE_TYPE)
  }
})

test('差し込まれた時に Esc を押すと、親に閉じてもらう', async () => {
  const page = await runOptionsPage()
  for (const fn of page.docListeners.keydown || []) fn({ key: 'Escape' })
  assert.ok(page.posted.some(p => p.data.kind === 'escape'))
})

test('トグルを入れると、その取得元の通信先だけを求める', async () => {
  const page = await runOptionsPage()
  assert.equal(page.items.length, PROVIDER_IDS.length)
  const buaaaItem = page.items.find(li => li.children[0].children[0].dataset.provider === 'buaaa')
  const box = buaaaItem.children[0].children[0]
  box.checked = true
  await box.fire('change')
  assert.deepEqual(page.requested, [PROVIDER_ORIGINS.buaaa])
})

test('単体で開いた時は親に何も送らず、差し込み用の見た目にもしない', async () => {
  const page = await runOptionsPage({ search: '', framed: false })
  assert.equal(page.posted.length, 0)
  assert.equal(page.rootClasses.has('embed'), false)
  assert.equal(page.items.length, PROVIDER_IDS.length)
})

test('横幅がまだ無い時は高さを送らない', async () => {
  const page = await runOptionsPage({ innerWidth: 0 })
  assert.ok(page.posted.some(p => p.data.kind === 'ready'), 'ready は高さと別に送る')
  assert.equal(page.posted.some(p => p.data.kind === 'size'), false)
})

// ── 標準の取得元のオン・オフ ─────────────────────────────────

const boxOf = (li) => li.children[0].children[0]

test('標準の取得元も全部並び、どの言語にも名前と説明がある', async () => {
  const page = await runOptionsPage()
  assert.deepEqual(page.builtinItems.map(li => boxOf(li).dataset.provider), LyricSources.BUILTIN_SOURCE_IDS)
  for (const [lang, table] of Object.entries(optionsText)) {
    for (const id of LyricSources.BUILTIN_SOURCE_IDS) {
      assert.ok(table.providers[id]?.name, `${lang} に ${id} の名前が無い`)
      assert.ok(table.providers[id]?.desc, `${lang} に ${id} の説明が無い`)
    }
    for (const key of ['groupBuiltin', 'groupBuiltinNote', 'groupExtra', 'groupExtraNote', 'builtinOn', 'builtinOff', 'allOff']) {
      assert.ok(table[key], `${lang}.${key} が無い`)
    }
  }
})

test('標準の取得元は既定でオン、保存済みのオフはオフで出る', async () => {
  const page = await runOptionsPage({ stored: { [LyricSources.DISABLED_LYRIC_SOURCES_KEY]: ['lrclib'] } })
  const checked = Object.fromEntries(page.builtinItems.map(li => [boxOf(li).dataset.provider, boxOf(li).checked]))
  assert.deepEqual(checked, { ytm: true, lrchub: true, lrclib: false, simpmusic: true, lyricsplus: true })
})

test('標準の取得元を切ると storage に残り、許可は求めない', async () => {
  const page = await runOptionsPage()
  const box = boxOf(page.builtinItems.find(li => boxOf(li).dataset.provider === 'lyricsplus'))
  box.checked = false
  await box.fire('change')
  assert.deepEqual([...page.store[LyricSources.DISABLED_LYRIC_SOURCES_KEY]], ['lyricsplus'])
  assert.deepEqual(page.requested, [])
  box.checked = true
  await box.fire('change')
  assert.deepEqual([...page.store[LyricSources.DISABLED_LYRIC_SOURCES_KEY]], [])
})

test('全部オフにすると、歌詞が出なくなることを知らせる', async () => {
  const page = await runOptionsPage()
  for (const li of page.builtinItems) {
    boxOf(li).checked = false
    await boxOf(li).fire('change')
  }
  assert.ok(page.status.textContent.includes(optionsText.ko.allOff))
})
