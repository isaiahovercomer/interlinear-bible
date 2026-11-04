// Search data sources. A source is
//   { id, label, abbr, group: 'orig'|'zh'|'en', script: 'grc'|'hbo'|'zh'|'en', lang, dir,
//     units(): number                      — work units for progress (books / chapters)
//     async *verses(scope)                 — yields { key, text, plain? } (plain = pre-folded key text)
//     async display(key, hitText)          — raw text to show for a hit (optional) }
// ShardIndexSource (a text set with a built index, DATA_FORMAT.md §9.1) instead answers
//     candidates(needle), meta(), chunk(n), line(ord) — see the worker.
// Descriptors (plain objects) are built on the main thread from the manifest and posted to the
// search worker, which turns them back into sources with `fromDescriptor`.
// Pure module: no DOM; runs in the window and in the worker.
import { gramShard, needleGrams, cpLength, decodePostings, intersect, parseShard, parseWords, wordCandidates, verseKeys } from './search-index.js';

const GROUP_OF = (v) => (v.original ? 'orig' : String(v.lang).startsWith('zh') ? 'zh' : 'en');
export const scriptOf = (v) => {
  const l = String(v.lang || '').toLowerCase();
  if (['grc', 'el', 'gre'].includes(l)) return 'grc';
  if (['hbo', 'he', 'heb', 'arc'].includes(l)) return 'hbo';
  if (l.startsWith('zh')) return 'zh';
  return 'en';
};
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

/**
 * Main thread: build serialisable source descriptors.
 * - manifest.search present → one TextIndexSource per display set (grc, hbo, cuv, rcv-zh …),
 *   paired with its `<set>-plain` set for fuzzy matching when it exists; when
 *   manifest.search.index has the set (same script), the descriptor also carries `index` and
 *   becomes a ShardIndexSource;
 * - every version not covered by a text set → ChapterJsonSource over chapters already loaded
 *   (posted from memory) or stored in Cache Storage (read by the worker).
 */
export function describeSources({ manifest, versions, books, dataBase, loaded = [] }) {
  const out = [];
  const covered = new Set();
  const s = manifest?.search;
  if (s?.sets && s.path) {
    const ix = s.index?.v === 1 && s.index.path ? s.index : null;
    for (const [set, info] of Object.entries(s.sets)) {
      if (set.endsWith('-plain')) continue;
      const ver = set === 'grc' || set === 'hbo'
        ? versions.find(v => v.original && scriptOf(v) === set)
        : versions.find(v => v.id === set);
      const script = ver ? scriptOf(ver) : (set === 'grc' || set === 'hbo' ? set : 'zh');
      const testament = set === 'grc' ? ['NT'] : set === 'hbo' ? ['OT'] : (ver?.testament || ['OT', 'NT']);
      const bookList = info.books || books.filter(b => testament.includes(b.testament)).map(b => b.id);
      if (ver) covered.add(ver.id);
      const xi = ix?.sets?.[set];
      out.push({
        kind: 'text', id: set, label: ver?.name || set, abbr: ver?.abbr || set,
        group: ver ? GROUP_OF(ver) : (set === 'grc' || set === 'hbo' ? 'orig' : 'zh'),
        script, lang: ver?.lang || script, dir: ver?.dir || (script === 'hbo' ? 'rtl' : 'ltr'),
        raw: new URL(fill(s.path, { set, book: '{book}' }), dataBase).href.replace('%7Bbook%7D', '{book}'),
        plain: s.sets[`${set}-plain`] ? new URL(fill(s.path, { set: `${set}-plain`, book: '{book}' }), dataBase).href.replace('%7Bbook%7D', '{book}') : null,
        books: bookList,
        index: xi && xi.script === script
          ? { base: new URL(fill(ix.path, { set }), dataBase).href, hash: ix.hash || '', verses: xi.verses, chunk: xi.chunk, shards: xi.shards, words: xi.words || 0 }
          : null,
      });
    }
  }
  for (const v of versions) {
    if (covered.has(v.id)) continue;
    const path = v.path?.includes('{') ? v.path : `${v.path || v.id}/{book}/{ch}.json`;
    const abs = new URL(path.replace('{book}', 'BOOK').replace('{ch}', '999'), dataBase).href;
    const re = '^' + abs.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace('BOOK', '([1-3]?[A-Za-z]+)').replace('999', '(\\d+)') + '$';
    out.push({
      kind: 'chapters', id: v.id, label: v.name, abbr: v.abbr, group: GROUP_OF(v), script: scriptOf(v),
      lang: v.lang, dir: v.dir || (scriptOf(v) === 'hbo' ? 'rtl' : 'ltr'), urlRe: re,
      chapters: loaded.filter(c => c.ver === v.id).map(c => ({ book: c.book, ch: c.ch, verses: c.verses })),
    });
  }
  return out;
}

/** Chapter JSON verse → {n, text, lemmas} (what the worker needs). */
export function slimChapter(c) {
  return (c?.verses || []).map(v => ({
    n: v.n,
    text: (v.text != null ? v.text : (v.w || []).map(w => w.t).join(' ')).replace(/¶\s?/g, ''),
    lemmas: v.w ? v.w.map(w => w.l || '').join(' ') : undefined,
  }));
}

// ---------------- worker side ----------------
const textCache = new Map(); // url → Promise<[[cv, text], …] | null>
function loadLines(url) {
  if (!textCache.has(url)) {
    textCache.set(url, fetch(url).then(r => (r.ok ? r.text() : null)).then(t => (t == null ? null
      : t.split('\n').filter(Boolean).map(l => { const i = l.indexOf('\t'); return [l.slice(0, i), l.slice(i + 1)]; })))
      .catch(() => (textCache.delete(url), null)));
  }
  return textCache.get(url);
}

export class TextIndexSource {
  constructor(d) { Object.assign(this, d); }
  units() { return this.books.length; }
  /** scope: { fuzzy, onUnit(label), cancelled() } */
  async *verses(scope) {
    const usePlain = scope.fuzzy && this.plain;
    for (const book of this.books) {
      if (scope.cancelled()) return;
      const lines = await loadLines((usePlain ? this.plain : this.raw).replace('{book}', book));
      scope.onUnit(book);
      if (!lines) continue;
      for (const [cv, t] of lines) {
        const [ch, v] = cv.split(':');
        yield usePlain ? { key: `${book}.${ch}.${v}`, text: null, plain: t, book, cv } : { key: `${book}.${ch}.${v}`, text: t, book, cv };
      }
    }
  }
  /** raw (display) text of a verse found through the plain set */
  async display(hit) {
    const lines = await loadLines(this.raw.replace('{book}', hit.book));
    return lines?.find(([cv]) => cv === hit.cv)?.[1] ?? hit.plain;
  }
}

// Index files never change for a given manifest hash: keep them for the worker's lifetime.
const idxCache = new Map(); // url → Promise
const idxDone = new Set();   // urls whose promise has resolved
/** Forget loaded index files (tools/check-search-parity.mjs measures cold fetches). */
export function resetIndexCache() { idxCache.clear(); idxDone.clear(); }
function cached(url, parse) {
  if (!idxCache.has(url)) {
    idxCache.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return parse(r);
    }).then(v => { idxDone.add(url); return v; }, e => { idxCache.delete(url); throw e; }));
  }
  return idxCache.get(url);
}

/** A text set searched through its index (gram shards or word index) + text blocks (DATA_FORMAT.md §9.1). */
export class ShardIndexSource {
  constructor(d) { Object.assign(this, d); }
  url(p) { return `${this.index.base}${p}${this.index.hash ? `?v=${this.index.hash}` : ''}`; }
  /** meta.json → { keys: ['Gen.1.1', …], alt: Set(ordinals whose key is not keyFor(raw)) } */
  meta() {
    return cached(this.url('meta.json'), async r => {
      const m = await r.json();
      if (m.script !== this.script || m.verses !== this.index.verses) throw new Error(`index mismatch: ${this.id}`);
      return { keys: verseKeys(m.books), alt: new Set(m.alt || []) };
    });
  }
  shard(i) { return cached(this.url(`g/${i}.txt`), async r => parseShard(await r.text())); }
  wordIndex() { return cached(this.url('words.txt'), async r => parseWords(await r.text())); }
  /** Text block n → lines `raw` or `raw\tkey`. */
  chunk(n) { return cached(this.url(`t/${n}.txt`), async r => (await r.text()).split('\n')); }
  /** Has text block n arrived (no wait for it)? */
  ready(n) { return idxDone.has(this.url(`t/${n}.txt`)); }
  /** Text block holding verse `ord`. */
  chunkOf(ord) { return Math.floor(ord / this.index.chunk); }
  /** { raw, key|null } of verse `ord` from its block's lines (key only when it is not keyFor(script,'fuzzy',raw)). */
  lineFrom(lines, ord) {
    const l = lines[ord % this.index.chunk] ?? '';
    const i = l.indexOf('\t');
    return i < 0 ? { raw: l, key: null } : { raw: l.slice(0, i), key: l.slice(i + 1) };
  }
  async line(ord) { return this.lineFrom(await this.chunk(this.chunkOf(ord)), ord); }
  /**
   * Verses whose fuzzy key may contain `needle` (a fuzzy key): { ords (ascending), complete }.
   * complete: ords are exactly the verses whose index key contains `needle` (no text check needed,
   * except for meta.alt) — a word-index needle without a space, or a gram needle of ≤ 2 characters.
   * Every verse for an empty needle.
   */
  async candidates(needle) {
    const metaP = this.meta();
    const nv = this.index.verses;
    if (!needle) {
      await metaP;
      return { ords: Int32Array.from({ length: nv }, (_, i) => i), complete: false };
    }
    if (this.index.words) {
      const [w] = await Promise.all([this.wordIndex(), metaP]);
      return wordCandidates(w, needle, nv);
    }
    const grams = needleGrams(needle);
    const n = this.index.shards;
    const [lists] = await Promise.all([
      Promise.all(grams.map(async g => {
        const p = (await this.shard(gramShard(g, n))).get(g);
        return p ? decodePostings(p) : new Int32Array(0);
      })),
      metaP,
    ]);
    return { ords: intersect(lists), complete: cpLength(needle) <= 2 };
  }
}

export class ChapterJsonSource {
  constructor(d) { Object.assign(this, d); this.re = new RegExp(d.urlRe); }
  units() { return this.chapters.length + 1; }
  async *verses(scope) {
    const seen = new Set();
    const emit = function* (book, ch, verses) {
      for (const v of verses) yield { key: `${book}.${ch}.${v.n}`, text: v.text, lemmas: v.lemmas };
    };
    for (const c of this.chapters) {
      if (scope.cancelled()) return;
      seen.add(`${c.book}.${c.ch}`);
      scope.onUnit(`${c.book} ${c.ch}`);
      yield* emit(c.book, c.ch, c.verses);
    }
    // chapters stored by the service worker (any il-* cache but the shell and the search index)
    if (typeof caches === 'undefined') { scope.onUnit('cache'); return; }
    try {
      for (const name of await caches.keys()) {
        if (!name.startsWith('il-') || name.startsWith('il-shell') || name.startsWith('il-sidx')) continue;
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          if (scope.cancelled()) return;
          const m = this.re.exec(req.url.split('?')[0]);
          if (!m || seen.has(`${m[1]}.${m[2]}`)) continue;
          seen.add(`${m[1]}.${m[2]}`);
          let j = null;
          try { j = await (await cache.match(req)).json(); } catch {}
          if (j) yield* emit(m[1], +m[2], slimChapter(j));
        }
      }
    } catch {}
    scope.onUnit('cache');
  }
}

/** `scan: true` ignores the index (full scan over the per-book text files). */
export const fromDescriptor = (d, { scan = false } = {}) => (d.kind === 'text'
  ? (d.index && !scan ? new ShardIndexSource(d) : new TextIndexSource(d))
  : new ChapterJsonSource(d));
