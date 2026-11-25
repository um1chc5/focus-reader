// Small window mode: always-on-top Document Picture-in-Picture (Chrome/Edge)
// with an automatic in-page draggable & resizable floating window fallback.
import { st, $, prefs, WPM_STEP } from './state.js';
import { T } from './i18n.js';
import {
  tokens, fillMarked, orp, toggle, step, jump, setMode, setWpm, restart,
  onReaderChange, setTimerWindow,
} from './reader.js';
import { onThemeChange, toggleDark } from './themes.js';

const MIN_W = 300;
const MIN_H = 210;
const MAX_W = 720;
const MAX_H = 540;
const DEF_W = 420;
const DEF_H = 270;
const MARGIN = 12;

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const ICON_PIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="15" rx="2"/><rect x="11" y="10" width="8" height="6" rx="1" fill="currentColor" stroke="none"/></svg>';

let mode = null; // 'pip' | 'float' | null
let pipWin = null;
let floatEl = null;
let ui = null;
let renderedPage = -1;
let renderedDoc = null;
let cleanupFns = [];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function savedSize() {
  const s = prefs.get('miniSize', null);
  const w = s && Number.isFinite(s.w) ? clamp(Math.round(s.w), MIN_W, MAX_W) : DEF_W;
  const h = s && Number.isFinite(s.h) ? clamp(Math.round(s.h), MIN_H, MAX_H) : DEF_H;
  return { w, h };
}

function clampRect(x, y, w, h) {
  const maxW = Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - MARGIN * 2));
  const maxH = Math.max(MIN_H, Math.min(MAX_H, window.innerHeight - MARGIN * 2));
  const cw = clamp(Math.round(w), Math.min(MIN_W, maxW), maxW);
  const ch = clamp(Math.round(h), Math.min(MIN_H, maxH), maxH);
  const maxX = Math.max(MARGIN, window.innerWidth - cw - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - ch - MARGIN);
  return {
    x: clamp(Math.round(x), MARGIN, maxX),
    y: clamp(Math.round(y), MARGIN, maxY),
    w: cw,
    h: ch,
  };
}

function savedFloatRect() {
  const { w, h } = savedSize();
  const p = prefs.get('miniPos', null);
  const x = p && Number.isFinite(p.x) ? p.x : window.innerWidth - w - 20;
  const y = p && Number.isFinite(p.y) ? p.y : window.innerHeight - h - 20;
  return clampRect(x, y, w, h);
}

export function isMiniOpen() {
  return mode !== null;
}

export function paintMiniButton() {
  const b = $('pipBtn');
  if (!b) return;
  const on = isMiniOpen();
  b.innerHTML = ICON_PIP;
  b.setAttribute('aria-pressed', String(on));
  const label = T(on ? 'miniExit' : 'miniEnter');
  b.setAttribute('aria-label', label);
  b.title = label + ' (I)';
}

function syncPipTheme() {
  if (!pipWin || pipWin.closed) return;
  const src = document.documentElement;
  const dst = pipWin.document.documentElement;
  dst.dataset.theme = src.dataset.theme || 'light';
  if (src.dataset.palette) dst.dataset.palette = src.dataset.palette;
  else delete dst.dataset.palette;
  dst.lang = src.lang || st.lang;
  dst.style.setProperty('--fs', st.fs + 'px');
}

function buildMiniDOM(doc, isFloat) {
  const shell = doc.createElement('div');
  shell.className = 'miniShell';
  shell.innerHTML = `
    ${isFloat ? `
    <div class="miniHead">
      <div class="miniTitleWrap">
        <div class="miniTitle"></div>
        <div class="miniMeta"></div>
      </div>
      <div class="miniHeadActions">
        <button class="btn icon sm miniCloseBtn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
    </div>` : ''}
    <div class="miniStage">
      <div class="miniSpot"></div>
      <div class="miniWord" hidden>
        <div class="rsvp">
          <div class="tick"></div>
          <div class="wline"><span class="mwl"></span><span class="mwp"></span><span class="mwr"></span></div>
          <div class="tick"></div>
        </div>
        <p class="wctx miniWctx"></p>
      </div>
    </div>
    <div class="miniFoot">
      <div class="miniBar"><div><div class="miniFill"></div></div></div>
      <div class="miniRow">
        <div class="miniTransport">
          <button class="btn icon sm miniPrev" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
          <button class="miniPlay" type="button"></button>
          <button class="btn icon sm miniNext" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
        </div>
        <div class="miniRight">
          <button class="btn sm miniModeBtn" type="button"></button>
          <div class="miniSpeed">
            <button class="btn icon sm miniWpmDown" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg></button>
            <span class="miniWpm"></span>
            <button class="btn icon sm miniWpmUp" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12M12 6v12"/></svg></button>
          </div>
        </div>
      </div>
    </div>
  `;

  const q = (sel) => shell.querySelector(sel);
  const refs = {
    doc,
    shell,
    head: q('.miniHead'),
    title: q('.miniTitle'),
    meta: q('.miniMeta'),
    modeBtn: q('.miniModeBtn'),
    closeBtn: q('.miniCloseBtn'),
    stage: q('.miniStage'),
    spot: q('.miniSpot'),
    word: q('.miniWord'),
    wl: q('.mwl'),
    wp: q('.mwp'),
    wr: q('.mwr'),
    wctx: q('.miniWctx'),
    foot: q('.miniFoot'),
    bar: q('.miniBar'),
    fill: q('.miniFill'),
    prevBtn: q('.miniPrev'),
    playBtn: q('.miniPlay'),
    nextBtn: q('.miniNext'),
    wpmDown: q('.miniWpmDown'),
    wpmOut: q('.miniWpm'),
    wpmUp: q('.miniWpmUp'),
  };

  refs.modeBtn.onclick = () => setMode(st.mode === 'spot' ? 'word' : 'spot');
  if (refs.closeBtn) refs.closeBtn.onclick = () => closeMini();
  refs.playBtn.onclick = () => toggle();
  refs.prevBtn.onclick = () => step(-1);
  refs.nextBtn.onclick = () => step(1);
  refs.wpmDown.onclick = () => setWpm(st.wpm - WPM_STEP);
  refs.wpmUp.onclick = () => setWpm(st.wpm + WPM_STEP);
  refs.bar.onclick = (e) => {
    if (!st.doc) return;
    const r = e.currentTarget.firstElementChild.getBoundingClientRect();
    const f = Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width));
    jump(Math.floor(f * st.doc.S.length));
  };

  // Auto-hide chrome: show on hover/pointer move, hide after idle or pointer leave.
  let hideTimer = null;
  let overChrome = false;
  const clearHide = () => { clearTimeout(hideTimer); hideTimer = null; };
  const scheduleHide = () => {
    clearHide();
    if (overChrome) return;
    hideTimer = setTimeout(() => {
      if (!overChrome) shell.classList.remove('showChrome');
    }, 1800);
  };
  const reveal = () => {
    shell.classList.add('showChrome');
    scheduleHide();
  };
  const hideNow = () => {
    clearHide();
    overChrome = false;
    shell.classList.remove('showChrome');
  };

  shell.addEventListener('pointermove', reveal);
  shell.addEventListener('pointerenter', reveal);
  shell.addEventListener('pointerleave', hideNow);

  [refs.foot, refs.head].filter(Boolean).forEach((bar) => {
    bar.addEventListener('pointerenter', () => { overChrome = true; clearHide(); shell.classList.add('showChrome'); });
    bar.addEventListener('pointerleave', () => { overChrome = false; scheduleHide(); });
  });

  cleanupFns.push(clearHide);

  if (isFloat) {
    const dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    dirs.forEach((d) => {
      const h = doc.createElement('div');
      h.className = 'miniResize miniResize-' + d;
      h.dataset.dir = d;
      h.setAttribute('aria-hidden', 'true');
      shell.appendChild(h);
    });
  }

  return refs;
}

function renderMiniSpot(forceCenter) {
  const D = st.doc;
  const p = D.S[st.si].p;
  const spot = ui.spot;
  spot.lang = D.lang;
  if (renderedPage !== p || renderedDoc !== D) {
    renderedPage = p;
    renderedDoc = D;
    spot.innerHTML = '';
    D.S.forEach((s, i) => {
      if (s.p !== p) return;
      const sp = ui.doc.createElement('span');
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
    const m = ui.stage;
    const top = Math.max(0, on.offsetTop - m.clientHeight * 0.42 + on.offsetHeight / 2);
    m.scrollTo({ top, behavior: forceCenter ? 'instant' : 'smooth' });
  }
}

function renderMiniWord() {
  const D = st.doc;
  const s = D.S[st.si];
  const tk = tokens(s);
  const wi = Math.min(st.wi, tk.length - 1);
  const cur = tk[wi];
  if (cur.includes(' ')) {
    const mid = cur.indexOf(' ');
    ui.wl.textContent = cur.slice(0, mid);
    ui.wp.textContent = '\u2002';
    ui.wr.textContent = cur.slice(mid + 1);
  } else {
    const [a, b, c] = orp(cur);
    ui.wl.textContent = a;
    ui.wp.textContent = b;
    ui.wr.textContent = c;
  }
  const ctx = ui.wctx;
  ctx.textContent = '';
  ctx.lang = D.lang;
  tk.forEach((w, i) => {
    if (i) ctx.append(' ');
    if (i === wi) {
      const b = ui.doc.createElement('b');
      b.textContent = w;
      ctx.appendChild(b);
    } else {
      ctx.append(w);
    }
  });
}

export function syncMini(opts = {}) {
  if (!ui) return;
  if (opts.invalidate) renderedPage = -1;
  const D = st.doc;

  ui.modeBtn.textContent = T(st.mode === 'spot' ? 'word' : 'spot');
  ui.modeBtn.title = T(st.mode === 'spot' ? 'wordTip' : 'spotTip');
  if (ui.closeBtn) {
    ui.closeBtn.title = T('miniExit') + ' (Esc)';
    ui.closeBtn.setAttribute('aria-label', T('miniExit'));
  }
  ui.prevBtn.title = T('prev');
  ui.prevBtn.setAttribute('aria-label', T('prev'));
  ui.nextBtn.title = T('next');
  ui.nextBtn.setAttribute('aria-label', T('next'));
  ui.wpmDown.title = T('slower');
  ui.wpmDown.setAttribute('aria-label', T('slower'));
  ui.wpmUp.title = T('faster');
  ui.wpmUp.setAttribute('aria-label', T('faster'));
  ui.bar.title = T('seek');
  ui.wpmOut.textContent = st.wpm + ' ' + T('unit');

  ui.playBtn.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY;
  ui.playBtn.title = T(st.playing ? 'pause' : 'play') + ' (Space)';
  ui.playBtn.setAttribute('aria-label', T(st.playing ? 'pause' : 'play'));

  ui.spot.hidden = st.mode !== 'spot';
  ui.word.hidden = st.mode !== 'word';

  if (!D) {
    if (ui.title) ui.title.textContent = 'Focus Reader';
    if (ui.meta) ui.meta.textContent = '';
    return;
  }

  const docTitle = D.sample ? T('sampleName') : D.name;
  const curSent = D.S[st.si];
  if (ui.title) { ui.title.textContent = docTitle; ui.title.title = docTitle; }
  if (ui.meta) ui.meta.textContent = `${T('pageShort')(curSent.p)}/${D.pages} · ${st.si + 1}/${D.S.length}`;
  if (pipWin && !pipWin.closed) {
    pipWin.document.title = `${docTitle} (${T('pageShort')(curSent.p)}/${D.pages})`;
  }

  const frac = (st.si + 1) / D.S.length;
  ui.fill.style.width = (frac * 100).toFixed(2) + '%';

  if (st.mode === 'spot') renderMiniSpot(!!opts.forceCenter);
  else renderMiniWord();
}

function onMiniKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape' || k === 'i') { e.preventDefault(); closeMini(); return; }
  if (e.key === ' ') {
    if (e.target && e.target.tagName === 'BUTTON') return;
    e.preventDefault(); toggle();
  } else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setWpm(st.wpm + WPM_STEP); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); setWpm(st.wpm - WPM_STEP); }
  else if (k === 'm') { e.preventDefault(); setMode(st.mode === 'spot' ? 'word' : 'spot'); }
  else if (k === 't') { e.preventDefault(); toggleDark(); }
}

async function openPip() {
  const { w, h } = savedSize();
  const win = await window.documentPictureInPicture.requestWindow({ width: w, height: h });
  pipWin = win;
  mode = 'pip';

  // Copy stylesheets (themes, layout, Google Fonts) into the PiP document.
  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const clone = win.document.createElement('link');
    clone.rel = 'stylesheet';
    clone.href = link.href;
    win.document.head.appendChild(clone);
  });

  win.document.body.className = 'isPipBody';
  syncPipTheme();

  ui = buildMiniDOM(win.document, false);
  renderedPage = -1;
  renderedDoc = null;
  win.document.body.appendChild(ui.shell);

  let resizeTimer = null;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!pipWin || pipWin.closed) return;
      prefs.set('miniSize', {
        w: clamp(pipWin.innerWidth, MIN_W, MAX_W),
        h: clamp(pipWin.innerHeight, MIN_H, MAX_H),
      });
      if (st.mode === 'spot') syncMini({ forceCenter: true });
    }, 150);
  };
  const onPageHide = () => teardown();

  win.addEventListener('resize', onResize);
  win.addEventListener('keydown', onMiniKeydown);
  win.addEventListener('pagehide', onPageHide, { once: true });
  cleanupFns.push(() => {
    clearTimeout(resizeTimer);
    if (!win.closed) {
      win.removeEventListener('resize', onResize);
      win.removeEventListener('keydown', onMiniKeydown);
      win.removeEventListener('pagehide', onPageHide);
    }
  });

  document.querySelector('.app').classList.add('inMiniPip');
  paintMiniButton();
  syncMini({ forceCenter: true });
  restart(); // move active playback timer to the visible PiP window
}

function openFloat() {
  mode = 'float';
  const rect = savedFloatRect();

  floatEl = document.createElement('aside');
  floatEl.className = 'miniWin';
  floatEl.id = 'miniWin';
  floatEl.setAttribute('role', 'region');
  floatEl.setAttribute('aria-label', T('miniTitle'));
  applyFloatRect(rect);

  ui = buildMiniDOM(document, true);
  renderedPage = -1;
  renderedDoc = null;
  floatEl.appendChild(ui.shell);
  document.body.appendChild(floatEl);

  let cur = { ...rect };

  function applyFloatRect(r) {
    floatEl.style.left = r.x + 'px';
    floatEl.style.top = r.y + 'px';
    floatEl.style.width = r.w + 'px';
    floatEl.style.height = r.h + 'px';
  }

  // Dragging via header
  const onHeadDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...cur };
    ui.head.setPointerCapture(e.pointerId);
    floatEl.classList.add('isInteracting');

    const onMove = (ev) => {
      const next = clampRect(orig.x + (ev.clientX - startX), orig.y + (ev.clientY - startY), orig.w, orig.h);
      cur = next;
      applyFloatRect(cur);
    };
    const onUp = () => {
      floatEl.classList.remove('isInteracting');
      ui.head.removeEventListener('pointermove', onMove);
      ui.head.removeEventListener('pointerup', onUp);
      ui.head.removeEventListener('pointercancel', onUp);
      prefs.set('miniPos', { x: cur.x, y: cur.y });
    };
    ui.head.addEventListener('pointermove', onMove);
    ui.head.addEventListener('pointerup', onUp);
    ui.head.addEventListener('pointercancel', onUp);
  };
  ui.head.addEventListener('pointerdown', onHeadDown);

  // Resizing via edges & corners with min/max & viewport bounds
  const onResizeDown = (e) => {
    const handle = e.target.closest('.miniResize');
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    const dir = handle.dataset.dir;
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...cur };
    handle.setPointerCapture(e.pointerId);
    floatEl.classList.add('isInteracting');

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const maxW = Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - MARGIN * 2));
      const maxH = Math.max(MIN_H, Math.min(MAX_H, window.innerHeight - MARGIN * 2));

      let { x, y, w, h } = orig;
      if (dir.includes('e')) {
        const rightMax = Math.min(maxW, window.innerWidth - MARGIN - orig.x);
        w = clamp(orig.w + dx, Math.min(MIN_W, rightMax), rightMax);
      }
      if (dir.includes('s')) {
        const botMax = Math.min(maxH, window.innerHeight - MARGIN - orig.y);
        h = clamp(orig.h + dy, Math.min(MIN_H, botMax), botMax);
      }
      if (dir.includes('w')) {
        const rightEdge = orig.x + orig.w;
        const leftMax = Math.min(maxW, rightEdge - MARGIN);
        w = clamp(orig.w - dx, Math.min(MIN_W, leftMax), leftMax);
        x = rightEdge - w;
      }
      if (dir.includes('n')) {
        const botEdge = orig.y + orig.h;
        const topMax = Math.min(maxH, botEdge - MARGIN);
        h = clamp(orig.h - dy, Math.min(MIN_H, topMax), topMax);
        y = botEdge - h;
      }

      cur = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      applyFloatRect(cur);
    };

    const onUp = () => {
      floatEl.classList.remove('isInteracting');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      prefs.set('miniSize', { w: cur.w, h: cur.h });
      prefs.set('miniPos', { x: cur.x, y: cur.y });
      if (st.mode === 'spot') syncMini({ forceCenter: true });
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };
  ui.shell.addEventListener('pointerdown', onResizeDown);

  const onViewportResize = () => {
    cur = clampRect(cur.x, cur.y, cur.w, cur.h);
    applyFloatRect(cur);
  };
  window.addEventListener('resize', onViewportResize);

  cleanupFns.push(() => {
    window.removeEventListener('resize', onViewportResize);
  });

  paintMiniButton();
  syncMini({ forceCenter: true });
}

function teardown() {
  const wasPip = mode === 'pip';
  cleanupFns.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  cleanupFns = [];
  if (pipWin && !pipWin.closed) {
    try { pipWin.close(); } catch { /* ignore */ }
  }
  pipWin = null;
  if (floatEl) {
    floatEl.remove();
    floatEl = null;
  }
  ui = null;
  mode = null;
  renderedPage = -1;
  renderedDoc = null;
  document.querySelector('.app').classList.remove('inMiniPip');
  paintMiniButton();
  if (wasPip) restart(); // move active playback timer back to main window
}

export async function openMini() {
  if (!st.doc || isMiniOpen()) return;
  if ('documentPictureInPicture' in window) {
    try {
      await openPip();
      return;
    } catch {
      // Blocked or unavailable (e.g. iframe / policy) -> fall back to in-page float.
    }
  }
  openFloat();
}

export function closeMini() {
  if (!isMiniOpen()) return;
  teardown();
}

export function toggleMini() {
  if (isMiniOpen()) closeMini();
  else openMini();
}

export function initMini() {
  setTimerWindow(() => (pipWin && !pipWin.closed ? pipWin : window));
  onReaderChange((ev) => {
    if (!isMiniOpen()) return;
    if (ev === 'fs') syncPipTheme();
    syncMini({ invalidate: ev === 'invalidate' });
  });
  onThemeChange(() => {
    syncPipTheme();
  });
  const btn = $('pipBtn');
  if (btn) btn.onclick = () => toggleMini();
  paintMiniButton();
}
