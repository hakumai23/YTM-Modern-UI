// SimpMusic の単語同期(Apple Music 由来)は、行頭に歌い手の印(v1: / v2:)が付く。
// そのまま読むと「v1:아파트」のように画面に出ていた(実測: APT.)。

import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.chrome = globalThis.chrome || { storage: { local: { get: (k, cb) => cb({}) } } }
const API = await import('../src/js/module/api.js')

test('SimpMusic の単語同期の歌い手の印(v1: / v2:)は歌詞に出さない', () => {
  const rich = '[00:06.677]v1:<00:06.677>아<00:07.066>파트 <00:07.439>\n[00:08.240]v2:<00:08.240>Kissy <00:08.629>face <00:09.002>'
  const lines = API.parseDynamicLrc(rich)
  assert.deepEqual(lines.map(l => l.chars.map(c => c.c).join('')), ['아파트 ', 'Kissy face '])
  // 語の時刻の前に無ければ触らない(歌詞そのものの「v1:」は残す)
  assert.equal(API.parseDynamicLrc('[00:01.00]<00:01.00>v1: <00:01.50>go')[0].chars.map(c => c.c).join(''), 'v1: go')
})
