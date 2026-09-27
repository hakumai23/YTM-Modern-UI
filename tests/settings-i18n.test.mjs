// 設定パネルの文言。
//
// タブ名(Visuals / Lyrics Source / Translation / Data & Reset)や見出し、
// 「UIサイズ (UI Size)」のような一部の項目、データのタブの説明・確認・
// 知らせが英語か日本語で固定されていて、表示言語を変えても残っていた。
// 画面に出る文言はすべて t() から引く。固定で残してよいのは、固有名詞・
// 言語ごとの自称(日本語 / English …)・単位だけ。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ui = read('src/js/module/lyrics-ui.js')
const ns = read('src/js/module/namespace.js')

const template = (() => {
  const from = ui.indexOf('  ui.settings.innerHTML = `')
  assert.notEqual(from, -1)
  return ui.slice(from, ui.indexOf('    `;', from)).replace(/\$\{[^}]*\}/g, '')
})()

const ALLOWED = new Set(['YTM Immersion', '日本語', 'English', '한국어', '中文', 'DeepL API Key', 'ms'])

test('設定パネルの本文に固定の文言が無い', () => {
  const leftovers = [...template.matchAll(/>([^<>]*)</g)]
    .map(m => m[1].trim())
    .filter(text => /[A-Za-z぀-ヿ一-鿿가-힯]/.test(text))
    .filter(text => !ALLOWED.has(text))
  assert.deepEqual(leftovers, [])
  // 属性に入る文言(閉じるボタンの名前、入力欄の見本)
  const attrs = [...template.matchAll(/(?:title|placeholder|aria-label)="([^"]+)"/g)]
    .map(m => m[1])
    .filter(text => !['Discord', 'GitHub', '0'].includes(text))
  assert.deepEqual(attrs, [])
})

test('データのタブの確認と知らせも表示言語に合わせる', () => {
  const render = ui.slice(ui.indexOf('function renderSettingsPanel() {'), ui.indexOf('\nfunction createReplayPanel()'))
  assert.doesNotMatch(render, /confirm\('[^']*[぀-ヿ]/, '確認が日本語で固定')
  assert.doesNotMatch(render, /showToast\('[^']*[぀-ヿ]/, '知らせが日本語で固定')
  for (const key of ['settings_reset_confirm', 'settings_delete_all_confirm', 'settings_delete_current_confirm', 'settings_deleted_all', 'settings_deleted_current']) {
    assert.match(render, new RegExp(`t\\('${key}'\\)`), key)
  }
})

test('設定パネルで引く文言は 4 言語ぶんある', () => {
  const render = ui.slice(ui.indexOf('function renderSettingsPanel() {'), ui.indexOf('\nfunction createReplayPanel()'))
  const keys = new Set([...render.matchAll(/t\('(settings_[a-z_]+)'\)/g)].map(m => m[1]))
  assert.ok(keys.size >= 40, `少なすぎる: ${keys.size}`)
  for (const key of keys) {
    assert.equal((ns.match(new RegExp(`\\b${key}:`, 'g')) || []).length, 4, key)
  }
})
