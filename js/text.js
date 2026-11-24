// Text processing: PDF extraction, sentence splitting, language detection, accent folding.

const VI_RE = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi;
const LEGACY_RE = /[ÂÊÔ¬¸µ¶·¹¨»¾¼½Æ©ÇËÌÎÏÐÑ¥×ØÞßãáâäåæçèéêëìíîïð]{2,}/g;

/**
 * Lower-case and strip diacritics (đ → d) so "nguyen" matches "Nguyễn".
 * Returns the folded string and a map from folded index → original index.
 */
export function fold(str) {
  let f = '';
  const map = [];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const g = (c === 'đ' || c === 'Đ') ? 'd' : c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let j = 0; j < g.length; j++) { f += g[j]; map.push(i); }
  }
  return { f, map };
}

/** Find every match of an already-folded query inside a string. Returns [{a, b}] in original indices. */
export function findAll(text, foldedQuery, cache) {
  const { f, map } = cache || fold(text);
  const out = [];
  const L = foldedQuery.length;
  if (!L) return out;
  for (let k = f.indexOf(foldedQuery); k >= 0; k = f.indexOf(foldedQuery, k + L)) {
    out.push({ a: map[k], b: map[k + L - 1] + 1 });
  }
  return out;
}

export function detectLang(text) {
  const sample = text.slice(0, 20000);
  const letters = (sample.match(/\p{L}/gu) || []).length;
  const vi = (sample.match(VI_RE) || []).length;
  return letters && vi / letters > 0.02 ? 'vi' : 'en';
}

/** Split page texts into sentences, remembering the page each sentence starts on. */
export function segmentText(pageTexts, docLang) {
  let full = '';
  const starts = [];
  pageTexts.forEach((t) => { starts.push(full.length); full += t + ' '; });

  const pieces = [];
  if (window.Intl && Intl.Segmenter) {
    for (const s of new Intl.Segmenter(docLang, { granularity: 'sentence' }).segment(full)) pieces.push({ t: s.segment, i: s.index });
  } else {
    for (const m of full.matchAll(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g)) pieces.push({ t: m[0], i: m.index });
  }

  const out = [];
  let carry = null; // short abbreviations like "TS." or "Mr." join the next sentence
  for (const p of pieces) {
    let t = p.t.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (!/\s/.test(t) && /^[\p{L}.]{1,5}\.$/u.test(t)) {
      carry = carry ? { t: carry.t + ' ' + t, i: carry.i } : { t, i: p.i };
      continue;
    }
    let at = p.i;
    if (carry) { t = carry.t + ' ' + t; at = carry.i; carry = null; }
    let pg = 0;
    while (pg + 1 < starts.length && starts[pg + 1] <= at) pg++;
    const prev = out[out.length - 1];
    if (prev && (!/[\p{L}\p{N}]/u.test(t) || (t.split(' ').length < 2 && t.length < 4))) { prev.t += ' ' + t; continue; }
    out.push({ t, p: pg + 1 });
  }
  if (carry) out.push({ t: carry.t, p: starts.length });
  out.forEach((s) => { s.w = s.t.split(' '); });
  return out;
}

/** Pull clean text out of every page of a pdf.js document. */
export async function extractPdf(pdf, onProgress) {
  const n = pdf.numPages;
  const pageLines = [];
  for (let i = 1; i <= n; i++) {
    onProgress && onProgress(i, n);
    const tc = await (await pdf.getPage(i)).getTextContent();
    const lines = [];
    let cur = '', lastY = null, lastEnd = null;
    for (const it of tc.items) {
      if (it.str === undefined) continue;
      const y = it.transform[5], x = it.transform[4];
      if (lastY !== null && Math.abs(y - lastY) > Math.max(2, (it.height || 10) * 0.5)) {
        if (cur.trim()) lines.push(cur.trim());
        cur = ''; lastEnd = null;
      }
      if (lastEnd !== null && x - lastEnd > 1 && !/\s$/.test(cur) && !/^[\s̀-ͯ]/.test(it.str)) cur += ' ';
      cur += it.str; lastY = y; lastEnd = x + (it.width || 0);
      if (it.hasEOL) { if (cur.trim()) lines.push(cur.trim()); cur = ''; lastY = null; lastEnd = null; }
    }
    if (cur.trim()) lines.push(cur.trim());
    // Re-attach Vietnamese tone marks that pdf.js sometimes emits as separate glyphs.
    pageLines.push(lines.map((l) => l.normalize('NFC').replace(/\s+([̀-ͯ])/g, '$1').normalize('NFC')));
  }

  // Drop running headers/footers that repeat on most pages, and bare page numbers.
  const norm = (s) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  const count = {};
  if (n >= 3) {
    pageLines.forEach((ls) => {
      new Set([...ls.slice(0, 2), ...ls.slice(-2)].map(norm)).forEach((k) => { count[k] = (count[k] || 0) + 1; });
    });
  }
  const isJunk = (l, idx, len) =>
    /^\s*((page|trang)\s*)?\d+(\s*(of|\/|trên)\s*\d+)?\s*$/i.test(l) ||
    ((idx < 2 || idx >= len - 2) && count[norm(l)] >= Math.max(3, n * 0.5));

  const pageTexts = pageLines.map((ls) => {
    let t = '';
    ls.filter((l, i) => !isJunk(l, i, ls.length)).forEach((l) => {
      if (/[\p{L}]-$/u.test(t) && /^\p{Ll}/u.test(l)) t = t.slice(0, -1) + l; // re-join hyphenated words
      else t += (t ? ' ' : '') + l;
    });
    return t;
  });

  const all = pageTexts.join(' ');
  const lang = detectLang(all);
  const garbled = lang !== 'vi' && (all.match(LEGACY_RE) || []).length > 20;
  return { pageTexts, lang, garbled };
}

/** Render page 1 to a small JPEG data URL for the library cover. */
export async function renderCover(pdf, width = 240) {
  const page = await pdf.getPage(1);
  const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / v1.width });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c.toDataURL('image/jpeg', 0.82);
}
