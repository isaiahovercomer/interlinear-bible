// Search tab: one box. Reference → jump; G/H number → occurrence list (+ dictionary glosses);
// anything else → keyword search in a Web Worker over pluggable sources (search-sources.js),
// results grouped 原文／中文／英文, exact or fuzzy (normalize.js).
import { parseRef, parseKey, refLabel, refShort } from './ref.js';
import { normStrong, occurrences, dictEntry, store, loadedChapters, DATA_BASE, url } from './data.js';
import { BOOKS } from './books.js';
import { h, $ } from './util.js';
import { detectQuery } from './normalize.js';
import { describeSources, slimChapter } from './search-sources.js';

const form = $('#search-form');
const q = $('#search-q');
const out = $('#search-results');
const modeSeg = $('#search-mode');
let navigate = () => {};
export function initSearch({ onNavigate }) { navigate = onNavigate; }

const GROUPS = [['orig', '原文'], ['zh', '中文'], ['en', '英文']];
const PAGE = 200;
const MODE_KEY = 'il.searchMode';
let mode = 'fuzzy';
try { mode = localStorage.getItem(MODE_KEY) === 'exact' ? 'exact' : 'fuzzy'; } catch {}

function syncMode() {
  for (const b of modeSeg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
}
syncMode();
modeSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (!b || b.dataset.mode === mode) return;
  mode = b.dataset.mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  syncMode();
  const d = detectQuery(q.value, parseRef);
  if (q.value.trim() && d.kind === 'keyword') run(q.value);
});

form.addEventListener('submit', (e) => { e.preventDefault(); run(q.value); });
// search as you type (keywords only; references and Strong numbers wait for Enter)
let typeTimer = 0;
q.addEventListener('input', () => {
  clearTimeout(typeTimer);
  const t = q.value.trim();
  if (!t) { cancel(); out.replaceChildren(); return; }
  const d = detectQuery(t, parseRef);
  if (d.kind !== 'keyword' || (d.script === 'en' && t.length < 2)) return;
  typeTimer = setTimeout(() => run(t), 280);
});
out.addEventListener('click', (e) => {
  const more = e.target.closest('button[data-more]');
  if (more) { showMore(more.dataset.more); return; }
  const a = e.target.closest('[data-ref]');
  if (a) { e.preventDefault(); navigate(a.dataset.ref); }
});

export async function run(text) {
  text = text.trim();
  clearTimeout(typeTimer);
  if (!text) { cancel(); out.replaceChildren(); return; }
  const d = detectQuery(text, parseRef);
  if (d.kind === 'strong') { cancel(); return strongSearch(normStrong(d.strong)); }
  if (d.kind === 'ref') { cancel(); navigate(d.ref); return; }
  return keywordSearch(text, d.script);
}

// ---------- Strong numbers ----------
const zhDicts = new Map();
async function dictZh(s) {
  const info = store.manifest?.dict_zh?.[s[0]];
  const tpl = typeof info === 'string' ? info : info?.path;
  if (!tpl) return null;
  const get = async (k) => {
    const p = tpl.replace(/\{(\w+)\}/g, (_, x) => (x === 'shard' ? k.slice(0, 3) : x === 'strong' || x === 's' ? k : `{${x}}`));
    if (!zhDicts.has(p)) zhDicts.set(p, fetch(url(p)).then(r => (r.ok ? r.json() : null)).catch(() => null));
    return (await zhDicts.get(p))?.[k] || null;
  };
  return (await get(s)) || (s.length > 5 ? get(s.slice(0, 5)) : null);
}

async function strongSearch(s) {
  out.replaceChildren(h('p.hint', '搜尋中…'));
  const [refs, e, z] = await Promise.all([occurrences(s), dictEntry(s), dictZh(s).catch(() => null)]);
  const lang = s[0] === 'H' ? 'hbo' : 'grc';
  out.replaceChildren(
    h('div.res-head', h('b', s), e || z ? [' ', h('span', { lang }, e?.lemma || z?.lemma || ''), ' ', h('small', e?.gloss || '')] : null, h('small.cnt', ` ${refs.length} 處`)),
    z?.gloss ? h('p.res-zh', h('span.tag', '中文'), ' ', z.gloss, z.m ? h('small', `（${z.m}）`) : null) : null,
    refs.length ? h('ol.reslist', refs.map(k => { const r = parseKey(k); return r ? h('li', h('a', { href: '#' + k, 'data-ref': k }, refLabel(r))) : null; }))
      : h('p.hint', '索引中沒有這個編號。'),
  );
}

// ---------- keywords (worker) ----------
let worker = null, qid = 0, state = null;
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./search-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = onMessage;
  }
  return worker;
}
function cancel() {
  if (worker && state) worker.postMessage({ type: 'cancel' });
  state = null;
}

async function loadedForWorker(ids) {
  const list = [];
  for (const [key, p] of loadedChapters) {
    const [ver, book, ch] = key.split('/');
    if (!ids.has(ver)) continue;
    const c = await p.catch(() => null);
    if (c) list.push({ ver, book, ch: +ch, verses: slimChapter(c) });
  }
  return list;
}

async function keywordSearch(text, script) {
  const id = ++qid;
  const base = { manifest: store.manifest, versions: store.versions, books: BOOKS, dataBase: DATA_BASE };
  // chapter sources (versions without a text index) also get the chapters held in memory
  const chapterIds = new Set(describeSources(base).filter(d => d.kind === 'chapters' && d.script === script).map(d => d.id));
  const loaded = chapterIds.size ? await loadedForWorker(chapterIds) : [];
  if (id !== qid) return;
  const sources = describeSources({ ...base, loaded });
  const active = new Set(sources.filter(d => d.script === script).map(d => d.group));

  const bar = h('i');
  const status = h('span', '搜尋中…');
  const progress = h('div.search-progress', { role: 'status', 'aria-live': 'polite' }, h('div.sp-bar', bar), status);
  const groups = {};
  const sections = GROUPS.map(([g, label]) => {
    const cnt = h('small.cnt', active.has(g) ? '0' : '—');
    const list = h('ol.reslist');
    const empty = h('p.hint.g-empty', active.has(g) ? '' : (g === 'orig' ? '輸入希臘文或希伯來文以搜尋原文。' : g === 'zh' ? '輸入中文以搜尋中文譯本。' : '輸入英文以搜尋英文譯本（已讀過的章節）。'));
    const more = h('div.g-more');
    groups[g] = { hits: [], shown: 0, cnt, list, empty, more, total: 0 };
    return h('section.res-group', { 'data-group': g, class: active.has(g) ? 'res-group' : 'res-group off' }, h('h3', label, ' ', cnt), list, empty, more);
  });
  out.replaceChildren(progress, ...sections);
  out.dataset.qid = id;
  out.setAttribute('aria-busy', 'true');
  state = { id, text, script, groups, bar, status, progress, active };
  getWorker().postMessage({ type: 'search', qid: id, q: text, script, mode, sources });
}

function onMessage(e) {
  const m = e.data;
  if (!state || m.qid !== state.id) return; // stale (cancelled) query
  const s = state;
  if (m.type === 'progress') {
    s.bar.style.transform = `scaleX(${(m.done / m.total).toFixed(3)})`;
    s.status.textContent = `搜尋中… ${m.label}`;
  } else if (m.type === 'hits') {
    for (const hit of m.hits) s.groups[hit.group]?.hits.push(hit);
    for (const [g, n] of Object.entries(m.counts)) setCount(g, n);
    for (const g of Object.keys(s.groups)) renderGroup(g);
  } else if (m.type === 'done') {
    for (const [g, n] of Object.entries(m.counts)) setCount(g, n);
    for (const [g, x] of Object.entries(s.groups)) {
      renderGroup(g);
      if (s.active.has(g) && !x.total) x.empty.textContent = mode === 'exact' ? '沒有精確結果。試試「模糊」。' : '沒有結果。';
    }
    const total = Object.values(m.counts).reduce((a, b) => a + b, 0);
    s.progress.classList.add('done');
    s.status.textContent = `共 ${total} 筆（${mode === 'exact' ? '精確' : '模糊'}）`;
    out.removeAttribute('aria-busy');
    state = { ...s, finished: true };
  } else if (m.type === 'error') {
    s.status.textContent = `搜尋失敗：${m.message}`;
    out.removeAttribute('aria-busy');
  }
}

function setCount(g, n) {
  const x = state.groups[g];
  if (!x || !state.active.has(g)) return;
  x.total = n;
  x.cnt.textContent = String(n);
}

function renderGroup(g, extra = 0) {
  const x = state.groups[g];
  if (!x) return;
  const want = Math.min(x.hits.length, Math.max(PAGE, x.shown) + extra);
  if (want > x.shown) {
    x.list.append(...x.hits.slice(x.shown, want).map(row));
    x.shown = want;
  }
  const rest = x.hits.length - x.shown;
  x.more.replaceChildren(
    rest > 0 ? h('button.linkbtn.press', { type: 'button', 'data-more': g }, `顯示更多（還有 ${rest} 筆）`) : '',
    !rest && x.total > x.hits.length ? h('p.hint', `只列出前 ${x.hits.length} 筆，請縮小搜尋範圍。`) : '');
}
function showMore(g) { if (state) renderGroup(g, PAGE); }

function row(r) {
  const ref = parseKey(r.key);
  return h('li', h('a', { href: '#' + r.key, 'data-ref': r.key },
    h('b', ref ? refShort(ref) : r.key), h('small.ver', r.abbr),
    h('span.snip', { lang: r.lang, dir: r.dir === 'rtl' ? 'rtl' : null }, snippet(r.text, r.range))));
}

/** Window of text around the match, with the match in <mark>. */
function snippet(text, range) {
  if (!range) return text;
  const [a, b] = range;
  const start = a > 14 ? a - 12 : 0;
  return [start ? '…' : '', text.slice(start, a), h('mark', text.slice(a, b)), text.slice(b)];
}
