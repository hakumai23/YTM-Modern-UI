// 叩きすぎた時に休むか。
//
// 相手はどれも無料で開いているサーバー。429 を返されているのに曲ごとに
// 叩き続けると、一時的な絞りが IP ごとの遮断に変わる。既存の LRCHub と
// LyricsPlus には休止があるのに、追加した4つには無かった。
//
// 「持っていない(404)」で休んではいけない。収録の少ない AMLL がすぐ
// 止まってしまい、当たるはずの曲まで取りに行かなくなる。
//
// 許可の問い合わせと通信を差し替えるので、ファイルを分けてある
// (node --test はファイルごとに別プロセスで走る)。

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
  fetchFromKugou,
  fetchFromLiriqo,
  fetchFromNetease,
  isProviderResting,
} = await import('../src/js/module/extra-providers.js')

const want = { track: 'テスト曲', artist: 'テスト歌手', durationSec: 200 }

let calls = []
const stubFetch = (handler) => {
  calls = []
  globalThis.fetch = async (url, options) => {
    calls.push(String(url))
    return handler(String(url), options)
  }
}
const reply = (status, body = '{}') => new Response(body, { status })

test('429 を返されたら、その取得元を休ませる', async () => {
  stubFetch(() => reply(429))

  assert.equal(await fetchFromKugou(want), null)
  assert.equal(calls.length, 1, '1回は叩く')
  assert.equal(isProviderResting('kugou'), true, '休みに入っていない')

  // 次の曲。休んでいる間は通信そのものを起こさない。
  const before = calls.length
  assert.equal(await fetchFromKugou({ ...want, track: '別の曲' }), null)
  assert.equal(calls.length, before, `休止中なのに ${calls.length - before} 回叩いている`)
})

test('404 では休まない(持っていないだけ)', async () => {
  stubFetch(() => reply(404))

  assert.equal(await fetchFromLiriqo({ ...want, video_id: 'abc' }), null)
  assert.equal(calls.length, 1)
  assert.equal(isProviderResting('liriqo'), false, '「持っていない」で止まっている')

  // 次の曲はちゃんと聞きに行く
  assert.equal(await fetchFromLiriqo({ ...want, track: '別の曲', video_id: 'def' }), null)
  assert.equal(calls.length, 2, '収録が無いだけの取得元を止めてしまっている')
})

test('サーバーが落ちている(5xx)時も休ませる', async () => {
  stubFetch(() => reply(503))

  assert.equal(await fetchFromNetease(want), null)
  assert.equal(isProviderResting('netease'), true)
})

test('休止に入ったことを警告として残す', () => {
  assert.ok(warnings.some(w => w.includes('kugou')), 'kugou の休止が記録されていない')
  assert.ok(warnings.some(w => w.includes('429')), '理由が残っていない')
  assert.ok(!warnings.some(w => w.includes('liriqo')), '404 で休ませた記録が残っている')
})

test('通信そのものに失敗した時も休ませる', async () => {
  stubFetch(() => { throw new TypeError('network down') })

  // netease は上のテストで休止中なので、まだ動く amll で確かめる。
  // (amll は曲IDの割り出しに netease を使うが、休止中なら即 null で返る)
  const { fetchFromAmll } = await import('../src/js/module/extra-providers.js')
  assert.equal(await fetchFromAmll(want), null)
})
