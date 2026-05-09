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


  if (req.type === 'GET_LYRICS') {
    const { track, artist, video_id, videoId } = req.payload || {};
    const resolvedVideoId = video_id || videoId || '';

    console.log('[BG] GET_LYRICS (LRCHub only)', { track, artist, video_id: resolvedVideoId });

    (async () => {
      try {
        const data = await API.withTimeout(
          API.fetchFromLrchub(track, artist, resolvedVideoId),
          15000,
          'lrchub lyrics'
        );

        if (data && typeof data.lyrics === 'string' && data.lyrics.trim()) {
          sendResponse({
            success: true,
            lyrics: data.lyrics,
            dynamicLines: data.dynamicLines || null,
            subLyrics: typeof data.subLyrics === 'string' ? data.subLyrics : '',
            hasSelectCandidates: !!data.hasSelectCandidates,
            candidates: Array.isArray(data.candidates) ? data.candidates : [],
            config: data.config || null,
            requests: Array.isArray(data.requests) ? data.requests : [],
            githubFallback: false,
          });
          return;
        }

        sendResponse({
          success: false,
          lyrics: '',
          dynamicLines: null,
          subLyrics: '',
          hasSelectCandidates: !!data?.hasSelectCandidates,
          candidates: Array.isArray(data?.candidates) ? data.candidates : [],
          config: data?.config || null,
          requests: Array.isArray(data?.requests) ? data.requests : [],
          githubFallback: false,
        });
      } catch (e) {
        sendResponse({ success: false, error: String(e), lyrics: '' });
      }
    })();

    return true;
  }

  if (req.type === 'GET_CANDIDATE_LYRICS') {
    const payload = req.payload || {};
    const candidate_id = payload.candidate_id || null;
    const candidate = payload.candidate && typeof payload.candidate === 'object' ? payload.candidate : {};

    (async () => {
      try {
        const lyrics = await API.fetchCandidateLyrics(candidate_id, candidate);
        if (typeof lyrics === 'string' && lyrics.trim()) {
          sendResponse({
            success: true,
            lyrics: lyrics.trim(),
            candidate_id: candidate_id || candidate.id || candidate.candidate_id || null,
            path: candidate.path || candidate.select || candidate.name || candidate.file || candidate.filename || ''
          });
          return;
        }
        sendResponse({
          success: false,
          error: 'Candidate lyrics not found',
          candidate_id: candidate_id || candidate.id || candidate.candidate_id || null,
          path: candidate.path || candidate.select || candidate.name || candidate.file || candidate.filename || ''
        });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
    })();

    return true;
  }

  if (req.type === 'SELECT_LYRICS_CANDIDATE') {
    const { youtube_url, video_id, candidate_id, request, action, lock } = req.payload || {};
    const body = {};
    if (youtube_url) body.youtube_url = youtube_url;
    else if (video_id) body.video_id = video_id;
    if (candidate_id) body.candidate_id = candidate_id;
    const reqKey = request || action;
    if (reqKey) body.request = reqKey;
    if (typeof lock !== 'undefined') body.lock = String(lock);

    if ((!body.youtube_url && !body.video_id) || (!body.candidate_id && !body.request)) {
      sendResponse({ success: false, error: 'missing params' });
      return;
    }

    fetch('https://lrchub.coreone.work/api/lyrics_select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.text())
      .then(text => {
        try {
          const json = JSON.parse(text);
          sendResponse({ success: !!json.ok, raw: json });
        } catch (e) {
          sendResponse({ success: false, error: 'Invalid JSON', raw: text });
        }
      })
      .catch(err => sendResponse({ success: false, error: err.toString() }));

    return true;
  }




  if (req.type === 'SHARE_REGISTER') {
    const { youtube_url, video_id, phrase, text, lang, time_ms, time_sec } = req.payload || {};
    const body = {};
    if (youtube_url) body.youtube_url = youtube_url;
    else if (video_id) body.video_id = video_id;
    if (phrase || text) body.phrase = phrase || text;
    if (lang) body.lang = lang;
    if (typeof time_ms === 'number') body.time_ms = time_ms;
    else if (typeof time_sec === 'number') body.time_sec = time_sec;

    if ((!body.youtube_url && !body.video_id) || !body.phrase) {
      sendResponse({ success: false, error: 'missing params' });
      return;
    }

    fetch('https://lrchub.coreone.work/api/share/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.text())
      .then(text => {
        try {
          const json = JSON.parse(text);
          sendResponse({ success: !!json.ok, data: json });
        } catch (e) {
          sendResponse({ success: false, error: 'Invalid JSON', raw: text });
        }
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
