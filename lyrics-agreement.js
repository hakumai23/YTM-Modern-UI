// 取得元どうしの歌詞を突き合わせて、間違った歌詞を見分ける。
//
// どの取得元も、登録されている中身そのものが違うことがある。
// 実測(23 曲 × 8 取得元)で見つかった外れ:
//   - 別の曲: 夜に駆ける (THE FIRST TAKE) の SimpMusic が「群青」、
//     アイドル・Supernova の LrcLib が別の曲
//   - ローマ字: 怪獣の花唄 の LrcLib
//   - 切れ端: Blinding Lights / Save Your Tears / Whiplash の LRC Hub が
//     クレジット1行だけ、Dynamite の LRC Hub が半分、丁香花 の LRC Hub が 8 行
//   - 訳が混ざる: Lemon の LrcLib に1行ごとにベトナム語訳
// 曲名・アーティスト名・長さは正しいので、メタデータでは気づけない。
//
// 手がかりは「他の取得元と中身が合うか」。正しい歌詞どうしなら、取得元が
// 違っても本文はほぼ同じになる。本文の2文字組の重なり(Dice 係数)は、
// 正しいもの同士で 0.82 以上、外れは 0.59 以下だった(上の実測)。
//
// Dice は両方向を見る。片側だけ(小さい方で割る包含率)だと、切れ端は
// 全部が相手に含まれるので 1.0 になり、訳が混ざったものも元の歌詞を
// 全部含むので高く出てしまう。

// これ以上重なっていれば同じ歌詞とみなす
export const LYRICS_AGREE_MIN = 0.7;

// 他と比べてこれより短い歌詞は切れ端とみなす(本文の文字数の比)
const FRAGMENT_RATIO = 0.4;

// 取得元の信頼の順。突き合わせで決まらない時(2つが食い違い、3つ目が
// 無い時)だけ使う。ytm は YouTube Music 自身の歌詞(その動画の公式の記録)。
export const LYRICS_TRUST_ORDER = [
  'ytm', 'lrchub', 'amll', 'lyricsplus', 'netease', 'kugou', 'lrclib', 'simpmusic', 'buaaa', 'liriqo',
];

export const lyricsTrustRank = (providerId) => trustOf(providerId);

function trustOf(providerId) {
  const i = LYRICS_TRUST_ORDER.indexOf(String(providerId || '').toLowerCase());
  return i < 0 ? LYRICS_TRUST_ORDER.length : i;
}

// クレジット行(作詞・作曲など)のラベル。突き合わせからは落とす。
// 取得元によって入っていたりいなかったりするので、残すと正しい歌詞どうしの
// 重なりが下がる。ラベルだけで見ると SimpMusic の「v1:」のような歌い手の
// 印まで落ちるので、知っている語に限る。
const COMPARE_CREDIT_LABELS = [
  '作詞', '作词', '作曲', '編曲', '编曲', '词曲', '詞曲', '词', '詞', '曲', '编', '編',
  '制作', '製作', '监制', '監製', '出品', '发行', '發行', '混音', '録音', '录音', '母带', '母帶',
  '和声', '和聲', '原唱', '翻唱', '演唱', '主唱', '歌手', '专辑', '專輯',
  'lyrics', 'lyricist', 'lyric', 'written', 'writer', 'music', 'composer', 'composed',
  'arranged', 'arranger', 'producer', 'produced', 'vocal', 'chorus', 'mixing', 'mastering',
];

const isCompareCreditLine = (line) => {
  const m = line.match(/^([^:：]{1,24})[:：]/);
  if (!m) return false;
  const label = m[1].normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  return COMPARE_CREDIT_LABELS.some(known => label.includes(known));
};

// 突き合わせ用の本文。時刻・タグ・歌い手の印・クレジット行を落とし、
// 字形と大小を揃え、文字と数字だけを残す(空白や記号の打ち方の違いで
// 外れにしない)。
// lyrics-ui.js の lyricTextForCompare と同じ中身。変える時は両方変えること
// (tests/lyrics-agreement.test.mjs が突き合わせている)。
export const lyricTextForCompare = (lyrics) => String(lyrics ?? '')
  .split(/\r?\n/)
  .map(line => line.replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '').trim()
    .replace(/^(?:v\d{1,4}|bg)\s*:\s*/i, ''))
  .filter(line => !isCompareCreditLine(line))
  .join('\n')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

// 比べる本文の上限(文字)。1曲の歌詞は長くても数千字。桁違いに大きい
// ものが混ざっても、比べる手間が膨らまないようにする。
const MAX_COMPARE_CHARS = 20000;

const bigrams = (text) => {
  const chars = Array.from(text).slice(0, MAX_COMPARE_CHARS);
  const set = new Set();
  for (let i = 0; i < chars.length - 1; i++) set.add(chars[i] + chars[i + 1]);
  return set;
};

// 同じ歌詞を何度も比べる(取得元が1つ届くたびに全部を比べ直す)ので、
// 本文と2文字組は歌詞ごとに一度だけ作って覚えておく。
const preparedCache = new Map();
const PREPARED_CACHE_MAX = 32;
const prepared = (lyrics) => {
  const hit = preparedCache.get(lyrics);
  if (hit) return hit;
  const text = lyricTextForCompare(lyrics).slice(0, MAX_COMPARE_CHARS * 2);
  const value = { text, grams: bigrams(text) };
  preparedCache.set(lyrics, value);
  while (preparedCache.size > PREPARED_CACHE_MAX) preparedCache.delete(preparedCache.keys().next().value);
  return value;
};

// 2つの歌詞がどれだけ同じか(0〜1)。どちらかが空なら 0。
export const lyricsAgreement = (a, b) => {
  const A = prepared(String(a ?? '')).grams;
  const B = prepared(String(b ?? '')).grams;
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return (2 * shared) / (A.size + B.size);
};

// 曲名から、歌詞に出てくるはずの文字の種類。
// 曲名がローマ字だけの時は決めない(Lemon のような日本語の曲がある)。
const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff]/u;
const HANGUL_RE = /[\uac00-\ud7af]/u;
const expectedScriptOf = (track) => {
  const title = String(track || '');
  if (HANGUL_RE.test(title)) return HANGUL_RE;
  if (CJK_RE.test(title)) return CJK_RE;
  return null;
};

// 本文のうち、その文字が占める割合
const shareOf = (text, re) => {
  const chars = Array.from(text);
  if (!chars.length) return 0;
  return chars.filter(c => re.test(c)).length / chars.length;
};
const ANY_ASIAN_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;

// 取得元ごとの歌詞を突き合わせて、それぞれの見立てを返す。
//
// entries: [{ key?, providerId, lyrics }]。YouTube Music の歌詞のように、
// 票としてだけ使うもの(表示には使わない)も同じ形で混ぜてよい。
// 見立ては key(無ければ providerId)ごとに返す。同じ取得元から2通り
// 届くこと(LRC Hub の直接取得と検索)があるので、区別したい時は key を付ける。
//
// 返す verdict:
//   'confirmed'    他の取得元と合っている
//   'contradicted' 他の取得元どうしが合っていて、自分だけ外れている。
//                  または、合う相手が誰にも無い中で、自分だけ切れ端か
//                  文字の種類が曲名と合わない
//   'unknown'      比べる相手が無い、または決め手が無い
export const judgeLyrics = (entries, { track = '' } = {}) => {
  const all = (Array.isArray(entries) ? entries : [])
    .filter(e => e && typeof e.lyrics === 'string' && e.lyrics.trim())
    .map(e => ({ key: String(e.key || e.providerId || ''), providerId: String(e.providerId || ''), ...prepared(e.lyrics) }));
  const list = all.filter(e => e.text);
  const verdicts = new Map();
  // クレジット行しか無い歌詞(実測: Blinding Lights の LRC Hub)は、
  // 他に本文のある候補があれば外れ。
  for (const e of all) if (!e.text) verdicts.set(e.key, list.length ? 'contradicted' : 'unknown');
  if (!list.length) return verdicts;

  const n = list.length;
  const agree = list.map(() => new Array(n).fill(false));
  const grams = list.map(e => e.grams);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let shared = 0;
      for (const g of grams[i]) if (grams[j].has(g)) shared += 1;
      const size = grams[i].size + grams[j].size;
      const ok = size > 0 && (2 * shared) / size >= LYRICS_AGREE_MIN;
      agree[i][j] = ok;
      agree[j][i] = ok;
    }
  }

  // 合うもの同士をまとめる。いちばん大きい塊(同数なら信頼の高い取得元を
  // 含む方)を「正しい歌詞」とみなす。
  const group = new Array(n).fill(-1);
  const groups = [];
  for (let i = 0; i < n; i++) {
    if (group[i] >= 0) continue;
    const members = [i];
    group[i] = groups.length;
    for (let k = 0; k < members.length; k++) {
      for (let j = 0; j < n; j++) {
        if (group[j] < 0 && agree[members[k]][j]) {
          group[j] = groups.length;
          members.push(j);
        }
      }
    }
    groups.push(members);
  }
  const bestTrust = (members) => Math.min(...members.map(i => trustOf(list[i].providerId)));
  const best = groups.slice().sort((a, b) => (b.length - a.length) || (bestTrust(a) - bestTrust(b)))[0];

  if (best.length >= 2) {
    list.forEach((e, i) => {
      verdicts.set(e.key, best.includes(i) ? 'confirmed' : 'contradicted');
    });
    return verdicts;
  }

  // 誰とも合わない。決め手になるのは次の2つの傷。傷の無いものが1つでも
  // あれば、傷のあるものを外れとみなす。
  //   切れ端: いちばん長いものの 4 割に満たず、文字の種類の割合が近い。
  //     (割合が違う時は、長い方に訳が混ざっているだけのことがある。
  //      Lemon の LrcLib は1行ごとにベトナム語訳が入って 3.6 倍の長さだった)
  //   曲名と文字の種類が違う: 曲名が日本語・中国語・韓国語なのに、その文字が
  //     他の候補の 6 割に満たない(ローマ字、訳だけ、訳が混ざったもの)
  const lengths = list.map(e => Array.from(e.text).length);
  const longest = Math.max(...lengths);
  const asian = list.map(e => shareOf(e.text, ANY_ASIAN_RE));
  const iLongest = lengths.indexOf(longest);
  const script = expectedScriptOf(track);
  const shares = script ? list.map(e => shareOf(e.text, script)) : null;
  const maxShare = shares ? Math.max(...shares) : 0;
  const flawed = list.map((e, i) => (
    (lengths[i] < longest * FRAGMENT_RATIO && Math.abs(asian[i] - asian[iLongest]) <= 0.2) ||
    (!!shares && maxShare >= 0.3 && shares[i] < maxShare * 0.6)
  ));
  const anyClean = flawed.some(f => !f);
  list.forEach((e, i) => {
    verdicts.set(e.key, (anyClean && flawed[i]) ? 'contradicted' : 'unknown');
  });
  return verdicts;
};

// 表示に使う候補を1つ選ぶ。外れと判定されたものは選ばない。
// 同じ見立ての中では、品質(単語同期 > 行同期)、次に信頼の順。
// candidates: [{ key?, providerId, lyrics, quality }]、voters: 票だけの歌詞
export const pickAgreedLyrics = (candidates, voters = [], { track = '' } = {}) => {
  const verdicts = judgeLyrics([...candidates, ...voters], { track });
  const keyOf = (c) => String(c.key || c.providerId || '');
  const rank = { confirmed: 0, unknown: 1 };
  return candidates
    .filter(c => verdicts.get(keyOf(c)) !== 'contradicted')
    .sort((a, b) => (
      (rank[verdicts.get(keyOf(a))] ?? 2) - (rank[verdicts.get(keyOf(b))] ?? 2) ||
      (Number(b.quality) || 0) - (Number(a.quality) || 0) ||
      trustOf(a.providerId) - trustOf(b.providerId)
    ))[0] || null;
};
