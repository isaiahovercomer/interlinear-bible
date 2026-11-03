// Search data sources. A source is
//   { id, label, abbr, group: 'orig'|'zh'|'en', script: 'grc'|'hbo'|'zh'|'en', lang, dir,
//     units(): number                      — work units for progress (books / chapters)
//     async *verses(scope)                 — yields { key, text, plain? } (plain = pre-folded key text)
//     async display(key, hitText)          — raw text to show for a hit (optional) }
// Descriptors (plain objects) are built on the main thread from the manifest and posted to the
// search worker, which turns them back into sources with `fromDescriptor`.
// Pure module: no DOM; runs in the window and in the worker.

const GROUP_OF = (v) => (v.original ? 'orig' : String(v.lang).startsWith('zh') ? 'zh' : 'en');
const SCRIPT_OF = (v) => {
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
 *   paired with its `<set>-plain` set for fuzzy matching when it exists;
 * - every version not covered by a text set → ChapterJsonSource over chapters already loaded
 *   (posted from memory) or stored in Cache Storage (read by the worker).
 */
export function describeSources({ manifest, versions, books, dataBase, loaded = [] }) {
  const out = [];
  const covered = new Set();
  const s = manifest?.search;
  if (s?.sets && s.path) {
    for (const [set, info] of Object.entries(s.sets)) {
      if (set.endsWith('-plain')) continue;
      const ver = set === 'grc' || set === 'hbo'
        ? versions.find(v => v.original && SCRIPT_OF(v) === set)
        : versions.find(v => v.id === set);
      const script = ver ? SCRIPT_OF(ver) : (set === 'grc' || set === 'hbo' ? set : 'zh');
      const testament = set === 'grc' ? ['NT'] : set === 'hbo' ? ['OT'] : (ver?.testament || ['OT', 'NT']);
      const bookList = info.books || books.filter(b => testament.includes(b.testament)).map(b => b.id);
      if (ver) covered.add(ver.id);
      out.push({
        kind: 'text', id: set, label: ver?.name || set, abbr: ver?.abbr || set,
        group: ver ? GROUP_OF(ver) : (set === 'grc' || set === 'hbo' ? 'orig' : 'zh'),
        script, lang: ver?.lang || script, dir: ver?.dir || (script === 'hbo' ? 'rtl' : 'ltr'),
        raw: new URL(fill(s.path, { set, book: '{book}' }), dataBase).href.replace('%7Bbook%7D', '{book}'),
        plain: s.sets[`${set}-plain`] ? new URL(fill(s.path, { set: `${set}-plain`, book: '{book}' }), dataBase).href.replace('%7Bbook%7D', '{book}') : null,
        books: bookList,
      });
    }
  }
  for (const v of versions) {
    if (covered.has(v.id)) continue;
    const path = v.path?.includes('{') ? v.path : `${v.path || v.id}/{book}/{ch}.json`;
    const abs = new URL(path.replace('{book}', 'BOOK').replace('{ch}', '999'), dataBase).href;
    const re = '^' + abs.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace('BOOK', '([1-3]?[A-Za-z]+)').replace('999', '(\\d+)') + '$';
    out.push({
      kind: 'chapters', id: v.id, label: v.name, abbr: v.abbr, group: GROUP_OF(v), script: SCRIPT_OF(v),
      lang: v.lang, dir: v.dir || (SCRIPT_OF(v) === 'hbo' ? 'rtl' : 'ltr'), urlRe: re,
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
    // chapters stored by the service worker / offline download (any il-* cache but the shell)
    if (typeof caches === 'undefined') { scope.onUnit('cache'); return; }
    try {
      for (const name of await caches.keys()) {
        if (!name.startsWith('il-') || name.startsWith('il-shell')) continue;
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

export const fromDescriptor = (d) => (d.kind === 'text' ? new TextIndexSource(d) : new ChapterJsonSource(d));
