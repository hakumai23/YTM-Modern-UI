import * as CloudSync from './module/bg-cloud-sync.js';
import * as API from './module/api.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(CloudSync.CLOUD_STORAGE_KEY, (items) => {
    if (!items || !items[CloudSync.CLOUD_STORAGE_KEY]) {
      chrome.storage.local.set({ [CloudSync.CLOUD_STORAGE_KEY]: CloudSync.DEFAULT_CLOUD_STATE });
    }
  });
});

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || typeof req !== 'object' || !req.type) {
    return;
  }

  if (req.type === 'GET_CLOUD_STATE') {
    CloudSync.loadCloudState()
      .then(state => sendResponse({ ok: true, state }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (req.type === 'SAVE_RECOVERY_TOKEN') {
    const token = typeof req.token === 'string' ? req.token.trim() : '';
    CloudSync.saveCloudState({ recoveryToken: token || null })
      .then(state => sendResponse({ ok: true, state }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (req.type === 'SET_SERVER_BASE_URL') {
    const url = typeof req.serverBaseUrl === 'string' ? req.serverBaseUrl.trim() : '';
    CloudSync.saveCloudState({ serverBaseUrl: url || CloudSync.DEFAULT_CLOUD_STATE.serverBaseUrl })
      .then(state => sendResponse({ ok: true, state }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (req.type === 'OPEN_LOGIN_PAGE') {
    (async () => {
      try {
        const state = await CloudSync.loadCloudState();
        const base = (state.serverBaseUrl || CloudSync.DEFAULT_CLOUD_STATE.serverBaseUrl || '').replace(/\/+$/, '');
        const loginPath = state.loginPath || CloudSync.DEFAULT_CLOUD_STATE.loginPath || '/auth/discord';
        const url = base + loginPath;
        chrome.tabs.create({ url }, () => {
          if (chrome.runtime.lastError) sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          else sendResponse({ ok: true, url });
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'GET_COMMUNITY_REMAINING') {
    (async () => {
      try {
        const data = await API.fetchCommunityRemaining();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  if (req.type === 'SYNC_HISTORY') {
    const history = Array.isArray(req.history) ? req.history : (req.payload && Array.isArray(req.payload.history) ? req.payload.history : []);
    (async () => {
      try {
        const result = await CloudSync.cloudSyncHistory(history);
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'TRANSLATE') {
    const { text, apiKey, targetLang, useSharedTranslateApi } = req.payload || {};
    const target = targetLang || 'JA';
    const texts = Array.isArray(text) ? text : [text];

    const translateViaDeepL = async () => {
      if (!apiKey) throw new Error('DeepL API key is missing');
      const endpoint = apiKey.endsWith(':fx')
        ? 'https://api-free.deepl.com/v2/translate'
        : 'https://api.deepl.com/v2/translate';

      const body = { text: texts, target_lang: target };

      const res = await API.withTimeout(
        fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
        20000,
        'deepl translate timeout'
      );

      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(`DeepL translate failed: ${res.status} ${msg}`);
      }

      const data = await res.json();
      if (!data || !Array.isArray(data.translations)) {
        throw new Error('DeepL translate: invalid response');
      }
      return {
        translations: data.translations,
        engine: 'deepl',
        plan: apiKey.endsWith(':fx') ? 'free' : 'pro',
      };
    };

    const fetchSharedJson = async (payload) => {
      const tryFetch = async (url, init, label) => {
        const res = await API.withTimeout(fetch(url, init), 20000, label || 'shared translate timeout');
        const rawText = await res.text().catch(() => '');
        let data = null;
        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch (e) {
        }
        if (!res.ok) {
          const msg = (data && (data.error || data.message)) ? (data.error || data.message) : (rawText || res.statusText);
          throw new Error(`shared translate http ${res.status}: ${msg}`);
        }
        if (!data || (data.ok !== undefined && !data.ok)) {
          const msg = (data && (data.error || data.message)) ? (data.error || data.message) : 'invalid response';
          throw new Error(`shared translate: ${msg}`);
        }
        return data;
      };

      const jsonInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };

      let lastErr = null;
      for (const url of API.SHARED_TRANSLATE_ENDPOINTS) {
        try {
          return await tryFetch(url, jsonInit, 'shared translate timeout');
        } catch (e) {
          lastErr = e;
        }
      }

      const formBody = new URLSearchParams();
      if (Array.isArray(payload.text)) {
        throw lastErr || new Error('shared translate failed');
      }
      formBody.set('text', String(payload.text ?? ''));
      formBody.set('target_lang', String(payload.target_lang ?? ''));
      const formInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: formBody.toString(),
      };

      for (const url of API.SHARED_TRANSLATE_ENDPOINTS) {
        try {
          return await tryFetch(url, formInit, 'shared translate timeout');
        } catch (e) {
          lastErr = e;
        }
      }

      throw lastErr || new Error('shared translate failed');
    };

    const translateViaShared = async () => {
      const toTranslations = (arr) => arr.map(v => ({ text: (v ?? '').toString() }));
      try {
        const data = await fetchSharedJson({ text: texts, target_lang: target });
        if (Array.isArray(data.text)) {
          return {
            translations: toTranslations(data.text),
            detected_source_language: data.detected_source_language || null,
            engine: data.engine || 'shared',
            plan: data.plan || null,
          };
        }
        if (Array.isArray(data.translations)) {
          const mapped = data.translations.map(x => ({ text: (x && x.text !== undefined ? x.text : x) ?? '' }));
          return {
            translations: mapped,
            detected_source_language: data.detected_source_language || null,
            engine: data.engine || 'shared',
            plan: data.plan || null,
          };
        }
        if (typeof data.text === 'string') {
          return {
            translations: [{ text: data.text }],
            detected_source_language: data.detected_source_language || null,
            engine: data.engine || 'shared',
            plan: data.plan || null,
          };
        }
        throw new Error('Invalid response format from shared API');
      } catch (e) {
        console.warn('[BG] Shared batch translation failed:', e);
        throw e;
      }
    };

    (async () => {
      try {
        if (useSharedTranslateApi) {
          const shared = await translateViaShared();
          sendResponse({
            success: true,
            translations: shared.translations,
            detected_source_language: shared.detected_source_language,
            engine: shared.engine,
            plan: shared.plan,
          });
          return;
        }
        const deepl = await translateViaDeepL();
        sendResponse({
          success: true,
          translations: deepl.translations,
          engine: deepl.engine,
          plan: deepl.plan,
        });
      } catch (e) {
        if (useSharedTranslateApi && apiKey) {
          try {
            const deepl = await translateViaDeepL();
            sendResponse({
              success: true,
              translations: deepl.translations,
              engine: deepl.engine,
              plan: deepl.plan,
              fallback_from: 'shared',
              fallback_error: String(e),
            });
            return;
          } catch (e2) {
            sendResponse({ success: false, error: `${String(e2)} (shared failed: ${String(e)})` });
            return;
          }
        }
        sendResponse({ success: false, error: String(e) });
      }
    })();
    return true;
  }

  // 歌詞取得
  if (req.type === 'GET_LYRICS') {
    const { track, artist, youtube_url, video_id, use_lrclib = true, offset_ms, translate_to, translation_source, lyric_source_mode = 'standard' } = req.payload || {};
    const tabId = sender && sender.tab ? sender.tab.id : null;

    console.log('[BG] GET_LYRICS', { track, artist, lyric_source_mode });

    (async () => {
      let responded = false;
      const sendOnce = (payload) => {
        if (responded) return;
        responded = true;
        sendResponse(payload);
      };

      if (lyric_source_mode === 'lrclib') {
        try {
          const lrcLibRes = await API.fetchFromLrcLib(track, artist);
          if (lrcLibRes && lrcLibRes.lyrics && lrcLibRes.lyrics.trim()) {
            console.log('[BG] Won: LrcLib (LrcLib Only Mode)');
            sendOnce({
              success: true,
              lyrics: lrcLibRes.lyrics,
              dynamicLines: null,
              subLyrics: '',
              hasSelectCandidates: (lrcLibRes.candidates && lrcLibRes.candidates.length > 1),
              candidates: lrcLibRes.candidates || [],
            });
            return;
          }
        } catch (e) {
          console.warn('[BG] LrcLib fetch failed in LrcLib Only Mode:', e);
        }
        sendOnce({
          success: false,
          lyrics: '',
        });
        return;
      }

      const pushMetaUpdate = (meta) => {
        if (!tabId) return;
        try {
          chrome.tabs.sendMessage(tabId, { type: 'LYRICS_META_UPDATE', payload: meta });
        } catch (e) {}
      };

      const sendHubLyrics = (hubRes, sourceLabel) => {
        const candidates = Array.isArray(hubRes.candidates) ? hubRes.candidates : [];
        const meaningData = hubRes.meaningData || API.normalizeLrchubMeaningPayload(hubRes);
        console.log(`[BG] Won: ${sourceLabel}`);
        sendOnce({
          success: true,
          lyrics: hubRes.lyrics,
          animated_lyrics: hubRes.animated_lyrics || hubRes.timedtext || hubRes.timed_text || null,
          dynamicLines: hubRes.dynamicLines || null,
          subLyrics: '',
          hasSelectCandidates: candidates.length > 1,
          candidates,
          config: hubRes.config || null,
          requests: hubRes.requests || [],
          meaningData,
          songSummary: hubRes.songSummary || hubRes.song_summary || hubRes.final_summary || null,
          comments: Array.isArray(hubRes.comments) ? hubRes.comments : [],
          rating: hubRes.rating || null,
          translations: hubRes.translations || null,
          lrcMap: {
            ...API.normalizeLrchubTranslations(hubRes.lrc_map),
            ...API.normalizeLrchubTranslations(hubRes.lrcMap),
            ...API.normalizeLrchubTranslations(hubRes.translations)
          },
        });
      };

      let primaryResolved = false;
      let primaryResult = null;

      const runPrimary = async () => {
        try {
          const hubRes = await API.withTimeout(
            API.fetchFromLrchub({ track, artist, youtube_url, video_id, offset_ms, translate_to, translation_source }),
            8000,
            'lrchub'
          );
          primaryResolved = true;
          if (hubRes && hubRes.lyrics && hubRes.lyrics.trim()) {
            primaryResult = { source: 'LRCHub', res: hubRes };
          }
        } catch (e) {
          primaryResolved = true;
          console.warn('[BG] LRCHub fetch failed:', e);
        }
      };

      const runFallbacks = async () => {
        const tasks = [];
        
        // Task A: LRCHub search
        const searchTask = (async () => {
          try {
            const hubSearchRes = await API.withTimeout(
              API.fetchFromLrchubSearch({ track, artist, limit: 30, translate_to }),
              5000,
              'lrchub search'
            );
            if (hubSearchRes && hubSearchRes.lyrics && hubSearchRes.lyrics.trim()) {
              return { source: 'LRCHub search', res: hubSearchRes };
            }
          } catch (e) {
            console.warn('[BG] LRCHub search fetch failed:', e);
          }
          return null;
        })();
        tasks.push(searchTask);

        // Task B: LRCHub retry
        const retryTask = (async () => {
          try {
            const hubRetryRes = await API.withTimeout(
              API.fetchFromLrchub({ track, artist, youtube_url, video_id, offset_ms, translate_to, translation_source }),
              5000,
              'lrchub retry'
            );
            if (hubRetryRes && hubRetryRes.lyrics && hubRetryRes.lyrics.trim()) {
              return { source: 'LRCHub retry', res: hubRetryRes };
            }
          } catch (e) {
            console.warn('[BG] LRCHub retry fetch failed:', e);
          }
          return null;
        })();
        tasks.push(retryTask);

        // Task C: LrcLib (only when enabled)
        if (use_lrclib) {
          const lrclibTask = (async () => {
            try {
              const lrcLibRes = await API.fetchFromLrcLib(track, artist);
              if (lrcLibRes && lrcLibRes.lyrics && lrcLibRes.lyrics.trim()) {
                return { source: 'LrcLib', res: lrcLibRes };
              }
            } catch (e) {
              console.warn('[BG] LrcLib fetch failed:', e);
            }
            return null;
          })();
          tasks.push(lrclibTask);
        }

        return new Promise(resolve => {
          let resolved = false;
          let pendingCount = tasks.length;
          if (pendingCount === 0) {
            resolve(null);
            return;
          }
          tasks.forEach(t => {
            t.then(result => {
              pendingCount--;
              if (result && !resolved) {
                resolved = true;
                resolve(result);
              } else if (pendingCount === 0 && !resolved) {
                resolve(null);
              }
            });
          });
        });
      };

      const primaryTask = runPrimary();

      // Phase 1: Wait up to 1.5s for primary
      await Promise.race([
        primaryTask,
        API.delay(1500)
      ]);

      if (primaryResult) {
        sendHubLyrics(primaryResult.res, primaryResult.source);
        return;
      }

      // Phase 2: Start fallbacks immediately if primary failed/returned empty, or after 1.5s if pending
      const fallbackTask = runFallbacks();

      if (!primaryResolved) {
        // Wait for whichever resolves first with a valid result, primary or any fallback.
        // If one fails (returns null), we keep waiting for the other.
        const winner = await new Promise(resolve => {
          let resolved = false;
          let pending = 2;
          const check = (result) => {
            pending--;
            if (result && !resolved) {
              resolved = true;
              resolve(result);
            } else if (pending === 0 && !resolved) {
              resolve(null);
            }
          };
          (async () => {
            await primaryTask;
            return primaryResult;
          })().then(check);
          fallbackTask.then(check);
        });

        if (winner) {
          if (winner.source === 'LrcLib') {
            // LrcLib completed first, but let's give primary up to 800ms more since it's richer
            await Promise.race([
              primaryTask,
              API.delay(800)
            ]);
            if (primaryResult) {
              sendHubLyrics(primaryResult.res, primaryResult.source);
              return;
            }
            
            console.log('[BG] Won: LrcLib');
            sendOnce({
              success: true,
              lyrics: winner.res.lyrics,
              dynamicLines: null,
              subLyrics: '',
              hasSelectCandidates: (winner.res.candidates && winner.res.candidates.length > 1),
              candidates: winner.res.candidates || [],
            });
            return;
          } else {
            sendHubLyrics(winner.res, winner.source);
            return;
          }
        }
      } else {
        const winner = await fallbackTask;
        if (winner) {
          if (winner.source === 'LrcLib') {
            console.log('[BG] Won: LrcLib');
            sendOnce({
              success: true,
              lyrics: winner.res.lyrics,
              dynamicLines: null,
              subLyrics: '',
              hasSelectCandidates: (winner.res.candidates && winner.res.candidates.length > 1),
              candidates: winner.res.candidates || [],
            });
            return;
          } else {
            sendHubLyrics(winner.res, winner.source);
            return;
          }
        }
      }

      console.log('[BG] No lyrics found');
      sendOnce({
        success: false,
        lyrics: '',
      });
    })();
    return true;
  }

  if (req.type === 'GET_CANDIDATE_LYRICS') {
    const { candidate, translate_to } = req.payload || {};

    (async () => {
      try {
        const candRes = await API.fetchLrchubCandidateLyrics(candidate, translate_to);
        if (candRes && candRes.lyrics && candRes.lyrics.trim()) {
          sendResponse({
            success: true,
            lyrics: candRes.lyrics,
            animated_lyrics: candRes.animated_lyrics || candRes.timedtext || candRes.timed_text || null,
            dynamicLines: candRes.dynamicLines || null,
            meaningData: candRes.meaningData || API.normalizeLrchubMeaningPayload(candRes),
            songSummary: candRes.songSummary || candRes.song_summary || candRes.final_summary || null,
            comments: Array.isArray(candRes.comments) ? candRes.comments : [],
            rating: candRes.rating || null,
            translations: candRes.translations || null,
            lrcMap: {
              ...API.normalizeLrchubTranslations(candRes.lrc_map),
              ...API.normalizeLrchubTranslations(candRes.lrcMap),
              ...API.normalizeLrchubTranslations(candRes.translations)
            },
            has_synced: /\[\d+:\d{2}(?:\.\d{1,3})?\]/.test(candRes.lyrics)
          });
          return;
        }
        sendResponse({ success: false, lyrics: '' });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'GET_TRANSLATION') {
    const payload = req.payload || {};
    const { track, artist, youtube_url, video_id, lang, langs, translation_source } = payload;

    (async () => {
      const vid = video_id || API.extractVideoIdFromUrl(youtube_url);
      const reqLangs = Array.isArray(langs) && langs.length ? langs : (lang ? [lang] : []);
      const translateTo = reqLangs.map(API.toLrchubTranslateLang).filter(Boolean);
      
      try {
        let lrcMap = {};
        if (translateTo.length) {
          const hubRes = await API.withTimeout(
            API.fetchFromLrchub({
              track,
              artist,
              youtube_url,
              video_id: video_id || vid,
              translate_to: translateTo,
              translation_source
            }),
            20000,
            'lrchub translation'
          );
          lrcMap = {
            ...API.normalizeLrchubTranslations(hubRes?.lrc_map),
            ...API.normalizeLrchubTranslations(hubRes?.lrcMap),
            ...API.normalizeLrchubTranslations(hubRes?.translations)
          };
        }

        if (Object.keys(lrcMap).length) {
          sendResponse({
            success: true,
            lrcMap,
            missing: reqLangs.filter(l => !lrcMap[API.toUiLangKey(l)])
          });
          return;
        }

        const url = new URL(`https://lrchub.coreone.work/api/translation?_=${API.getCacheBuster()}`);
        if (youtube_url) url.searchParams.set('youtube_url', youtube_url);
        else if (video_id) url.searchParams.set('video_id', video_id);
        else if (vid) url.searchParams.set('video_id', vid);

        reqLangs.forEach(l => url.searchParams.append('lang', l));

        const res = await fetch(url.toString()).then(r => r.json());
        sendResponse({ 
          success: true, 
          lrcMap: {
            ...API.normalizeLrchubTranslations(res.lrc_map),
            ...API.normalizeLrchubTranslations(res.lrcMap),
            ...API.normalizeLrchubTranslations(res.translations)
          }, 
          missing: res.missing_langs || [] 
        });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'REGISTER_TRANSLATION') {
    const { youtube_url, video_id, lang, lyrics } = req.payload;
    const body = { lang, lyrics };
    if (youtube_url) body.youtube_url = youtube_url;
    else if (video_id) body.video_id = video_id;

    fetch(`https://lrchub.coreone.work/api/translation?_=${API.getCacheBuster()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(json => {
        sendResponse({ success: !!json.ok, raw: json });
      })
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true;
  }

});

self.addEventListener('fetch', (event) => {
  if (event.preloadResponse) {
    event.waitUntil(event.preloadResponse);
  }
});
