// Reading views (spotlight + word), playback timing, position, speed and text size.
import { st, $, prefs, WPM_MIN, WPM_MAX } from './state.js';
import { T } from './i18n.js';
import { updateBook } from './db.js';

let timer = null;
let wakeLock = null;
let saveTimer = null;

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

/** Units shown one at a time in word mode. Vietnamese can pair syllables. */
export function tokens(s) {
  if (!(st.doc.lang === 'vi' && st.chunk)) return s.w;
  if (s.c) return s.c;
  const c = [];
  let buf = [];
  s.w.forEach((w) => {
    buf.push(w);
    if (buf.length === 2 || /[.,;:!?…)"”’—–]$/.test(w) || w.length > 7) { c.push(buf.join(' ')); buf = []; }
  });
  if (buf.length) c.push(buf.join(' '));
  return (s.c = c);
}

export function clearTokenCache() {
  if (st.doc) st.doc.S.forEach((s) => { delete s.c; });
}

export function invalidate() { st.renderedPage = -1; }

export function render() {
  $('spot').hidden = st.mode !== 'spot';
  $('word').hidden = st.mode !== 'word';
  $('modeSpot').setAttribute('aria-pressed', st.mode === 'spot');
  $('modeWord').setAttribute('aria-pressed', st.mode === 'word');
  if (!st.doc) return;
  if (st.mode === 'spot') renderSpot(); else renderWord();
  renderPos();
}

/** Fill an element with sentence text, wrapping search matches in <mark>. */
export function fillMarked(el, i, t, hits = st.Q.hits) {
  el.textContent = '';
  let p = 0;
  for (const h of hits) {
    if ((h.i !== undefined && h.i !== i) || h.a < p) continue;
    const m = document.createElement('mark');
    m.textContent = t.slice(h.a, h.b);
    el.append(t.slice(p, h.a), m);
    p = h.b;
  }
  el.append(t.slice(p));
}

function renderSpot() {
  const D = st.doc;
  const p = D.S[st.si].p;
  const spot = $('spot');
  spot.lang = D.lang;
  if (st.renderedPage !== p) {
    st.renderedPage = p;
    spot.innerHTML = '';
    const tag = document.createElement('div');
    tag.className = 'pageTag';
    tag.textContent = T('pageOf')(p, D.pages);
    spot.appendChild(tag);
    D.S.forEach((s, i) => {
      if (s.p !== p) return;
      const sp = document.createElement('span');
      sp.className = 's';
      sp.dataset.i = i;
      fillMarked(sp, i, s.t);
      sp.onclick = () => jump(i);
      spot.append(sp, ' ');
    });
  }
  let on = null;
  spot.querySelectorAll('.s').forEach((el) => {
    const active = +el.dataset.i === st.si;
    el.classList.toggle('on', active);
    if (active) on = el;
  });
  if (on) {
    const m = $('stage');
    m.scrollTo({ top: on.offsetTop - m.clientHeight * 0.42 + on.offsetHeight / 2 });
  }
}

/** Split a word around its optimal recognition point. */
function orp(w) {
  const chars = [...w];
  const first = chars.findIndex((c) => /[\p{L}\p{N}]/u.test(c));
  let last = chars.length - 1;
  while (last > 0 && !/[\p{L}\p{N}]/u.test(chars[last])) last--;
  const L = first < 0 ? 0 : last - first + 1;
  const k = Math.max(0, first) + (L < 2 ? 0 : L < 6 ? 1 : L < 10 ? 2 : 3);
  return [chars.slice(0, k).join(''), chars[k] || '', chars.slice(k + 1).join('')];
}

function renderWord() {
  const D = st.doc;
  const s = D.S[st.si];
  const tk = tokens(s);
  if (st.wi >= tk.length) st.wi = tk.length - 1;
  const cur = tk[st.wi];
  if (cur.includes(' ')) {
    const mid = cur.indexOf(' ');
    $('wl').textContent = cur.slice(0, mid);
    $('wp').textContent = ' ';
    $('wr').textContent = cur.slice(mid + 1);
  } else {
    const [a, b, c] = orp(cur);
    $('wl').textContent = a; $('wp').textContent = b; $('wr').textContent = c;
  }
  const ctx = $('wctx');
  ctx.textContent = '';
  ctx.lang = D.lang;
  tk.forEach((w, i) => {
    if (i) ctx.append(' ');
    if (i === st.wi) { const b = document.createElement('b'); b.textContent = w; ctx.appendChild(b); } else ctx.append(w);
  });
}

export function renderPos() {
  const D = st.doc;
  const tot = D.S.length;
  let left = 0;
  for (let i = st.si; i < tot; i++) left += D.S[i].w.length;
  const mins = Math.max(1, Math.round(left / st.wpm));
  $('pos').innerHTML = T('pos')(D.S[st.si].p, D.pages, (st.si + 1).toLocaleString(), tot.toLocaleString(), mins, st.wpm);
  $('fill').style.width = ((st.si + 1) / tot * 100).toFixed(2) + '%';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePosition, 500);
}

function savePosition() {
  const D = st.doc;
  if (!D) return;
  if (D.id) {
    updateBook(D.id, { pos: st.si, page: D.S[st.si].p, total: D.S.length, opened: Date.now() }).catch(() => {});
  } else {
    prefs.set('pos:' + D.key, st.si);
  }
}

function delay() {
  const D = st.doc;
  const base = 60000 / st.wpm;
  if (st.mode === 'spot') return Math.max(900, D.S[st.si].w.length * base + 300);
  const tk = tokens(D.S[st.si]);
  const w = tk[st.wi];
  let d = base * w.split(' ').length;
  if (w.length > 9 && !w.includes(' ')) d *= 1.3;
  if (/[.!?…]["'”’)\]]*$/.test(w) || st.wi === tk.length - 1) d *= 2.2;
  else if (/[,;:—–]["'”’)\]]*$/.test(w)) d *= 1.6;
  return d;
}

function tick() {
  timer = setTimeout(() => {
    const D = st.doc;
    if (st.mode === 'word' && st.wi < tokens(D.S[st.si]).length - 1) st.wi++;
    else if (st.si < D.S.length - 1) { st.si++; st.wi = 0; }
    else { stop(); return; }
    render();
    tick();
  }, delay());
}

export function play() {
  if (!st.doc || st.playing) return;
  st.playing = true;
  updatePlay();
  tick();
  try { navigator.wakeLock && navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {}); } catch { /* ignore */ }
}

export function stop() {
  st.playing = false;
  clearTimeout(timer);
  updatePlay();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function atEnd() {
  return st.si >= st.doc.S.length - 1 && (st.mode === 'spot' || st.wi >= tokens(st.doc.S[st.si]).length - 1);
}

export function toggle() {
  if (!st.doc) return;
  if (st.playing) { stop(); return; }
  if (atEnd()) { st.si = 0; st.wi = 0; render(); }
  play();
}

export function updatePlay() {
  const b = $('playBtn');
  b.setAttribute('aria-label', T(st.playing ? 'pause' : 'play'));
  b.title = T(st.playing ? 'pause' : 'play') + ' (Space)';
  b.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY;
}

export function restart() {
  if (st.playing) { clearTimeout(timer); tick(); }
}

export function jump(i, wi = 0) {
  if (!st.doc) return;
  st.si = Math.max(0, Math.min(st.doc.S.length - 1, i));
  st.wi = wi;
  render();
  restart();
}

export function step(d) {
  if (!st.doc) return;
  if (st.mode === 'word' && d < 0 && st.wi > 0) { st.wi = 0; render(); restart(); return; }
  jump(st.si + d);
}

export function setMode(m) {
  st.mode = m;
  prefs.set('mode', m);
  invalidate();
  st.wi = 0;
  render();
  restart();
}

export function setWpm(v) {
  st.wpm = Math.max(WPM_MIN, Math.min(WPM_MAX, Math.round(v)));
  $('wpm').value = st.wpm;
  $('wpmOut').textContent = st.wpm + ' ' + T('unit');
  prefs.set('wpm', st.wpm);
  if (st.doc) renderPos();
}

export function setFs(v) {
  st.fs = Math.max(16, Math.min(32, v));
  document.documentElement.style.setProperty('--fs', st.fs + 'px');
  prefs.set('fs', st.fs);
  invalidate();
  if (st.doc) render();
}
