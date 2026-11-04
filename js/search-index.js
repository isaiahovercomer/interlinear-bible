// Sharded keyword index (DATA_FORMAT.md §9.1): shared by tools/build-search-index.mjs and the
// search worker, so gram hashing and posting encoding are byte-identical on both sides.
// Pure module: no DOM, no fetch.
//
// Per display set (grc, hbo, rcv-zh, cuv …) verses are numbered 0…n-1 in book order, then line
// order. For Chinese sets the index maps every character unigram and bigram of the verse's
// *fuzzy* key (normalize.js keyFor(script, 'fuzzy', …)) to the sorted list of verse ordinals
// containing it; a gram lives in shard gramShard(gram, shards). Greek and Hebrew sets instead
// have one word index (words.txt, see wordCandidates). Raw verse text is stored in blocks of `chunk`
// verses (one line per verse: `raw` or `raw<TAB>key` when the key is not keyFor(script,'fuzzy',raw)).

export const INDEX_V = 1;

/** FNV-1a (32 bit) over UTF-16 code units → shard number in [0, n). */
export function gramShard(gram, n) {
  let h = 0x811c9dc5;
  for (let i = 0; i < gram.length; i++) { h ^= gram.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % n;
}

/** Every unigram and bigram (code points) of a key, deduplicated. */
export function keyGrams(key) {
  const cps = Array.from(key);
  const out = new Set(cps);
  for (let i = 1; i < cps.length; i++) out.add(cps[i - 1] + cps[i]);
  return out;
}

/**
 * Grams a needle must contain: the unigram for a 1-character needle, otherwise its bigrams.
 * [] for an empty needle (no index lookup possible).
 */
export function needleGrams(needle) {
  const cps = Array.from(needle);
  if (cps.length <= 1) return cps;
  const out = new Set();
  for (let i = 1; i < cps.length; i++) out.add(cps[i - 1] + cps[i]);
  return [...out];
}
/** Needle length in code points (≤ 2 → index hits are final for an unverified fuzzy query). */
export const cpLength = (s) => Array.from(s).length;

// ---- postings: delta-encoded, 5 bits per character ----
// Each value is (ordinal − previous − 1) (previous starts at −1), written base 32 big-endian:
// leading digits from CONT, the last digit from LAST. JSON/TSV safe, no escaping.
const LAST = '0123456789abcdefghijklmnopqrstuv';
const CONT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZwxyz_-';
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < 32; i++) { DIGIT[LAST.charCodeAt(i)] = i; DIGIT[CONT.charCodeAt(i)] = 32 + i; }

/** Sorted, distinct non-negative integers → posting string. */
export function encodePostings(ords) {
  let out = '', prev = -1;
  for (const o of ords) {
    let d = o - prev - 1;
    prev = o;
    let s = LAST[d & 31];
    d = Math.floor(d / 32);
    while (d > 0) { s = CONT[d & 31] + s; d = Math.floor(d / 32); }
    out += s;
  }
  return out;
}

/** Posting string → Int32Array of ordinals (ascending). */
export function decodePostings(s) {
  const out = new Int32Array(s.length);
  let n = 0, acc = 0, prev = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const d = c < 128 ? DIGIT[c] : -1;
    if (d < 0) throw new Error('bad posting digit');
    if (d >= 32) { acc = acc * 32 + (d - 32); continue; }
    prev = prev + 1 + acc * 32 + d;
    out[n++] = prev;
    acc = 0;
  }
  return out.subarray(0, n);
}

/** Intersection of ascending lists (smallest first). */
export function intersect(lists) {
  if (!lists.length) return new Int32Array(0);
  const sorted = [...lists].sort((a, b) => a.length - b.length);
  let cur = sorted[0];
  for (let k = 1; k < sorted.length && cur.length; k++) {
    const b = sorted[k];
    const out = new Int32Array(cur.length);
    let n = 0, j = 0;
    for (let i = 0; i < cur.length; i++) {
      const x = cur[i];
      // gallop: b is usually much longer than cur
      if (j < b.length && b[j] < x) {
        let step = 1;
        while (j + step < b.length && b[j + step] < x) step *= 2;
        let lo = j + (step >> 1), hi = Math.min(j + step, b.length);
        while (lo < hi) { const m = (lo + hi) >> 1; if (b[m] < x) lo = m + 1; else hi = m; }
        j = lo;
      }
      if (j < b.length && b[j] === x) out[n++] = x;
    }
    cur = out.subarray(0, n);
  }
  return cur;
}

/** Union of ascending lists over ordinals 0…n-1 → ascending Int32Array. */
export function union(lists, n) {
  if (lists.length === 1) return lists[0];
  const mark = new Uint8Array(n);
  let k = 0;
  for (const l of lists) for (let i = 0; i < l.length; i++) if (!mark[l[i]]) { mark[l[i]] = 1; k++; }
  const out = new Int32Array(k);
  for (let o = 0, j = 0; j < k; o++) if (mark[o]) out[j++] = o;
  return out;
}

// ---- word index (grc, hbo) ----
// words.txt: `word<TAB>postings` per distinct word of the fuzzy keys (split on ' '), sorted.

/** words.txt text → { words: [word…], posts: [posting string…] } (same order). */
export function parseWords(text) {
  const words = [], posts = [];
  for (const line of text.split('\n')) {
    const i = line.indexOf('\t');
    if (i > 0) { words.push(line.slice(0, i)); posts.push(line.slice(i + 1)); }
  }
  return { words, posts };
}

/**
 * Verses (of `n`) whose key may contain `needle` (a fuzzy key, single-spaced, trimmed), from the
 * word index. Without a space the result is exact (some word contains the needle); with spaces
 * t0 … tk must be a word suffix, whole words, a word prefix — a superset to verify.
 * → { ords, complete }
 */
export function wordCandidates({ words, posts }, needle, n) {
  const toks = needle.split(' ');
  const pick = (test) => {
    const lists = [];
    for (let i = 0; i < words.length; i++) if (test(words[i])) lists.push(decodePostings(posts[i]));
    return lists.length ? union(lists, n) : new Int32Array(0);
  };
  if (toks.length === 1) return { ords: pick(w => w.includes(needle)), complete: true };
  const last = toks.length - 1;
  const lists = toks.map((t, i) => pick(i === 0 ? w => w.endsWith(t) : i === last ? w => w.startsWith(t) : w => w === t));
  return { ords: intersect(lists), complete: false };
}

/** Shard file text (`gram<TAB>postings` per line) → Map gram → posting string (decoded lazily). */
export function parseShard(text) {
  const m = new Map();
  for (const line of text.split('\n')) {
    const i = line.indexOf('\t');
    if (i > 0) m.set(line.slice(0, i), line.slice(i + 1));
  }
  return m;
}

// ---- verse table ----
// meta.books = [[book, [chapter, …]], …]; a chapter is [ch, first, last] when its verses are
// first…last without gaps, else [ch, [v, v, …]].

/** [[book, ch, v], …] in ordinal order → compact books table. */
export function encodeVerses(list) {
  const books = [];
  let b = null, c = null;
  for (const [book, ch, v] of list) {
    if (!b || b[0] !== book) { b = [book, []]; books.push(b); c = null; }
    if (!c || c.ch !== ch) { c = { ch, vs: [] }; b[1].push(c); }
    c.vs.push(v);
  }
  for (const bk of books) {
    bk[1] = bk[1].map(({ ch, vs }) => {
      const contiguous = vs.every((v, i) => v === vs[0] + i);
      return contiguous ? [ch, vs[0], vs[vs.length - 1]] : [ch, vs];
    });
  }
  return books;
}

/** books table → array of verse keys `Book.ch.v` by ordinal. */
export function verseKeys(books) {
  const out = [];
  for (const [book, chs] of books) {
    for (const c of chs) {
      if (Array.isArray(c[1])) for (const v of c[1]) out.push(`${book}.${c[0]}.${v}`);
      else for (let v = c[1]; v <= c[2]; v++) out.push(`${book}.${c[0]}.${v}`);
    }
  }
  return out;
}
