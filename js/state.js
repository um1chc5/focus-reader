// Shared app state and small helpers used by every module.

export const $ = (id) => document.getElementById(id);

/** Per-browser preferences (theme, speed, …). Never throws. */
export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('fr:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem('fr:' + key, JSON.stringify(value)); } catch { /* storage blocked */ }
  },
};

export const st = {
  /** Current document: { id?, sample?, name, pages, lang, S: [{t, p, w}], pdf?, thumbs: Map } */
  doc: null,
  si: 0,            // current sentence index
  wi: 0,            // current token index inside the sentence (word mode)
  playing: false,
  view: 'reader',   // 'reader' | 'library'
  renderedPage: -1,
  mode: prefs.get('mode', 'spot'),
  wpm: prefs.get('wpm', 300),
  fs: prefs.get('fs', 21),
  chunk: prefs.get('chunk', true),
  lang: prefs.get('lang', /^vi/i.test(navigator.language || '') ? 'vi' : 'en'),
  /** In-document search state */
  Q: { q: '', fq: '', hits: [], cur: -1, fresh: false },
};

export const WPM_MIN = 100;
export const WPM_MAX = 800;
export const WPM_STEP = 25;
