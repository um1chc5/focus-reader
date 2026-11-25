// Appearance: light/dark/system mode, color palettes, and fullscreen.
// Palette colors live in css/themes.css; the preview colors below are for the picker swatches only.
import { $, prefs } from './state.js';
import { T } from './i18n.js';

/** [background, accent] for each mode. Keep ids in sync with css/themes.css. */
export const PALETTES = [
  { id: 'book', light: ['#F3EBDD', '#B4561F'], dark: ['#17120E', '#E8955A'] },
  { id: 'paper', light: ['#FAF8F3', '#9E2B25'], dark: ['#1B1A17', '#E0877C'] },
  { id: 'blue', light: ['#F2F3EF', '#3550C4'], dark: ['#111317', '#95A7FF'] },
  { id: 'gray', light: ['#EDEDEB', '#4E4E4B'], dark: ['#151515', '#C4C4BF'] },
  { id: 'sage', light: ['#ECEFE7', '#4A7552'], dark: ['#121612', '#8FC197'] },
];
const MODES = ['light', 'dark', 'system'];
const mq = matchMedia('(prefers-color-scheme: dark)');
const themeListeners = [];

export function onThemeChange(fn) { themeListeners.push(fn); }

let palette = prefs.get('palette', 'book');
if (!PALETTES.some((p) => p.id === palette)) palette = 'book';
let mode = prefs.get('theme', 'system');
if (!MODES.includes(mode)) mode = 'system';

export const effectiveMode = () => (mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode);

export function applyTheme() {
  const root = document.documentElement;
  const eff = effectiveMode();
  root.dataset.theme = eff;
  if (palette === 'book') delete root.dataset.palette; else root.dataset.palette = palette;
  const p = PALETTES.find((x) => x.id === palette);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = p[eff][0];
  document.head.appendChild(meta);
  paintThemeUI();
  themeListeners.forEach((fn) => fn());
}

export function setPalette(id) { palette = id; prefs.set('palette', id); applyTheme(); }
export function setThemeMode(m) { mode = m; prefs.set('theme', m); applyTheme(); }
export function toggleDark() { setThemeMode(effectiveMode() === 'dark' ? 'light' : 'dark'); }

export function paintThemeUI() {
  const btn = $('themeBtn');
  btn.title = T('appearanceTip');
  btn.setAttribute('aria-label', T('appearance'));
  document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === mode));
  const box = $('swatches');
  box.innerHTML = '';
  const eff = effectiveMode();
  PALETTES.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'sw';
    b.setAttribute('aria-pressed', p.id === palette);
    const chip = document.createElement('span');
    chip.className = 'chip';
    const [bg, accent] = p[eff];
    chip.style.background = `linear-gradient(135deg, ${bg} 0 50%, ${accent} 50% 100%)`;
    const label = document.createElement('span');
    label.textContent = T('pal_' + p.id);
    b.append(chip, label);
    b.onclick = () => setPalette(p.id);
    box.appendChild(b);
  });
  paintFullscreen();
}

export const isThemePopOpen = () => !$('themePop').hidden;

export function closeThemePop() {
  $('themePop').hidden = true;
  $('themeBtn').setAttribute('aria-expanded', 'false');
}

function openThemePop() {
  $('themePop').hidden = false;
  $('themeBtn').setAttribute('aria-expanded', 'true');
  paintThemeUI();
  const cur = $('swatches').querySelector('[aria-pressed="true"]');
  if (cur) cur.focus();
}

/* ---------- Fullscreen ---------- */
const fsSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;

export function toggleFullscreen() {
  if (!fsSupported()) return;
  try {
    if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const el = document.documentElement;
      const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      if (p && p.catch) p.catch(() => {});
    }
  } catch { /* refused */ }
}

const ICON_EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_SHRINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

export function paintFullscreen() {
  const b = $('fsBtn');
  b.hidden = !fsSupported();
  const on = !!fsElement();
  b.innerHTML = on ? ICON_SHRINK : ICON_EXPAND;
  const label = T(on ? 'fsExit' : 'fsEnter');
  b.setAttribute('aria-label', label);
  b.title = label + ' (Shift+F)';
}

export function initTheme() {
  $('themeBtn').onclick = (e) => { e.stopPropagation(); isThemePopOpen() ? closeThemePop() : openThemePop(); };
  document.querySelectorAll('#modeSeg button').forEach((b) => { b.onclick = () => setThemeMode(b.dataset.mode); });
  document.addEventListener('pointerdown', (e) => {
    if (isThemePopOpen() && !e.target.closest('.themeWrap')) closeThemePop();
  });
  const onSystemChange = () => { if (mode === 'system') applyTheme(); };
  if (mq.addEventListener) mq.addEventListener('change', onSystemChange); else if (mq.addListener) mq.addListener(onSystemChange);

  $('fsBtn').onclick = toggleFullscreen;
  document.addEventListener('fullscreenchange', paintFullscreen);
  document.addEventListener('webkitfullscreenchange', paintFullscreen);
  applyTheme();
}
