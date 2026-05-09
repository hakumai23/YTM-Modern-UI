
  const parseLRCInternal = (lrc) => {
    if (!lrc) return { lines: [], hasTs: false };
    const tagTest = /\[\d{2}:\d{2}\.\d{2,3}\]/;

    // 繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝励′縺ｪ縺・ｴ蜷・
    if (!tagTest.test(lrc)) {
      // 遨ｺ陦後ｂ菫晄戟縺励※縲∫ｿｻ險ｳ譎ゅ↓陦後′隧ｰ縺ｾ繧峨↑縺・ｈ縺・↓縺吶ｋ
      const lines = lrc.split(/\r?\n/).map(line => {
        const text = (line ?? '').replace(/^\s+|\s+$/g, '');
        return { time: null, text };
      });
      return { lines, hasTs: false };
    }

    // 繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝励′縺ゅｋ蝣ｴ蜷・
    const tagExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
    const result = [];
    let match;
    let lastTime = null;
    let lastIndex = 0;

    while ((match = tagExp.exec(lrc)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const fracStr = match[3];
      const frac = parseInt(fracStr, 10) / (fracStr.length === 2 ? 100 : 1000);
      const time = min * 60 + sec + frac;

      if (lastTime !== null) {
        const rawText = lrc.slice(lastIndex, match.index);
        const cleaned = rawText.replace(/\r?\n/g, ' ');
        const text = cleaned.trim();
        const hasLineBreak = /[\r\n]/.test(rawText);
        if (text || hasLineBreak) {
          result.push({ time: lastTime, text });
        }
      }
      lastTime = time;
      lastIndex = tagExp.lastIndex;
    }

    // 譛蠕後・陦後・蜃ｦ逅・
    if (lastTime !== null && lastIndex < lrc.length) {
      const rawText = lrc.slice(lastIndex);
      const cleaned = rawText.replace(/\r?\n/g, ' ');
      const text = cleaned.trim();
      // 笘・ｿｮ豁｣: 遨ｺ陦・譏守､ｺ逧・↑謾ｹ陦後・縺ｿ)繧ゆｿ晄戟縺励※繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝励・繧ｺ繝ｬ繧帝亟縺・
      const hasLineBreak = /[\r\n]/.test(rawText);
      if (text || hasLineBreak) {
        result.push({ time: lastTime, text });
      }
    }

    result.sort((a, b) => (a.time || 0) - (b.time || 0));
    return { lines: result, hasTs: true };
  };


  const parseBaseLRC = (lrc) => {
    const { lines, hasTs } = parseLRCInternal(lrc);
    hasTimestamp = hasTs;
    return lines;
  };

  // ===== duet helpers =====
  const timeKey = (t) => {
    if (typeof t !== 'number' || Number.isNaN(t)) return 'NaN';
    // milliseconds precision is enough for LRC tags
    return t.toFixed(3);
  };

  const DUET_TIME_TOLERANCE = 0.15;
  const DUET_DUPLICATE_TOLERANCE = 1.0;
  const SAME_TIMESTAMP_TOLERANCE = 0.05;
  const DYNAMIC_ACTIVE_TAIL_SEC = 0.2;
  const DYNAMIC_OVERLAP_TOLERANCE = 0.05;

  const normalizeLyricCompareText = (text) => String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[\p{P}\p{S}\p{C}]/gu, '')
    .toLowerCase()
    .trim();

  const normalizeLyricCompareTextStrict = (text) => String(text || '')
    .normalize('NFKC')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[\p{P}\p{S}\p{C}]/gu, '')
    .toLowerCase()
    .trim();

  const extractDynamicLineText = (line) => {
    if (typeof line?.text === 'string' && line.text.length) return line.text;
    if (Array.isArray(line?.chars)) {
      return line.chars.map(c => c?.c || c?.text || c?.caption || '').join('');
    }
    return '';
  };

  const getDynamicLineStartSec = (line) => {
    if (typeof line?.startTimeMs === 'number') return line.startTimeMs / 1000;
    if (typeof line?.startTimeMs === 'string') {
      const n = Number(line.startTimeMs);
      if (!Number.isNaN(n)) return n / 1000;
    }
    if (typeof line?.time === 'number') return line.time;
    if (Array.isArray(line?.chars) && line.chars.length) {
      const ts = line.chars
        .map(c => (typeof c?.t === 'number' ? c.t : null))
        .filter(v => v != null);
      if (ts.length) return Math.min(...ts) / 1000;
    }
    return null;
  };

  const getDynamicLineEndSec = (line) => {
    if (!line) return null;
    if (typeof line.__ytmEndSec === 'number' && Number.isFinite(line.__ytmEndSec)) {
      return line.__ytmEndSec;
    }

    const startSec = getDynamicLineStartSec(line);
    let endSec = null;

    if (typeof line?.endTimeMs === 'number' && Number.isFinite(line.endTimeMs)) {
      endSec = line.endTimeMs / 1000;
    } else if (typeof line?.endTimeMs === 'string') {
      const n = Number(line.endTimeMs);
      if (Number.isFinite(n)) endSec = n / 1000;
    }

    if (Array.isArray(line?.chars) && line.chars.length) {
      const lastCharMs = line.chars
        .map(ch => {
          if (typeof ch?.t === 'number' && Number.isFinite(ch.t)) return ch.t;
          if (typeof ch?.t === 'string') {
            const n = Number(ch.t);
            if (Number.isFinite(n)) return n;
          }
          return null;
        })
        .filter(v => v != null)
        .reduce((max, v) => Math.max(max, v), Number.NEGATIVE_INFINITY);

      if (Number.isFinite(lastCharMs)) {
        const charTailSec = (lastCharMs / 1000) + DYNAMIC_ACTIVE_TAIL_SEC;
        endSec = (typeof endSec === 'number') ? Math.max(endSec, charTailSec) : charTailSec;
      }
    }

    if (!(typeof endSec === 'number') && typeof startSec === 'number') {
      endSec = startSec + 1.5;
    }

    if (typeof startSec === 'number' && typeof endSec === 'number' && endSec <= startSec) {
      endSec = startSec + DYNAMIC_ACTIVE_TAIL_SEC;
    }

    if (typeof endSec === 'number' && Number.isFinite(endSec)) {
      line.__ytmEndSec = endSec;
      return endSec;
    }
    return null;
  };

  const isLineDynamicallyActiveAtTime = (line, timeSec, tolerance = DYNAMIC_OVERLAP_TOLERANCE) => {
    const startSec = (typeof line?._dynamicRenderStartSec === 'number' && Number.isFinite(line._dynamicRenderStartSec))
      ? line._dynamicRenderStartSec
      : null;
    const endSec = (typeof line?._dynamicRenderEndSec === 'number' && Number.isFinite(line._dynamicRenderEndSec))
      ? line._dynamicRenderEndSec
      : null;

    return typeof startSec === 'number' &&
      typeof endSec === 'number' &&
      (timeSec + tolerance) >= startSec &&
      timeSec <= (endSec + tolerance);
  };

  const isSameTimestamp = (a, b, tolerance = SAME_TIMESTAMP_TOLERANCE) =>
    typeof a === 'number' &&
    typeof b === 'number' &&
    Math.abs(a - b) <= tolerance;

  const scoreLyricTextMatch = (a, b) => {
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.includes(b) || b.includes(a)) return 60;
    return 0;
  };

  const findCrossSideDuplicateIndex = (lines, line) => {
    if (!Array.isArray(lines) || !lines.length || !line) return -1;

    const lineText = normalizeLyricCompareTextStrict(line?.text);
    if (!lineText) return -1;

    for (let i = lines.length - 1; i >= 0; i--) {
      const existing = lines[i];
      if (!isSameTimestamp(existing?.time, line?.time, DUET_DUPLICATE_TOLERANCE)) {
        if (typeof existing?.time === 'number' && typeof line?.time === 'number' && existing.time < line.time - DUET_DUPLICATE_TOLERANCE) {
          break;
        }
        continue;
      }

      const isCrossSideDuplicate = existing?.duetSide && line?.duetSide && existing.duetSide !== line.duetSide;
      if (!isCrossSideDuplicate) continue;

      const existingText = normalizeLyricCompareTextStrict(existing?.text);
      if (existingText && scoreLyricTextMatch(existingText, lineText) >= 100) {
        return i;
      }
    }

    return -1;
  };

  const preferDuplicateMainLine = (existingLine, incomingLine) => {
    if (!existingLine) return incomingLine || null;
    if (!incomingLine) return existingLine;
    if (existingLine.duetSide === incomingLine.duetSide) return existingLine;
    if (incomingLine.duetSide === 'left') return incomingLine;
    if (existingLine.duetSide === 'left') return existingLine;
    return existingLine;
  };

  const findDynamicLineForRender = (line, sourceLines, usedIndexes) => {
    if (!line || typeof line.time !== 'number') return null;
    if (!Array.isArray(sourceLines) || !sourceLines.length) return null;

    const wantedText = normalizeLyricCompareTextStrict(line.text);
    const candidates = [];

    sourceLines.forEach((dynLine, idx) => {
      const startSec = getDynamicLineStartSec(dynLine);
      if (typeof startSec !== 'number') return;

      const timeDiff = Math.abs(startSec - line.time);
      if (timeDiff > DUET_TIME_TOLERANCE) return;

      const dynText = normalizeLyricCompareTextStrict(extractDynamicLineText(dynLine));
      const textScore = scoreLyricTextMatch(wantedText, dynText);

      candidates.push({
        idx,
        dynLine,
        timeDiff,
        textScore,
        used: !!(usedIndexes && usedIndexes.has(idx)),
      });
    });

    if (!candidates.length) return null;

    candidates.sort((a, b) =>
      Number(a.used) - Number(b.used) ||
      b.textScore - a.textScore ||
      a.timeDiff - b.timeDiff ||
      a.idx - b.idx
    );

    const picked = candidates[0];
    if (usedIndexes) usedIndexes.add(picked.idx);
    return picked.dynLine;
  };

  // 繧ｳ繝ｳ繝・Φ繝・・繝・メ縺ｧDynamic LRC陦後ｒ謗｢縺呻ｼ域凾髢薙′螟ｧ縺阪￥縺壹ｌ縺ｦ縺・ｋ蝣ｴ蜷医・1譁・ｭ怜酔譛溷ｯｾ蠢懃畑・・
  // timeTolerance: 遘貞腰菴阪・險ｱ螳ｹ蟷・・譁・ｭ怜酔譛溘・蝣ｴ蜷医・5.0遘呈耳螂ｨ縲・
  const findDynamicLineByContent = (line, sourceLines, timeTolerance = 5.0) => {
    if (!line || !Array.isArray(sourceLines) || !sourceLines.length) return null;
    const wantedText = normalizeLyricCompareTextStrict(line.text);
    if (!wantedText) return null;

    let bestMatch = null;
    let bestScore = 0;
    let bestTimeDiff = Infinity;

    sourceLines.forEach(dynLine => {
      const startSec = getDynamicLineStartSec(dynLine);
      if (typeof startSec !== 'number') return;
      if (typeof line.time === 'number' && Math.abs(startSec - line.time) > timeTolerance) return;

      const dynText = normalizeLyricCompareTextStrict(extractDynamicLineText(dynLine));
      const score = scoreLyricTextMatch(wantedText, dynText);
      if (score <= 0) return;

      const timeDiff = typeof line.time === 'number' ? Math.abs(startSec - line.time) : 0;
      // 蜷後せ繧ｳ繧｢縺ｪ繧画凾髢薙′霑代＞譁ｹ繧貞━蜈・
      if (score > bestScore || (score === bestScore && timeDiff < bestTimeDiff)) {
        bestScore = score;
        bestTimeDiff = timeDiff;
        bestMatch = dynLine;
      }
    });

    // 螳悟・荳閾ｴ(100)縺ｮ縺ｿ謗｡逕ｨ: 驛ｨ蛻・ｸ閾ｴ(60)縺縺ｨ譁・ｭ玲焚繝ｻ蜀・ｮｹ縺碁＆縺・ョ繝ｼ繧ｿ縺悟ｽ薙◆繧願ｪ､陦ｨ遉ｺ縺ｮ蜴溷屏縺ｫ縺ｪ繧・
    return bestScore >= 100 ? bestMatch : null;
  };

  // Dynamic.lrc蠖｢蠑上・繝代・繧ｵ繝ｼ・・ub.txt逕ｨ・・
  const parseDynamicLrcForSub = (text) => {
    const out = [];
    if (!text) return out;

    const rows = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const parseLrcTimeToMsSub = (ts) => {
      const s = String(ts || '').trim();
      const m = s.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
      if (!m) return null;
      const mm = parseInt(m[1], 10);
      const ss = parseInt(m[2], 10);
      let frac = m[3] || '0';
      if (frac.length === 1) frac = frac + '00';
      else if (frac.length === 2) frac = frac + '0';
      const ms = parseInt(frac.slice(0, 3), 10);
      if (!Number.isFinite(mm) || !Number.isFinite(ss) || !Number.isFinite(ms)) return null;
      return (mm * 60 + ss) * 1000 + ms;
    };

    // 1st pass: parse lines
    const parsed = [];
    for (const raw of rows) {
      const line = raw.trimEnd();
      if (!line) continue;

      const m = line.match(/^\[(\d+:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
      if (!m) continue;

      parsed.push({
        lineMs: parseLrcTimeToMsSub(m[1]),
        rest: m[2] || '',
      });
    }

    const pushDistributed = (chars, chunk, startMs, endMs) => {
      if (!chunk) return;
      const arr = Array.from(chunk);
      const n = arr.length;
      if (!n) return;

      const s = (typeof startMs === 'number') ? startMs : null;
      const e = (typeof endMs === 'number') ? endMs : null;

      if (s == null) {
        for (const ch of arr) chars.push({ t: 0, c: ch });
        return;
      }

      if (e == null || e <= s) {
        for (const ch of arr) chars.push({ t: s, c: ch });
        return;
      }

      const dur = Math.max(1, e - s);
      const step = dur / n;

      for (let i = 0; i < n; i++) {
        const t = s + Math.floor(step * i);
        chars.push({ t, c: arr[i] });
      }
    };

    for (let li = 0; li < parsed.length; li++) {
      const { lineMs, rest } = parsed[li];
      const nextLineMs = (li + 1 < parsed.length && typeof parsed[li + 1].lineMs === 'number')
        ? parsed[li + 1].lineMs
        : null;

      const tagRe = /<(\d+:\d{2}(?:\.\d{1,3})?)>/g;
      const chars = [];

      let prevMs = null;
      let prevEnd = 0;

      while (true) {
        const mm = tagRe.exec(rest);
        if (!mm) break;

        const tagMs = parseLrcTimeToMsSub(mm[1]);

        if (prevMs == null && tagMs != null && mm.index > prevEnd) {
          const chunk0 = rest.slice(prevEnd, mm.index);
          pushDistributed(chars, chunk0, tagMs, tagMs);
        }

        if (prevMs != null) {
          const chunk = rest.slice(prevEnd, mm.index);
          pushDistributed(chars, chunk, prevMs, tagMs);
        }

        prevMs = tagMs;
        prevEnd = mm.index + mm[0].length;
      }

      if (prevMs != null) {
        const chunk = rest.slice(prevEnd);
        let endMs = nextLineMs;
        if (typeof endMs !== 'number') endMs = prevMs + 1500;
        if (endMs <= prevMs) endMs = prevMs + 200;
        pushDistributed(chars, chunk, prevMs, endMs);
      }

      const textLine = chars.map(c => c.c).join('');

      out.push({
        startTimeMs: (typeof lineMs === 'number' ? lineMs : (chars.length ? chars[0].t : 0)),
        text: textLine,
        chars,
      });
    }

    return out;
  };

  // Dynamic.lrc蠖｢蠑上°縺ｩ縺・°繧貞愛螳・
  const isDynamicLrcFormat = (text) => {
    if (!text) return false;
    // <00:00.00>蠖｢蠑上・繧ｿ繧ｰ縺悟性縺ｾ繧後※縺・ｌ縺ｰDynamic.lrc蠖｢蠑・
    return /<\d+:\d{2}(?:\.\d{1,3})?>/.test(text);
  };

  const parseSubLRC = (lrc) => {
    // Dynamic.lrc蠖｢蠑上・蝣ｴ蜷医・蟆ら畑繝代・繧ｵ繝ｼ繧剃ｽｿ逕ｨ
    if (isDynamicLrcFormat(lrc)) {
      const dynLines = parseDynamicLrcForSub(lrc);
      if (dynLines && dynLines.length) {
        // dynamicLines縺九ｉLRC蠖｢蠑上・lines縺ｫ螟画鋤
        const lines = dynLines.map(dl => ({
          time: (typeof dl.startTimeMs === 'number') ? dl.startTimeMs / 1000 : null,
          text: dl.text || '',
        }));
        // 繧ｵ繝也畑縺ｮdynamicLines繧剃ｿ晏ｭ・
        duetSubDynamicLines = dynLines;
        return { lines, hasTs: true, dynamicLines: dynLines };
      }
    }
    
    // 騾壼ｸｸ縺ｮLRC蠖｢蠑・
    duetSubDynamicLines = null;
    const { lines, hasTs } = parseLRCInternal(lrc);
    return { lines: Array.isArray(lines) ? lines : [], hasTs: !!hasTs, dynamicLines: null };
  };

  const mergeDuetLines = (mainLines, subLines) => {
    // 繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝励・險ｱ螳ｹ隱､蟾ｮ (遘・
    const TIME_TOLERANCE = 0.5;

    const subLinesWithTime = (subLines || []).filter(l => typeof l?.time === 'number');
    
    // 繧ｵ繝匁ｭ瑚ｩ槭・繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝励そ繝・ヨ繧剃ｽ懈・・磯ｫ倬滓､懃ｴ｢逕ｨ・・
    const subTimeSet = new Set();
    subLinesWithTime.forEach(sub => {
      // 險ｱ螳ｹ隱､蟾ｮ繧定・・縺励※縲・.1遘貞綾縺ｿ縺ｧ繧ｭ繝ｼ繧定ｿｽ蜉
      const baseMs = Math.round(sub.time * 10);
      for (let i = -5; i <= 5; i++) {
        subTimeSet.add(baseMs + i);
      }
    });

    // sub豁瑚ｩ槭→譎る俣縺瑚｢ｫ繧九Γ繧､繝ｳ豁瑚ｩ槭ｒ髯､螟悶☆繧・
    // 縺ｾ縺溘・勁螟悶＆繧後◆繝｡繧､繝ｳ豁瑚ｩ槭・繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝励ｒ險倬鹸
    const excludedMainTimes = new Set();
    const filteredMain = (mainLines || []).filter(l => {
      if (typeof l?.time !== 'number') return true;
      // 譎る俣縺瑚ｿ台ｼｼ縺励※縺・ｋ繧ｵ繝匁ｭ瑚ｩ槭′縺ゅｋ縺九メ繧ｧ繝・け
      const keyMs = Math.round(l.time * 10);
      const collision = subTimeSet.has(keyMs);
      if (collision) {
        excludedMainTimes.add(Math.round(l.time * 1000)); // 繝溘Μ遘堤ｲｾ蠎ｦ縺ｧ險倬鹸
      }
      return !collision;
    });
    
    // dynamicLines縺九ｉ繧る勁螟悶＆繧後◆繝｡繧､繝ｳ陦後↓蟇ｾ蠢懊☆繧九ｂ縺ｮ繧帝勁螟・
    // ・医げ繝ｭ繝ｼ繝舌Ν螟画焚dynamicLines繧堤峩謗･螟画峩縺帙★縲√ヵ繧｣繝ｫ繧ｿ逕ｨ縺ｮ繧ｻ繝・ヨ繧剃ｿ晏ｭ假ｼ・
    _duetExcludedTimes = excludedMainTimes;

    _duetExcludedTimes = excludedMainTimes;

    _duetExcludedTimes = excludedMainTimes;

    _duetExcludedTimes = excludedMainTimes;

    const merged = [];
    filteredMain.forEach(l => merged.push({ ...l, duetSide: 'left' }));
    (subLines || []).forEach(l => merged.push({ ...l, duetSide: 'right' }));

    merged.sort((a, b) => {
      const at = (typeof a.time === 'number') ? a.time : Number.POSITIVE_INFINITY;
      const bt = (typeof b.time === 'number') ? b.time : Number.POSITIVE_INFINITY;
      
      // 譎る俣縺後⊇縺ｼ蜷後§蝣ｴ蜷医・縲´eft(繝｡繧､繝ｳ) -> Right(繧ｵ繝・ 縺ｮ鬆・↓荳ｦ縺ｹ繧・
      if (Math.abs(at - bt) < 0.05) {
        const ap = a.duetSide === 'right' ? 1 : 0;
        const bp = b.duetSide === 'right' ? 1 : 0;
        return ap - bp;
      }
      return at - bt;
    });

    return merged;
  };

  const mergeDuetLinesWithSimultaneousSupport = (mainLines, subLines) => {
    const subLinesWithTime = (subLines || []).filter(l => typeof l?.time === 'number');
    const excludedMainTimes = new Set();

    // Dynamic LRC・・譁・ｭ怜酔譛滂ｼ峨′縺ゅｋ蝣ｴ蜷医・5遘偵・險ｱ螳ｹ蟷・蜀・ｮｹ荳閾ｴ縺ｧ驥崎､・愛螳・
    // 騾壼ｸｸLRC縺ｯ繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝励′邊ｾ遒ｺ縺ｪ縺ｮ縺ｧ螳悟・荳閾ｴ・・AME_TIMESTAMP_TOLERANCE=0.05s・峨・縺ｿ驥崎､・→縺ｿ縺ｪ縺・
    const hasDynamicLrc = Array.isArray(dynamicLines) && dynamicLines.length > 0;
    const dedupeTimeTolerance = hasDynamicLrc ? 5.0 : SAME_TIMESTAMP_TOLERANCE;

    const filteredMain = (mainLines || []).filter((mainLine) => {
      if (typeof mainLine?.time !== 'number') return true;

      const mainText = normalizeLyricCompareTextStrict(mainLine.text);
      if (!mainText) return true;

      // dedupeTimeTolerance莉･蜀・・繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝怜ｷｮ縺九▽蜷御ｸ繝・く繧ｹ繝医・繧ｵ繝冶｡後′縺ゅｌ縺ｰ驥崎､・→縺ｿ縺ｪ縺励※繝｡繧､繝ｳ陦後ｒ髯､螟・
      const duplicateSub = subLinesWithTime.find((subLine) => {
        if (!isSameTimestamp(mainLine.time, subLine.time, dedupeTimeTolerance)) return false;
        const subText = normalizeLyricCompareTextStrict(subLine.text);
        return !!subText && scoreLyricTextMatch(mainText, subText) >= 100;
      });
      if (duplicateSub) {
        excludedMainTimes.add(Math.round(mainLine.time * 1000));
        return false;
      }
      return true;
    });

    const merged = [];
    filteredMain.forEach(l => merged.push({ ...l, duetSide: 'left' }));
    (subLines || []).forEach(l => merged.push({ ...l, duetSide: 'right' }));

    merged.sort((a, b) => {
      const at = (typeof a.time === 'number') ? a.time : Number.POSITIVE_INFINITY;
      const bt = (typeof b.time === 'number') ? b.time : Number.POSITIVE_INFINITY;

      if (isSameTimestamp(at, bt)) {
        const ap = a.duetSide === 'right' ? 1 : 0;
        const bp = b.duetSide === 'right' ? 1 : 0;
        return ap - bp;
      }
      return at - bt;
    });

    const deduped = [];
    for (const line of merged) {
      const duplicateIdx = findCrossSideDuplicateIndex(deduped, line);
      const prev = duplicateIdx >= 0 ? deduped[duplicateIdx] : null;
      if (duplicateIdx >= 0) {
        deduped[duplicateIdx] = preferDuplicateMainLine(prev, line);
        continue;
      }
      if (duplicateIdx >= 0) {
        deduped[duplicateIdx] = preferDuplicateMainLine(prev, line);
        continue;
      }

      if (duplicateIdx >= 0) {
        // 蜷悟・螳ｹ縺ｮ驥崎､・□縺題誠縺ｨ縺吶ょ挨豁瑚ｩ槭・蜷梧凾騾ｲ陦後・谿九☆縲・
        if (prev?.duetSide === 'left' && line?.duetSide === 'right') {
          deduped[duplicateIdx] = preferDuplicateMainLine(prev, line);
        }
        continue;
      }

      deduped.push(line);
    }

    return deduped;
  };

  const collapseCrossSideDuplicateLyrics = (lines) => {
    if (!Array.isArray(lines) || !lines.length) return Array.isArray(lines) ? lines : [];

    const deduped = [];
    for (const line of lines) {
      const duplicateIdx = findCrossSideDuplicateIndex(deduped, line);
      const prev = duplicateIdx >= 0 ? deduped[duplicateIdx] : null;

      if (duplicateIdx >= 0) {
        deduped[duplicateIdx] = preferDuplicateMainLine(prev, line);
        continue;
      }

      deduped.push(line);
    }

    return deduped;
  };

  const getDynamicLineForTime = (sec) => {
    if (!dynamicLines || !Array.isArray(dynamicLines) || !dynamicLines.length) return null;
    
    // 繝・Η繧ｨ繝・ヨ繝｢繝ｼ繝峨〒髯､螟悶＆繧後◆繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝励°繝√ぉ繝・け
    const isDuetMode = document.body.classList.contains('ytm-duet-mode');
    if (isDuetMode && _duetExcludedTimes && _duetExcludedTimes.size > 0) {
      const secMs = Math.round(sec * 1000);
      // 險ｱ螳ｹ隱､蟾ｮ50ms莉･蜀・〒髯､螟悶＆繧後◆繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝励ｒ繝√ぉ繝・け
      for (let offset = -50; offset <= 50; offset += 10) {
        if (_duetExcludedTimes.has(secMs + offset)) {
          return null; // 縺薙・繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝励・sub.txt縺ｧ荳頑嶌縺阪＆繧後※縺・ｋ縺ｮ縺ｧ辟｡隕・
        }
      }
    }

    // 繝槭ャ繝励く繝｣繝・す繝･縺ｮ蜀肴ｧ狗ｯ会ｼ亥盾辣ｧ縺悟､峨ｏ縺｣縺滓凾縺ｮ縺ｿ・・
    if (_dynMapSrc !== dynamicLines) {
      _dynMapSrc = dynamicLines;
      _dynMap = new Map();

      dynamicLines.forEach(dl => {
        let ms = null;
        if (typeof dl?.startTimeMs === 'number') {
          ms = dl.startTimeMs;
        } else if (typeof dl?.startTimeMs === 'string') {
          const n = Number(dl.startTimeMs);
          if (!Number.isNaN(n)) ms = n;
        } else if (Array.isArray(dl?.chars) && dl.chars.length) {
          const ts = dl.chars.map(c => (typeof c?.t === 'number' ? c.t : null)).filter(v => v != null);
          if (ts.length) ms = Math.min(...ts);
        }

        if (typeof ms === 'number') {
          _dynMap.set(timeKey(ms / 1000), dl);
        }
      });
    }

    // 1. 螳悟・荳閾ｴ繝医Λ繧､
    const exact = _dynMap?.get(timeKey(sec));
    if (exact) return exact;

    // 2. 霑台ｼｼ蛟､繝医Λ繧､ (蜑榊ｾ・.15遘・
    const TOLERANCE = 0.15;
    const found = dynamicLines.find(dl => {
       let startS = 0;
       if (typeof dl.startTimeMs === 'number') startS = dl.startTimeMs / 1000;
       else if (dl.time) startS = dl.time;
       return Math.abs(startS - sec) <= TOLERANCE;
    });

    return found || null;
  };

  // 繧ｵ繝悶・繝ｼ繧ｫ繝ｫ逕ｨ縺ｮdynamicLine蜿門ｾ暦ｼ・ub.txt縺ｮDynamic.lrc蟇ｾ蠢懶ｼ・
  let _subDynMapSrc = null;
  let _subDynMap = null;
  
  const getSubDynamicLineForTime = (sec) => {
    if (!duetSubDynamicLines || !Array.isArray(duetSubDynamicLines) || !duetSubDynamicLines.length) return null;
    
    // 繝槭ャ繝励く繝｣繝・す繝･縺ｮ蜀肴ｧ狗ｯ会ｼ亥盾辣ｧ縺悟､峨ｏ縺｣縺滓凾縺ｮ縺ｿ・・
    if (_subDynMapSrc !== duetSubDynamicLines) {
      _subDynMapSrc = duetSubDynamicLines;
      _subDynMap = new Map();

      duetSubDynamicLines.forEach(dl => {
        let ms = null;
        if (typeof dl?.startTimeMs === 'number') {
          ms = dl.startTimeMs;
        } else if (typeof dl?.startTimeMs === 'string') {
          const n = Number(dl.startTimeMs);
          if (!Number.isNaN(n)) ms = n;
        } else if (Array.isArray(dl?.chars) && dl.chars.length) {
          const ts = dl.chars.map(c => (typeof c?.t === 'number' ? c.t : null)).filter(v => v != null);
          if (ts.length) ms = Math.min(...ts);
        }

        if (typeof ms === 'number') {
          _subDynMap.set(timeKey(ms / 1000), dl);
        }
      });
    }

    // 1. 螳悟・荳閾ｴ繝医Λ繧､
    const exact = _subDynMap?.get(timeKey(sec));
    if (exact) return exact;

    // 2. 霑台ｼｼ蛟､繝医Λ繧､ (蜑榊ｾ・.15遘・
    const TOLERANCE = 0.15;
    const found = duetSubDynamicLines.find(dl => {
       let startS = 0;
       if (typeof dl.startTimeMs === 'number') startS = dl.startTimeMs / 1000;
       else if (dl.time) startS = dl.time;
       return Math.abs(startS - sec) <= TOLERANCE;
    });

    return found || null;
  };
  function setupMovieMode() {
    const resizeObserver = new ResizeObserver(() => {
      window.dispatchEvent(new Event('resize'));
    });
    const targetWrapper = document.getElementById("ytm-custom-wrapper");
    if (targetWrapper) {
      resizeObserver.observe(targetWrapper);
    } else {
      resizeObserver.observe(document.body);
    }
    
    const check = () => {
      const video = document.querySelector("ytmusic-player#player.style-scope.ytmusic-player-page");
      const target = document.querySelector("#ytm-custom-wrapper");
      const switcher = document.querySelector("ytmusic-av-toggle");
      const switcherTarget = document.querySelector("#ytm-custom-info-area");

      if (!video || !target || !switcher || !switcherTarget) {
        setTimeout(check, 300);
        return;
      }

      movieObserver = observerMovieModeSetup();
    };
    check();
  };
  function bringSwitcherOnly(){
    const switcher = document.querySelector("ytmusic-av-toggle");
    const customSwitcherParent = document.querySelector("#ytm-custom-info-area");
    customSwitcherParent.appendChild(switcher);
  }
  function changeIModeUIWithMovieMode(mode) {
    if (!mode) {
      moviemode = null;
      if (movieObserver) movieObserver.stop();
      movieObserver = null;
      const switcher = document.querySelector("ytmusic-av-toggle");
      const video = document.querySelector("ytmusic-player#player");
      const originParent = document.querySelector("div#main-panel");
      const originSwitcherTarget = originParent.children[1];
      const originTarget = originParent.children[2];
      if (!originParent.contains(video)) {
        originParent.insertBefore(video, originTarget);
      }
      if (!originParent.contains(switcher)) {
        originSwitcherTarget.appendChild(switcher);
      }
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 300);
    }
    else {
      if (movieObserver) movieObserver.stop();
      movieObserver = null;
      movieObserver = observerMovieModeSetup();
    }
  }
  const observerMovieModeSetup = () => {
    const switcher = document.querySelector("ytmusic-av-toggle");
    if (!switcher) return null;

    if (movieObserver) {
      movieObserver.stop();
      movieObserver = null;
    }

    let changed;
    let classTargets = [];

    const handleMutation = () => {
      const mode = switcher.getAttribute("playback-mode");
      const newMoviemode = (mode === "OMV_PREFERRED") ? true : false;

      if (moviemode !== newMoviemode) {
        changed = true;
      } else {
        changed = false;
      }

      moviemode = newMoviemode;

      classTargets = [];
      const wrapper = document.querySelector("#ytm-custom-wrapper");
      if (wrapper instanceof Element) {
        classTargets.push(...wrapper.querySelectorAll("*"));
      }
      const pusher = (element) => {
        if (element instanceof Element) classTargets.push(element);
      };
      const playerBar = document.querySelector("ytmusic-player-bar");
      pusher(playerBar);
      pusher(switcher);
      const video = document.querySelector("ytmusic-player#player");
      pusher(video);
      const navBar = document.querySelector("ytmusic-nav-bar");
      pusher(navBar);

      classTargets.forEach(element => {
        if (moviemode) {
          element.classList.add("moviemode");
        } else {
          element.classList.remove("moviemode");
        }
      });

      changeUIWithMovieMode(changed);
    };

    handleMutation();
    bringSwitcherOnly();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "playback-mode") {
          handleMutation();
        }
      });
    });

    observer.observe(switcher, { attributes: true });

    movieObserver = {
      stop: () => {
        observer.disconnect();
        movieObserver = null;
      }
    };

    return movieObserver;
  };
  function changeUIWithMovieMode(changed) {
    if (!changed || changed === null) return;
    const originParent = document.querySelector("div#main-panel");
    const originTarget = originParent.children[2];
    const customParent = document.querySelector("#ytm-custom-wrapper");
    const customSwitcherParent = document.querySelector("#ytm-custom-info-area");
    const switcher = document.querySelector("ytmusic-av-toggle");
    const video = document.querySelector("ytmusic-player#player.style-scope.ytmusic-player-page");

    if (moviemode) {
      customParent.prepend(video);
      customSwitcherParent.appendChild(switcher);
    }
    else {
      if (!originParent.contains(video)) {
        originParent.insertBefore(video, originTarget);
      }
    }
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 100);
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 300);
  }
  function isYTMPremiumUser() {
    const switcher = document.querySelector("ytmusic-av-toggle");
    const requireSignIn = !!document.querySelector('ytmusic-guide-signin-promo-renderer');
    const primarySection = document.querySelector('#mini-guide ytmusic-guide-section-renderer[is-primary] div#items');
    const notPremium = primarySection ? primarySection.childNodes.length >= 4 : false;
    if(!requireSignIn && !notPremium){
      if(switcher) switcher.classList.remove('notpremium');
    }
    else {
      if(switcher) switcher.classList.add('notpremium');
    }
    return !requireSignIn || !notPremium;
  }

  function preferLyricsDefault(targetKey, attempt = 0) {
    if (!targetKey || currentKey !== targetKey) return;

    const switcher = document.querySelector("ytmusic-av-toggle");
    if (!switcher) {
      if (attempt < 10) setTimeout(() => preferLyricsDefault(targetKey, attempt + 1), 300);
      return;
    }

    const mode = switcher.getAttribute("playback-mode");
    if (mode === "ATV_PREFERRED") return;
    if (mode && mode !== "OMV_PREFERRED") return;

    const songBtn = switcher.querySelector('.song-button.ytmusic-av-toggle, .song-button');
    if (!songBtn) {
      if (attempt < 10) setTimeout(() => preferLyricsDefault(targetKey, attempt + 1), 300);
      return;
    }

    try {
      songBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
      if (typeof songBtn.click === 'function') songBtn.click();
    } catch (e) {
      console.warn('Failed to switch default playback mode to lyrics', e);
    }

    if (attempt < 10) {
      setTimeout(() => {
        if (currentKey !== targetKey) return;
        const latestMode = switcher.getAttribute("playback-mode");
        if (latestMode !== "ATV_PREFERRED") {
          preferLyricsDefault(targetKey, attempt + 1);
        }
      }, 250);
    }
  }
  const hoverTimeInfoSetup = () => {
    const timeToSeconds = (str) => {
      const [m, s] = str.split(":").map(Number);
      return m * 60 + s;
    };
    const removeHoverTimeInfo = () => {
      const info = document.querySelector('#hover-time-info');
      const interval = setInterval(() => {
        if (info) {
          info.remove();
          clearInterval(interval);
        }
      }, 1000);
    };
    const createHoverTimeInfo = () => {
      let info = document.querySelector('#hover-time-info-new');
      const parent = document.querySelector('ytmusic-player-bar');
      if (!info) {
        info = document.createElement('span');
        info.id = 'hover-time-info-new';
        info.style.display = 'none';
        info.textContent = '0:00';
        document.body.appendChild(info);
      }
    };
    const adjustHoverTimeInfoPosition = () => {
      const progresshandle = document.querySelector('tp-yt-paper-slider#progress-bar #sliderKnob');
      const info = document.querySelector('#hover-time-info-new');
      const slider = document.querySelector(
        'tp-yt-paper-slider#progress-bar tp-yt-paper-progress#sliderBar #primaryProgress'
      ).parentElement.parentElement;
      const playerBar = document.querySelector('ytmusic-player-bar');
      const refresh = () => {
        const onMove = (e) => {
          const marginLeft = (playerBar.parentElement.offsetWidth - playerBar.offsetWidth) / 2;
          const infoLeft = e.clientX;
          const relativeMouseX = e.clientX - marginLeft;
          const timeinfo = document.querySelector('#left-controls > span');
          const songLengthSeconds = timeToSeconds(timeinfo.textContent.replace(/^[^/]+\/\s*/, ""));
          const relativePosition = Math.round((Math.min(1, Math.max(0, (relativeMouseX / slider.offsetWidth)))) * 1000) / 1000;
          const hoverTimeSeconds = Math.floor(songLengthSeconds * relativePosition);
          const hoverTimeString = `${String(Math.floor(hoverTimeSeconds / 60))}:${String(hoverTimeSeconds % 60).padStart(2, '0')}`;
          info.style.display = 'block';
          info.style.left = `${infoLeft}px`;
          info.textContent = hoverTimeString;
        };
        const hide = () => {
          info.style.display = 'none';
        };
        slider.addEventListener('mousemove', onMove);
        slider.addEventListener('mouseout', hide);
        progresshandle.addEventListener('mousemove', onMove);
        progresshandle.addEventListener('mouseout', hide);
      };
      const interval = setInterval(() => {
        if (slider && info && progresshandle) {
          refresh();
          clearInterval(interval);
        }
      }, 1000);
    };
    removeHoverTimeInfo();
    createHoverTimeInfo();
    adjustHoverTimeInfoPosition();
  };

  const parseLRCNoFlag = (lrc) => {
    return parseLRCInternal(lrc).lines;
  };

  const getMetadata = () => {
    // Prefer MediaSession metadata (most accurate)
    if (navigator.mediaSession?.metadata) {
      const { title, artist, album, artwork } = navigator.mediaSession.metadata;
      return {
        title: (title || '').toString(),
        artist: (artist || '').toString(),
        album: (album || '').toString(),
        src: Array.isArray(artwork) && artwork.length ? artwork[artwork.length - 1].src : null
      };
    }

    // Fallback: read from player bar
    const tEl = document.querySelector('yt-formatted-string.title.style-scope.ytmusic-player-bar');
    const aEl = document.querySelector('.byline.style-scope.ytmusic-player-bar');
    if (!(tEl && aEl)) return null;

    const parts = (aEl.textContent || '')
      .split('窶｢')
      .map(s => (s || '').trim())
      .filter(Boolean);

    return {
      title: (tEl.textContent || '').trim(),
      artist: parts[0] || '',
      album: parts[1] || '',
      src: null
    };
  };


  const getCurrentVideoUrl = () => {
    try {
      const url = new URL(location.href);
      const vid = url.searchParams.get('v');
      return vid ? `https://youtu.be/${vid}` : location.href;
    } catch (e) {
      console.warn('Failed to get current video url', e);
      return '';
    }
  };

  const getCurrentVideoId = () => {
    try {
      const url = new URL(location.href);
      return url.searchParams.get('v');
    } catch (e) {
      return null;
    }
  };

  // === BG 縺九ｉ縺ｮ蠕瑚ｿｽ縺・Γ繧ｿ譖ｴ譁ｰ・磯≦縺・婿蠕・■繧偵ｄ繧√◆譎ら畑・・==
  // GitHub 縺ｧ蜈医↓豁瑚ｩ槭□縺題ｿ斐▲縺ｦ縺阪◆蠕後↓縲´RCHub 蛛ｴ縺ｮ candidates/config/requests 縺梧擂縺溘ｉ UI 繧呈峩譁ｰ縺吶ｋ
  chrome.runtime.onMessage.addListener((msg) => {
    try {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type !== 'LYRICS_META_UPDATE') return;
      const p = msg.payload || {};
      const curVid = getCurrentVideoId();
      if (p.video_id && curVid && p.video_id !== curVid) return;

      if (Array.isArray(p.candidates)) lyricsCandidates = p.candidates;
      if (p.config !== undefined) lyricsConfig = p.config;
      if (Array.isArray(p.requests)) lyricsRequests = p.requests;
      syncLyricsLockState();

      // duet: sub lyrics can arrive later (GitHub)
      if (typeof p.subLyrics === 'string') {
        duetSubLyricsRaw = p.subLyrics;
        // re-render with same raw lyrics to avoid showing duplicate left+right lines
        if (lastRawLyricsText && typeof lastRawLyricsText === 'string') {
          applyLyricsText(lastRawLyricsText);
        }
      }

      // dynamic: char-timed lines can arrive later (GitHub) even if lyrics came from API
      if (Array.isArray(p.dynamicLines) && p.dynamicLines.length) {
        dynamicLines = p.dynamicLines;
        // re-render to attach per-char spans while keeping current lines
        if (Array.isArray(lyricsData) && lyricsData.length) {
          renderLyrics(lyricsData);
        }
      }

      // candidates/config 縺梧峩譁ｰ縺輔ｌ縺溘ｉ繝｡繝九Η繝ｼ繧貞・謠冗判

      refreshCandidateMenu();
      refreshLockMenu();
    } catch (e) {
      // ignore
    }
  });

  const createEl = (tag, id, cls, html) => {
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (cls) el.className = cls;
    if (html !== undefined && html !== null) el.innerHTML = html;
    return el;
  };

  const showToast = (text) => {
    if (!text) return;
    let el = document.getElementById('ytm-toast');
    if (!el) {
      el = createEl('div', 'ytm-toast', '', '');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('visible');
    }, 5000);
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  function setupAutoHideEvents() {
    if (document.body.dataset.autohideSetup) return;
    ['mousemove', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, handleInteraction));
    document.body.dataset.autohideSetup = 'true';
    handleInteraction();
  }
  

  // ===================== 豁瑚ｩ橸ｼ狗ｿｻ險ｳ驕ｩ逕ｨ =====================

  // ===================== Dynamic line post-processing =====================
  // Some providers return Dynamic lyrics in "word chunks" (e.g. each char item is a whole word).
  // We normalize them into true character-level timings by distributing each chunk's duration
  // across its characters (1 char at a time).
  function normalizeDynamicLinesToCharLevel(dynLines) {
    if (!Array.isArray(dynLines) || dynLines.length === 0) return dynLines;

    const toMs = (v) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return null;
    };

    const getLineStartMs = (line) => {
      if (!line) return null;
      return toMs(line.startTimeMs) ?? toMs(line.time) ?? null;
    };

    const getCharStartMs = (ch) => {
      if (!ch) return null;
      return toMs(ch.t) ?? toMs(ch.time) ?? toMs(ch.startTimeMs) ?? null;
    };

    const isWordChunk = (s) => {
      if (typeof s !== 'string') return false;
      // Use Array.from to be Unicode-safe (emoji etc.)
      return Array.from(s).length > 1;
    };

    const expandChunk = (chunkText, startMs, endMs) => {
      const arr = Array.from(String(chunkText ?? ''));
      const n = arr.length;
      if (!n) return [];
      const s = (typeof startMs === 'number' && Number.isFinite(startMs)) ? startMs : null;
      const e = (typeof endMs === 'number' && Number.isFinite(endMs)) ? endMs : null;

      // If we can't determine timing, emit all at 0 (will appear immediately when line becomes active)
      if (s == null) return arr.map(c => ({ t: 0, c }));

      if (e == null || e <= s) return arr.map(c => ({ t: s, c }));

      const dur = Math.max(1, e - s);
      const step = dur / n;
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push({ t: s + Math.floor(step * i), c: arr[i] });
      }
      return out;
    };

    for (let li = 0; li < dynLines.length; li++) {
      const line = dynLines[li];
      if (!line || !Array.isArray(line.chars) || line.chars.length === 0) continue;

      // detect if any "char" item is actually a multi-character chunk (word)
      const hasChunk = line.chars.some(ch => isWordChunk(ch?.c));
      if (!hasChunk) continue;

      const nextLineStartMs = (li + 1 < dynLines.length) ? getLineStartMs(dynLines[li + 1]) : null;
      const lineStartMs = getLineStartMs(line) ?? getCharStartMs(line.chars[0]) ?? 0;

      // Build expanded character list
      const expanded = [];
      for (let i = 0; i < line.chars.length; i++) {
        const seg = line.chars[i];
        const segText = (seg && typeof seg.c === 'string') ? seg.c : '';
        const segStart = getCharStartMs(seg) ?? lineStartMs;

        // End bound is next segment's start, else next line, else a small fallback window
        let segEnd = (i + 1 < line.chars.length) ? getCharStartMs(line.chars[i + 1]) : null;
        if (segEnd == null) segEnd = toMs(line.endTimeMs) ?? nextLineStartMs ?? (segStart + 1500);
        if (typeof segEnd === 'number' && segEnd <= segStart) segEnd = segStart + 200;

        // Even if segText is already single "character", keep it as-is
        const segArr = Array.from(String(segText));
        if (segArr.length <= 1) {
          if (segArr.length === 1) expanded.push({ t: segStart, c: segArr[0] });
          continue;
        }

        expanded.push(...expandChunk(segText, segStart, segEnd));
      }

      // Replace with normalized chars
      line.chars = expanded;
      // Update line text if missing or mismatched
      try {
        const rebuilt = expanded.map(x => x.c).join('');
        if (typeof line.text !== 'string' || line.text.length === 0) line.text = rebuilt;
      } catch (e) { }

      // Ensure startTimeMs exists
      if (typeof line.startTimeMs !== 'number' || !Number.isFinite(line.startTimeMs)) {
        const firstT = expanded.length ? expanded[0].t : lineStartMs;
        line.startTimeMs = firstT;
      }
    }

    return dynLines;
  }

async function applyLyricsText(rawLyrics) {
    const keyAtStart = currentKey;
    if (!rawLyrics || typeof rawLyrics !== 'string' || !rawLyrics.trim()) {
      if (keyAtStart !== currentKey) return;
      lyricsData = [];
      hasTimestamp = false;
      renderLyrics([]);
      return;
    }
    lastRawLyricsText = rawLyrics;
    let parsed = parseBaseLRC(rawLyrics);

    // duet: if sub.txt exists, hide (filter) the normal lines that match sub timestamps,
    // and render the sub lines on the right.
    let baseLines = parsed;
    let hasDuetSub = false;
    
    // 繝・Η繧ｨ繝・ヨ繝｢繝ｼ繝峨・繝ｪ繧ｻ繝・ヨ・・ub.txt縺後↑縺・ｴ蜷医・髯､螟悶ち繧､繝繧ｹ繧ｿ繝ｳ繝励ｂ繧ｯ繝ｪ繧｢・・
    _duetExcludedTimes = new Set();
    
    if (typeof duetSubLyricsRaw === 'string' && duetSubLyricsRaw.trim()) {
      const subObj = parseSubLRC(duetSubLyricsRaw);
      const subLines = subObj.lines || [];
      hasDuetSub = !!subObj.hasTs && subLines.some(l => typeof l?.time === 'number');
      if (hasDuetSub) {
        // even if the main lyrics didn't have tags, duet sub implies timestamp mode
        hasTimestamp = true;
        baseLines = mergeDuetLinesWithSimultaneousSupport(parsed, subLines);
      }
    }
    document.body.classList.toggle('ytm-duet-mode', hasDuetSub);

    let finalLines = baseLines;
    if (keyAtStart !== currentKey) return;

    finalLines = collapseCrossSideDuplicateLyrics(finalLines);

    // Normalize Dynamic lyrics: expand "word chunks" into character-level timings
    try {
      if (Array.isArray(dynamicLines) && dynamicLines.length) {
        dynamicLines = normalizeDynamicLinesToCharLevel(dynamicLines);
      }
    } catch (e) { }

    lyricsData = finalLines;
    renderLyrics(finalLines);
  }

  // ===================== 豁瑚ｩ槫呵｣懊・繝ｭ繝・け髢｢騾｣ =====================

  const getCandidateId = (cand, idx = 0) => {
    if (!cand || typeof cand !== 'object') return String(idx);
    return String(cand.id || cand.candidate_id || cand.path || cand.file || cand.filename || cand.name || cand.title || idx);
  };

  const buildCandidateLabel = (cand, idx = 0) => {
    if (!cand || typeof cand !== 'object') return `蛟呵｣・{idx + 1}`;

    const rawName = (
      cand.file ||
      cand.filename ||
      cand.name ||
      cand.path ||
      cand.select ||
      cand.list ||
      cand.candidate_id ||
      cand.id ||
      ''
    );

    const normalized = String(rawName || '').trim().replace(/\\/g, '/');
    const labelText = normalized ? normalized.split('/').pop() : `蛟呵｣・{idx + 1}`;
    return labelText;
  };

  const safeRuntimeSendMessage = (message) => {
    return new Promise((resolve) => {
      try {
        if (!EXT || !EXT.runtime || typeof EXT.runtime.sendMessage !== 'function') {
          resolve(null);
          return;
        }
        EXT.runtime.sendMessage(message, (resp) => {
          const err = EXT.runtime && EXT.runtime.lastError ? EXT.runtime.lastError : null;
          if (err) {
            console.warn('[CS] runtime.sendMessage failed:', err.message || err);
            resolve({ success: false, error: err.message || String(err) });
            return;
          }
          resolve(resp || null);
        });
      } catch (e) {
        console.warn('[CS] runtime.sendMessage exception:', e);
        resolve({ success: false, error: String(e) });
      }
    });
  };

  const formatPreviewTime = (seconds) => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '--:--';
    const total = Math.max(0, Math.floor(seconds));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  const getCurrentPlaybackSeconds = () => {
    try {
      const v = document.querySelector('video');
      if (v && Number.isFinite(v.currentTime)) return v.currentTime;
    } catch (e) { }
    return null;
  };

  const getCurrentRenderedLyricText = () => {
    if (lastActiveIndex >= 0 && Array.isArray(lyricsData) && lyricsData[lastActiveIndex]) {
      const line = lyricsData[lastActiveIndex];
      const txt = String(line.text || line.rawLine || '').trim();
      if (txt) return txt;
    }
    try {
      const activeRow = ui.lyrics ? ui.lyrics.querySelector('.lyric-line.active .lyric-main, .lyric-line.active') : null;
      return activeRow && activeRow.textContent ? activeRow.textContent.trim() : '';
    } catch (e) {
      return '';
    }
  };

  const getCurrentRenderedLyricIndex = () => {
    if (!Array.isArray(lyricsData) || !lyricsData.length) return -1;
    if (Number.isInteger(lastActiveIndex) && lastActiveIndex >= 0) {
      let nonEmptyIndex = -1;
      for (let i = 0; i <= Math.min(lastActiveIndex, lyricsData.length - 1); i++) {
        const txt = String(lyricsData[i]?.text || lyricsData[i]?.rawLine || '').trim();
        if (txt) nonEmptyIndex += 1;
      }
      return nonEmptyIndex;
    }
    return -1;
  };

  const pickPreviewInfoFromLyrics = (rawLyrics) => {
    const txt = typeof rawLyrics === 'string' ? rawLyrics.trim() : '';
    if (!txt) return { line: '', mode: 'empty', lineIndex: -1, total: 0 };

    const parsed = parseLRCNoFlag(txt);
    const nonEmpty = Array.isArray(parsed)
      ? parsed.filter(line => line && typeof line.text === 'string' && line.text.trim())
      : [];

    if (!nonEmpty.length) {
      const plain = txt.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!plain.length) return { line: '', mode: 'empty', lineIndex: -1, total: 0 };
      return { line: plain[0], mode: 'plain-first', lineIndex: 0, total: plain.length };
    }

    const currentSeconds = getCurrentPlaybackSeconds();
    const hasTs = nonEmpty.some(line => typeof line.time === 'number' && Number.isFinite(line.time));

    if (hasTs && typeof currentSeconds === 'number') {
      let foundIndex = 0;
      for (let i = 0; i < nonEmpty.length; i++) {
        const t = nonEmpty[i] && typeof nonEmpty[i].time === 'number' ? nonEmpty[i].time : null;
        if (t == null) continue;
        if (t > currentSeconds) break;
        foundIndex = i;
      }
      return {
        line: String(nonEmpty[foundIndex].text || '').trim(),
        mode: 'timestamp',
        lineIndex: foundIndex,
        total: nonEmpty.length
      };
    }

    const currentLineIndex = getCurrentRenderedLyricIndex();
    if (currentLineIndex >= 0) {
      const idx = Math.max(0, Math.min(currentLineIndex, nonEmpty.length - 1));
      return {
        line: String(nonEmpty[idx].text || '').trim(),
        mode: 'current-line-index',
        lineIndex: idx,
        total: nonEmpty.length
      };
    }

    try {
      const v = document.querySelector('video');
      if (v && Number.isFinite(v.currentTime) && Number.isFinite(v.duration) && v.duration > 0) {
        const ratio = Math.max(0, Math.min(1, v.currentTime / v.duration));
        const idx = Math.max(0, Math.min(nonEmpty.length - 1, Math.round((nonEmpty.length - 1) * ratio)));
        return {
          line: String(nonEmpty[idx].text || '').trim(),
          mode: 'progress-ratio',
          lineIndex: idx,
          total: nonEmpty.length
        };
      }
    } catch (e) { }

    return {
      line: String(nonEmpty[0].text || '').trim(),
      mode: 'plain-first',
      lineIndex: 0,
      total: nonEmpty.length
    };
  };

  async function ensureCandidateLyricsLoaded(candId) {
    if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) return null;
    const idx = lyricsCandidates.findIndex((cand, i) => getCandidateId(cand, i) === String(candId));
    if (idx < 0) return null;
    const cand = lyricsCandidates[idx];
    if (cand && typeof cand.lyrics === 'string' && cand.lyrics.trim()) return cand;

    const payload = {
      youtube_url: getCurrentVideoUrl(),
      video_id: getCurrentVideoId(),
      candidate_id: getCandidateId(cand, idx),
      candidate: cand || null
    };
    console.log('[CS] GET_CANDIDATE_LYRICS request:', payload);
    const res = await safeRuntimeSendMessage({ type: 'GET_CANDIDATE_LYRICS', payload });
    console.log('[CS] GET_CANDIDATE_LYRICS response:', res);
    if (res && res.success && typeof res.lyrics === 'string' && res.lyrics.trim()) {
      const next = {
        ...(cand || {}),
        lyrics: res.lyrics,
        has_synced: typeof res.has_synced === 'boolean' ? res.has_synced : !!/\[\d+:\d{2}(?:\.\d{1,3})?\]/.test(res.lyrics)
      };
      lyricsCandidates[idx] = next;
      return next;
    }
    return cand || null;
  }

  function ensureCandidateHoverPreview() {
    let el = document.getElementById('ytm-candidate-hover-preview');
    const parent = ui.uploadMenu || document.body;
    if (!el) {
      el = document.createElement('div');
      el.id = 'ytm-candidate-hover-preview';
      el.innerHTML = `
        <div class="ytm-candidate-hover-preview-title"></div>
        <div class="ytm-candidate-hover-preview-line"></div>
        <div class="ytm-candidate-hover-preview-meta"></div>
        <div class="ytm-candidate-hover-preview-current"></div>
      `;
      parent.appendChild(el);
    } else if (el.parentElement !== parent) {
      parent.appendChild(el);
    }
    return el;
  }

  function updateCandidateHoverPreviewPosition(clientX, clientY, anchorEl) {
    const el = ensureCandidateHoverPreview();
    if (!el) return;
    if (ui.uploadMenu && el.parentElement === ui.uploadMenu) {
      const menuRect = ui.uploadMenu.getBoundingClientRect();
      const anchorRect = (anchorEl || hoverPreviewAnchorEl || ui.uploadMenu).getBoundingClientRect();
      const height = el.offsetHeight || 180;
      const maxTop = Math.max(8, ui.uploadMenu.offsetHeight - height - 8);
      const desiredTop = Math.max(8, Math.min(maxTop, anchorRect.top - menuRect.top - 8));
      el.style.top = `${desiredTop}px`;
      el.style.left = 'auto';
      el.style.right = `calc(100% + 12px)`;
      return;
    }
    const pad = 18;
    const width = el.offsetWidth || 360;
    const height = el.offsetHeight || 160;
    let left = clientX + pad;
    let top = clientY + pad;
    if (left + width > window.innerWidth - 12) left = Math.max(12, clientX - width - pad);
    if (top + height > window.innerHeight - 12) top = Math.max(12, clientY - height - pad);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function renderCandidateHoverPreview(candId) {
    const el = ensureCandidateHoverPreview();
    if (!el || !candId) return;
    const list = Array.isArray(lyricsCandidates) ? lyricsCandidates : [];
    const idx = list.findIndex((cand, i) => getCandidateId(cand, i) === String(candId));
    if (idx < 0) return;
    const cand = list[idx];
    const titleEl = el.querySelector('.ytm-candidate-hover-preview-title');
    const lineEl = el.querySelector('.ytm-candidate-hover-preview-line');
    const metaEl = el.querySelector('.ytm-candidate-hover-preview-meta');
    const currentEl = el.querySelector('.ytm-candidate-hover-preview-current');
    const info = pickPreviewInfoFromLyrics(cand && cand.lyrics ? cand.lyrics : '');
    const currentLine = getCurrentRenderedLyricText();
    const currentSeconds = getCurrentPlaybackSeconds();

    if (titleEl) titleEl.textContent = buildCandidateLabel(cand, idx);

    if (lineEl) {
      if (info.line) lineEl.textContent = info.line;
      else if (hoverPreviewLoading) lineEl.textContent = '蛟呵｣懊・豁瑚ｩ槭ョ繝ｼ繧ｿ繧定ｪｭ縺ｿ霎ｼ縺ｿ荳ｭ...';
      else lineEl.textContent = '縺薙・蛟呵｣懊・豁瑚ｩ槭ョ繝ｼ繧ｿ繧定｡ｨ遉ｺ縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆';
    }

    if (metaEl) {
      const parts = [];
      if (typeof currentSeconds === 'number') parts.push(`蜀咲函菴咲ｽｮ ${formatPreviewTime(currentSeconds)}`);
      if (info.total > 0 && info.lineIndex >= 0) parts.push(`陦・${info.lineIndex + 1}/${info.total}`);
      if (info.mode === 'timestamp') parts.push('蛟呵｣懆・霄ｫ縺ｮ蜷梧悄菴咲ｽｮ');
      else if (info.mode === 'current-line-index') parts.push('current line');
      else if (info.mode === 'progress-ratio') parts.push('playback position');
      else if (info.mode === 'plain-first') parts.push('蜈磯ｭ陦後ｒ陦ｨ遉ｺ');
      metaEl.textContent = parts.join(' / ');
    }

    if (currentEl) {
      currentEl.textContent = currentLine ? `迴ｾ蝨ｨ陦ｨ遉ｺ荳ｭ: ${currentLine}` : '';
    }

    updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY);
    el.classList.add('visible');
  }

  function startCandidateHoverPreviewLoop() {
    if (hoverPreviewRafId) return;
    const tick = () => {
      if (!hoverPreviewCandidateId) {
        hoverPreviewRafId = null;
        return;
      }
      renderCandidateHoverPreview(hoverPreviewCandidateId);
      hoverPreviewRafId = requestAnimationFrame(tick);
    };
    hoverPreviewRafId = requestAnimationFrame(tick);
  }

  async function showCandidateHoverPreview(candId, ev) {
    if (!candId) return;
    hoverPreviewCandidateId = candId;
    hoverPreviewAnchorEl = ev?.currentTarget || ev?.target?.closest?.('.ytm-upload-menu-item-candidate') || hoverPreviewAnchorEl;
    hoverPreviewMouseX = ev?.clientX ?? hoverPreviewMouseX;
    hoverPreviewMouseY = ev?.clientY ?? hoverPreviewMouseY;
    hoverPreviewLoading = true;
    console.log('[CS] hover preview start:', candId);
    const el = ensureCandidateHoverPreview();
    if (el) {
      renderCandidateHoverPreview(candId);
      updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY, hoverPreviewAnchorEl);
      el.classList.add('visible');
    }
    startCandidateHoverPreviewLoop();
    const cand = await ensureCandidateLyricsLoaded(candId);
    if (hoverPreviewCandidateId !== candId) return;
    hoverPreviewLoading = false;
    renderCandidateHoverPreview(candId);
  }

  function hideCandidateHoverPreview() {
    hoverPreviewCandidateId = null;
    hoverPreviewLoading = false;
    hoverPreviewAnchorEl = null;
    if (hoverPreviewRafId) {
      cancelAnimationFrame(hoverPreviewRafId);
      hoverPreviewRafId = null;
    }
    const el = document.getElementById('ytm-candidate-hover-preview');
    if (el) el.classList.remove('visible');
  }

  async function selectCandidateById(candId) {
    if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) return;
    let cand = lyricsCandidates.find((c, idx) => getCandidateId(c, idx) === String(candId));
    if (!cand) return;
    if (!(typeof cand.lyrics === 'string' && cand.lyrics.trim())) {
      cand = await ensureCandidateLyricsLoaded(candId);
    }
    if (!cand || typeof cand.lyrics !== 'string' || !cand.lyrics.trim()) {
      showToast('縺薙・蛟呵｣懊・豁瑚ｩ槭ョ繝ｼ繧ｿ繧定ｪｭ縺ｿ霎ｼ繧√∪縺帙ｓ縺ｧ縺励◆');
      return;
    }
    selectedCandidateId = candId;
    dynamicLines = null;
    duetSubDynamicLines = null;
    _duetExcludedTimes = new Set();
    if (currentKey) {
      storage.set(currentKey, {
        lyrics: cand.lyrics,
        dynamicLines: null,
        noLyrics: false,
        candidateId: cand.id || candId || null
      });
    }
    await applyLyricsText(cand.lyrics);
    const youtube_url = getCurrentVideoUrl();
    const video_id = getCurrentVideoId();
    const candidate_id = cand.id || candId;
    try {
      chrome.runtime.sendMessage(
        { type: 'SELECT_LYRICS_CANDIDATE', payload: { youtube_url, video_id, candidate_id } },
        (res) => console.log('[CS] SELECT_LYRICS_CANDIDATE result:', res)
      );
    } catch (e) {
      console.warn('[CS] SELECT_LYRICS_CANDIDATE failed to send', e);
    }
    const reloadKey = currentKey;
    setTimeout(() => {
      const metaNow = getMetadata();
      if (!metaNow) return;
      const keyNow = `${metaNow.title}///${metaNow.artist}`;
      if (keyNow !== reloadKey) return;
      storage.remove(reloadKey);
      loadLyrics(metaNow);
    }, 10000);
  }

  let lyricsLockState = null;

  function normalizeLockRequestId(req) {
    return String(req?.request || req?.id || '').trim().toLowerCase();
  }

  function inferLockRequestTarget(req) {
    if (!req || typeof req !== 'object') return null;

    const explicit = String(req.target || '').trim().toLowerCase();
    if (explicit === 'sync' || explicit === 'dynamic') return explicit;

    const key = normalizeLockRequestId(req);
    if (key === 'lock_current_sync') return 'sync';
    if (key === 'lock_current_dynamic') return 'dynamic';

    const label = String(req.label || '').toLowerCase();
    if (label.includes('lock dynamic') || label.includes('dynamic') || label.includes('蜍輔￥')) return 'dynamic';
    if (label.includes('lock sync') || label.includes('sync') || label.includes('蜷梧悄') || label.includes('readme')) return 'sync';

    return null;
  }

  function buildLyricsLockState(requests, config, prevState) {
    const prevByRequest = prevState && prevState.byRequest && typeof prevState.byRequest === 'object'
      ? prevState.byRequest
      : {};

    const next = {
      sync: false,
      dynamic: false,
      byRequest: { ...prevByRequest }
    };

    if (Array.isArray(requests)) {
      requests.forEach((req) => {
        if (!req || typeof req !== 'object') return;

        const requestId = normalizeLockRequestId(req);
        const target = inferLockRequestTarget(req);
        const locked = req.locked === true || req.available === false || req.state === 'locked';

        if (requestId) next.byRequest[requestId] = locked;
        if (target && locked) next[target] = true;
      });
    }

    if (!Object.prototype.hasOwnProperty.call(next.byRequest, 'lock_current_sync')) {
      next.byRequest.lock_current_sync = !!(config && (config.SyncLocked || config.syncLocked || config.ReadmeLocked || config.readmeLocked));
    }
    if (!Object.prototype.hasOwnProperty.call(next.byRequest, 'lock_current_dynamic')) {
      next.byRequest.lock_current_dynamic = !!(config && (config.dynmicLock || config.dynamicLocked || config.DynamicLocked));
    }

    next.sync = !!next.byRequest.lock_current_sync || !!next.sync;
    next.dynamic = !!next.byRequest.lock_current_dynamic || !!next.dynamic;

    return next;
  }

  function syncLyricsLockState() {
    lyricsLockState = buildLyricsLockState(lyricsRequests, lyricsConfig, lyricsLockState);
    return lyricsLockState;
  }

  function isLockRequestLocked(req, state = lyricsLockState) {
    const target = inferLockRequestTarget(req);
    const requestId = normalizeLockRequestId(req);

    if (requestId && state?.byRequest && Object.prototype.hasOwnProperty.call(state.byRequest, requestId)) {
      return !!state.byRequest[requestId];
    }
    if (target && state && Object.prototype.hasOwnProperty.call(state, target)) {
      return !!state[target];
    }
    return !!req?.locked;
  }

  function refreshCandidateMenu() {
    if (!ui.uploadMenu) {
      if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
      return;
    }
    const section = ui.uploadMenu.querySelector('.ytm-upload-menu-candidates');
    const list = section ? section.querySelector('.ytm-upload-menu-candidate-list') : null;
    if (!section || !list) return;
    list.innerHTML = '';
    if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) {
      section.style.display = 'none';
      if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
      return;
    }
    section.style.display = 'block';
    lyricsCandidates.forEach((cand, idx) => {
      const id = getCandidateId(cand, idx);
      const btn = document.createElement('button');
      btn.className = 'ytm-upload-menu-item ytm-upload-menu-item-candidate';
      btn.dataset.action = 'candidate';
      btn.dataset.candidateId = id;
      btn.textContent = buildCandidateLabel(cand, idx);
      if (String(selectedCandidateId || '') === id) {
        btn.classList.add('is-selected');
      }
      btn.addEventListener('mouseenter', (ev) => {
        showCandidateHoverPreview(id, ev);
      });
      btn.addEventListener('mousemove', (ev) => {
        hoverPreviewMouseX = ev.clientX;
        hoverPreviewMouseY = ev.clientY;
        hoverPreviewAnchorEl = ev.currentTarget || hoverPreviewAnchorEl;
        updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY, hoverPreviewAnchorEl);
      });
      btn.addEventListener('mouseleave', () => {
        hideCandidateHoverPreview();
      });
      list.appendChild(btn);
    });
    if (ui.lyricsBtn) {
      ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
      void ui.lyricsBtn.offsetWidth;
      ui.lyricsBtn.classList.add('ytm-lyrics-has-candidates');
    }
  }

  function refreshLockMenu() {
    if (!ui.uploadMenu) return;
    const lockSection = ui.uploadMenu.querySelector('.ytm-upload-menu-locks');
    const lockList = lockSection ? lockSection.querySelector('.ytm-upload-menu-lock-list') : null;
    const addSyncBtn = ui.uploadMenu.querySelector('.ytm-upload-menu-item[data-action="add-sync"]');
    if (!lockSection || !lockList || !addSyncBtn) return;
    const lockState = syncLyricsLockState();
    lockList.innerHTML = '';
    const mergedRequests = [];
    if (Array.isArray(lyricsRequests)) {
      lyricsRequests.forEach(r => { if (r) mergedRequests.push({ ...r }); });
    }
    const ensureRequest = (id, label, target) => {
      const idLower = String(id).toLowerCase();
      if (mergedRequests.some(r => String(r.request || r.id || '').toLowerCase() === idLower)) return;
      mergedRequests.push({ request: id, label, target });
    };
    ensureRequest('lock_current_sync', '蜷梧悄豁瑚ｩ槭ｒ遒ｺ螳・(Lock sync)', 'sync');
    ensureRequest('lock_current_dynamic', '蜍輔￥豁瑚ｩ槭ｒ遒ｺ螳・(Lock dynamic)', 'dynamic');
    const activeReqs = mergedRequests.filter(r => {
      if (!r) return false;
      if (r.has_lyrics) return true;
      if (r.target === 'sync' || r.target === 'dynamic') return true;
      const key = String(r.request || r.id || '').toLowerCase();
      if (!key) return false;
      return key.startsWith('lock_current_');
    });
    if (!activeReqs.length) {
      lockSection.style.display = 'none';
    } else {
      lockSection.style.display = 'block';
      activeReqs.forEach(r => {
        const btn = document.createElement('button');
        btn.className = 'ytm-upload-menu-item';
        btn.dataset.action = 'lock-request';
        btn.dataset.requestId = r.request || r.id || '';
        btn.textContent = r.label || r.request || r.id || 'Confirm lyrics';
        const locked = isLockRequestLocked(r, lockState);
        if (locked) {
          btn.classList.add('ytm-upload-menu-item-disabled');
          btn.title = 'Already confirmed';
        }
        lockList.appendChild(btn);
      });
    }
    const shouldDisableAddSync = !!lockState?.sync && !!lockState?.dynamic;
    addSyncBtn.classList.toggle('ytm-upload-menu-item-disabled', shouldDisableAddSync);
    if (shouldDisableAddSync) {
      addSyncBtn.dataset.disabledMessage = 'Already confirmed';
      addSyncBtn.title = 'Already confirmed';
    } else {
      delete addSyncBtn.dataset.disabledMessage;
      addSyncBtn.title = '';
    }
  }


  function setupUploadMenu(uploadBtn) {
    if (!ui.btnArea || ui.uploadMenu) return;
    ui.btnArea.style.position = 'relative';
    const menu = createEl('div', 'ytm-upload-menu', 'ytm-upload-menu');
    menu.innerHTML = `
      <div class="ytm-upload-menu-title">Lyrics</div>
      <button class="ytm-upload-menu-item" data-action="local">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg></span>
        <span>繝ｭ繝ｼ繧ｫ繝ｫ豁瑚ｩ櫁ｪｭ縺ｿ霎ｼ縺ｿ / ReadLyrics</span>
      </button>
      <button class="ytm-upload-menu-item" data-action="add-sync">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></span>
        <span>豁瑚ｩ槫酔譛溘ｒ霑ｽ蜉 / AddTiming</span>
      </button>
      <div class="ytm-upload-menu-locks" style="display:none;">
        <div class="ytm-upload-menu-subtitle">豁瑚ｩ槭ｒ遒ｺ螳・/ Confirm</div>
        <div class="ytm-upload-menu-lock-list"></div>
      </div>
      <div class="ytm-upload-menu-separator"></div>
      <button class="ytm-upload-menu-item" data-action="fix">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></span>
        <span>豁瑚ｩ槭・髢馴＆縺・ｒ菫ｮ豁｣ / FixLyrics</span>
      </button>
      <div class="ytm-upload-menu-candidates" style="display:none;">
        <div class="ytm-upload-menu-subtitle">蛻･縺ｮ豁瑚ｩ槭ｒ驕ｸ謚・/div>
        <div class="ytm-upload-menu-candidate-list"></div>
      </div>
    `;
    ui.btnArea.appendChild(menu);
    ui.uploadMenu = menu;
    const toggleMenu = (show) => {
      if (!ui.uploadMenu) return;
      const cl = ui.uploadMenu.classList;
      if (show === undefined) cl.toggle('visible');
      else if (show) cl.add('visible');
      else { cl.remove('visible'); hideCandidateHoverPreview(); }
    };
    uploadBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleMenu();
    });
    ui.uploadMenu.addEventListener('click', (ev) => {
      const target = ev.target.closest('.ytm-upload-menu-item');
      if (!target) return;
      if (target.classList.contains('ytm-upload-menu-item-disabled')) {
        const msg = target.dataset.disabledMessage || '縺薙・謫堺ｽ懊・迴ｾ蝨ｨ蛻ｩ逕ｨ縺ｧ縺阪∪縺帙ｓ';
        showToast(msg);
        return;
      }
      const action = target.dataset.action;
      const candId = target.dataset.candidateId || null;
      const reqId = target.dataset.requestId || null;
      toggleMenu(false);
      hideCandidateHoverPreview();
      if (action === 'local') {
        ui.input?.click();
      } else if (action === 'add-sync') {
        const videoUrl = getCurrentVideoUrl();
        const base = 'https://lrchub.coreone.work';
        const lrchubUrl = videoUrl ? `${base}/manual?video_url=${encodeURIComponent(videoUrl)}` : base;
        window.open(lrchubUrl, '_blank');
      } else if (action === 'fix') {
        const vid = getCurrentVideoId();
        if (!vid) {
          alert('Video ID could not be detected. Please run this on a YouTube Music playback page.');
          return;
        }
        const githubUrl = `https://github.com/LRCHub/${vid}/edit/main/README.md`;
        window.open(githubUrl, '_blank');
      } else if (action === 'candidate' && candId) {
        selectCandidateById(candId);
      } else if (action === 'lock-request' && reqId) {
        sendLockRequest(reqId);
      }
    });

    if (!uploadMenuGlobalSetup) {
      uploadMenuGlobalSetup = true;
      document.addEventListener('click', (ev) => {
        if (!ui.uploadMenu) return;
        if (!ui.uploadMenu.classList.contains('visible')) return;
        if (ui.uploadMenu.contains(ev.target) || uploadBtn.contains(ev.target)) return;
        ui.uploadMenu.classList.remove('visible');
        hideCandidateHoverPreview();
      }, true);
    }
    refreshCandidateMenu();
    refreshLockMenu();
  }

  function setupDeleteDialog(trashBtn) {
    if (!ui.btnArea || ui.deleteDialog) return;
    ui.btnArea.style.position = 'relative';
    const dialog = createEl('div', 'ytm-delete-dialog', 'ytm-confirm-dialog', `
      <div class="ytm-confirm-title">豁瑚ｩ槭ｒ蜑企勁</div>
      <div class="ytm-confirm-message">
        縺薙・譖ｲ縺ｮ菫晏ｭ俶ｸ医∩豁瑚ｩ槭ｒ蜑企勁縺励∪縺吶°・・br>
        <span style="font-size:11px;opacity:0.7;">繝ｭ繝ｼ繧ｫ繝ｫ繧ｭ繝｣繝・す繝･縺ｮ縺ｿ蜑企勁縺輔ｌ縺ｾ縺吶・/span>
      </div>
      <div class="ytm-confirm-buttons">
        <button class="ytm-confirm-btn cancel">繧ｭ繝｣繝ｳ繧ｻ繝ｫ</button>
        <button class="ytm-confirm-btn danger">蜑企勁</button>
      </div>
    `);
    ui.btnArea.appendChild(dialog);
    ui.deleteDialog = dialog;
    const toggleDialog = (show) => {
      if (!ui.deleteDialog) return;
      const cl = ui.deleteDialog.classList;
      if (show === undefined) cl.toggle('visible');
      else if (show) cl.add('visible');
      else cl.remove('visible');
    };
    trashBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleDialog();
    });
    const cancelBtn = dialog.querySelector('.ytm-confirm-btn.cancel');
    const dangerBtn = dialog.querySelector('.ytm-confirm-btn.danger');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleDialog(false);
      });
    }
    if (dangerBtn) {
      dangerBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (currentKey) {
          storage.remove(currentKey);
          lyricsData = [];
          dynamicLines = null;
          duetSubDynamicLines = null;
          _duetExcludedTimes = new Set();
          lyricsCandidates = null;
          selectedCandidateId = null;
          lyricsRequests = null;
          lyricsConfig = null;
          lyricsLockState = null;
          renderLyrics([]);
          refreshCandidateMenu();
          refreshLockMenu();
        }
        toggleDialog(false);
      });
    }
    if (!deleteDialogGlobalSetup) {
      deleteDialogGlobalSetup = true;
      document.addEventListener('click', (ev) => {
        if (!ui.deleteDialog) return;
        if (!ui.deleteDialog.classList.contains('visible')) return;
        if (ui.deleteDialog.contains(ev.target) || trashBtn.contains(ev.target)) return;
        ui.deleteDialog.classList.remove('visible');
      }, true);
    }
  }

  function setupLangPills(groupId, currentValue, onChange) {
    const group = document.getElementById(groupId);
    if (!group) return;
    const pills = Array.from(group.querySelectorAll('.ytm-lang-pill'));
    const apply = () => {
      pills.forEach(p => {
        p.classList.toggle('active', p.dataset.value === currentValue);
      });
    };
    apply();
    pills.forEach(p => {
      p.onclick = (e) => {
        e.stopPropagation();
        currentValue = p.dataset.value;
        apply();
        onChange(currentValue);
      };
    });
  }

  async function initSettings() {
    if (ui.settings) return;
    ui.settings = createEl('div', 'ytm-settings-panel', '', ``);
    document.body.appendChild(ui.settings);

    await loadRemoteTextsFromGithub();

    const uiLangStored = await storage.get('ytm_ui_lang');
    if (uiLangStored) config.uiLang = uiLangStored;

    const offsetStored = await storage.get('ytm_sync_offset');
    if (offsetStored !== null) config.syncOffset = offsetStored;
    const saveOffsetStored = await storage.get('ytm_save_sync_offset');
    if (saveOffsetStored !== null) config.saveSyncOffset = saveOffsetStored;
    // 笘・せ繝ｩ繧､繝繝ｼ蛻晄悄蛟､蜿肴丐
    const weightStored = await storage.get('ytm_lyric_weight');
    if (weightStored) config.lyricWeight = weightStored;
    const brightStored = await storage.get('ytm_bg_brightness');
    if (brightStored) config.bgBrightness = brightStored;

    renderSettingsPanel();

    if (!settingsOutsideClickSetup) {
      settingsOutsideClickSetup = true;
      document.addEventListener('click', (ev) => {
        if (!ui.settings) return;
        if (!ui.settings.classList.contains('active')) return;
        if (ui.settings.contains(ev.target)) return;
        if (ui.settingsBtn && ui.settingsBtn.contains(ev.target)) return;
        ui.settings.classList.remove('active');
      }, true);
    }
  }


function renderSettingsPanel() {
    if (!ui.settings) return;

    // 迴ｾ蝨ｨ縺ｮ譖ｲID縺後≠繧九°遒ｺ隱搾ｼ医く繝｣繝・す繝･蜑企勁繝懊ち繝ｳ縺ｮ蛻ｶ蠕｡逕ｨ・・
    const hasCurrentSong = !!currentKey;

    // --- SVG Icons ---
    const ICONS = {
      visuals: `<svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5 11 5.67 11 6.5 10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5S18.33 12 17.5 12z"/></svg>`,
      trans: `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`,
      data: `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
      save: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/></svg>`,
      trash: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`
    };

    ui.settings.innerHTML = `
      <div class="settings-tabs">
        <div class="settings-tabs-header">Settings</div>
        <button class="settings-tab-btn active" data-tab="visuals">
          ${ICONS.visuals} Visuals
        </button>
        <button class="settings-tab-btn" data-tab="timing">
          ${ICONS.trans} Timing
        </button>
        <button class="settings-tab-btn" data-tab="data">
          ${ICONS.data} Data & Reset
        </button>
        
        <div style="margin-top: auto; padding-top: 20px;">
           <button id="save-settings-btn" class="settings-action-btn btn-primary" style="padding:14px; font-size:14px; border-radius:12px; box-shadow:0 4px 12px rgba(0, 122, 255, 0.3); display:flex; align-items:center; justify-content:center; gap:8px;">
             ${ICONS.save}
             ${t('settings_save')}
           </button>
        </div>
      </div>

      <div class="settings-panels">
        <div class="settings-panels-header">
          <h3>${t('settings_title')}</h3>
          <button id="ytm-settings-close-btn" title="Close">ﾃ・/button>
        </div>
        
        <div class="settings-scroll-area">
          
          <div class="settings-panel active" id="panel-visuals">
            <div class="settings-section-title">Visual Customization</div>
            <div class="settings-group-card">
              <div class="setting-row" style="flex-direction:column; align-items:flex-start; gap:12px;">
                <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-size:13px; font-weight:500;">UI Language</span>
                  <div class="ytm-lang-group" id="ui-lang-group" style="background:transparent; padding:0;"></div>
                </div>
              </div>
              <div class="setting-row">
                <label class="toggle-label" style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                  <span>${t('settings_left_align')}</span>
                  <input type="checkbox" id="left-align-toggle">
                </label>
              </div>
              <div class="setting-row">
                <label class="toggle-label" style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                  <span>${t('settings_apple_bg') || 'Apple Music鬚ｨ縺ｮ蜍慕噪閭梧勹'}</span>
                  <input type="checkbox" id="apple-bg-toggle">
                </label>
              </div>
            </div>

            <div class="settings-group-card">
              <div class="setting-row" style="flex-direction:column; align-items:stretch;">
                <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:500;">
                  <span>豁瑚ｩ槭・螟ｪ縺・(Weight)</span>
                  <span id="weight-val" style="opacity:0.6;">${config.lyricWeight || 800}</span>
                </div>
                <input type="range" id="weight-slider" min="100" max="900" step="100" value="${config.lyricWeight || 800}">
              </div>
              <div class="setting-row" style="flex-direction:column; align-items:stretch;">
                 <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:500;">
                  <span>閭梧勹縺ｮ譏弱ｋ縺・(Brightness)</span>
                  <span id="bright-val" style="opacity:0.6;">${Math.round((config.bgBrightness || 0.35) * 100)}%</span>
                </div>
                <input type="range" id="bright-slider" min="0.1" max="1.0" step="0.05" value="${config.bgBrightness || 0.35}">
              </div>
            </div>
          </div>

          <div class="settings-panel" id="panel-timing">
            <div class="settings-section-title">Timing</div>
            <div class="settings-group-card">
               <div class="setting-row" style="flex-direction:column; align-items:stretch; gap:12px;">
                  <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:13px; font-weight:500;">${t('settings_sync_offset')}</span>
                    <input type="number" id="sync-offset-input" placeholder="0" style="width:70px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:8px; padding:6px 8px; text-align:right; outline:none;">
                  </div>
                  <label class="toggle-label" style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:12px; opacity:0.7;">${t('settings_sync_offset_save')}</span>
                    <input type="checkbox" id="sync-offset-save-toggle">
                  </label>
              </div>
            </div>
          </div>

          <div class="settings-panel" id="panel-data">
            <div class="settings-section-title">Data Management</div>
            <div class="settings-group-card">
              <div class="setting-row" style="display:block;">
                <button id="delete-current-cache-btn" class="settings-action-btn btn-danger" ${hasCurrentSong ? '' : 'disabled style="opacity:0.5; cursor:not-allowed;"'} style="display:flex; align-items:center; justify-content:center; gap:8px;">
                  ${ICONS.trash} 縺薙・譖ｲ縺ｮ豁瑚ｩ槭ョ繝ｼ繧ｿ繧貞炎髯､
                </button>
                <div style="font-size:11px; opacity:0.5; margin-top:8px; text-align:center;">
                  迴ｾ蝨ｨ蜀咲函荳ｭ縺ｮ譖ｲ縺ｮ豁瑚ｩ槭く繝｣繝・す繝･縺ｮ縺ｿ繧貞炎髯､縺励∪縺・
                </div>
              </div>
              <div class="setting-row" style="display:block;">
                 <button id="clear-all-btn" class="settings-action-btn" style="background:rgba(255,255,255,0.1); color:#fff;">
                   險ｭ螳壹ｒ繝ｪ繧ｻ繝・ヨ (Reset All)
                 </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
    // --- Tab Switching Logic ---
    const tabs = ui.settings.querySelectorAll('.settings-tab-btn');
    const panels = ui.settings.querySelectorAll('.settings-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        
        tab.classList.add('active');
        const tabId = tab.getAttribute('data-tab');
        ui.settings.querySelector(`#panel-${tabId}`).classList.add('active');
      });
    });
    
    
        // 蛟､縺ｮ蜿肴丐
    document.getElementById('left-align-toggle').checked = !!config.leftAlignInfo;
    document.getElementById('apple-bg-toggle').checked = !!config.appleBg;

    // 蜈ｱ譛臥ｿｻ險ｳ縺ｮ谿九ｊ譁・ｭ玲焚・井ｿ晏ｭ俶ｸ医∩蛟､繧定｡ｨ遉ｺ・・
    document.getElementById('sync-offset-input').valueAsNumber = config.syncOffset || 0;
    document.getElementById('sync-offset-save-toggle').checked = config.saveSyncOffset;

    // 繧ｹ繝ｩ繧､繝繝ｼ繧､繝吶Φ繝郁ｨｭ螳・
    const wSlider = document.getElementById('weight-slider');
    const bSlider = document.getElementById('bright-slider');
    if (wSlider) {
      wSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('weight-val').textContent = val;
        config.lyricWeight = val;
        document.documentElement.style.setProperty('--ytm-lyric-weight', val);
      });
    }
    if (bSlider) {
      bSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('bright-val').textContent = Math.round(val * 100) + '%';
        document.documentElement.style.setProperty('--ytm-bg-brightness', val);
      });
    }

    // 險隱槭ヴ繝ｫ險ｭ螳・
    refreshUiLangGroup();

    // 髢峨§繧九・繧ｿ繝ｳ
    const closeBtn = document.getElementById('ytm-settings-close-btn');
    if (closeBtn) {
      closeBtn.onclick = (ev) => {
        ev.stopPropagation();
        ui.settings.classList.remove('active');
      };
    }

    // 菫晏ｭ倥・繧ｿ繝ｳ縺ｮ蜃ｦ逅・
    document.getElementById('save-settings-btn').onclick = async () => {
      const savedUiLang = await storage.get('ytm_ui_lang');

      const prevMainLang = savedMainLang || 'original';
      const prevSubLang = savedSubLang !== null ? savedSubLang : 'en';
      const prevUiLang = savedUiLang || (config.uiLang || 'ja');

      // 逕ｻ髱｢縺九ｉ蛟､繧貞叙蠕・
      config.leftAlignInfo = document.getElementById('left-align-toggle').checked;
      config.appleBg = document.getElementById('apple-bg-toggle').checked;
      config.lyricWeight = document.getElementById('weight-slider').value;
      config.bgBrightness = document.getElementById('bright-slider').value;
      
      const offsetVal = document.getElementById('sync-offset-input').valueAsNumber;
      config.syncOffset = isNaN(offsetVal) ? 0 : offsetVal;
      config.saveSyncOffset = document.getElementById('sync-offset-save-toggle').checked;

      // 繧ｹ繝医Ξ繝ｼ繧ｸ縺ｫ菫晏ｭ・
      storage.set('ytm_left_align', config.leftAlignInfo);
      document.body.classList.toggle('ytm-align-left', !!config.leftAlignInfo);
      
      storage.set('ytm_apple_bg', config.appleBg);
      document.body.classList.toggle('ytm-apple-bg', !!config.appleBg);
      storage.set('ytm_ui_lang', config.uiLang);
      storage.set('ytm_lyric_weight', config.lyricWeight);
      storage.set('ytm_bg_brightness', config.bgBrightness);
      storage.set('ytm_sync_offset', config.syncOffset);
      storage.set('ytm_save_sync_offset', config.saveSyncOffset);

      const needReload = (
        prevUiLang !== config.uiLang
      );

      if (needReload) {
        alert(t('settings_saved'));
        location.reload();
      } else {
        showToast(t('settings_saved'));
        ui.settings.classList.remove('active');
      }
    };

    // 繝ｪ繧ｻ繝・ヨ繝懊ち繝ｳ
    document.getElementById('clear-all-btn').onclick = storage.clear;

    // 繧ｭ繝｣繝・す繝･蜑企勁繝懊ち繝ｳ縺ｮ蜃ｦ逅・
    const delBtn = document.getElementById('delete-current-cache-btn');
    if (delBtn) {
      delBtn.onclick = async () => {
        if (!currentKey) return;
        if (confirm('Delete the lyric cache for the current song?')) {
          await storage.remove(currentKey);
          
          lyricsData = [];
          dynamicLines = null;
          duetSubDynamicLines = null;
          _duetExcludedTimes = new Set();
          lyricsCandidates = null;
          selectedCandidateId = null;
          lyricsRequests = null;
          lyricsConfig = null;
          lyricsLockState = null;
          
          renderLyrics([]);
          refreshCandidateMenu();
          refreshLockMenu();
          
          showToast('豁瑚ｩ槭く繝｣繝・す繝･繧貞炎髯､縺励∪縺励◆');
        }
      };
    }
  }

  function createReplayPanel() {
    ui.replayPanel = createEl('div', 'ytm-replay-panel', '', `
      <button class="replay-close-btn">ﾃ・/button>
      <h3>Daily Replay</h3>
      
      <div class="ytm-lang-group" style="margin-bottom: 20px;">
        <button class="ytm-lang-pill active" data-range="day">${t('replay_today')}</button>
        <button class="ytm-lang-pill" data-range="week">${t('replay_week')}</button>
        <button class="ytm-lang-pill" data-range="all">${t('replay_all')}</button>
      </div>

      <div class="ytm-replay-content">
        <div class="lyric-loading">Calculating...</div>
      </div>

      <button id="replay-reset-action" class="replay-footer-btn">${t('settings_reset')} History</button>
    `);

    document.body.appendChild(ui.replayPanel);

    ui.replayPanel.querySelector('.replay-close-btn').onclick = () => {
      ui.replayPanel.classList.remove('active');
    };

    const pills = ui.replayPanel.querySelectorAll('.ytm-lang-pill');
    pills.forEach(p => {
      p.onclick = (e) => {
        pills.forEach(x => x.classList.remove('active'));
        e.target.classList.add('active');
        ui.replayPanel.dataset.range = e.target.dataset.range;
        ReplayManager.renderUI();
      };
    });

    document.getElementById('replay-reset-action').onclick = async () => {
      if (confirm(t('replay_reset_confirm'))) {
        await storage.remove(ReplayManager.HISTORY_KEY);
        ReplayManager.renderUI();
      }
    };
  }

  // ===================== Artist Seamless Switch =====================
  const SWITCH_NOISE_KEYWORDS = [
    'cover', 'covered', 'karaoke',
    'acoustic', 'live', 'remix', 'piano',
    'arrange', 'off vocal', 'instrumental', 'full chorus', 'short ver'
  ];

  function _switchQueryForMeta(meta) {
    // Search title only 窶・not title+artist, so we get all versions
    return (meta?.title || '').trim();
  }

  function _filterSwitchResults(items, meta) {
    const titleLower = (meta?.title || '').toLowerCase();
    return items.filter(item => {
      const t = (item.title || '').toLowerCase();
      const ch = (item.channel || '').toLowerCase();
      // Keep items whose title shares words with the song title (looser check)
      const titleWords = titleLower.split(/\s+/).filter(w => w.length > 1);
      const hasTitle = titleWords.some(w => t.includes(w));
      if (!hasTitle) return false;
      // Exclude noise keywords
      for (const kw of SWITCH_NOISE_KEYWORDS) {
        if (t.includes(kw) || ch.includes(kw)) return false;
      }
      return true;
    });
  }

  async function searchYTMAlternatives(meta) {
    const q = _switchQueryForMeta(meta);
    if (!q) return [];
    // Use YouTube Music's InnerTube API 窶・same endpoint the web app itself uses
    try {
      const resp = await fetch('https://music.youtube.com/youtubei/v1/search?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '67', 'X-YouTube-Client-Version': '1.20240101.01.00' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00',
              hl: 'ja',
              gl: 'JP',
            }
          },
          query: q
          // No params = search all types (songs, videos, albums, etc.)
        })
      });
      if (!resp.ok) { console.warn('[Switch] InnerTube API error:', resp.status); return []; }
      const data = await resp.json();

      const results = [];
      const walk = (obj, depth = 0) => {
        if (!obj || typeof obj !== 'object' || depth > 30) return;
        if (obj.musicResponsiveListItemRenderer) {
          const r = obj.musicResponsiveListItemRenderer;
          const videoId =
            r.playlistItemData?.videoId ||
            r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
            r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.find(x => x.navigationEndpoint?.watchEndpoint)?.navigationEndpoint?.watchEndpoint?.videoId;
          const title    = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
          const subtitle = (r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []).map(x => x.text).join('');
          const thumbs   = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
          const thumb    = thumbs.length ? thumbs[thumbs.length - 1].url : '';
          if (videoId && title) results.push({ videoId, title, channel: subtitle, thumb });
          return; // don't descend into an item we already parsed
        }
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (Array.isArray(val)) val.forEach(v => walk(v, depth + 1));
          else if (val && typeof val === 'object') walk(val, depth + 1);
        }
      };
      walk(data);
      const seen = new Set();
      return results.filter(r => { if (seen.has(r.videoId)) return false; seen.add(r.videoId); return true; });
    } catch (e) {
      console.error('[Switch] Search failed:', e);
      return [];
    }
  }


  function setupSwitchPanel(triggerBtn) {
    // Toggle: close if already open
    const existing = document.getElementById('ytm-switch-panel');
    if (existing) { existing.remove(); return; }

    const meta = getMetadata();
    if (!meta || !meta.title) { showToast('譖ｲ蜷肴ュ蝣ｱ繧貞叙蠕励〒縺阪∪縺帙ｓ縺ｧ縺励◆'); return; }

    const panel = document.createElement('div');
    panel.id = 'ytm-switch-panel';
    panel.className = 'ytm-switch-panel';
    panel.innerHTML = `
      <div class="ytm-switch-header">
        <span>売 莉｣譖ｿ繝舌・繧ｸ繝ｧ繝ｳ繧呈､懃ｴ｢: ${escHtml(meta.title)}</span>
        <button class="ytm-switch-close" id="ytm-switch-close">笨・/button>
      </div>
      <div class="ytm-switch-list" id="ytm-switch-list">
        <div class="ytm-switch-loading">讀懃ｴ｢荳ｭ窶ｦ</div>
      </div>
    `;
    document.body.appendChild(panel);

    // Position panel ABOVE the trigger button
    if (triggerBtn) {
      const rect = triggerBtn.getBoundingClientRect();
      const panelWidth = 360;
      const isMoviemode = triggerBtn.classList.contains("moviemode");
      let left = rect.left + rect.width / 2 - panelWidth / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
      panel.style.position = 'fixed';
      panel.style.left = `${left}px`;
      panel.style.bottom = isMoviemode ?  'auto' : `${(window.innerHeight - rect.top + 10)}px`;
      panel.style.top = isMoviemode ? `${rect.top - 10 + 65}px` : 'auto';// 65px縺ｯ縺｡繧・≧縺ｩ縺・＞鬮倥＆繧ｪ繝輔そ繝・ヨ
      panel.style.right = 'auto';
    }

    document.getElementById('ytm-switch-close').onclick = () => panel.remove();
    setTimeout(() => {
      document.addEventListener('click', function outsideClick(ev) {
        if (!panel.contains(ev.target) && !ev.target.closest('#ytm-switch-btn')) {
          panel.remove();
          document.removeEventListener('click', outsideClick, true);
        }
      }, true);
    }, 100);

    searchYTMAlternatives(meta).then(rawResults => {
      const results = _filterSwitchResults(rawResults, meta);
      const listEl = document.getElementById('ytm-switch-list');
      if (!listEl) return;

      if (!results.length) {
        // Show all unfiltered results if filter removed everything
        const fallback = rawResults.slice(0, 10);
        if (!fallback.length) {
          listEl.innerHTML = '<div class="ytm-switch-loading">蛟呵｣懊′隕九▽縺九ｊ縺ｾ縺帙ｓ縺ｧ縺励◆</div>';
          return;
        }
        listEl.innerHTML = '<div class="ytm-switch-loading" style="font-size:10px;opacity:0.6;padding:6px 10px">繝輔ぅ繝ｫ繧ｿ繝ｼ繧堤ｷｩ繧√※陦ｨ遉ｺ縺励※縺・∪縺・/div>';
        renderSwitchItems(listEl, fallback, false);
        return;
      }
      listEl.innerHTML = '';
      renderSwitchItems(listEl, results, true);
    });
  }

  function renderSwitchItems(listEl, items, clearFirst) {
    if (clearFirst) listEl.innerHTML = '';
    const video = document.querySelector('video');
    const currentTime = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;

    items.forEach(item => {
      const row = document.createElement('button');
      row.className = 'ytm-switch-item';
      row.innerHTML = `
        ${item.thumb ? `<img class="ytm-switch-thumb" src="${escHtml(item.thumb)}" alt="">` : '<div class="ytm-switch-thumb"></div>'}
        <div class="ytm-switch-info">
          <div class="ytm-switch-title">${escHtml(item.title)}</div>
          <div class="ytm-switch-channel">${escHtml(item.channel)}</div>
        </div>
      `;
      row.onclick = () => {
        document.getElementById('ytm-switch-panel')?.remove();
        const t = Math.floor(currentTime);
        const url = `https://music.youtube.com/watch?v=${item.videoId}&t=${t}s`;
        location.href = url;
      };
      listEl.appendChild(row);
    });
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function initLayout() {

    if (document.getElementById('ytm-custom-wrapper')) {
      ui.wrapper = document.getElementById('ytm-custom-wrapper');
      ui.bg = document.getElementById('ytm-custom-bg');
      ui.lyrics = document.getElementById('my-lyrics-container');
      ui.title = document.getElementById('ytm-custom-title');
      ui.artist = document.getElementById('ytm-custom-artist');
      ui.artwork = document.getElementById('ytm-artwork-container');
      ui.btnArea = document.getElementById('ytm-btn-area');
      setupAutoHideEvents();
      return;
    }
    ui.bg = createEl('div', 'ytm-custom-bg');
    document.body.appendChild(ui.bg);
    ui.wrapper = createEl('div', 'ytm-custom-wrapper');
    const leftCol = createEl('div', 'ytm-custom-left-col');
    ui.artwork = createEl('div', 'ytm-artwork-container');
    const info = createEl('div', 'ytm-custom-info-area');
    ui.title = createEl('div', 'ytm-custom-title');
    ui.artist = createEl('div', 'ytm-custom-artist');
    ui.btnArea = createEl('div', 'ytm-btn-area');

    const btns = [];
    const lyricsBtnConfig = { txt: 'Lyrics', cls: 'lyrics-btn', click: () => { } };
    const shareBtnConfig = { txt: 'Share', cls: 'share-btn', click: onShareButtonClick };

    //  PiP繝懊ち繝ｳ
    const pipBtnConfig = {
      txt: 'PIP',
      cls: 'icon-btn',
      click: () => PipManager.toggle()
    };

    const replayBtnConfig = {
      txt: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/></svg>',
      cls: 'icon-btn',
      click: () => {
        if (!ui.replayPanel) {
          createReplayPanel();
        }
        ui.replayPanel.classList.add('active');
        ReplayManager.renderUI();
      }
    };

    
    const settingsBtnConfig = {
      txt: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.73 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .43-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.49-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
      cls: 'icon-btn',
      click: async () => {
        initSettings();
        await loadRemoteTextsFromGithub();
        refreshUiLangGroup();
        ui.settings.classList.toggle('active');
      }
    };

    const switchBtnConfig = {
      txt: '',
      cls: 'icon-btn ytm-switch-icon-btn',
      click: (ev) => setupSwitchPanel(ev.currentTarget)
    };

    // 繝懊ち繝ｳ驟榊・縺ｫ霑ｽ蜉
    btns.push(lyricsBtnConfig, shareBtnConfig, pipBtnConfig, replayBtnConfig, switchBtnConfig, settingsBtnConfig);

    btns.forEach(b => {
      const btn = createEl('button', '', `ytm-glass-btn ${b.cls || ''}`, b.txt);
      btn.onclick = b.click;
      ui.btnArea.appendChild(btn);
      if (b === lyricsBtnConfig) {
        ui.lyricsBtn = btn;
        setupUploadMenu(btn);
      }
      if (b === shareBtnConfig) {
        ui.shareBtn = btn;
      }
      if (b === switchBtnConfig) {
        btn.id = 'ytm-switch-btn';
        // Use the custom icon image
        try {
          const iconUrl = chrome.runtime.getURL('src/assets/icons/ArtistChange.png');
          btn.innerHTML = `<img src="${iconUrl}" style="width:18px;height:18px;object-fit:contain;vertical-align:middle;" alt="ArtistChange">`;
        } catch(_) { btn.textContent = '売'; }
      }
      if (b === settingsBtnConfig) ui.settingsBtn = btn;
    });

    ui.input = createEl('input');
    ui.input.type = 'file';
    ui.input.accept = '.lrc,.txt';
    ui.input.style.display = 'none';
    ui.input.onchange = handleUpload;
    document.body.appendChild(ui.input);
    info.append(ui.title, ui.artist, ui.btnArea);
    leftCol.append(ui.artwork, info);
    ui.lyrics = createEl('div', 'my-lyrics-container');
    ui.wrapper.append(leftCol, ui.lyrics);
    document.body.appendChild(ui.wrapper);
    setupAutoHideEvents();
    if(isYTMPremiumUser()) setupMovieMode(); //moviemode setup
  }

  async function loadLyrics(meta) {

    const uiLangStored = await storage.get('ytm_ui_lang');
    if (uiLangStored) config.uiLang = uiLangStored;

    const thisKey = `${meta.title}///${meta.artist}`;
    if (thisKey !== currentKey) return;
    let cached = await storage.get(thisKey);
    isFallbackLyrics = false;
    dynamicLines = null;
    duetSubDynamicLines = null;
    _duetExcludedTimes = new Set();
    duetSubLyricsRaw = '';
    lyricsCandidates = null;
    selectedCandidateId = null;
    lyricsRequests = null;
    lyricsConfig = null;
    lyricsLockState = null;
    let data = null;
    let noLyricsCached = false;
    if (cached !== null && cached !== undefined) {
      if (cached === NO_LYRICS_SENTINEL) {
        noLyricsCached = true;
      } else if (typeof cached === 'string') {
        data = cached;
      } else if (typeof cached === 'object') {
        if (typeof cached.lyrics === 'string') data = cached.lyrics;
        if (Array.isArray(cached.dynamicLines)) dynamicLines = cached.dynamicLines;
        if (typeof cached.subLyrics === 'string') duetSubLyricsRaw = cached.subLyrics;
        if (cached.noLyrics) noLyricsCached = true;
        if (cached.githubFallback) isFallbackLyrics = true;
        if (Array.isArray(cached.candidates)) lyricsCandidates = cached.candidates;
        if (Array.isArray(cached.requests)) lyricsRequests = cached.requests;
        if (cached.config) lyricsConfig = cached.config;
        if (cached.lockState && typeof cached.lockState === 'object') lyricsLockState = cached.lockState;
      }
    }
    syncLyricsLockState();
    refreshCandidateMenu();
    refreshLockMenu();
    if (!data && noLyricsCached) {
      if (thisKey !== currentKey) return;
      renderLyrics([]);
      return;
    }
    if (!data && !noLyricsCached) {
      let gotLyrics = false;


      try {
        const track = meta.title.replace(/\s*[\(-\[].*?[\)-]].*/, '');
        const artist = meta.artist;
        const youtube_url = getCurrentVideoUrl();
        const video_id = getCurrentVideoId();
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage(
            { type: 'GET_LYRICS', payload: { track, artist, video_id } },
            resolve
          );
        });
        console.log('[CS] GET_LYRICS response:', res);
        lyricsRequests = Array.isArray(res?.requests) ? res.requests : null;
        lyricsConfig = res?.config || null;
        syncLyricsLockState();
        lyricsCandidates = Array.isArray(res?.candidates) ? res.candidates : null;
        refreshCandidateMenu();
        refreshLockMenu();
        isFallbackLyrics = !!res?.githubFallback;
        if (typeof res?.subLyrics === 'string' && res.subLyrics.trim()) duetSubLyricsRaw = res.subLyrics;

        if (res?.success && typeof res.lyrics === 'string' && res.lyrics.trim()) {
          data = res.lyrics;
          gotLyrics = true;
          if (Array.isArray(res.dynamicLines) && res.dynamicLines.length) dynamicLines = res.dynamicLines;
          if (thisKey === currentKey) {
            storage.set(thisKey, {
              lyrics: data,
              dynamicLines: dynamicLines || null,
              noLyrics: false,
              githubFallback: isFallbackLyrics,
              subLyrics: (typeof duetSubLyricsRaw === 'string' ? duetSubLyricsRaw : ''),
              candidates: lyricsCandidates || null,
              requests: lyricsRequests || null,
              config: lyricsConfig || null,
              lockState: lyricsLockState || null
            });
          }
        } else {

        }
      } catch (e) {
        console.error('GET_LYRICS failed', e);
      }
      if (!gotLyrics && thisKey === currentKey) {
        storage.set(thisKey, NO_LYRICS_SENTINEL);
        noLyricsCached = true;
      }
    }
    if (thisKey !== currentKey) return;
    if (!data) {
      renderLyrics([]);
      refreshCandidateMenu();
      refreshLockMenu();
      return;
    }
    await applyLyricsText(data);
  }

const optimizeLineBreaks = (text) => {
    if (!text) return '';
    return `<span class="lyric-phrase">${escapeHtml(text)}</span>`;
  };    
  function renderLyrics(data) {
    if (!ui.lyrics) return;
    ui.lyrics.innerHTML = '';
    ui.lyrics.scrollTop = 0;
    const hasData = Array.isArray(data) && data.length > 0;
    document.body.classList.toggle('ytm-no-lyrics', !hasData);
    document.body.classList.toggle('ytm-has-timestamp', hasTimestamp);
    document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);

    const fragment = document.createDocumentFragment();
    const usedMainDynamicIndices = new Set();
    const usedSubDynamicIndices = new Set();

    data.forEach((line, index) => {
      const row = createEl('div', '', 'lyric-line');

      if (line && line.duetSide === 'right') {
        row.classList.add('sub-vocal');
      } else if (line && line.duetSide === 'left') {
        row.classList.add('main-vocal');
      }

      if (line && typeof line === 'object') {
        line._dynamicRenderStartSec = null;
        line._dynamicRenderEndSec = null;
      }

      if (typeof line.time === 'number') {
        row.dataset.startTime = String(line.time);
      }

      const mainSpan = createEl('span', '', 'lyric-main');

      // dynamic lyrics highlighting
      let dyn = null;
      
      // 繧ｵ繝悶・繝ｼ繧ｫ繝ｫ(right)縺ｫ縺ｯduetSubDynamicLines繧剃ｽｿ逕ｨ縲√Γ繧､繝ｳ縺ｫ縺ｯdynamicLines繧剃ｽｿ逕ｨ
      if (line && line.duetSide === 'right') {
        // 繧ｵ繝悶・繝ｼ繧ｫ繝ｫ逕ｨ縺ｮdynamic lines・・ub.txt縺轡ynamic LRC蠖｢蠑上・蝣ｴ蜷茨ｼ・
        if (duetSubDynamicLines && Array.isArray(duetSubDynamicLines) && duetSubDynamicLines.length) {
          if (typeof line.time === 'number') {
             dyn = findDynamicLineForRender(line, duetSubDynamicLines, usedSubDynamicIndices);
          }
        } else if (dynamicLines && Array.isArray(dynamicLines) && dynamicLines.length) {
          // sub.txt縺碁壼ｸｸLRC蠖｢蠑上・蝣ｴ蜷医√Γ繧､繝ｳ縺ｮDynamic LRC縺九ｉ繧ｳ繝ｳ繝・Φ繝・・繝・メ縺ｧ1譁・ｭ怜酔譛溘ョ繝ｼ繧ｿ繧貞叙蠕・
          // 竊・繧ｵ繝悶・繝ｼ繧ｫ繝ｫ蜿ｳ蛛ｴ繧・譁・ｭ励ワ繧､繝ｩ繧､繝医↓蟇ｾ蠢懶ｼ・遘偵・險ｱ螳ｹ蟷・蜀・ｮｹ荳閾ｴ縺ｧ讀懃ｴ｢・・
          if (typeof line.time === 'number') {
            dyn = findDynamicLineByContent(line, dynamicLines);
          }
        }
      } else {
        // 繝｡繧､繝ｳ繝懊・繧ｫ繝ｫ逕ｨ縺ｮdynamic lines
        if (dynamicLines && Array.isArray(dynamicLines) && dynamicLines.length) {
          if (typeof line.time === 'number') {
             // 譎る俣縺ｧ讀懃ｴ｢
             dyn = findDynamicLineForRender(line, dynamicLines, usedMainDynamicIndices);
          } else {
             // 繝・Η繧ｨ繝・ヨ繝｢繝ｼ繝我ｻ･螟悶・縺ｿ繧､繝ｳ繝・ャ繧ｯ繧ｹ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ繧剃ｽｿ逕ｨ
             const isDuetMode = document.body.classList.contains('ytm-duet-mode');
             if (!isDuetMode) {
                dyn = dynamicLines[index];
             }
          }
        }
      }

      if (line && typeof line === 'object' && dyn) {
        const dynStartSec = getDynamicLineStartSec(dyn);
        const dynEndSec = getDynamicLineEndSec(dyn);
        line._dynamicRenderStartSec = typeof dynStartSec === 'number' ? dynStartSec : (
          typeof line.time === 'number' ? line.time : null
        );
        line._dynamicRenderEndSec = typeof dynEndSec === 'number' ? dynEndSec : null;

        if (typeof line._dynamicRenderStartSec === 'number') {
          row.dataset.dynamicStartTime = String(line._dynamicRenderStartSec);
        }
        if (typeof line._dynamicRenderEndSec === 'number') {
          row.dataset.dynamicEndTime = String(line._dynamicRenderEndSec);
        }
      }
      
      if (dyn && Array.isArray(dyn.chars) && dyn.chars.length) {
        dyn.chars.forEach((ch, ci) => {
          const chSpan = createEl('span', '', 'lyric-char');
          // Preserve spaces
          const cc = (ch.c === '\t') ? ' ' : ch.c;
          chSpan.textContent = (cc === ' ') ? '\u00A0' : cc;
          chSpan.dataset.charIndex = String(ci);
          if (typeof ch.t === 'number') {
            chSpan.dataset.time = String(ch.t / 1000);
          }
          chSpan.classList.add('char-pending');
          mainSpan.appendChild(chSpan);
        });
      } else {
        const rawText = line ? line.text : '';
        mainSpan.innerHTML = optimizeLineBreaks(rawText);
      }
      row.appendChild(mainSpan);
      

      row.onclick = () => {
        if (shareMode) {
          handleShareLineClick(index);
          return;
        }
        if (!hasTimestamp || !line || line.time == null) return;
        const v = document.querySelector('video');
        if (v) v.currentTime = line.time + timeOffset;
      };
      fragment.appendChild(row);
    });

    ui.lyrics.appendChild(fragment);

    if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
      PipManager.pipLyricsContainer.innerHTML = ui.lyrics.innerHTML;
      if (PipManager.pipWindow.document) {
        PipManager.pipWindow.document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);
      }
    }

    updateShareSelectionHighlight();
  }

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !currentKey) return;
    const r = new FileReader();
    r.onload = (ev) => {
      storage.set(currentKey, ev.target.result);
      currentKey = null;
    };
    r.readAsText(file);
    e.target.value = '';
  };


  function startLyricRafLoop() {
    if (lyricRafId) cancelAnimationFrame(lyricRafId);

    const loop = () => {
      const v = document.querySelector('video');

      if (v) {

        if (PipManager.pipWindow) {
          PipManager.updatePlayState(v.paused);
        }

        if (v.readyState > 0 && !v.paused && !v.ended) {
          let t = v.currentTime;
          const duration = v.duration || 1;

          if (timeOffset > 0 && t < timeOffset) timeOffset = 0;
          t = Math.max(0, t - timeOffset);
          t = Math.min(Math.max(0, t + (config.syncOffset / 1000)), v.duration);
          if (lyricsData.length && hasTimestamp) {
            updateLyricHighlight(t);
          }


          if (PipManager.pipWindow && PipManager.progressRing) {
            const radius = 32;
            const circumference = radius * 2 * Math.PI;
            const progress = t / duration;
            const offset = circumference - (progress * circumference);
            PipManager.progressRing.style.strokeDashoffset = offset;
          }
        }
      }

      if (PipManager.pipWindow) {
        lyricRafId = PipManager.pipWindow.requestAnimationFrame(loop);
      } else {
        lyricRafId = requestAnimationFrame(loop);
      }
    };

    lyricRafId = requestAnimationFrame(loop);
  }

  function updateLyricHighlight(currentTime) {
    if (!lyricsData.length) return;
    if (!hasTimestamp) return;

    const t = currentTime;

    let idx = -1;
    const startSearch = Math.max(0, lastActiveIndex);

    for (let i = startSearch; i < lyricsData.length; i++) {
      if (lyricsData[i].time > t) {
        idx = i - 1;
        break;
      }
      if (i === lyricsData.length - 1) idx = i;
    }



    const targets = [];
    if (ui.lyrics) targets.push(ui.lyrics);
    if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
      targets.push(PipManager.pipLyricsContainer);
    }

    const activeIndices = new Set();
    if (idx >= 0 && idx < lyricsData.length) {
      activeIndices.add(idx);

      const currentLineTime = lyricsData[idx]?.time;
      if (typeof currentLineTime === 'number') {
        for (let i = idx - 1; i >= 0; i--) {
          if (!isSameTimestamp(lyricsData[i]?.time, currentLineTime)) break;
          activeIndices.add(i);
        }
        for (let i = idx + 1; i < lyricsData.length; i++) {
          if (!isSameTimestamp(lyricsData[i]?.time, currentLineTime)) break;
          activeIndices.add(i);
        }
      }

      if (activeIndices.size === 1) {
        const prevIdx = (idx > 0 && idx < lyricsData.length &&
          typeof lyricsData[idx]?.time === 'number' &&
          typeof lyricsData[idx - 1]?.time === 'number' &&
          (lyricsData[idx].time - lyricsData[idx - 1].time) <= 1.0
        ) ? (idx - 1) : -1;

        if (prevIdx >= 0) {
          // 繝・Η繧ｨ繝・ヨ繝｢繝ｼ繝峨〒duetSide縺檎焚縺ｪ繧玖｡鯉ｼ医Γ繧､繝ｳ竍斐し繝厄ｼ峨・霑ｽ蜉縺励↑縺・
          // ・・譁・ｭ苓ｿｽ霍｡繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝玲凾縺ｫ繧ｵ繝悶・繝ｼ繧ｫ繝ｫ縺後ム繝悶ｋ蜴溷屏縺ｫ縺ｪ繧九◆繧・ｼ・
          const currentSide = lyricsData[idx]?.duetSide;
          const prevSide = lyricsData[prevIdx]?.duetSide;
          const isDifferentDuetSide = currentSide && prevSide && currentSide !== prevSide;
          if (!isDifferentDuetSide) {
            const currentText = normalizeLyricCompareTextStrict(lyricsData[idx]?.text);
            const prevText = normalizeLyricCompareTextStrict(lyricsData[prevIdx]?.text);
            const sameDisplayedLyric = !!currentText && !!prevText && scoreLyricTextMatch(currentText, prevText) >= 100;
            if (!sameDisplayedLyric) activeIndices.add(prevIdx);
          }
        }
      }

      lyricsData.forEach((line, lineIndex) => {
        if (activeIndices.has(lineIndex)) return;
        if (!isLineDynamicallyActiveAtTime(line, t)) return;
        activeIndices.add(lineIndex);
      });

      if (activeIndices.size > 1) {
        const activeList = Array.from(activeIndices).sort((a, b) => a - b);
        activeList.forEach((activeIdx) => {
          const activeLine = lyricsData[activeIdx];
          if (activeLine?.duetSide !== 'right') return;

          const activeText = normalizeLyricCompareTextStrict(activeLine?.text);
          if (!activeText) return;

          const hasMatchingLeft = activeList.some((otherIdx) => {
            if (otherIdx === activeIdx) return false;
            const otherLine = lyricsData[otherIdx];
            if (otherLine?.duetSide !== 'left') return false;
            // Dynamic LRC・・譁・ｭ怜酔譛滂ｼ峨・蝣ｴ蜷医・陦後・髢句ｧ区凾蛻ｻ縺梧怙螟ｧ5遘偵★繧後ｋ蜿ｯ閭ｽ諤ｧ縺後≠繧九◆繧・
            // 險ｱ螳ｹ蟷・ｒ蜍慕噪縺ｫ蛻・ｊ譖ｿ縺医ｋ・磯壼ｸｸLRC縺ｯDUET_DUPLICATE_TOLERANCE=1.0s縺ｮ縺ｾ縺ｾ・・
            const dedupeTol = (Array.isArray(dynamicLines) && dynamicLines.length > 0)
              ? 5.0
              : DUET_DUPLICATE_TOLERANCE;
            if (!isSameTimestamp(otherLine?.time, activeLine?.time, dedupeTol)) return false;

            const otherText = normalizeLyricCompareTextStrict(otherLine?.text);
            return !!otherText && scoreLyricTextMatch(otherText, activeText) >= 100;
          });

          if (hasMatchingLeft) {
            activeIndices.delete(activeIdx);
          }
        });
      }
    }

    targets.forEach(container => {
      const rows = container.querySelectorAll('.lyric-line');
      if (rows.length === 0) return;

      rows.forEach((r, i) => {
        const isActive = activeIndices.has(i);
        const isPrimary = (i === idx);

        if (isActive) {
          if (!r.classList.contains('active')) {
            r.classList.add('active');

// Only the primary line should scroll / count replay
           // Only the primary line should scroll / count replay
// Only the primary line should scroll / count replay
           // Only the primary line should scroll / count replay
            if (isPrimary) {
              // 逕ｻ髱｢縺ｮ遞ｮ鬘橸ｼ磯壼ｸｸ逕ｻ髱｢縺輝IP縺具ｼ峨〒繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ菴咲ｽｮ繧貞・縺代ｋ
              if (container === ui.lyrics) {
                // 縲宣壼ｸｸ蜀咲函逕ｻ髱｢縲・繝悶Λ繧ｦ繧ｶ縺ｮ讓呎ｺ匁ｩ溯・縺ｧ縲檎黄逅・噪縺ｪ荳ｭ螟ｮ縲阪↓蠑ｷ蛻ｶ驟咲ｽｮ
                r.scrollIntoView({ behavior: 'smooth', block: 'center' });
                ReplayManager.incrementLyricCount();
              } else {
                // 縲娠IP・亥ｰ冗ｪ難ｼ峨・蠑輔″邯壹″ Apple Music鬚ｨ縺ｫ縲御ｺ瑚｡御ｸ・(35%縺ｮ菴咲ｽｮ)縲阪ｒ繧ｭ繝ｼ繝・
                const offsetTop = r.offsetTop;
                const containerHeight = container.clientHeight;
                const targetScroll = offsetTop - (containerHeight * 0.35) + (r.offsetHeight / 2);
                container.scrollTo({ top: targetScroll, behavior: 'smooth' });
              }
            }            
                      }


          const charSpans = r.querySelectorAll('.lyric-char');
          if (charSpans.length > 0) {
            charSpans.forEach(sp => {
              const tt = parseFloat(sp.dataset.time || '0');
              if (Number.isFinite(tt) && tt <= t) {
                sp.classList.add('char-active');
                sp.classList.remove('char-pending');
              } else {
                sp.classList.remove('char-active');
                sp.classList.add('char-pending');
              }
            });
          }
        } else {
          r.classList.remove('active');

          const charSpans = r.querySelectorAll('.lyric-char');
          if (charSpans.length > 0) {
            charSpans.forEach(sp => {
              sp.classList.remove('char-active');
              sp.classList.add('char-pending');
            });
          }
        }
      });
    });

    lastActiveIndex = idx;
  }

  // ===================== Share 讖溯・ =====================

  function onShareButtonClick() {
    if (!lyricsData.length) {
      showToast('蜈ｱ譛峨〒縺阪ｋ豁瑚ｩ槭′縺ゅｊ縺ｾ縺帙ｓ');
      return;
    }
    shareMode = !shareMode;
    shareStartIndex = null;
    shareEndIndex = null;
    if (shareMode) {
      document.body.classList.add('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.add('share-active');
      showToast('蜈ｱ譛峨＠縺溘＞豁瑚ｩ槭・髢句ｧ玖｡後→邨ゆｺ・｡後ｒ繧ｯ繝ｪ繝・け縺励※縺上□縺輔＞');
    } else {
      document.body.classList.remove('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.remove('share-active');
    }
    updateShareSelectionHighlight();
  }

  function handleShareLineClick(index) {
    if (!shareMode) return;
    if (!lyricsData.length) return;
    if (shareStartIndex == null) {
      shareStartIndex = index;
      shareEndIndex = null;
      updateShareSelectionHighlight();
      return;
    }
    if (shareEndIndex == null) {
      shareEndIndex = index;
      updateShareSelectionHighlight();
      finalizeShareSelection();
      return;
    }
    shareStartIndex = index;
    shareEndIndex = null;
    updateShareSelectionHighlight();
  }

  function updateShareSelectionHighlight() {
    if (!ui.lyrics) return;
    const rows = ui.lyrics.querySelectorAll('.lyric-line');
    rows.forEach(r => {
      r.classList.remove('share-select');
      r.classList.remove('share-select-range');
      r.classList.remove('share-select-start');
      r.classList.remove('share-select-end');
    });
    if (!shareMode || shareStartIndex == null || !lyricsData.length) return;
    const max = lyricsData.length ? lyricsData.length - 1 : 0;
    let s, e;
    if (shareEndIndex == null) {
      const idx = Math.max(0, Math.min(shareStartIndex, max));
      s = idx;
      e = idx;
    } else {
      const minIdx = Math.min(shareStartIndex, shareEndIndex);
      const maxIdx = Math.max(shareStartIndex, shareEndIndex);
      s = Math.max(0, Math.min(minIdx, max));
      e = Math.max(0, Math.min(maxIdx, max));
    }
    for (let i = s; i <= e && i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      row.classList.add('share-select-range');
      if (i === s) row.classList.add('share-select-start');
      if (i === e) row.classList.add('share-select-end');
    }
  }

  function getShareSelectionInfo() {
    if (!lyricsData.length || shareStartIndex == null) return null;
    const max = lyricsData.length - 1;
    let s, e;
    if (shareEndIndex == null) {
      const idx = Math.max(0, Math.min(shareStartIndex, max));
      s = idx;
      e = idx;
    } else {
      const minIdx = Math.min(shareStartIndex, shareEndIndex);
      const maxIdx = Math.max(shareStartIndex, shareEndIndex);
      s = Math.max(0, Math.min(minIdx, max));
      e = Math.max(0, Math.min(maxIdx, max));
    }
    const parts = [];
    for (let i = s; i <= e; i++) {
      if (!lyricsData[i]) continue;
      let t = (lyricsData[i].text || '').trim();
      if (t) parts.push(t);
    }
    const phrase = parts.join('\n');
    let timeMs = 0;
    if (hasTimestamp && lyricsData[s] && typeof lyricsData[s].time === 'number') {
      timeMs = Math.round(lyricsData[s].time * 1000);
    } else {
      const v = document.querySelector('video');
      if (v && typeof v.currentTime === 'number') {
        timeMs = Math.round(v.currentTime * 1000);
      }
    }
    return { phrase, timeMs };
  }

  function normalizeToHttps(url) {
    if (!url) return url;
    try {
      const u = new URL(url, 'https://lrchub.coreone.work');
      u.protocol = 'https:';
      return u.toString();
    } catch (e) {
      if (url.startsWith('http://')) {
        return 'https://' + url.slice(7);
      }
      return url;
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve();
    }
  }

  async function finalizeShareSelection() {
    const info = getShareSelectionInfo();
    if (!info || !info.phrase) {
      showToast('Selected lyrics are empty');
      return;
    }
    const youtube_url = getCurrentVideoUrl();
    const video_id = getCurrentVideoId();
    try {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'SHARE_REGISTER', payload: { youtube_url, video_id, phrase: info.phrase, lang, time_ms: info.timeMs } },
          resolve
        );
      });
      if (!res || !res.success) {
        console.error('Share register failed:', res && res.error);
        showToast('蜈ｱ譛峨↓螟ｱ謨励＠縺ｾ縺励◆');
        return;
      }
      let shareUrl = (res.data && res.data.share_url) || '';
      shareUrl = normalizeToHttps(shareUrl);
      if (!shareUrl && video_id) {
        const sec = Math.round((info.timeMs || 0) / 1000);
        shareUrl = `https://lrchub.coreone.work/s/${video_id}/${sec}`;
      }
      if (shareUrl) {
        await copyToClipboard(shareUrl);
        showToast('蜈ｱ譛峨Μ繝ｳ繧ｯ繧偵さ繝斐・縺励∪縺励◆');
      } else {
        showToast('蜈ｱ譛峨Μ繝ｳ繧ｯ縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆');
      }
    } catch (e) {
      console.error('Share register error', e);
      showToast('蜈ｱ譛峨↓螟ｱ謨励＠縺ｾ縺励◆');
    } finally {
      shareMode = false;
      shareStartIndex = null;
      shareEndIndex = null;
      document.body.classList.remove('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.remove('share-active');
      updateShareSelectionHighlight();
    }
  }

  async function sendLockRequest(requestId) {
    const youtube_url = getCurrentVideoUrl();
    const video_id = getCurrentVideoId();
    const reqInfo = Array.isArray(lyricsRequests)
      ? lyricsRequests.find(r => r.id === requestId || r.request === requestId || (r.aliases || []).includes(requestId))
      : null;
    const requestTarget = inferLockRequestTarget(reqInfo || { request: requestId });
    try {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'SELECT_LYRICS_CANDIDATE', payload: { youtube_url, video_id, request: requestId } },
          resolve
        );
      });
      if (res?.success) {
        showToast('豁瑚ｩ槭ｒ遒ｺ螳壹＠縺ｾ縺励◆');
        if (reqInfo) {
          reqInfo.locked = true;
          reqInfo.available = false;
        }
        const currentState = syncLyricsLockState();
        const nextState = {
          ...(currentState || { sync: false, dynamic: false, byRequest: {} }),
          byRequest: { ...(currentState?.byRequest || {}) }
        };
        nextState.byRequest[String(requestId || '').toLowerCase()] = true;
        if (requestTarget === 'sync') nextState.sync = true;
        if (requestTarget === 'dynamic') nextState.dynamic = true;
        lyricsLockState = nextState;
        refreshLockMenu();
      } else {
        const msg = res?.error || (res?.raw && (res.raw.message || res.raw.code)) || '豁瑚ｩ槭・遒ｺ螳壹↓螟ｱ謨励＠縺ｾ縺励◆';
        showToast(msg);
      }
    } catch (e) {
      console.error('lock request error', e);
      showToast('豁瑚ｩ槭・遒ｺ螳壹↓螟ｱ謨励＠縺ｾ縺励◆');
    }
  }



  function setupPlayerBarBlankClickGuard() {
    const bar = document.querySelector('ytmusic-player-bar');
    if (!bar || bar.dataset.ytmBlankClickGuard === '1') return;
    bar.dataset.ytmBlankClickGuard = '1';

    // 菴咏區繧ｯ繝ｪ繝・け縺後・繝ｬ繧､繝､繝ｼ縺ｮ髢矩哩縺ｫ郢九′繧九・繧帝亟縺撰ｼ医・繧ｿ繝ｳ/繧ｹ繝ｩ繧､繝繝ｼ遲峨・騾壼ｸｸ騾壹ｊ蜍輔°縺呻ｼ・
    bar.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;

      // 繧､繝ｳ繧ｿ繝ｩ繧ｯ繝・ぅ繝冶ｦ∫ｴ縺ｯ騾壹☆・磯哩縺倥ｋ繝懊ち繝ｳ縺ｮ騾・ｸ芽ｧ偵ｂ縺薙％縺ｫ蜷ｫ縺ｾ繧後ｋ諠ｳ螳夲ｼ・
      if (
        t.closest('button, a, input, textarea, select, tp-yt-paper-icon-button, tp-yt-paper-button, tp-yt-paper-slider, ytmusic-like-button-renderer, ytmusic-toggle-button-renderer')
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  const tick = async () => {
  if (document.querySelector('.ad-interrupting') || document.querySelector('.ad-showing')) return;

    let toggleBtn = document.getElementById('my-mode-toggle');


    if (!toggleBtn) {
      const rc = document.querySelector('.right-controls-buttons');
      if (rc) {
        toggleBtn = createEl('button', 'my-mode-toggle', '', 'IMMERSION');


        if (config.mode) toggleBtn.classList.add('active');

        toggleBtn.onclick = () => {
          config.mode = !config.mode;
          document.body.classList.toggle('ytm-custom-layout', config.mode);
          if(isYTMPremiumUser()) changeIModeUIWithMovieMode(config.mode);

          toggleBtn.classList.toggle('active', config.mode);
        };
        rc.prepend(toggleBtn);
      }
    } else {

      const isActive = toggleBtn.classList.contains('active');
      if (config.mode && !isActive) toggleBtn.classList.add('active');
      else if (!config.mode && isActive) toggleBtn.classList.remove('active');
    }


    const layout = document.querySelector('ytmusic-app-layout');
    const isPlayerOpen = layout?.hasAttribute('player-page-open');
    if (!config.mode || !isPlayerOpen) {
      document.body.classList.remove('ytm-custom-layout');
      return;
    }
    document.body.classList.add('ytm-custom-layout');
    initLayout();


    setupPlayerBarBlankClickGuard();
    (function patchSliders() {
      const sliders = document.querySelectorAll('ytmusic-player-bar .middle-controls tp-yt-paper-slider');
      sliders.forEach(s => {
        try {
          s.style.boxSizing = 'border-box';
          s.style.paddingLeft = '20px';
          s.style.paddingRight = '20px';
          s.style.minWidth = '0';
          s.style.cursor = 'pointer';
        } catch (e) { }
      });
    })();

    const meta = getMetadata();
    if (!meta) return;
    const key = `${meta.title}///${meta.artist}`;

    if (currentKey !== key) {
      // 繧ｯ繝ｩ繧ｦ繝牙酔譛・
      if (currentKey !== null && CloudSync && typeof CloudSync.syncNow === 'function') {
        CloudSync.syncNow();
      }

      const v = document.querySelector('video');
      const currentTime = v ? v.currentTime : 0;
      const duration = v ? v.duration : 0;


      if (currentTime < 5 || (duration > 0 && Math.abs(duration - currentTime) < 5)) {
        timeOffset = 0;
      } else {
        timeOffset = currentTime;
      }

      if (!config.saveSyncOffset) {
        if (isFirstSongDetected) {
          isFirstSongDetected = false;
        } else {
          const offsetInput = document.getElementById('sync-offset-input');
          if (offsetInput) {
            offsetInput.value = 0;
          }
          config.syncOffset = 0;
          storage.set('ytm_sync_offset', 0);
        }
      } else {
        isFirstSongDetected = false;
      }


      currentKey = key;
      lyricsData = [];
      dynamicLines = null;
      duetSubDynamicLines = null;
      _duetExcludedTimes = new Set();
      lyricsCandidates = null;
      selectedCandidateId = null;
      lyricsRequests = null;
      lyricsConfig = null;
      lyricsLockState = null;
      shareMode = false;
      shareStartIndex = null;
      shareEndIndex = null;
      document.body.classList.remove('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.remove('share-active');
      lastActiveIndex = -1;
      lastTimeForChars = -1;

      if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
        QueueManager.onSongChanged();
      }

      updateMetaUI(meta);
      preferLyricsDefault(key);

      // PIP繧ｦ繧｣繝ｳ繝峨え縺ｮ繝｡繧ｿ繝・・繧ｿ縺ｨ豁瑚ｩ櫁｡ｨ遉ｺ繧偵Μ繧ｻ繝・ヨ
      if (PipManager) {
        PipManager.updateMeta(meta.title, meta.artist);
        PipManager.resetLyrics(); // 縺薙％縺ｧ豁瑚ｩ槭ｒ荳譌ｦ豸医☆
      }

      refreshCandidateMenu();
      refreshLockMenu();
      if (ui.lyrics) ui.lyrics.scrollTop = 0;
      loadLyrics(meta);
    }
  };

function updateMetaUI(meta) {
  ui.title.innerText = meta.title;
  ui.artist.innerText = meta.artist;

  if (meta.src) {
    ui.artwork.innerHTML = `<img src="${meta.src}" crossorigin="anonymous">`;
    ui.bg.style.backgroundImage = `url(${meta.src})`;
  }
  ui.lyrics.innerHTML = '<div class="lyric-loading" style="opacity:0.5; padding:20px;">Loading...</div>';

  // 繧｢繝ｼ繝・ぅ繧ｹ繝医・繝ｼ繧ｸ縺ｮURL繧貞叙蠕・
  let retryCount = 0;
  const maxRetries = 5;
  const trySetArtistLink = () => {
    const bylineWrapper = document.querySelector('ytmusic-player-bar yt-formatted-string.byline.complex-string');
    if (!bylineWrapper) {
      retryCount++;
      if (retryCount < maxRetries) {
        setTimeout(trySetArtistLink, 300);
      } else {
        ui.artist.innerText = meta.artist; // 繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ
      }
      return;
    }

    const artistLinks = Array.from(
      bylineWrapper.querySelectorAll('a.yt-simple-endpoint')
    ).filter(a => {
      const href = a.href || '';
      return href.includes('channel/') || href.includes('/channel/');
    });

    if (artistLinks.length > 0) {
      let artistHTML = '';

      artistLinks.forEach((link, index) => {
        const name = link.textContent.trim();
        const url = link.href;

        artistHTML += `<a href="${url}" 
          style="color:inherit; text-decoration:none;"
          target="_blank">
          ${name}
        </a>`;
        if (index < artistLinks.length - 1) {
          artistHTML += ' 窶｢ ';
        }
      });
      ui.artist.innerHTML = artistHTML;
      return;
    }

    retryCount++;
    if (retryCount < maxRetries) {
      setTimeout(trySetArtistLink, 300);
    } else {
      ui.artist.innerText = meta.artist;
    }
  };

trySetArtistLink();
}

  (async function applySavedVisualSettings() {
    // 1. 豁瑚ｩ槭・螟ｪ縺・
    const savedWeight = await storage.get('ytm_lyric_weight');
    if (savedWeight) {
      config.lyricWeight = savedWeight;
      document.documentElement.style.setProperty('--ytm-lyric-weight', savedWeight);
    }

    // 2. 閭梧勹縺ｮ譏弱ｋ縺・
    const savedBright = await storage.get('ytm_bg_brightness');
    if (savedBright) {
      config.bgBrightness = savedBright;
      document.documentElement.style.setProperty('--ytm-bg-brightness', savedBright);
    }

    // 3. 蟾ｦ謠・∴繧ｪ繝励す繝ｧ繝ｳ
    const leftAlignStored = await storage.get('ytm_left_align');
    if (leftAlignStored !== null) config.leftAlignInfo = leftAlignStored;
    document.body.classList.toggle('ytm-align-left', !!config.leftAlignInfo);

    // 4. Apple Music鬚ｨ閭梧勹繧ｪ繝励す繝ｧ繝ｳ
    const appleBgStored = await storage.get('ytm_apple_bg');
    if (appleBgStored !== null) config.appleBg = appleBgStored;
    document.body.classList.toggle('ytm-apple-bg', !!config.appleBg);
  })();
  
  
  // ===================== 蛻晄悄蛹・=====================

  ReplayManager.init();
  QueueManager.init();
  CloudSync.init();

  loadRemoteTextsFromGithub();

  console.log('YTM Immersion loaded.');


  const setupObserver = () => {

    const targetNode = document.querySelector('ytmusic-player-bar');


    if (!targetNode) {
      setTimeout(setupObserver, 500);
      return;
    }


    const observer = new MutationObserver(() => {

      tick();
    });



    observer.observe(targetNode, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true
    });

    console.log('YTM Immersion: Zero-delay observer started.');

    tick();
  };
