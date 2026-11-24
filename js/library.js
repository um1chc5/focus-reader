// Library view: a shelf of saved books with covers, progress, open and delete.
import { st, $ } from './state.js';
import { T, fmtDate } from './i18n.js';
import { listBooks, deleteBook, dbAvailable } from './db.js';

let handlers = { onOpen() {}, onAdd() {}, onSample() {}, onDeletedCurrent() {} };

export function initLibrary(h) { handlers = { ...handlers, ...h }; }

const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

export async function renderLibrary() {
  const shelf = $('shelf');
  let ok = await dbAvailable();
  let books = [];
  if (ok) { try { books = await listBooks(); } catch { ok = false; } }
  shelf.innerHTML = '';
  $('libCount').textContent = !ok ? T('noDb') : books.length ? T('books')(books.length) : '';

  if (!books.length) {
    const box = document.createElement('div');
    box.className = 'libEmpty';
    const h = document.createElement('h2'); h.textContent = T('emptyTitle');
    const p = document.createElement('p'); p.textContent = T('emptyBody');
    const btns = document.createElement('div'); btns.className = 'btns';
    const add = document.createElement('button'); add.className = 'btn primary'; add.textContent = T('addBook'); add.onclick = handlers.onAdd;
    const sample = document.createElement('button'); sample.className = 'btn'; sample.textContent = T('trySample'); sample.onclick = handlers.onSample;
    btns.append(add, sample);
    box.append(h, p, btns);
    shelf.appendChild(box);
    return;
  }

  books.forEach((b) => shelf.appendChild(card(b)));
  const add = document.createElement('button');
  add.className = 'addCard';
  add.innerHTML = ICON_PLUS;
  add.append(T('addBook'));
  add.onclick = handlers.onAdd;
  shelf.appendChild(add);
}

function card(b) {
  const started = (b.pos || 0) > 0;
  const pct = b.total ? Math.min(100, Math.round(((b.pos || 0) + 1) / b.total * 100)) : 0;
  const el = document.createElement('div');
  el.className = 'book' + (st.doc && st.doc.id === b.id ? ' current' : '');

  const cover = document.createElement('button');
  cover.className = 'coverBtn';
  cover.setAttribute('aria-label', `${T('openBook')}: ${b.name}`);
  if (b.cover) {
    const img = document.createElement('img');
    img.src = b.cover; img.alt = ''; img.loading = 'lazy';
    cover.appendChild(img);
  } else {
    const nc = document.createElement('span'); nc.className = 'noCover'; nc.textContent = b.name;
    cover.appendChild(nc);
  }
  if (started) {
    const prog = document.createElement('span'); prog.className = 'prog';
    const bar = document.createElement('i'); bar.style.width = pct + '%';
    prog.appendChild(bar); cover.appendChild(prog);
  }
  cover.onclick = () => handlers.onOpen(b.id);

  const title = document.createElement('div'); title.className = 'title'; title.textContent = b.name; title.title = b.name;
  const sub = document.createElement('div'); sub.className = 'sub';
  sub.textContent = started ? T('progress')(pct, b.page || 1, b.pages) : T('notStarted')(b.pages);
  const when = document.createElement('div'); when.className = 'sub'; when.textContent = T('opened')(fmtDate(b.opened || b.added));

  const actions = document.createElement('div'); actions.className = 'bookActions';
  const showDefault = () => {
    actions.innerHTML = '';
    const read = document.createElement('button'); read.className = 'btn'; read.textContent = T('openBook'); read.onclick = () => handlers.onOpen(b.id);
    const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = T('del'); del.onclick = showConfirm;
    actions.append(read, del);
  };
  const showConfirm = () => {
    actions.innerHTML = '';
    const q = document.createElement('span'); q.className = 'sub'; q.textContent = T('delAsk'); q.style.width = '100%';
    const yes = document.createElement('button'); yes.className = 'btn danger'; yes.textContent = T('del');
    yes.onclick = async () => {
      yes.disabled = true;
      try { await deleteBook(b.id); } catch { /* ignore */ }
      if (st.doc && st.doc.id === b.id) handlers.onDeletedCurrent();
      renderLibrary();
    };
    const no = document.createElement('button'); no.className = 'btn'; no.textContent = T('cancel'); no.onclick = showDefault;
    actions.append(q, yes, no);
    no.focus();
  };
  showDefault();

  el.append(cover, title, sub, when, actions);
  return el;
}
