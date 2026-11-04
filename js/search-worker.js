// Search worker (module worker). Keeps keyword matching off the UI thread.
// in:  {type:'search', qid, q, script, mode:'exact'|'fuzzy', sources:[descriptor], limit, first}
//      {type:'more', qid, group, upto}    — index path: materialise hits of `group` up to `upto`
//      {type:'cancel'}
// out: {type:'progress', qid, done, total, label}
//      {type:'counts', qid, counts, final}  — index path: hit counts so far (lower bounds until final)
//      {type:'hits', qid, group, hits:[{key, text, range, abbr, src, lang, dir}], counts, filled?}
//      {type:'done', qid, counts, ms}
//      {type:'error', qid, message}
//
// Two strategies, same hits in the same order (per group: source order, then verse order):
// - index (every source of the script is a ShardIndexSource): candidates from the gram shards
//   (zh) or the word index (grc, hbo); when they are not already the exact hits, verify them
//   against their text block; stream the first `first` hits per group (text blocks of the first
//   EARLY rows first), then verify the remaining candidates so the counts are exact; later
//   pages are materialised on demand ('more');
// - scan (fallback, chapter sources): read every verse of every source.
import { fromDescriptor, ShardIndexSource } from './search-sources.js';
import { keyFor, locate, nfc } from './normalize.js';

const POOL = 12;  // text blocks in flight (HTTP/2)
const FIRST = 50; // hits per group before 'done'
const EARLY = 20; // rows whose text blocks are fetched before the rest of the page (first screen)

let current = 0;
let session = null; // index path state of the current query (for 'more')

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'cancel') { current = 0; session = null; return; }
  if (m.type === 'more') { more(m); return; }
  if (m.type === 'search') {
    current = m.qid; session = null;
    run(m).catch(err => fail(m.qid, err));
  }
};
const post = (m) => self.postMessage(m);
const fail = (qid, err) => { if (current === qid) post({ type: 'error', qid, message: String(err?.message || err) }); };

async function run(m) {
  const descs = m.sources.filter(d => d.script === m.script);
  const srcs = descs.map(d => fromDescriptor(d));
  if (srcs.length && srcs.every(s => s instanceof ShardIndexSource) && await runIndexed(m, srcs)) return;
  if (current !== m.qid) return;
  return runScan(m, descs.map(d => fromDescriptor(d, { scan: true })));
}

// ---------------- index ----------------

/** → false when the index cannot be read (the caller falls back to the scan). */
async function runIndexed({ qid, q, script, mode, limit = 1000, first = FIRST }, srcs) {
  const t0 = Date.now();
  const fuzzy = mode === 'fuzzy';
  const needle = keyFor(script, mode, q);
  const counts = { orig: 0, zh: 0, en: 0 };
  if (!needle) { post({ type: 'done', qid, counts, ms: 0 }); return true; }
  // candidates come from the fuzzy key: an exact match is also a fuzzy match (folding is per
  // character), so exact queries use the fuzzy candidates and verify every one
  const gramNeedle = fuzzy ? needle : keyFor(script, 'fuzzy', q);
  const cancelled = () => current !== qid;
  post({ type: 'progress', qid, done: 0, total: 2, label: '索引' });
  let parts;
  try {
    parts = await Promise.all(srcs.map(async src => {
      const [{ ords, complete }, meta] = await Promise.all([src.candidates(gramNeedle), src.meta()]);
      return { src, cands: ords, complete, meta };
    }));
  } catch (err) {
    if (!cancelled()) console.warn('search index unavailable, scanning the text sets', err);
    return cancelled() || false;
  }
  if (cancelled()) return true;

  // Complete candidates of a fuzzy needle (a word-index needle without a space, a gram needle
  // of ≤ 2 characters) are the hits, except for the few verses indexed under two keys
  // (meta.alt), which are checked like everything else.
  for (const p of parts) {
    const short = fuzzy && p.complete;
    p.needs = short ? (ord) => p.meta.alt.has(ord) : () => true;
    p.known = new Map(); // ord → verified hit?
    p.pending = short ? p.cands.filter(o => p.meta.alt.has(o)) : p.cands;
    counts[p.src.group] += p.cands.length - p.pending.length;
  }
  const S = { qid, script, mode, needle, limit, counts, groups: new Map() };
  for (const p of parts) {
    let g = S.groups.get(p.src.group);
    if (!g) S.groups.set(p.src.group, (g = { group: p.src.group, parts: [], pi: 0, ci: 0, out: 0, chain: Promise.resolve() }));
    g.parts.push(p);
  }
  session = S;
  const unverified = () => parts.reduce((n, p) => n + p.pending.filter(o => !p.known.has(o)).length, 0);
  post({ type: 'counts', qid, counts: { ...counts }, final: !unverified() });
  post({ type: 'progress', qid, done: 1, total: 2, label: '經文' });

  // first rows of every group, then the exact counts
  await Promise.all([...S.groups.values()].map(g => fill(S, g, Math.min(first, limit))));
  if (cancelled()) return true;
  await verifyAll(S, parts);
  if (cancelled()) return true;
  post({ type: 'done', qid, counts: { ...counts }, ms: Date.now() - t0 });
  return true;
}

function matches(S, raw, key) {
  const hay = S.mode === 'fuzzy' ? (key ?? keyFor(S.script, 'fuzzy', raw)) : keyFor(S.script, 'exact', raw);
  return hay.includes(S.needle);
}
/** Is verse `ord` of part `p` a hit? (counts it the first time it is verified) */
function check(S, p, ord, line) {
  if (!p.needs(ord)) return true;
  let ok = p.known.get(ord);
  if (ok === undefined) {
    ok = matches(S, line.raw, line.key);
    p.known.set(ord, ok);
    if (ok) S.counts[p.src.group]++;
  }
  return ok;
}

/** Queue: materialise hits of group `g` until it has `upto` (or runs out of candidates). */
function fill(S, g, upto) {
  g.chain = g.chain.then(() => fillNow(S, g, upto)).catch(err => fail(S.qid, err));
  return g.chain;
}
async function fillNow(S, g, upto) {
  let batch = [], last = Date.now(), lastChunk = -1;
  const live = () => current === S.qid;
  const flush = (filled = false) => {
    if (!live() || (!batch.length && !filled)) return;
    post({ type: 'hits', qid: S.qid, group: g.group, hits: batch, counts: { ...S.counts }, filled });
    batch = []; last = Date.now();
  };
  while (g.out < upto && live()) {
    const p = g.parts[g.pi];
    if (!p) break;
    if (g.ci >= p.cands.length) { g.pi++; g.ci = 0; lastChunk = -1; continue; }
    const ord = p.cands[g.ci++];
    const c = p.src.chunkOf(ord);
    if (c !== lastChunk) {
      lastChunk = c;
      prefetch(g, upto);
      if (!p.src.ready(c)) flush(); // about to wait: show what we have
    }
    const line = await p.src.line(ord);
    if (!live()) return;
    if (!check(S, p, ord, line)) continue;
    const text = nfc(line.raw);
    g.out++;
    batch.push({ key: p.meta.keys[ord], text, range: locate(S.script, S.mode, text, S.needle),
      abbr: p.src.abbr, src: p.src.id, lang: p.src.lang, dir: p.src.dir, group: g.group });
    if (g.out === EARLY && upto > EARLY) { flush(); prefetch(g, upto); } // first screen done: the rest of the page
    if (batch.length >= 50 || Date.now() - last > 120) flush();
  }
  flush(true);
}
/**
 * Start loading the text blocks of group `g`'s next rows (display order, at most POOL blocks):
 * up to row EARLY while the first screen is still missing, then up to row `upto`.
 */
function prefetch(g, upto) {
  let n = 0, rows = (g.out < EARLY ? Math.min(EARLY, upto) : upto) - g.out;
  for (let pi = g.pi, ci = Math.max(0, g.ci - 1); pi < g.parts.length && n < POOL && rows > 0; pi++, ci = 0) {
    const p = g.parts[pi];
    let last = -1;
    for (; ci < p.cands.length && n < POOL && rows > 0; ci++, rows--) {
      const c = p.src.chunkOf(p.cands[ci]);
      if (c === last) continue;
      last = c; n++;
      p.src.chunk(c).catch(() => {});
    }
  }
}

/** Verify every candidate not checked yet (text blocks in display order, POOL at a time). */
async function verifyAll(S, parts) {
  const jobs = [];
  for (const p of parts) {
    let job = null;
    for (const ord of p.pending) {
      if (p.known.has(ord)) continue;
      const c = p.src.chunkOf(ord);
      if (!job || job.c !== c) jobs.push((job = { p, c, ords: [] }));
      job.ords.push(ord);
    }
  }
  if (!jobs.length) return;
  let next = 0, done = 0, lastPost = 0;
  const live = () => current === S.qid;
  const lane = async () => {
    while (next < jobs.length && live()) {
      const { p, c, ords } = jobs[next++];
      const lines = await p.src.chunk(c);
      if (!live()) return;
      for (const ord of ords) check(S, p, ord, p.src.lineFrom(lines, ord));
      done++;
      if (Date.now() - lastPost > 150 && done < jobs.length) {
        lastPost = Date.now();
        post({ type: 'progress', qid: S.qid, done: 1 + done / jobs.length, total: 2, label: `${p.src.abbr} 比對` });
        post({ type: 'counts', qid: S.qid, counts: { ...S.counts }, final: false });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, jobs.length) }, lane));
}

function more({ qid, group, upto }) {
  const S = session;
  if (!S || S.qid !== qid || current !== qid) return;
  const g = S.groups.get(group);
  if (g) fill(S, g, Math.min(upto, S.limit));
}

// ---------------- scan ----------------

async function runScan({ qid, q, script, mode, limit = 1000 }, srcs) {
  const t0 = Date.now();
  const fuzzy = mode === 'fuzzy';
  const needle = keyFor(script, mode, q);
  const counts = { orig: 0, zh: 0, en: 0 };
  if (!needle) { post({ type: 'done', qid, counts, ms: 0 }); return; }
  const total = srcs.reduce((n, s) => n + s.units(), 0) || 1;
  let done = 0;
  const cancelled = () => current !== qid;
  let pending = [], lastFlush = Date.now();
  const flush = (group) => {
    if (!pending.length) return;
    post({ type: 'hits', qid, group, hits: pending, counts: { ...counts } });
    pending = []; lastFlush = Date.now();
  };
  for (const src of srcs) {
    const scope = {
      fuzzy, cancelled,
      onUnit: (label) => {
        done++;
        flush(src.group);
        post({ type: 'progress', qid, done, total, label: `${src.abbr} ${label}` });
      },
    };
    for await (const v of src.verses(scope)) {
      if (cancelled()) return;
      let hay;
      if (v.plain != null) hay = script === 'hbo' ? keyFor('hbo', 'fuzzy', v.plain) : v.plain;
      else hay = keyFor(script, mode, v.text) + (fuzzy && v.lemmas ? ' ' + keyFor(script, mode, v.lemmas) : '');
      if (!hay.includes(needle)) continue;
      counts[src.group]++;
      if (counts[src.group] > limit) continue;
      let text = v.text;
      if (text == null) text = await src.display(v);
      if (cancelled()) return;
      text = nfc(text);
      pending.push({ key: v.key, text, range: locate(script, mode, text, needle), abbr: src.abbr, src: src.id, lang: src.lang, dir: src.dir, group: src.group });
      if (pending.length >= 50 || Date.now() - lastFlush > 120) flush(src.group);
    }
    flush(src.group);
  }
  if (!cancelled()) post({ type: 'done', qid, counts, ms: Date.now() - t0 });
}
