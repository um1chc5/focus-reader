// In-document search bar: accent-insensitive matches, results dropdown, next/previous.
import { st, $ } from './state.js';
import { T } from './i18n.js';
import { fold, findAll } from './text.js';
import { render, restart, invalidate, tokens } from './reader.js';

const MAX_LIST = 200;
let debounce = null;

const emptyQ = () => ({ q: '', fq: '', hits: [], cur: -1, fresh: false });

export const foldedOf = (s) => s.F || (s.F = fold(s.t));

export function runSearch() {
  const raw = $('q').value.trim();
  st.Q = { q: raw, fq: fold(raw.replace(/\s+/g, ' ')).f, hits: [], cur: -1, fresh: true };
  const D = st.doc;
  if (D && st.Q.fq.length >= 2) {
    D.S.forEach((s, i) => {
      for (const h of findAll(s.t, st.Q.fq, foldedOf(s))) st.Q.hits.push({ i, ...h });
    });
    if (st.Q.hits.length) {
      st.Q.cur = st.Q.hits.findIndex((h) => h.i >= st.si);
      if (st.Q.cur < 0) st.Q.cur = 0;
    }
  }
  paintCount();
  paintResults(true);
  invalidate();
  render();
}

export function paintCount() {
  const c = $('qCount');
  if (st.Q.fq.length < 2) { c.textContent = ''; return; }
  c.textContent = st.Q.hits.length ? T('qCount')(st.Q.cur + 1, st.Q.hits.length) : T('noMatch');
}

/** Build a snippet element around a match. */
export function snippet(t, a, b, before = 60, after = 90) {
  let s = Math.max(0, a - before);
  let e = Math.min(t.length, b + after);
  if (s > 0) { const sp = t.indexOf(' ', s); if (sp >= 0 && sp < a) s = sp + 1; }
  if (e < t.length) { const sp = t.lastIndexOf(' ', e); if (sp > b) e = sp; }
  const body = document.createElement('span');
  const m = document.createElement('mark');
  m.textContent = t.slice(a, b);
  body.append((s > 0 ? '… ' : '') + t.slice(s, a), m, t.slice(b, e) + (e < t.length ? ' …' : ''));
  return body;
}

export function paintResults(show) {
  const ol = $('qResults');
  ol.innerHTML = '';
  const { hits } = st.Q;
  if (!hits.length) { ol.hidden = true; return; }
  ol.lang = st.doc.lang;
  hits.slice(0, MAX_LIST).forEach((h, k) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.setAttribute('aria-current', k === st.Q.cur);
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = T('pageShort')(st.doc.S[h.i].p);
    btn.append(n, snippet(st.doc.S[h.i].t, h.a, h.b));
    btn.onclick = () => gotoHit(k, true);
    li.appendChild(btn);
    ol.appendChild(li);
  });
  if (hits.length > MAX_LIST) {
    const li = document.createElement('li');
    li.className = 'more';
    li.textContent = T('more')(hits.length);
    ol.appendChild(li);
  }
  if (show) ol.hidden = false;
}

function gotoHit(k, hideList) {
  const { hits } = st.Q;
  if (!hits.length) return;
  st.Q.cur = k;
  st.Q.fresh = false;
  const h = hits[k];
  st.si = h.i;
  st.wi = 0;
  if (st.mode === 'word') {
    const tk = tokens(st.doc.S[st.si]);
    let pos = 0;
    for (let j = 0; j < tk.length; j++) {
      if (pos + tk[j].length > h.a) { st.wi = j; break; }
      pos += tk[j].length + 1;
    }
  }
  render();
  restart();
  paintCount();
  const ol = $('qResults');
  ol.querySelectorAll('li > button').forEach((b, j) => b.setAttribute('aria-current', j === k));
  if (hideList) ol.hidden = true;
  else { const c = ol.children[k]; if (c && !ol.hidden) c.scrollIntoView({ block: 'nearest' }); }
}

export function stepHit(d) {
  const n = st.Q.hits.length;
  if (!n) return;
  $('qResults').hidden = true;
  gotoHit((st.Q.cur + d + n) % n, true);
}

export function openSearch() {
  if (!st.doc || st.view !== 'reader') return;
  $('searchWrap').hidden = false;
  const q = $('q');
  q.focus();
  q.select();
  if (st.Q.hits.length) $('qResults').hidden = false;
}

export function closeSearch() {
  $('searchWrap').hidden = true;
  $('qResults').hidden = true;
  $('q').value = '';
  st.Q = emptyQ();
  paintCount();
  invalidate();
  render();
}

export function isSearchOpen() { return !$('searchWrap').hidden; }

/** Called when a new document loads. */
export function resetSearchForDoc() {
  if (isSearchOpen() && $('q').value.trim()) runSearch();
  else { st.Q = emptyQ(); $('qResults').hidden = true; paintCount(); }
}

export function initSearch() {
  $('searchBtn').onclick = () => (isSearchOpen() ? closeSearch() : openSearch());
  $('qClose').onclick = closeSearch;
  $('qPrev').onclick = () => stepHit(-1);
  $('qNext').onclick = () => stepHit(1);
  const q = $('q');
  q.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(runSearch, 150); });
  q.addEventListener('focus', () => { if (st.Q.hits.length) $('qResults').hidden = false; });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounce);
      if (q.value.trim() !== st.Q.q) runSearch();
      if (st.Q.fresh) gotoHit(st.Q.cur, true); else stepHit(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (!$('qResults').hidden) $('qResults').hidden = true; else closeSearch();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!$('searchWrap').contains(e.target)) $('qResults').hidden = true;
  });
}
