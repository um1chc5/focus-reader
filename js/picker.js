// "Choose where to start" dialog: page thumbnails, sentences per page, and its own search.
import { st, $ } from './state.js';
import { T } from './i18n.js';
import { fold, findAll } from './text.js';
import { jump, stop, fillMarked } from './reader.js';
import { foldedOf, snippet } from './search.js';

const MAX_LIST = 200;
let pickerPage = 1;
let observer = null;
let debounce = null;

export const isPickerOpen = () => !$('sheet').hidden;

function buildPages() {
  const D = st.doc;
  const box = $('pages');
  box.innerHTML = '';
  if (observer) observer.disconnect();
  observer = D.pdfPromise && 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => {
        if (e.isIntersecting) { observer.unobserve(e.target); drawThumb(e.target); }
      }), { root: box, rootMargin: '300px' })
    : null;
  const hasText = new Set(D.S.map((s) => s.p));
  for (let i = 1; i <= D.pages; i++) {
    const b = document.createElement('button');
    b.className = 'pg';
    b.dataset.p = i;
    const cached = D.thumbs.get(i);
    if (cached) b.appendChild(cached);
    else { const ph = document.createElement('div'); ph.className = 'ph'; b.appendChild(ph); }
    const lab = document.createElement('span');
    lab.textContent = T('pageShort')(i) + (hasText.has(i) ? '' : T('empty'));
    b.appendChild(lab);
    b.onclick = () => { $('pq').value = ''; showPage(i); };
    box.appendChild(b);
    if (observer && !cached) observer.observe(b);
  }
}

async function drawThumb(btn) {
  const D = st.doc;
  try {
    const pdf = await D.pdfPromise;
    if (!pdf || st.doc !== D) return;
    const p = +btn.dataset.p;
    const page = await pdf.getPage(p);
    const v1 = page.getViewport({ scale: 1 });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: (96 / v1.width) * dpr });
    const c = document.createElement('canvas');
    c.width = vp.width;
    c.height = vp.height;
    c.style.height = (vp.height / vp.width) * 96 + 'px';
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    D.thumbs.set(p, c);
    const ph = btn.querySelector('.ph');
    if (ph) ph.replaceWith(c);
  } catch { /* leave placeholder */ }
}

function markPage(p) {
  $('pages').querySelectorAll('.pg').forEach((b) => b.setAttribute('aria-current', +b.dataset.p === p));
  const cur = $('pages').querySelector('[aria-current="true"]');
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function item(i, label, content, isCur) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  if (isCur) b.className = 'cur';
  const n = document.createElement('span');
  n.className = 'n';
  n.textContent = label;
  b.append(n, content);
  b.onclick = () => { closePicker(); jump(i); };
  li.appendChild(b);
  return li;
}

function showPage(p) {
  const D = st.doc;
  pickerPage = p;
  markPage(p);
  const items = [];
  D.S.forEach((s, i) => { if (s.p === p) items.push(i); });
  $('sentTitle').textContent = T('pageTitle')(p);
  $('sentCount').textContent = items.length ? T('count')(items.length) : '';
  $('pageStart').hidden = !items.length;
  const ol = $('sentList');
  ol.innerHTML = '';
  ol.lang = D.lang;
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = T('noPageText');
    ol.appendChild(li);
    return;
  }
  items.forEach((i) => {
    const span = document.createElement('span');
    span.textContent = D.S[i].t;
    ol.appendChild(item(i, String(i + 1), span, i === st.si));
  });
  const cur = ol.querySelector('.cur');
  if (cur) cur.scrollIntoView({ block: 'center' }); else $('sents').scrollTop = 0;
}

function showResults(fq) {
  const D = st.doc;
  const ol = $('sentList');
  ol.innerHTML = '';
  const found = [];
  D.S.forEach((s, i) => {
    const hits = findAll(s.t, fq, foldedOf(s));
    if (hits.length) found.push({ i, hits });
  });
  $('sentTitle').textContent = T('pickerResults');
  $('sentCount').textContent = T('pickerHits')(found.length);
  $('pageStart').hidden = true;
  if (!found.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = T('pickerNone');
    ol.appendChild(li);
  }
  found.slice(0, MAX_LIST).forEach(({ i, hits }) => {
    const s = D.S[i];
    const content = s.t.length > 260 ? snippet(s.t, hits[0].a, hits[0].b, 110, 140) : (() => {
      const span = document.createElement('span');
      fillMarked(span, i, s.t, hits);
      return span;
    })();
    ol.appendChild(item(i, T('pageShort')(s.p), content, i === st.si));
  });
  if (found.length > MAX_LIST) {
    const li = document.createElement('li');
    li.className = 'more';
    li.textContent = T('more')(found.length);
    ol.appendChild(li);
  }
  $('sents').scrollTop = 0;
}

function runPickerSearch() {
  const raw = $('pq').value.trim();
  if (!raw) { showPage(pickerPage); return; }
  if (/^\d+$/.test(raw)) {
    const n = +raw;
    if (n >= 1 && n <= st.doc.pages) { showPage(n); return; }
    $('sentTitle').textContent = T('pickerResults');
    $('sentCount').textContent = '';
    $('pageStart').hidden = true;
    $('sentList').innerHTML = '';
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = T('noPage')(n);
    $('sentList').appendChild(li);
    return;
  }
  const fq = fold(raw.replace(/\s+/g, ' ')).f;
  if (fq.length < 2) { showPage(pickerPage); return; }
  showResults(fq);
}

export function openPicker() {
  if (!st.doc || st.view !== 'reader') return;
  stop();
  $('sheet').hidden = false;
  $('pq').value = '';
  buildPages();
  showPage(st.doc.S[st.si].p);
  $('pq').focus();
}

export function closePicker() {
  $('sheet').hidden = true;
  if (observer) observer.disconnect();
}

/** Re-render labels after a language switch. */
export function refreshPicker() {
  if (!isPickerOpen()) return;
  buildPages();
  runPickerSearch();
}

export function initPicker() {
  $('pickBtn').onclick = openPicker;
  $('sheetClose').onclick = closePicker;
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closePicker(); });
  $('pageStart').onclick = () => {
    const i = st.doc.S.findIndex((s) => s.p === pickerPage);
    if (i >= 0) { closePicker(); jump(i); }
  };
  const pq = $('pq');
  pq.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(runPickerSearch, 150); });
  pq.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounce);
      runPickerSearch();
      const raw = pq.value.trim();
      if (/^\d+$/.test(raw)) { $('pageStart').hidden || $('pageStart').click(); return; }
      const first = $('sentList').querySelector('li > button');
      if (first) first.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (pq.value) { pq.value = ''; showPage(pickerPage); } else closePicker();
    }
  });
}
