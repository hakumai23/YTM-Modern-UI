// 歌詞カード。
//
// 聴いている曲の歌詞から 1〜4 行を選び、Immersion と同じ見た目
// (ジャケットの色の背景・太い白文字・曲名とジャケット)の画像にして、
// コピーか保存をする。刺さった一節をそのまま友だちや SNS に渡すための機能。
//
// - 入口はボタン列の「歌詞カード」。押すと選ぶ状態になり、いま歌っている行
//   (無ければ直前に歌った行)が選ばれている。
// - 選んでいる間は、行を押してもシークしない。範囲の外を押すと、そこまで
//   広げる(最大 4 行。短い抜き出しにとどめる)。範囲の中を押すと、その 1 行
//   から選び直す。Esc でやめる、Enter で作る。
// - 選んでいる間は自動で歌っている行へ寄せない(選ぶ行が逃げていかない)。
//   曲が変わったらやめる。
// - 画像は手元の canvas で作り、どこにも送らない。ジャケットが読めない時は
//   ジャケットなしの暗い背景で作る。
//
// 共有画像の器(.ytm-replay-share)は Daily Replay と同じものを使う。
const LyricCard = (() => {
  const W = 1080;
  const H = 1080;
  const PAD = 88;
  const MAX_LINES = 4;
  const ART = 132;
  const FAMILY = '-apple-system, "SF Pro Display", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", system-ui, sans-serif';
  const font = (size, weight) => `${weight || 400} ${size}px ${FAMILY}`;

  let selecting = false;
  // 選ぶ状態の世代。始める・やめるたびに進める。カードを作っている間
  // (ジャケットの読み込み待ち)に曲送りや広告でやめた場合、戻ってきた
  // 結果は前の曲のものなので捨てる。捨てないと旧曲のカードが後から開く。
  let generation = 0;
  let anchor = -1;
  let focus = -1;
  let bar = null;
  let rowObserver = null;
  let objectUrl = null;

  // ── 行の読み取り ───────────────────────────────────────
  const rows = () => (ui.lyrics ? Array.from(ui.lyrics.querySelectorAll('.lyric-line')) : []);
  const mainText = (row) => {
    const el = row && row.querySelector('.lyric-main');
    return (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  };
  const translationText = (row) => {
    const el = row && row.querySelector('.lyric-translation');
    return (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  };
  // 間奏の「♪」や空行はカードにしない
  const isSelectable = (row) => {
    const text = mainText(row);
    return !!text && !/^[♪♫\s・…]+$/.test(text);
  };

  const range = () => [Math.min(anchor, focus), Math.max(anchor, focus)];

  // 範囲の外を押したらそこまで広げ、MAX_LINES を超えるぶんは押した側と
  // 反対の端から落とす。範囲の中を押したら、その行だけに戻す。
  const nextRange = (current, clicked, max) => {
    const [lo, hi] = current;
    if (clicked >= lo && clicked <= hi) return [clicked, clicked];
    if (clicked > hi) return [Math.max(lo, clicked - max + 1), clicked];
    return [clicked, Math.min(hi, clicked + max - 1)];
  };

  const selectedLines = () => {
    const rs = rows();
    const [lo, hi] = range();
    const out = [];
    for (let i = lo; i <= hi && i < rs.length; i++) {
      if (i < 0 || !isSelectable(rs[i])) continue;
      out.push({ text: mainText(rs[i]), translation: translationText(rs[i]) });
    }
    return out;
  };

  // ── 選ぶ状態 ─────────────────────────────────────────
  const paint = () => {
    const rs = rows();
    const [lo, hi] = range();
    rs.forEach((row, i) => row.classList.toggle('ytm-card-selected', selecting && i >= lo && i <= hi && isSelectable(row)));
    if (bar) {
      const n = selectedLines().length;
      bar.querySelector('.ytm-card-bar-count').textContent = t('lyric_card_selected').replace('{n}', String(n));
      bar.querySelector('.ytm-card-bar-make').disabled = n === 0;
    }
  };

  const startIndex = () => {
    const rs = rows();
    let i = rs.findIndex(r => r.classList.contains('active') && isSelectable(r));
    if (i < 0) {
      for (let j = rs.length - 1; j >= 0; j--) {
        if (rs[j].classList.contains('lyric-past') && isSelectable(rs[j])) { i = j; break; }
      }
    }
    if (i < 0) i = rs.findIndex(isSelectable);
    return i;
  };

  const onRowClick = (e) => {
    const row = e.target.closest && e.target.closest('.lyric-line');
    if (!row || !ui.lyrics || !ui.lyrics.contains(row)) return;
    // 選んでいる間は、行を押してもシークしない
    e.preventDefault();
    e.stopPropagation();
    if (!isSelectable(row)) return;
    const i = rows().indexOf(row);
    [anchor, focus] = nextRange(range(), i, MAX_LINES);
    paint();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      make();
    }
  };

  const showBar = () => {
    bar = createEl('div', 'ytm-lyric-card-bar', 'ytm-lyric-card-bar', `
      <span class="ytm-card-bar-count"></span>
      <span class="ytm-card-bar-hint"></span>
      <button type="button" class="ytm-card-bar-make"></button>
      <button type="button" class="ytm-card-bar-cancel"></button>
    `);
    bar.setAttribute('role', 'toolbar');
    bar.querySelector('.ytm-card-bar-hint').textContent = t('lyric_card_hint');
    bar.querySelector('.ytm-card-bar-make').textContent = t('lyric_card_make');
    bar.querySelector('.ytm-card-bar-cancel').textContent = t('lyric_card_cancel');
    bar.querySelector('.ytm-card-bar-make').onclick = () => make();
    bar.querySelector('.ytm-card-bar-cancel').onclick = () => cancel();
    // 歌詞の列の下に置く(画面の真ん中だと左の列の曲/動画の切り替えに重なる)
    (ui.lyricsStage || document.body).appendChild(bar);
  };

  const start = () => {
    if (selecting) return;
    // 歌詞の列が画面に無い時(動画モード)も作れない。以前は見えない所で
    // 選ぶ状態に入り、Esc を押すまでキー操作を横取りしていた(実機で確認)。
    if (!ui.lyrics || !ui.lyrics.getClientRects().length ||
      document.body.classList.contains('ytm-ad-playing') || !rows().some(isSelectable)) {
      if (typeof showToast === 'function') showToast(t('lyric_card_unavailable'));
      return;
    }
    const i = startIndex();
    if (i < 0) return;
    selecting = true;
    generation += 1;
    anchor = i;
    focus = i;
    document.body.classList.add('ytm-lyric-card-selecting');
    if (typeof setLyricsAutoFollowHold === 'function') setLyricsAutoFollowHold(true);
    ui.lyrics.addEventListener('click', onRowClick, true);
    document.addEventListener('keydown', onKey, true);
    // 翻訳が遅れて届くなどで歌詞が組み直されたら、選んだ印を付け直す
    rowObserver = new MutationObserver(() => paint());
    rowObserver.observe(ui.lyrics, { childList: true });
    showBar();
    paint();
  };

  const cancel = () => {
    if (!selecting) return;
    selecting = false;
    generation += 1;
    document.body.classList.remove('ytm-lyric-card-selecting');
    if (ui.lyrics) ui.lyrics.removeEventListener('click', onRowClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (rowObserver) rowObserver.disconnect();
    rowObserver = null;
    rows().forEach(row => row.classList.remove('ytm-card-selected'));
    if (bar) bar.remove();
    bar = null;
    if (typeof setLyricsAutoFollowHold === 'function') setLyricsAutoFollowHold(false);
  };

  // ── 描く ─────────────────────────────────────────────
  const loadImage = (src) => new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    img.onload = () => done(img);
    img.onerror = () => done(null);
    setTimeout(() => done(null), 6000);
    img.src = src;
  });

  const roundRectPath = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  };

  const ellipsize = (ctx, text, maxWidth) => {
    const value = String(text ?? '');
    if (ctx.measureText(value).width <= maxWidth) return value;
    let lo = 0;
    let hi = value.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(value.slice(0, mid) + '…').width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return value.slice(0, lo) + '…';
  };

  // 行頭に来てはいけない文字(句読点・閉じ括弧・小書き)
  const NO_LINE_START = /^[、。，．,.!?！？」』）)\]】〕〉》ー～ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/;

  const segmentsOf = (text) => {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        return Array.from(new Intl.Segmenter('ja', { granularity: 'word' }).segment(text), s => s.segment);
      } catch (e) { /* 下へ */ }
    }
    return text.split(/(\s+)/);
  };

  // 幅に収まるように折り返す。語の途中では切らず、1 語が幅を超える時だけ字で切る。
  const wrap = (ctx, text, maxWidth) => {
    const lines = [];
    let line = '';
    for (const seg of segmentsOf(text)) {
      const candidate = line + seg;
      if (ctx.measureText(candidate).width <= maxWidth || !line.trim()) {
        if (ctx.measureText(candidate).width <= maxWidth) {
          line = candidate;
          continue;
        }
        // 1 語だけで幅を超える: 字で切る
        for (const ch of seg) {
          if (ctx.measureText(line + ch).width > maxWidth && line.trim()) {
            lines.push(line.trimEnd());
            line = '';
          }
          line += ch;
        }
        continue;
      }
      if (NO_LINE_START.test(seg)) {
        // 句読点は前の行にぶら下げる(少しはみ出しても行頭には置かない)
        line = candidate;
        continue;
      }
      lines.push(line.trimEnd());
      line = seg.trimStart();
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
  };

  // 選んだ行を、枠に収まる最大の文字サイズで組む
  const layoutLyrics = (ctx, lines, maxWidth, maxHeight) => {
    for (let size = 72; size >= 34; size -= 2) {
      const subSize = Math.round(size * 0.5);
      const blocks = [];
      let height = 0;
      for (const line of lines) {
        ctx.font = font(size, 800);
        const main = wrap(ctx, line.text, maxWidth);
        ctx.font = font(subSize, 500);
        const sub = line.translation ? wrap(ctx, line.translation, maxWidth) : [];
        const h = main.length * size * 1.22 + (sub.length ? 10 + sub.length * subSize * 1.35 : 0);
        blocks.push({ main, sub, h });
        height += h;
      }
      height += (blocks.length - 1) * size * 0.55;
      if (height <= maxHeight || size === 34) return { size, subSize, blocks, height };
    }
    return null;
  };

  const averageLuminance = (img) => {
    try {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      return sum / (d.length / 4);
    } catch (e) {
      return 0.5;
    }
  };

  const render = async ({ lines, title, artist, artworkSrc }) => {
    const img = await loadImage(artworkSrc);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 背景: ジャケットを大きくぼかして敷き、明るさに応じて沈める
    ctx.fillStyle = '#121216';
    ctx.fillRect(0, 0, W, H);
    if (img) {
      ctx.save();
      ctx.filter = 'blur(70px) saturate(150%)';
      ctx.drawImage(img, -W * 0.2, -H * 0.2, W * 1.4, H * 1.4);
      ctx.restore();
      const luma = averageLuminance(img);
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.78, 0.34 + luma * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    const vignette = ctx.createRadialGradient(W / 2, H * 0.45, W * 0.2, W / 2, H / 2, W * 0.8);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    // 見出し: ジャケット・曲名・アーティスト
    let textX = PAD;
    if (img) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 10;
      roundRectPath(ctx, PAD, PAD, ART, ART, 18);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRectPath(ctx, PAD, PAD, ART, ART, 18);
      ctx.clip();
      ctx.drawImage(img, PAD, PAD, ART, ART);
      ctx.restore();
      textX = PAD + ART + 30;
    }
    const headWidth = W - PAD - textX;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = font(42, 700);
    ctx.fillText(ellipsize(ctx, title, headWidth), textX, PAD + 58);
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = font(32, 500);
    ctx.fillText(ellipsize(ctx, artist, headWidth), textX, PAD + 106);

    // 歌詞
    const top = PAD + ART + 70;
    const bottom = H - PAD - 64;
    const maxWidth = W - PAD * 2;
    const layout = layoutLyrics(ctx, lines, maxWidth, bottom - top);
    if (layout) {
      let y = top + Math.max(0, (bottom - top - layout.height) / 2);
      ctx.textBaseline = 'top';
      layout.blocks.forEach((block, bi) => {
        ctx.font = font(layout.size, 800);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = 18;
        block.main.forEach((text, li) => {
          if (y + layout.size > bottom + layout.size * 0.3) return;
          ctx.fillText(text, PAD, y + li * layout.size * 1.22);
        });
        let yy = y + block.main.length * layout.size * 1.22;
        ctx.shadowBlur = 0;
        if (block.sub.length) {
          yy += 10;
          ctx.font = font(layout.subSize, 500);
          ctx.fillStyle = 'rgba(255,255,255,0.66)';
          block.sub.forEach((text, li) => ctx.fillText(text, PAD, yy + li * layout.subSize * 1.35));
        }
        y += block.h + (bi < layout.blocks.length - 1 ? layout.size * 0.55 : 0);
      });
    }

    // 署名
    ctx.textBaseline = 'alphabetic';
    ctx.shadowBlur = 0;
    ctx.font = font(26, 600);
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText('YTM Immersion', PAD, H - PAD + 10);

    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  };

  // ── 見せる(Daily Replay の共有画像と同じ器) ─────────────
  const closeDialog = () => {
    const el = document.getElementById('ytm-lyric-card-share');
    if (el) el.remove();
    document.removeEventListener('keydown', onDialogKey, true);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const onDialogKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    }
  };

  const fileNameFor = (title) => {
    const safe = String(title || 'lyrics').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
    return `lyric_card_${safe}.png`;
  };

  const showDialog = (blob, title) => {
    closeDialog();
    objectUrl = URL.createObjectURL(blob);
    const root = createEl('div', 'ytm-lyric-card-share', 'ytm-replay-share', `
      <div class="replay-share-box" role="dialog" aria-modal="true">
        <div class="replay-share-head">
          <span></span>
          <button type="button" class="replay-share-close"></button>
        </div>
        <img class="replay-share-img" alt="">
        <div class="replay-share-actions">
          <button type="button" class="replay-footer-btn replay-share-copy"></button>
          <button type="button" class="replay-footer-btn replay-share-save"></button>
        </div>
      </div>
    `);
    root.querySelector('.replay-share-head span').textContent = t('lyric_card_title');
    const close = root.querySelector('.replay-share-close');
    close.textContent = '✕';
    close.setAttribute('aria-label', t('replay_share_close'));
    root.querySelector('.replay-share-img').src = objectUrl;
    root.querySelector('.replay-share-save').textContent = t('replay_share_save');
    document.body.appendChild(root);
    document.addEventListener('keydown', onDialogKey, true);

    close.onclick = closeDialog;
    root.onclick = (e) => { if (e.target === root) closeDialog(); };

    root.querySelector('.replay-share-save').onclick = () => {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileNameFor(title);
      a.click();
    };

    const copyBtn = root.querySelector('.replay-share-copy');
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      copyBtn.remove();
    } else {
      copyBtn.textContent = t('replay_share_copy');
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          copyBtn.textContent = t('replay_share_copied');
        } catch (e) {
          console.warn('[LyricCard] clipboard failed', e);
          copyBtn.textContent = t('replay_share_copy_failed');
        }
        setTimeout(() => { copyBtn.textContent = t('replay_share_copy'); }, 1800);
      };
      copyBtn.focus();
    }
  };

  const make = async () => {
    if (!selecting) return;
    const lines = selectedLines();
    if (!lines.length) return;
    const title = (ui.title && ui.title.textContent || '').trim();
    const artist = (ui.artist && ui.artist.textContent || '').trim();
    const artImg = ui.artwork && ui.artwork.querySelector('img');
    const artworkSrc = artImg ? (artImg.currentSrc || artImg.src) : null;
    const makeBtn = bar && bar.querySelector('.ytm-card-bar-make');
    if (makeBtn) {
      makeBtn.disabled = true;
      makeBtn.textContent = t('replay_share_building');
    }
    const myGeneration = generation;
    try {
      const blob = await render({ lines, title, artist, artworkSrc });
      // 作っている間にやめていたら(曲送り・広告・Esc)、結果は捨てる
      if (myGeneration !== generation || !selecting) return;
      if (!blob) throw new Error('toBlob returned null');
      cancel();
      showDialog(blob, title);
    } catch (e) {
      if (myGeneration !== generation) return;
      console.error('[LyricCard] build failed', e);
      if (typeof showToast === 'function') showToast(t('lyric_card_failed'));
      if (makeBtn) {
        makeBtn.disabled = false;
        makeBtn.textContent = t('lyric_card_make');
      }
    }
  };

  return {
    start,
    cancel,
    isSelecting: () => selecting,
    // テスト用
    _nextRange: nextRange,
    _wrap: wrap,
  };
})();
