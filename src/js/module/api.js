export const LRCHUB_LYRICS_ENDPOINT = 'https://lrchub.coreone.work/api/lyrics';

const emptyLyricsResult = () => ({
  lyrics: '',
  dynamicLines: null,
  subLyrics: '',
  hasSelectCandidates: false,
  candidates: [],
  config: null,
  requests: [],
});

const unwrapResponse = (payload) => {
  if (payload && typeof payload === 'object' && payload.response && typeof payload.response === 'object') {
    return payload.response;
  }
  return payload;
};

const firstString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

export const formatLrcTime = (seconds) => {
  const total = Math.max(0, Number(seconds) || 0);
  const min = Math.floor(total / 60);
  const sec = Math.floor(total - min * 60);
  const cs = Math.floor((total - min * 60 - sec) * 100);
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  const cc = String(cs).padStart(2, '0');
  return `${mm}:${ss}.${cc}`;
};

const getDynamicLineStartMs = (line) => {
  if (!line || typeof line !== 'object') return null;

  if (typeof line.startTimeMs === 'number' && Number.isFinite(line.startTimeMs)) {
    return line.startTimeMs;
  }

  if (typeof line.startTimeMs === 'string') {
    const n = Number(line.startTimeMs);
    if (Number.isFinite(n)) return n;
  }

  if (typeof line.time === 'number' && Number.isFinite(line.time)) {
    return line.time * 1000;
  }

  if (Array.isArray(line.chars) && line.chars.length) {
    const times = line.chars
      .map(ch => {
        if (typeof ch?.t === 'number' && Number.isFinite(ch.t)) return ch.t;
        if (typeof ch?.t === 'string') {
          const n = Number(ch.t);
          if (Number.isFinite(n)) return n;
        }
        return null;
      })
      .filter(v => v !== null);
    if (times.length) return Math.min(...times);
  }

  return null;
};

export const buildLrcFromDynamicLines = (lines) => {
  if (!Array.isArray(lines) || !lines.length) return '';

  return lines
    .map(line => {
      const ms = getDynamicLineStartMs(line);
      if (ms === null) return null;

      let textLine = '';
      if (typeof line.text === 'string' && line.text.length) {
        textLine = line.text;
      } else if (Array.isArray(line.chars)) {
        textLine = line.chars
          .map(ch => ch?.c || ch?.text || ch?.caption || '')
          .join('');
      }

      const timeTag = `[${formatLrcTime(ms / 1000)}]`;
      return textLine ? `${timeTag} ${String(textLine)}` : timeTag;
    })
    .filter(Boolean)
    .join('\n')
    .trimEnd();
};

export const extractLyricsText = (payload) => {
  const res = unwrapResponse(payload);
  if (typeof res === 'string') return res.trim();
  if (!res || typeof res !== 'object') return '';

  return firstString(
    res.lyrics,
    res.synced_lyrics,
    res.syncedLyrics,
    res.plain_lyrics,
    res.plainLyrics,
    res.plain_lyrics_text,
    res.lrc,
    res.text
  );
};

const normalizeCandidate = (candidate, index) => {
  if (!candidate || typeof candidate !== 'object') return null;

  const lyrics = extractLyricsText(candidate);
  const id = firstString(
    candidate.id,
    candidate.candidate_id,
    candidate.candidateId,
    candidate.path,
    candidate.select,
    candidate.title,
    candidate.name
  ) || `lrchub_${index}`;

  return {
    ...candidate,
    id,
    candidate_id: candidate.candidate_id || candidate.candidateId || id,
    title: candidate.title || candidate.track || candidate.track_name || candidate.name || '',
    artist: candidate.artist || candidate.artist_name || candidate.artistName || '',
    source: candidate.source || 'LRCHub',
    has_synced: typeof candidate.has_synced === 'boolean'
      ? candidate.has_synced
      : !!firstString(candidate.synced_lyrics, candidate.syncedLyrics),
    lyrics,
  };
};

const normalizeCandidates = (res) => {
  if (!res || typeof res !== 'object') return [];

  const raw =
    (Array.isArray(res.candidates) && res.candidates) ||
    (Array.isArray(res.lyrics_candidates) && res.lyrics_candidates) ||
    (Array.isArray(res.select_candidates) && res.select_candidates) ||
    [];

  return raw
    .map((candidate, index) => normalizeCandidate(candidate, index))
    .filter(Boolean);
};

export const fetchFromLrchub = (track, artist, videoId) => {
  const cleanTrack = String(track || '').trim();
  const cleanArtist = String(artist || '').trim();
  const cleanVideoId = String(videoId || '').trim();

  if (!cleanTrack) return Promise.resolve(emptyLyricsResult());

  const body = { track: cleanTrack, artist: cleanArtist };
  if (cleanVideoId) body.video_id = cleanVideoId;

  return fetch(LRCHUB_LYRICS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(async (r) => {
      const text = await r.text();
      let json = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch (e) {
        json = text;
      }

      if (!r.ok) {
        const msg = json && typeof json === 'object'
          ? (json.error || json.message || r.statusText)
          : (text || r.statusText);
        throw new Error(`LRCHub lyrics failed: ${r.status} ${msg}`);
      }

      const res = unwrapResponse(json);
      const out = emptyLyricsResult();

      if (res && typeof res === 'object') {
        if (
          res.dynamic_lyrics &&
          Array.isArray(res.dynamic_lyrics.lines) &&
          res.dynamic_lyrics.lines.length
        ) {
          out.dynamicLines = res.dynamic_lyrics.lines;
          out.lyrics = buildLrcFromDynamicLines(out.dynamicLines);
        }

        if (!out.lyrics) out.lyrics = extractLyricsText(res);

        out.subLyrics = firstString(
          res.subLyrics,
          res.sub_lyrics,
          res.sub_lrc,
          res.duet_lyrics
        );
        out.candidates = normalizeCandidates(res);
        out.hasSelectCandidates = !!res.has_select_candidates || out.candidates.length > 1;
        out.config = res.config || null;
        out.requests = Array.isArray(res.requests) ? res.requests : [];
      } else {
        out.lyrics = extractLyricsText(res);
      }

      return out;
    })
    .catch(err => {
      console.error('[BG] LRCHub lyrics error:', err);
      return emptyLyricsResult();
    });
};

export const fetchCandidateLyrics = async (candidate_id, candidate) => {
  const cand = candidate && typeof candidate === 'object'
    ? candidate
    : (candidate_id && typeof candidate_id === 'object' ? candidate_id : {});

  return extractLyricsText(cand);
};

export const extractVideoIdFromUrl = (youtube_url) => {
  if (!youtube_url) return null;
  try {
    const u = new URL(youtube_url);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace('/', '');
      return id || null;
    }
    const v = u.searchParams.get('v');
    return v || null;
  } catch (e) {
    return null;
  }
};

export const withTimeout = (promise, ms, label) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label || 'timeout')), ms);
    }),
  ]);
};
