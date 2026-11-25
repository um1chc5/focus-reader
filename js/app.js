// Entry point: loading documents, library <-> reader views, theme, language, keyboard.
import { st, $, prefs, WPM_STEP } from './state.js';
import { T } from './i18n.js';
import { SAMPLE } from './samples.js';
import { segmentText, extractPdf, renderCover } from './text.js';
import { getBook, getFile, saveBook, updateBook, listBooks, requestPersistence } from './db.js';
import {
  render, invalidate, toggle, step, setMode, setWpm, setFs, stop, updatePlay, clearTokenCache, restart,
} from './reader.js';
import {
  initSearch, openSearch, closeSearch, isSearchOpen, paintCount, paintResults, resetSearchForDoc,
} from './search.js';
import { initPicker, openPicker, closePicker, isPickerOpen, refreshPicker } from './picker.js';
import { initLibrary, renderLibrary } from './library.js';
import { initTheme, paintThemeUI, toggleDark, toggleFullscreen, isThemePopOpen, closeThemePop } from './themes.js';
import { initMini, toggleMini, isMiniOpen, paintMiniButton, syncMini } from './mini.js';

const pdfjs = window.pdfjsLib;
if (pdfjs) pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ---------- Notices ---------- */
// Info notices fade after a few seconds; errors stay until closed.
let noticeState = null;
let noticeTimer = null;
function note(key, arg, err) {
  noticeState = key ? { key, arg, err } : null;
  clearTimeout(noticeTimer);
  if (key && !err) noticeTimer = setTimeout(() => note(null), 6000);
  paintNotice();
}
function paintNotice() {
  const n = $('notice');
  if (!noticeState) { n.hidden = true; return; }
  const v = T(noticeState.key);
  n.hidden = false;
  n.className = 'notice' + (noticeState.err ? ' err' : '');
  $('noticeText').textContent = typeof v === 'function' ? v(noticeState.arg) : v;
}

/* ---------- Floating controls ---------- */
const ICON_LIB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v14M9 19V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12M15.5 6.5l3-.8a1 1 0 0 1 1.2.7l3 11.2M3 20h18"/></svg>';
const ICON_READ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2zM22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z"/></svg>';

function setCollapsed(on, focus, instant) {
  st.ctrlCollapsed = on;
  prefs.set('ctrlCollapsed', on);
  const app = document.querySelector('.app');
  if (instant) app.classList.add('noAnim');
  $('ctrl').classList.toggle('isCollapsed', on);
  $('ctrlMini').classList.toggle('isHidden', !on);
  $('ctrl').inert = on;           // hidden controls can't be tabbed to
  $('ctrlMini').inert = !on;
  app.classList.toggle('ctrlCollapsed', on);
  if (instant) requestAnimationFrame(() => requestAnimationFrame(() => app.classList.remove('noAnim')));
  if (focus) (on ? $('ctrlMini') : $('playBtn')).focus();
}
const loading = (msg) => { const L = $('loading'); L.hidden = !msg; if (msg) L.textContent = msg; };

/* ---------- Documents ---------- */
function makeDoc(base, pageTexts) {
  return { ...base, S: segmentText(pageTexts, base.lang), thumbs: new Map(), pdf: null, pdfPromise: null };
}

function setDoc(d, startAt = 0) {
  stop();
  st.doc = d;
  invalidate();
  st.si = startAt > 0 && startAt < d.S.length ? startAt : 0;
  st.wi = 0;
  refreshText();
  resetSearchForDoc();
}

function loadSample() {
  const d = makeDoc({ sample: true, key: 'sample-' + st.lang, pages: SAMPLE[st.lang].length, lang: st.lang }, SAMPLE[st.lang]);
  setDoc(d, prefs.get('pos:' + d.key, 0));
  note(null);
}

async function openFile(file) {
  if (!file) return;
  if (!pdfjs) { note('noLib', null, true); return; }
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { note('notPdf', file.name, true); return; }
  loading(T('opening')(file.name));
  try {
    const buf = await file.arrayBuffer();
    const blob = new Blob([buf], { type: 'application/pdf' });
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const { pageTexts, lang, garbled } = await extractPdf(pdf, (i, n) => loading(T('readingPage')(i, n)));
    if (!pageTexts.join('').trim()) { loading(''); note('noText', file.name, true); return; }

    const id = file.name + ':' + file.size;
    const name = file.name.replace(/\.pdf$/i, '');
    const existing = await getBook(id).catch(() => null);
    let cover = existing && existing.cover;
    if (!cover) { try { cover = await renderCover(pdf); } catch { cover = null; } }

    const d = makeDoc({ id, name, pages: pdf.numPages, lang }, pageTexts);
    d.pdf = pdf;
    d.pdfPromise = Promise.resolve(pdf);
    const pos = existing && existing.pos < d.S.length ? existing.pos : 0;
    const book = {
      id, name, size: file.size, pages: pdf.numPages, lang, cover, pageTexts,
      added: (existing && existing.added) || Date.now(), opened: Date.now(),
      pos, page: d.S[pos].p, total: d.S.length,
    };
    let saved = true;
    try { await saveBook(book, blob); requestPersistence(); } catch { saved = false; }

    loading('');
    setDoc(d, pos);
    showReader();
    if (garbled) note('garbled', null, true);
    else if (!saved) note('storeFail', null, true);
    else if (pos > 0) note('resumed', pos + 1);
    else note('saved');
  } catch (e) {
    loading('');
    if (e && e.name === 'PasswordException') note('password', null, true);
    else note('broken', file.name, true);
  }
}

async function openBook(id) {
  const b = await getBook(id).catch(() => null);
  if (!b) { renderLibrary(); return; }
  const d = makeDoc({ id: b.id, name: b.name, pages: b.pages, lang: b.lang }, b.pageTexts);
  d.pdfPromise = getFile(id)
    .then(async (blob) => {
      if (!blob || !pdfjs) return null;
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      d.pdf = pdf;
      return pdf;
    })
    .catch(() => null);
  setDoc(d, b.pos || 0);
  showReader();
  updateBook(id, { opened: Date.now() }).catch(() => {});
  note(b.pos > 0 ? 'resumed' : null, (b.pos || 0) + 1);
}

/* ---------- Views ---------- */
function showReader() {
  if (!st.doc) return;
  st.view = 'reader';
  $('library').hidden = true;
  document.querySelector('.app').classList.remove('inLibrary');
  paintLibButton();
  invalidate();
  render();
}

function showLibrary() {
  if (!isMiniOpen()) stop();
  closePicker();
  $('qResults').hidden = true;
  st.view = 'library';
  $('library').hidden = false;
  document.querySelector('.app').classList.add('inLibrary');
  paintLibButton();
  renderLibrary();
}

function paintLibButton() {
  const inLib = st.view === 'library';
  const b = $('libBtn');
  b.innerHTML = inLib ? ICON_READ : ICON_LIB;
  b.title = T(inLib ? 'readTip' : 'libTip');
  b.setAttribute('aria-label', T(inLib ? 'reading' : 'library'));
}

/* ---------- Text refresh (language) ---------- */
function refreshText() {
  document.documentElement.lang = st.lang;
  document.querySelectorAll('[data-i]').forEach((el) => { el.textContent = T(el.dataset.i); });
  const tip = (id, k, aria) => { $(id).title = T(k); if (aria) $(id).setAttribute('aria-label', T(k)); };
  $('modeGroup').setAttribute('aria-label', T('modeGroup'));
  tip('modeSpot', 'spotTip'); tip('modeWord', 'wordTip'); tip('pickBtn', 'pickTip', true);
  tip('openBtn', 'openTip'); tip('noticeClose', 'close', true);
  tip('ctrlCollapse', 'hideCtrl', true); tip('ctrlMini', 'showCtrl', true);
  $('langBtn').textContent = T('langLabel'); tip('langBtn', 'langTip', true);
  tip('prevBtn', 'prev', true); tip('nextBtn', 'next', true); tip('fsDown', 'smaller', true); tip('fsUp', 'larger', true);
  tip('wpmDown', 'slower', true); tip('wpmUp', 'faster', true);
  tip('sheetClose', 'close', true); tip('bar', 'seek'); $('chunkWrap').title = T('chunkTip');
  tip('searchBtn', 'search', true); tip('qPrev', 'prevMatch', true); tip('qNext', 'nextMatch', true); tip('qClose', 'closeSearch', true);
  $('q').placeholder = T('searchPh'); $('q').setAttribute('aria-label', T('searchPh'));
  $('pq').placeholder = T('pickerPh'); $('pq').setAttribute('aria-label', T('pickerPh'));
  $('wpmOut').textContent = st.wpm + ' ' + T('unit');
  paintThemeUI(); updatePlay(); paintNotice(); paintCount(); paintLibButton(); paintMiniButton(); syncMini();
  const D = st.doc;
  if (D) {
    $('docName').textContent = D.sample ? T('sampleName') : D.name;
    $('docName').title = $('docName').textContent;
    const words = D.S.reduce((a, s) => a + s.w.length, 0);
    $('docMeta').textContent = T('meta')(D.pages, D.S.length.toLocaleString(), words.toLocaleString());
    $('chunkWrap').hidden = D.lang !== 'vi';
    if (st.Q.hits.length) paintResults(false);
    refreshPicker();
    invalidate();
    if (st.view === 'reader') render();
  }
  if (st.view === 'library') renderLibrary();
}

function setLang(l) {
  st.lang = l;
  prefs.set('lang', l);
  if (!st.doc || st.doc.sample) loadSample(); else refreshText();
}

/* ---------- Events ---------- */
function bindEvents() {
  const pickFile = () => $('file').click();
  $('openBtn').onclick = pickFile;
  $('file').onchange = (e) => { openFile(e.target.files[0]); e.target.value = ''; };
  $('modeSpot').onclick = () => setMode('spot');
  $('modeWord').onclick = () => setMode('word');
  $('langBtn').onclick = () => setLang(st.lang === 'vi' ? 'en' : 'vi');
  $('libBtn').onclick = () => (st.view === 'library' ? showReader() : showLibrary());
  $('noticeClose').onclick = () => note(null);
  $('ctrlCollapse').onclick = () => setCollapsed(true, true);
  $('ctrlMini').onclick = () => setCollapsed(false, true);
  $('playBtn').onclick = toggle;
  $('prevBtn').onclick = () => step(-1);
  $('nextBtn').onclick = () => step(1);
  $('wpm').oninput = (e) => setWpm(+e.target.value);
  $('wpmDown').onclick = () => setWpm(st.wpm - WPM_STEP);
  $('wpmUp').onclick = () => setWpm(st.wpm + WPM_STEP);
  $('fsDown').onclick = () => setFs(st.fs - 1);
  $('fsUp').onclick = () => setFs(st.fs + 1);
  $('chunk').checked = st.chunk;
  $('chunk').onchange = (e) => {
    st.chunk = e.target.checked;
    prefs.set('chunk', st.chunk);
    clearTokenCache();
    st.wi = 0;
    render();
    restart();
  };
  $('bar').onclick = (e) => {
    if (!st.doc) return;
    const r = e.currentTarget.firstElementChild.getBoundingClientRect();
    const f = Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width));
    st.si = Math.floor(f * st.doc.S.length);
    st.wi = 0;
    render();
    restart();
  };

  initSearch();
  initPicker();
  initMini();
  initLibrary({
    onOpen: openBook,
    onAdd: pickFile,
    onSample: () => { loadSample(); showReader(); },
    onDeletedCurrent: () => { st.doc = null; loadSample(); },
  });

  // Drag and drop anywhere
  let depth = 0;
  addEventListener('dragenter', (e) => {
    if ([...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files')) { depth++; $('drop').hidden = false; }
  });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').hidden = true; } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    $('drop').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  // Keyboard
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.key === 'Escape' && isThemePopOpen()) { closeThemePop(); $('themeBtn').focus(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'f' && st.doc && st.view === 'reader' && !isPickerOpen()) {
      e.preventDefault(); openSearch(); return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.tagName === 'INPUT' && t.type === 'range' && /Arrow/.test(e.key)) return;
    if (t.tagName === 'INPUT' && (t.type === 'search' || t.type === 'text')) return;
    if (isPickerOpen()) { if (e.key === 'Escape') closePicker(); return; }
    if (k === 'f' && e.shiftKey) { e.preventDefault(); toggleFullscreen(); return; }
    if (k === 'l') { $('libBtn').click(); return; }
    if (k === 'h' && st.view === 'reader') { setCollapsed(!st.ctrlCollapsed); return; }
    if (k === 'i' && st.doc && (st.view === 'reader' || isMiniOpen())) { e.preventDefault(); toggleMini(); return; }
    if (k === 't') { toggleDark(); return; }
    if (st.view !== 'reader') return;
    if (k === 'f' || e.key === '/') { e.preventDefault(); openSearch(); return; }
    if (e.key === 'Escape' && isSearchOpen()) { closeSearch(); return; }
    if (e.key === ' ') { if (t.tagName === 'BUTTON' || t.tagName === 'INPUT') return; e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setWpm(st.wpm + WPM_STEP); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setWpm(st.wpm - WPM_STEP); }
    else if (k === 'm') setMode(st.mode === 'spot' ? 'word' : 'spot');
    else if (k === 'p') openPicker();
  });
}

/* ---------- Start ---------- */
async function start() {
  initTheme();
  bindEvents();
  setWpm(st.wpm);
  setFs(st.fs);
  setCollapsed(prefs.get('ctrlCollapsed', false), false, true);
  refreshText();
  let books = [];
  try { books = await listBooks(); } catch { /* storage blocked */ }
  if (books.length) await openBook(books[0].id);
  else { loadSample(); showReader(); }
}

start();
