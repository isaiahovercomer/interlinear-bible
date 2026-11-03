// Bookmarks and notes in IndexedDB (DESIGN 決策 10).
// One record per bookmark / note:
//   {id, kind:'bookmark'|'note', refs:['John.3.16',…], text, color, created, updated}
// `refs` has a multiEntry index so the reader can ask "what is marked in this chapter".
// Export / import is plain JSON ({format:'interlinear-notes', v:1, items:[…]}).
import { BOOK } from './books.js';

export const COLORS = { red: '紅', yellow: '黃', green: '綠', blue: '藍', purple: '紫' };
export const KINDS = { bookmark: '書籤', note: '筆記' };
export const FORMAT = 'interlinear-notes';
const MAX_TEXT = 20000;

let dbp = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('interlinear', 2);
    r.onupgradeneeded = (e) => {
      const d = r.result;
      const t = r.transaction;
      const items = d.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('refs', 'refs', { multiEntry: true });
      items.createIndex('updated', 'updated');
      // v1 (Phase 1) had separate `bookmarks` / `notes` stores: migrate them.
      if (e.oldVersion === 1) {
        const move = (name, kind) => {
          if (!d.objectStoreNames.contains(name)) return;
          t.objectStore(name).getAll().onsuccess = (ev) => {
            for (const o of ev.target.result) {
              const at = o.created || Date.now();
              items.put({ id: uid(), kind, refs: o.refs, text: o.text || '', color: null, created: at, updated: at });
            }
            d.deleteObjectStore(name);
          };
        };
        move('bookmarks', 'bookmark');
        move('notes', 'note');
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('items', mode);
    let out;
    const ret = fn(t.objectStore('items'), (v) => { out = v; });
    t.oncomplete = () => resolve(out !== undefined ? out : ret?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function uid() {
  return (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
}
function changed() { dispatchEvent(new CustomEvent('notes:changed')); }

const sameRefs = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Add (or return the existing identical) bookmark for these verse keys. */
export async function addBookmark(refs, color = null) {
  const existing = (await byRef(refs[0])).find(x => x.kind === 'bookmark' && sameRefs(x.refs, refs));
  if (existing) return { item: existing, existed: true };
  const now = Date.now();
  const item = { id: uid(), kind: 'bookmark', refs, text: '', color, created: now, updated: now };
  await tx('readwrite', s => s.put(item));
  changed();
  return { item, existed: false };
}
export async function saveItem(item) {
  const now = Date.now();
  const o = { id: item.id || uid(), kind: item.kind || 'note', refs: item.refs, text: item.text || '', color: item.color || null, created: item.created || now, updated: now };
  await tx('readwrite', s => s.put(o));
  changed();
  return o;
}
export async function putRaw(item) { await tx('readwrite', s => s.put(item)); changed(); }
export async function removeItem(id) { await tx('readwrite', s => s.delete(id)); changed(); }
export const getItem = (id) => tx('readonly', s => s.get(id));
export const listItems = () => tx('readonly', s => s.getAll());
export const byRef = (key) => tx('readonly', s => s.index('refs').getAll(key));

/** Items touching a chapter → Map(verse number → {bookmark, note, color}). */
export async function chapterMarks(book, ch) {
  const pre = `${book}.${ch}.`;
  const items = await tx('readonly', s => s.index('refs').getAll(IDBKeyRange.bound(pre, pre + '￿')));
  const out = new Map();
  for (const it of items) {
    for (const k of it.refs) {
      if (!k.startsWith(pre)) continue;
      const n = +k.slice(pre.length);
      const m = out.get(n) || { bookmark: false, note: false, color: null };
      m[it.kind] = true;
      m.color ||= it.color;
      out.set(n, m);
    }
  }
  return out;
}

// ---------- sorting ----------
/** Canonical order key: book order, chapter, verse. */
export function canonKey(key) {
  const [b, c, v] = String(key).split('.');
  return (BOOK[b]?.order ?? 999) * 1e6 + (+c || 0) * 1e3 + (+v || 0);
}
export function sortItems(items, by) {
  const a = [...items];
  if (by === 'book') a.sort((x, y) => canonKey(x.refs[0]) - canonKey(y.refs[0]) || y.updated - x.updated);
  else a.sort((x, y) => y.updated - x.updated);
  return a;
}

// ---------- export / import ----------
export async function exportJSON() {
  const items = sortItems(await listItems(), 'book');
  return { format: FORMAT, v: 1, exported: new Date().toISOString(), count: items.length, items };
}

const KEY_RE = /^([1-3]?[A-Za-z]+)\.(\d{1,3})\.(\d{1,3})$/;
/** Validate one imported item; returns a clean copy or a reason string. */
export function validateItem(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return '不是物件';
  if (!(o.kind in KINDS)) return `kind 不正確（${String(o.kind).slice(0, 20)}）`;
  if (!Array.isArray(o.refs) || !o.refs.length || o.refs.length > 200) return 'refs 必須是非空陣列';
  for (const k of o.refs) {
    const m = typeof k === 'string' && KEY_RE.exec(k);
    if (!m || !BOOK[m[1]]) return `經節鍵不正確（${String(k).slice(0, 30)}）`;
  }
  if (o.text != null && typeof o.text !== 'string') return 'text 必須是字串';
  if ((o.text || '').length > MAX_TEXT) return 'text 太長';
  if (o.kind === 'note' && !(o.text || '').trim()) return '筆記沒有內容';
  if (o.color != null && !(o.color in COLORS)) return `color 不正確（${String(o.color).slice(0, 20)}）`;
  const num = (x) => Number.isFinite(x) && x > 0 && x < 8.64e15;
  if (o.created != null && !num(o.created)) return 'created 不是時間';
  if (o.updated != null && !num(o.updated)) return 'updated 不是時間';
  if (o.id != null && (typeof o.id !== 'string' || o.id.length > 100)) return 'id 不正確';
  const created = o.created ?? o.updated ?? Date.now();
  return { id: o.id || uid(), kind: o.kind, refs: [...o.refs], text: o.text || '', color: o.color || null, created, updated: o.updated ?? created };
}

/**
 * Merge an export file into the store.
 * - same id: keep whichever has the newer `updated` (older → skipped as duplicate)
 * - different id but same kind + refs + text: duplicate, skipped (a bookmark ignores text)
 * Returns {added, updated, duplicates, invalid:[{index, reason}]}. Throws on a bad envelope.
 */
export async function importJSON(data) {
  if (!data || typeof data !== 'object' || data.format !== FORMAT) throw new Error('不是書籤筆記匯出檔（format 不符）');
  if (data.v !== 1) throw new Error(`不支援的版本 v=${data.v}`);
  if (!Array.isArray(data.items)) throw new Error('items 必須是陣列');
  const res = { added: 0, updated: 0, duplicates: 0, invalid: [] };
  const existing = await listItems();
  const byId = new Map(existing.map(x => [x.id, x]));
  const sig = (x) => `${x.kind}|${x.refs.join(',')}|${x.kind === 'note' ? x.text.trim() : ''}`;
  const sigs = new Set(existing.map(sig));
  const writes = [];
  data.items.forEach((raw, index) => {
    const o = validateItem(raw);
    if (typeof o === 'string') { res.invalid.push({ index, reason: o }); return; }
    const old = byId.get(o.id);
    if (old) {
      if (o.updated > old.updated) { writes.push(o); res.updated++; sigs.add(sig(o)); byId.set(o.id, o); }
      else res.duplicates++;
      return;
    }
    if (sigs.has(sig(o))) { res.duplicates++; return; }
    sigs.add(sig(o)); byId.set(o.id, o);
    writes.push(o); res.added++;
  });
  if (writes.length) await tx('readwrite', s => { for (const o of writes) s.put(o); });
  if (writes.length) changed();
  return res;
}
