// IndexedDB storage for the library.
//   books: { id, name, size, pages, lang, added, opened, pos, total, cover, pageTexts }
//   files: { id, blob }   (the original PDF, kept for page thumbnails)

const DB_NAME = 'focus-reader';
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

export async function dbAvailable() {
  try { await openDb(); return true; } catch { return false; }
}

export async function listBooks() {
  const db = await openDb();
  const books = await wrap(db.transaction('books').objectStore('books').getAll());
  return books.sort((a, b) => (b.opened || 0) - (a.opened || 0));
}

export async function getBook(id) {
  const db = await openDb();
  return wrap(db.transaction('books').objectStore('books').get(id));
}

export async function getFile(id) {
  const db = await openDb();
  const rec = await wrap(db.transaction('files').objectStore('files').get(id));
  return rec ? rec.blob : null;
}

export async function saveBook(book, blob) {
  const db = await openDb();
  const tx = db.transaction(['books', 'files'], 'readwrite');
  tx.objectStore('books').put(book);
  if (blob) tx.objectStore('files').put({ id: book.id, blob });
  return done(tx);
}

export async function updateBook(id, patch) {
  const db = await openDb();
  const tx = db.transaction('books', 'readwrite');
  const store = tx.objectStore('books');
  const get = store.get(id);
  get.onsuccess = () => { if (get.result) store.put({ ...get.result, ...patch }); };
  return done(tx);
}

export async function deleteBook(id) {
  const db = await openDb();
  const tx = db.transaction(['books', 'files'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('files').delete(id);
  return done(tx);
}

/** Ask the browser not to evict saved books under storage pressure. Silent if refused. */
export function requestPersistence() {
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch { /* ignore */ }
}
