// Data loader. Knows only manifest.json + books.json; never hard-codes a version.
import { mergeBooks } from './books.js';
import { refreshNames } from './ref.js';
import { setDefaults } from './settings.js';

const qs = new URLSearchParams(location.search);
let base = qs.get('data') || window.IL_CONFIG?.data || 'data/';
if (!base.endsWith('/')) base += '/';
// Only same-origin data roots are accepted (a ?data= URL must not pull JSON from another site).
let _u = new URL(base, location.href);
if (_u.origin !== location.origin) _u = new URL('data/', location.href);
export const DATA_BASE = _u.href;
export const url = (p) => {
  const u = new URL(p, DATA_BASE);
  if (u.origin !== location.origin) throw new Error(`cross-origin data path refused: ${p}`);
  return u.href;
};

/** G25 → G0025, H1a → H0001a, G2424G stays G2424G (suffix kept as given; DESIGN §3.1) */
export function normStrong(s) {
  const m = /^([GH])0*(\d+)([A-Za-z]?)$/i.exec(String(s || '').trim());
  return m ? m[1].toUpperCase() + m[2].padStart(4, '0') + m[3] : null;
}
/** Strong number without extended-Strong suffix: G2424G → G2424 (for tok ↔ word matching). */
export const baseStrong = (s) => normStrong(s)?.slice(0, 5) || null;
/** Strong numbers of one original word: 'H9002+H9009+H0776G' → ['H9002','H9009','H0776G'] */
export const wordStrongs = (w) => String(w?.s || '').split('+').map(normStrong).filter(Boolean);
/** The headword Strong of a word: `h` marks the main morpheme of a multi-morpheme Hebrew word. */
export function mainStrong(w) {
  const all = wordStrongs(w);
  if (all.length <= 1) return all[0] || null;
  if (Number.isInteger(w.h) && all[w.h]) return all[w.h];
  return all.find(x => !/^H9\d{3}/.test(x)) || all[all.length - 1];
}
/** Lemma of the headword morpheme ('ה+אֶ֫רֶץ' with h=1 → 'אֶ֫רֶץ'). */
export function mainLemma(w) {
  const parts = String(w?.l || '').split('+');
  if (parts.length <= 1) return w?.l || '';
  const i = Number.isInteger(w.h) ? w.h : parts.length - 1;
  return parts[i] || w.l;
}

async function getJSON(p) {
  const res = await fetch(url(p));
  if (!res.ok) { const e = new Error(`${res.status} ${p}`); e.status = res.status; throw e; }
  return res.json();
}

const ORIG_LANGS = ['grc', 'el', 'gre', 'hbo', 'he', 'heb', 'arc'];
function normLicense(l) {
  if (!l) return { name: '未標示' };
  if (typeof l === 'string') return { name: l };
  return { name: l.name || l.id || l.spdx || '未標示', url: l.url || l.link || '', file: l.file || '', note: l.note || '', attribution: l.attribution || l.credit || l.notice || '' };
}
function normVersion(v, id) {
  id = v.id || id;
  const lang = v.lang || v.language || '';
  const type = v.type || v.kind || v.role || '';
  return {
    ...v, id, lang,
    name: v.name || v.title || id,
    abbr: v.abbr || v.abbrev || v.short || v.shortName || id.toUpperCase(),
    original: type === 'original' || type === 'source' || ORIG_LANGS.includes(lang.toLowerCase()),
    testament: [].concat(v.testament || v.testaments || ['NT']),
    license: normLicense(v.license),
    pack: v.pack || 'core',
    size: v.size ?? v.bytes ?? null,
    path: v.path || id,
    attribution: v.attribution || v.license?.attribution || '',
    dir: v.dir || (/^(hbo|he|heb|arc)$/i.test(lang) ? 'rtl' : 'ltr'),
  };
}

export const store = { manifest: null, versions: [], originals: [], translations: [] };

export async function init() {
  // books.json is fetched in parallel with the manifest (default path); refetched only if the
  // manifest names a different file.
  const booksP = getJSON('books.json').catch(() => null);
  const m = await getJSON('manifest.json');
  const list = Array.isArray(m.versions) ? m.versions.map(v => normVersion(v))
    : Object.entries(m.versions || {}).map(([id, v]) => normVersion(v, id));
  store.manifest = m;
  store.versions = list;
  store.originals = list.filter(v => v.original);
  store.translations = list.filter(v => !v.original);
  setDefaults(m, store.translations);
  const bp = typeof m.books === 'string' && m.books !== 'books.json' ? getJSON(m.books).catch(() => null) : booksP;
  const books = await bp;
  if (books) mergeBooks(books);
  refreshNames();
  return store;
}

export const versionById = (id) => store.versions.find(v => v.id === id);
export const originalFor = (testament) => store.originals.find(v => v.testament.includes(testament)) || store.originals[0];

// ---- chapters (memory cache; the service worker keeps them in Cache Storage) ----
const chapters = new Map();
export const loadedChapters = chapters;
export function chapter(verId, book, ch) {
  const v = versionById(verId);
  const key = `${verId}/${book}/${ch}`;
  if (!chapters.has(key)) {
    const path = v?.path || verId;
    const file = path.includes('{') ? fill(path, { book, ch }) : `${path}/${book}/${ch}.json`;
    const p = getJSON(file).catch(e => { if (e.status === 404) return null; chapters.delete(key); throw e; });
    chapters.set(key, p);
  }
  return chapters.get(key);
}

// Path templates from the manifest: {book} {ch} {strong}/{s} {shard} (= first 3 chars, e.g. G00).
function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}
const strongVars = (s) => ({ s, strong: s, shard: s.slice(0, 3), n: parseInt(s.slice(1), 10) });

// ---- dictionary ----
const dicts = new Map();
function dictPath(letter, s) {
  const d = store.manifest?.dict?.[letter];
  const p = typeof d === 'string' ? d : d?.path || `dict/${letter}.json`;
  return fill(p, strongVars(s));
}
async function rawEntry(s) {
  const p = dictPath(s[0], s);
  if (!dicts.has(p)) dicts.set(p, getJSON(p).catch(() => (dicts.delete(p), null)));
  const d = await dicts.get(p);
  if (!d) return null;
  return d[s] ?? d[s.replace(/^([GH])0+/, '$1')] ?? (Array.isArray(d) ? d.find(x => normStrong(x.s || x.strong || x.id) === s) : null);
}
/** Dictionary entry. A bare number that only points elsewhere ({see:[…]}) resolves to the first target. */
export async function dictEntry(strong) {
  const s = normStrong(strong);
  if (!s) return null;
  let e = await rawEntry(s);
  if (!e) { const b = baseStrong(s); if (b !== s) e = await rawEntry(b); }
  if (e?.see && !e.lemma && e.see.length) {
    const first = await rawEntry(normStrong(e.see[0]));
    return first ? { ...first, strong: normStrong(e.see[0]), see: e.see, from: s } : { ...e, strong: s };
  }
  return e ? { ...e, strong: s } : null;
}
export function dictInfo(letter) {
  const d = store.manifest?.dict?.[letter];
  return typeof d === 'object' ? d : null;
}

// ---- 中文 Strong 字典 (CBOL; manifest.dict_zh.G/H = {path}) ----
export async function dictZhEntry(strong) {
  const s = normStrong(strong);
  const info = s && store.manifest?.dict_zh?.[s[0]];
  if (!info) return null;
  const tpl = typeof info === 'string' ? info : info.path;
  const get = async (x) => {
    const p = fill(tpl, strongVars(x));
    if (!dicts.has(p)) dicts.set(p, getJSON(p).catch(() => (dicts.delete(p), null)));
    return (await dicts.get(p))?.[x] || null;
  };
  const e = (await get(s)) || (baseStrong(s) !== s ? await get(baseStrong(s)) : null);
  return e ? { ...e, strong: s } : null;
}
export const dictZhInfo = (letter) => store.manifest?.dict_zh?.[letter] || null;

// ---- syntax trees (manifest.syntax.grc / .hbo) ----
const syn = new Map();
export function syntaxInfo(lang) { return store.manifest?.syntax?.[lang === 'hbo' ? 'hbo' : 'grc'] || null; }
export function syntaxChapter(lang, book, ch) {
  const info = syntaxInfo(lang);
  if (!info?.path) return Promise.resolve(null);
  const p = fill(info.path, { book, ch });
  if (!syn.has(p)) syn.set(p, getJSON(p).catch(() => (syn.delete(p), null)));
  return syn.get(p);
}

// ---- strong → occurrences index ----
const idx = new Map();
function loadIndex(s) {
  const i = store.manifest?.index?.strong;
  const tpl = (typeof i === 'string' ? i : i?.path) || 'index/strong/{strong}.json';
  const p = fill(tpl, strongVars(s));
  if (!idx.has(p)) idx.set(p, getJSON(p).then(j => Array.isArray(j) ? j : (j.refs || [])).catch(() => []));
  return idx.get(p);
}
/** Verse keys where a Strong number occurs. Bare numbers with extended variants merge their lists. */
export async function occurrences(strong, see) {
  const s = normStrong(strong);
  if (!s) return [];
  const own = await loadIndex(s);
  if (own.length || !see?.length) return own;
  const lists = await Promise.all(see.map(x => loadIndex(normStrong(x))));
  const order = (k) => k; // keys are already canonical-ordered per list
  return [...new Set(lists.flat().map(order))];
}

// ---- morphology → 繁中 (manifest.morph.G = {path}) ----
const morphTables = new Map();
export async function morphZh(code, letter = 'G') {
  if (!code) return '';
  const info = store.manifest?.morph?.[letter];
  const p = typeof info === 'string' ? info : info?.path;
  if (!p) return null;
  if (!morphTables.has(p)) morphTables.set(p, getJSON(p).catch(() => null));
  const t = await morphTables.get(p);
  const v = t?.[code];
  return typeof v === 'string' ? v : (v?.zh || v?.parse || null);
}

// ---- verse text helpers ----
export function verseText(verse) {
  if (!verse) return '';
  if (verse.text != null) return verse.text.replace(/¶\s?/g, '');
  if (verse.w) return verse.w.map(w => w.t).join(' ').replace(/¶\s?/g, '');
  return '';
}
