// Reading view: 3-page virtual pager over CSS scroll-snap, verse-interleaved rendering,
// one delegated tap listener for words / tokens / verse numbers, verse selection.
import { chapterCaption } from './editions.js';
import { store, chapter, originalFor, versionById, baseStrong, verseText, wordStrongs, mainStrong, syntaxInfo } from './data.js';
import { BOOK, BOOKS } from './books.js';
import { settings, enabledVersions, onChange } from './settings.js';
import { h, $, toast, copyText } from './util.js';
import { refLabel, refRangeLabel } from './ref.js';
import { openWordCard } from './wordcard.js';
import { sheet } from './sheet.js';
import { addBookmark, chapterMarks, COLORS } from './notes.js';
import { openEditor } from './editor.js';
import { syntaxView } from './syntax.js';
import { shotAndShare, fileSafe } from './shot.js';
import { out as zhOut } from './zh.js';

const pager = $('#pager');
const titleBtn = $('#title');
const selbar = $('#selbar');
let pages = [...pager.children];
let cur = null;                       // {book, ch}
const models = new WeakMap();         // page → chapter model
const selected = new Set();           // verse numbers (current chapter)
let hooks = { showBars() {}, hideBars() {}, onChapter() {} };
export function setHooks(h) { hooks = { ...hooks, ...h }; }
export const current = () => cur && { ...cur };

// ---------- navigation ----------
export function neighbor(ref, dir) {
  if (!ref) return null;
  const b = BOOK[ref.book];
  const ch = ref.ch + dir;
  if (ch >= 1 && ch <= b.chapters) return { book: b.id, ch };
  const scope = BOOKS.filter(x => x.testament === b.testament);
  const nb = scope[scope.indexOf(b) + dir];
  return nb ? { book: nb.id, ch: dir > 0 ? 1 : nb.chapters } : null;
}

const W = () => pager.clientWidth;
let programmatic = 0;
function setScrollLeft(x) {
  programmatic++;
  pager.scrollLeft = x;
  requestAnimationFrame(() => requestAnimationFrame(() => programmatic--));
}

/** Open a chapter (and optionally scroll to / flash a verse). */
export async function open(ref, { v, flash = !!v } = {}) {
  const same = cur && cur.book === ref.book && cur.ch === ref.ch;
  if (!same) {
    clearSelection();
    cur = { book: ref.book, ch: ref.ch };
    const p = renderInto(pages[1], cur);
    // neighbours show a skeleton immediately but fetch after the current chapter (bandwidth)
    const prev = neighbor(cur, -1), next = neighbor(cur, 1);
    setScrollLeft(W());
    chapterChanged();
    await p;
    renderInto(pages[0], prev);
    renderInto(pages[2], next);
  }
  if (v) await scrollToVerse(pages[1], v, flash);
  else if (!same) pages[1].scrollTop = 0;
}

function chapterChanged() {
  setTitle(cur);
  hooks.onChapter(cur);
}

function setTitle(ref) {
  titleBtn.textContent = ref ? `${BOOK[ref.book].zh} ${ref.ch}` : '';
}

function settle() {
  if (programmatic) return;
  const idx = Math.round(pager.scrollLeft / W());
  if (idx === 1) return;
  const dir = idx === 2 ? 1 : -1;
  const target = neighbor(cur, dir);
  if (!target) { pager.scrollTo({ left: W(), behavior: 'smooth' }); return; }
  clearSelection();
  clearHighlights();
  cur = target;
  let recycled;
  if (dir > 0) { recycled = pages[0]; pager.append(recycled); pages = [pages[1], pages[2], recycled]; }
  else { recycled = pages[2]; pager.prepend(recycled); pages = [recycled, pages[0], pages[1]]; }
  // DOM move + scrollLeft reset happen in the same task → no frame shows the jump.
  setScrollLeft(W());
  syncInert();
  renderInto(recycled, neighbor(cur, dir));
  chapterChanged();
}

// off-screen neighbour chapters: out of the tab order and the accessibility tree
function syncInert() { pages.forEach((p, i) => { p.inert = i !== 1; }); }
syncInert();

let settleTimer = 0;
pager.addEventListener('scroll', (e) => {
  if (e.target !== pager) return;
  if (programmatic) return;
  pager.dataset.paging = '1';
  clearTimeout(settleTimer);
  // live title while swiping
  const idx = Math.round(pager.scrollLeft / W());
  setTitle(pages[idx]?._ref || cur);
  settleTimer = setTimeout(() => { delete pager.dataset.paging; if (!('onscrollend' in window)) settle(); }, 140);
}, { passive: true });
pager.addEventListener('scrollend', (e) => {
  if (e.target !== pager) return;
  delete pager.dataset.paging;
  settle();
});
addEventListener('resize', () => setScrollLeft(W()));

// vertical scroll inside a page → hide / show tab bar
pager.addEventListener('scroll', (e) => {
  const p = e.target;
  if (p === pager || !p.classList?.contains('page') || p !== pages[1]) return;
  const st = p.scrollTop, d = st - (p._lastTop || 0);
  p._lastTop = st;
  if (st < 24) hooks.showBars();
  else if (d > 6) hooks.hideBars();
  else if (d < -6) hooks.showBars();
}, { capture: true, passive: true });

// ---------- rendering ----------
function translationsToShow() {
  return enabledVersions(store.translations).filter(x => x.on).map(x => versionById(x.id)).filter(Boolean);
}

async function renderInto(page, ref) {
  const token = Symbol();
  page._token = token;
  page._ref = ref;
  page._lastTop = 0;
  page.scrollTop = 0;
  models.delete(page);
  if (!ref) {
    page.replaceChildren(h('div.boundary', '已到盡頭'));
    return;
  }
  const b = BOOK[ref.book];
  page.dataset.key = `${ref.book}.${ref.ch}`;
  page.replaceChildren(h('div.chapter.loading', h('h2.chead', `${b.zh} ${ref.ch}`), h('div.skel'), h('div.skel'), h('div.skel.short')));
  const orig = originalFor(b.testament);
  const trs = translationsToShow();
  let oc = null, tcs = [], failed = false;
  try {
    [oc, ...tcs] = await Promise.all([
      orig ? chapter(orig.id, ref.book, ref.ch).catch(() => { failed = true; return null; }) : null,
      ...trs.map(v => chapter(v.id, ref.book, ref.ch).catch(() => { failed = true; return null; })),
    ]);
  } catch { failed = true; }
  if (page._token !== token) return;
  page.replaceChildren(buildChapter(ref, orig, oc, trs, tcs, failed));
  models.set(page, { ref, orig, oc, trs, tcs });
  applyMarks(page);
}

// ---------- bookmark / note markers ----------
async function applyMarks(page) {
  const ref = page._ref;
  if (!ref || !models.has(page)) return;
  let marks;
  try { marks = await chapterMarks(ref.book, ref.ch); } catch { return; }
  if (page._ref !== ref) return;
  for (const sec of page.querySelectorAll('.verse')) {
    const m = marks.get(+sec.dataset.v);
    const vn = sec.querySelector('.vn');
    const n = sec.dataset.v;
    if (!m) { delete sec.dataset.mark; delete sec.dataset.color; vn.setAttribute('aria-label', vnLabel(n)); continue; }
    sec.dataset.mark = [m.bookmark && 'bm', m.note && 'note'].filter(Boolean).join(' ');
    if (m.color) sec.dataset.color = m.color; else delete sec.dataset.color;
    vn.setAttribute('aria-label', `${vnLabel(n)}，${[m.bookmark && '有書籤', m.note && '有筆記'].filter(Boolean).join('、')}${m.color ? `（${COLORS[m.color]}）` : ''}`);
  }
}
const vnLabel = (n) => +n === 0 ? '標題（點選選取）' : `第 ${n} 節（點選選取）`;
addEventListener('notes:changed', () => pages.forEach(applyMarks));

function buildChapter(ref, orig, oc, trs, tcs, failed) {
  const b = BOOK[ref.book];
  const root = h('div.chapter', { 'data-key': `${ref.book}.${ref.ch}` });
  root.append(h('h2.chead', `${b.zh} ${ref.ch}`));
  if (orig && oc?.verses?.length) root.append(h('p.ed-line', { lang: 'zh-Hant' }, h('span.ed-dot', { 'aria-hidden': 'true' }), chapterCaption(orig.lang)));
  const nums = new Set();
  const ov = new Map(oc?.verses?.map(v => [v.n, v]) || []);
  const tv = tcs.map(c => new Map(c?.verses?.map(v => [v.n, v]) || []));
  ov.forEach((_, n) => nums.add(n));
  tv.forEach(m => m.forEach((_, n) => nums.add(n)));
  if (!nums.size) {
    root.append(h('p.empty', failed ? '離線中，這一章還沒有下載過。' : '本章尚無資料。'));
    return root;
  }
  for (const n of [...nums].sort((a, b) => a - b)) {
    const sec = h('section.verse', { 'data-v': n });
    sec.append(h('button.vn', { type: 'button', 'aria-label': vnLabel(n) }, n === 0 ? '題' : n));
    const body = h('div.vb');
    const o = ov.get(n);
    if (o?.w) body.append(origLine(o, orig));
    trs.forEach((v, i) => { const t = tv[i].get(n); if (t) body.append(trLine(t, v)); });
    sec.append(body);
    const stop = body.querySelector('.w,.tk');
    if (stop) makeStop(stop);
    root.append(sec);
  }
  return root;
}

const PILCROW = /¶\s?/g; // paragraph marks (TAGNT, KJV)

const MAQAF = '\u05BE';
const noAccents = (t) => t.replace(/[\u0591-\u05AF\u05BD\u05C0]/g, ''); // cantillation, meteg, paseq (DATA_FORMAT §2.1)

function origLine(verse, ver) {
  const p = document.createElement('p');
  p.className = 'orig';
  p.lang = ver.lang || 'grc';
  const rtl = ver.dir === 'rtl';
  if (rtl) p.dir = 'rtl';
  const strip = rtl && !settings.hebAccents;
  verse.w.forEach((w, i) => {
    // words are space-separated, except after a maqaf (Hebrew word joiner)
    if (i && !verse.w[i - 1].t.endsWith(MAQAF)) p.append(' ');
    const s = document.createElement('span');
    s.className = 'w';
    s.dataset.i = i;
    const t = document.createElement('span');
    t.className = 'wt';
    const txt = w.t.replace(PILCROW, ''); // TAGNT paragraph marks
    t.textContent = strip ? noAccents(txt) : txt;
    s.append(t);
    const ms = mainStrong(w);
    if (ms) s.append(h('small.ws', { dir: 'ltr' }, ms.replace(/^([GH])0*/, '$1')));
    if (w.m) s.append(h('small.wm', { dir: 'ltr' }, w.m));
    p.append(s);
  });
  return p;
}

/** Split `text` into plain runs and tagged tokens; tok may cover all text or only tagged words. */
export function alignTokens(text, tok) {
  if (text == null) text = tok.map(t => t.t).join('');
  const out = [];
  let c = 0;
  tok.forEach((t, i) => {
    if (!t.t) return;
    const pos = text.indexOf(t.t, c);
    if (pos < 0) return;
    if (pos > c) out.push({ t: text.slice(c, pos) });
    const tagged = (t.s && t.s.length) || t.a != null;
    out.push(tagged ? { t: t.t, i } : { t: t.t });
    c = pos + t.t.length;
  });
  if (c < text.length) out.push({ t: text.slice(c) });
  return out;
}

function trLine(verse, ver) {
  const p = document.createElement('p');
  p.className = 'tr';
  p.dataset.ver = ver.id;
  p.lang = ver.lang || '';
  p.append(h('span.ab', ver.abbr));
  if (verse.tok?.length) {
    for (const seg of alignTokens(verse.text, verse.tok)) {
      if (seg.i == null) appendText(p, seg.t.replace(PILCROW, ''));
      else { const s = document.createElement('span'); s.className = 'tk'; s.dataset.i = seg.i; appendText(s, seg.t); p.append(s); }
    }
  } else appendText(p, (verse.text ?? '').replace(PILCROW, ''));
  return p;
}

// Recovery Version marks words supplied by the translator with […] (also inside a token: 世[人]).
// Shown muted, brackets dropped (DATA_FORMAT §3.1).
function appendText(el, t) {
  if (!t.includes('[')) { el.append(t); return; }
  for (const part of t.split(/(\[[^\]]*\])/)) {
    if (!part) continue;
    if (part[0] === '[' && part.endsWith(']')) el.append(h('span.sup', { title: '譯者補字' }, part.slice(1, -1)));
    else el.append(part);
  }
}

/** Re-render all three pages (settings changed), keeping the reading position. */
export async function rerender() {
  if (!cur) return;
  const page = pages[1];
  const anchor = topVisibleVerse(page);
  await Promise.all([renderInto(pages[0], neighbor(cur, -1)), renderInto(page, cur), renderInto(pages[2], neighbor(cur, 1))]);
  if (anchor) await scrollToVerse(page, anchor.n, false, anchor.offset);
}
onChange((keys) => { if (keys.includes('versions') || keys.includes('hebAccents')) rerender(); });

function topVisibleVerse(page) {
  const top = page.getBoundingClientRect().top + topOffset();
  for (const v of page.querySelectorAll('.verse')) {
    const r = v.getBoundingClientRect();
    if (r.bottom > top) return { n: +v.dataset.v, offset: r.top - top };
  }
  return null;
}
const topOffset = () => $('.topbar').getBoundingClientRect().bottom;
const frame = () => new Promise(r => requestAnimationFrame(() => r()));

export async function scrollToVerse(page, n, flash, offset = 0) {
  const vs = [...page.querySelectorAll('.verse')];
  if (!vs.length) return;
  const el = vs.find(v => +v.dataset.v >= n) || vs[vs.length - 1];
  const want = () => el.offsetTop - (topOffset() - page.getBoundingClientRect().top) - 8 - offset;
  // content-visibility:auto sizes are estimates until a verse has rendered once. Render the
  // whole chapter for one layout so `contain-intrinsic-size: auto` remembers real sizes,
  // then jump; afterwards keep correcting until the position is stable for a few frames.
  if (document.fonts?.status !== 'loaded') await document.fonts.ready;
  const chap = page.querySelector('.chapter');
  chap?.classList.add('cv-measure');
  void page.scrollHeight;
  page.scrollTop = want();
  await frame();
  chap?.classList.remove('cv-measure');
  for (let i = 0, stable = 0; i < 20 && stable < 3; i++) {
    await frame();
    const w = want();
    if (Math.abs(page.scrollTop - w) < 1) stable++;
    else { stable = 0; page.scrollTop = w; }
  }
  page._lastTop = page.scrollTop;
  if (flash) {
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  }
}

// ---------- taps (single delegated listener) ----------
function clearHighlights(scope = pager) {
  scope.querySelectorAll('.hl').forEach(e => e.classList.remove('hl'));
}

function tokWords(tok, ov) {
  if (!ov?.w) return [];
  if (tok.a != null) return [].concat(tok.a).filter(i => ov.w[i]);
  const ss = new Set((tok.s || []).map(baseStrong));
  return ov.w.map((w, i) => (wordStrongs(w).some(x => ss.has(baseStrong(x))) ? i : -1)).filter(i => i >= 0);
}

function verseData(page, n) {
  const m = models.get(page);
  if (!m) return null;
  return {
    m,
    ov: m.oc?.verses?.find(v => v.n === n),
    tr: m.trs.map((v, i) => [v, m.tcs[i]?.verses?.find(x => x.n === n)]),
  };
}

// ---------- keyboard: one tab stop per verse, arrows move between words ----------
// Only the verse's current stop carries tabindex/role (roving), so long chapters add one
// attribute per verse instead of one per word; a single delegated listener handles keys.
const WORD = '.w,.tk';
function makeStop(t) { t.tabIndex = 0; t.setAttribute('role', 'button'); }
function dropStop(t) { t.removeAttribute('tabindex'); t.removeAttribute('role'); }
const lines = (verseEl) => [...verseEl.querySelectorAll('.orig,.tr')].filter(l => l.querySelector(WORD));
function verseFirst(verseEl) { return verseEl?.querySelector(WORD); }

let kbdOpen = false;
pager.addEventListener('focusin', (e) => {
  const t = e.target.closest?.(WORD);
  if (!t) return;
  for (const o of t.closest('.vb').querySelectorAll(':is(.w,.tk)[tabindex]')) if (o !== t) dropStop(o);
  makeStop(t);
});
pager.addEventListener('keydown', (e) => {
  const t = e.target.closest?.(WORD);
  if (!t || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    kbdOpen = true;
    try { t.click(); } finally { kbdOpen = false; }
    return;
  }
  const verseEl = t.closest('.verse');
  const line = t.closest('.orig,.tr');
  const inLine = [...line.querySelectorAll(WORD)];
  const ls = lines(verseEl);
  const li = ls.indexOf(line);
  let to = null;
  let key = e.key;
  if (line.dir === 'rtl' && (key === 'ArrowLeft' || key === 'ArrowRight')) key = key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft'; // visual order
  switch (key) {
    case 'ArrowRight': to = inLine[inLine.indexOf(t) + 1] || ls[li + 1]?.querySelector(WORD); break;
    case 'ArrowLeft': { to = inLine[inLine.indexOf(t) - 1]; if (!to) { const p = ls[li - 1]; to = p && [...p.querySelectorAll(WORD)].pop(); } break; }
    case 'ArrowDown': to = ls[li + 1]?.querySelector(WORD) || verseFirst(nextVerse(verseEl, 1)); break;
    case 'ArrowUp': to = ls[li - 1]?.querySelector(WORD) || (() => { const pv = nextVerse(verseEl, -1); const pl = pv && lines(pv).pop(); return pl?.querySelector(WORD); })(); break;
    case 'Home': to = verseFirst(verseEl); break;
    case 'End': to = [...verseEl.querySelectorAll(WORD)].pop(); break;
    default: return;
  }
  e.preventDefault(); // arrows would otherwise scroll the page / the horizontal pager
  if (to) { makeStop(to); to.focus(); } // focusin drops the verse's previous stop
});
function nextVerse(verseEl, dir) {
  let v = verseEl;
  do v = dir > 0 ? v.nextElementSibling : v.previousElementSibling; while (v && !(v.classList.contains('verse') && verseFirst(v)));
  return v;
}

// press feedback within one frame (pointerdown), independent of click timing
pager.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.w,.tk,.vn');
  if (t) { t.classList.add('pressed'); const off = () => { t.classList.remove('pressed'); removeEventListener('pointerup', off, true); removeEventListener('pointercancel', off, true); }; addEventListener('pointerup', off, true); addEventListener('pointercancel', off, true); }
});

pager.addEventListener('click', (e) => {
  if (pager.dataset.paging) return; // mid-swipe: never treat as a tap
  const page = e.target.closest('.page');
  if (page !== pages[1]) return;
  const verseEl = e.target.closest('.verse');
  const n = verseEl ? +verseEl.dataset.v : null;

  const vn = e.target.closest('.vn');
  if (vn) { toggleSelect(n, verseEl); return; }

  const w = e.target.closest('.w');
  if (w) {
    const d = verseData(page, n);
    const i = +w.dataset.i;
    const word = d?.ov?.w?.[i];
    if (!word) return;
    clearHighlights(page);
    w.classList.add('hl');
    // reverse: highlight translation tokens aligned to this word
    const ws = new Set(wordStrongs(word).map(baseStrong).filter(x => !/^H9\d{3}/.test(x)));
    d.tr.forEach(([v, tv]) => {
      if (!tv?.tok) return;
      const line = verseEl.querySelector(`.tr[data-ver="${CSS.escape(v.id)}"]`);
      tv.tok.forEach((tok, ti) => {
        const hit = tok.a != null ? [].concat(tok.a).includes(i) : (tok.s || []).some(x => ws.has(baseStrong(x)));
        if (hit) line?.querySelector(`.tk[data-i="${ti}"]`)?.classList.add('hl');
      });
    });
    showCard(word, `${cur.book}.${cur.ch}.${n}`, null, null, d.ov, i);
    return;
  }

  const tk = e.target.closest('.tk');
  if (tk) {
    const d = verseData(page, n);
    const ver = tk.closest('.tr').dataset.ver;
    const tv = d?.tr.find(([v]) => v.id === ver)?.[1];
    const tok = tv?.tok?.[+tk.dataset.i];
    if (!tok) return;
    clearHighlights(page);
    tk.classList.add('hl');
    const idxs = tokWords(tok, d.ov);
    idxs.forEach(i => verseEl.querySelector(`.orig .w[data-i="${i}"]`)?.classList.add('hl'));
    const word = idxs.length ? d.ov.w[idxs[0]] : null;
    showCard(word, `${cur.book}.${cur.ch}.${n}`, word ? null : (tok.s || [])[0], tok.t, d.ov, idxs[0]);
    return;
  }

  // blank area → bring the bars back
  hooks.showBars();
});

function showCard(word, key, strong, surface, verse, wordIndex) {
  const n = +key.split('.')[2];
  openWordCard({
    word, strong, surface, refKey: key, verse, wordIndex,
    onSyntaxWord: (i) => highlightWords(n, [i]),
    onClose: () => clearHighlights(pages[1]),
    onNavigate: (r) => { sheet.close(); hooks.navigate?.(r); },
    focus: kbdOpen,
  });
}

/** Highlight original words `idxs` of verse n on the current page (syntax view → text). */
export function highlightWords(n, idxs) {
  const page = pages[1];
  const verseEl = page.querySelector(`.verse[data-v="${n}"]`);
  if (!verseEl) return;
  clearHighlights(page);
  for (const i of idxs) verseEl.querySelector(`.orig .w[data-i="${i}"]`)?.classList.add('hl');
  const w = verseEl.querySelector('.orig .w.hl');
  if (w) {
    const r = w.getBoundingClientRect(), top = topOffset();
    const visibleBottom = sheet.open ? innerHeight * (sheet.snap === 'peek' ? 0.7 : 0.5) : innerHeight;
    if (r.top < top || r.bottom > visibleBottom) page.scrollBy({ top: r.top - top - 24, behavior: 'smooth' });
  }
}

/** Open the syntax view for verse n of the current chapter in the bottom sheet. */
async function openSyntax(n) {
  const m = models.get(pages[1]);
  const ov = m?.oc?.verses?.find(v => v.n === n);
  const lang = m?.orig?.lang === 'hbo' ? 'hbo' : 'grc';
  const key = `${cur.book}.${cur.ch}.${n}`;
  const wrap = h('div.synwrap', h('h2.syn-title', `句法 · ${refRangeLabel([key])}`), h('p.hint', '載入句法…'));
  sheet.show(wrap, { at: 'half', onClose: () => clearHighlights(pages[1]), focus: true });
  const view = ov?.w ? await syntaxView({ lang, book: cur.book, ch: cur.ch, n, words: ov.w, onWord: (i) => highlightWords(n, [i]) })
    : h('p.hint', '這一節沒有原文資料。');
  wrap.replaceChildren(wrap.firstChild, view);
}

// ---------- verse selection + capsule toolbar ----------
function toggleSelect(n, el) {
  if (selected.has(n)) { selected.delete(n); el.classList.remove('sel'); }
  else { selected.add(n); el.classList.add('sel'); }
  updateSelbar();
}
export function clearSelection() {
  selected.clear();
  pager.querySelectorAll('.verse.sel').forEach(e => e.classList.remove('sel'));
  updateSelbar();
}
function updateSelbar() {
  const on = selected.size > 0;
  selbar.classList.toggle('show', on);
  selbar.setAttribute('aria-hidden', String(!on));
  selbar.querySelector('.selcount').textContent = on ? `${selected.size} 節` : '';
  const syn = selbar.querySelector('[data-act="syntax"]');
  if (syn) syn.hidden = !(on && syntaxInfo(cur && BOOK[cur.book].testament === 'OT' ? 'hbo' : 'grc'));
  if (on) hooks.showBars();
}
function selectionKeys() { return [...selected].sort((a, b) => a - b).map(n => `${cur.book}.${cur.ch}.${n}`); }
function rangeLabel() {
  const ns = [...selected].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    parts.push(i === j ? `${ns[i]}` : `${ns[i]}-${ns[j]}`);
    i = j;
  }
  return `${BOOK[cur.book].zh} ${cur.ch}:${parts.join(',')}`;
}
function selectionText() {
  const m = models.get(pages[1]);
  const ns = [...selected].sort((a, b) => a - b);
  const lines = [rangeLabel()];
  const vers = m.trs.length ? m.trs.map((v, i) => [v, m.tcs[i]]) : [[m.orig, m.oc]];
  for (const [v, c] of vers) {
    if (!c) continue;
    const txt = ns.map(n => { const x = c.verses.find(y => y.n === n); return x ? `${n} ${verseText(x)}` : null; }).filter(Boolean);
    if (txt.length) lines.push(`${txt.join(' ')}（${v.abbr}）`);
  }
  return lines.join('\n');
}

// 截圖: the selected verses as an image — original line + every visible version, verse by verse.
function selectionBlocks() {
  const m = models.get(pages[1]);
  const ns = [...selected].sort((a, b) => a - b);
  const heb = m.orig?.lang === 'hbo';
  const b = [{ text: rangeLabel(), size: 18, weight: 600, color: 'accent' }];
  const oMap = new Map(m.oc?.verses?.map(v => [v.n, v]) || []);
  const tMaps = m.trs.map((v, i) => [v, new Map(m.tcs[i]?.verses?.map(x => [x.n, x]) || [])]);
  ns.forEach((n, i) => {
    if (i) b.push({ rule: true });
    const o = oMap.get(n);
    if (o) b.push({ text: `${n} ${verseText(o)}`, size: heb ? 21 : 18, font: heb ? 'hbo' : 'grc', dir: heb ? 'rtl' : null, lh: 1.7, gap: 8 });
    for (const [v, map] of tMaps) {
      const t = map.get(n);
      if (t) b.push({ text: `${n} ${verseText(t)}`, size: 16, font: 'serif', lh: 1.65, gap: 6 }, { text: v.abbr || v.name || '', size: 11, font: 'ui', color: 'muted', gap: 0 });
    }
  });
  return b;
}

selbar.addEventListener('click', async (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act || !selected.size) return;
  if (act === 'clear') return clearSelection();
  if (act === 'copy') { await copyText(selectionText()); toast('已複製'); clearSelection(); }
  if (act === 'share') {
    const text = zhOut(selectionText());
    if (navigator.share) {
      try { await navigator.share({ title: zhOut(rangeLabel()), text }); clearSelection(); } catch (err) { if (err?.name !== 'AbortError') { await copyText(text); toast('無法分享，已改為複製'); } }
    } else { await copyText(text); toast('此瀏覽器不支援分享，已複製'); clearSelection(); }
  }
  if (act === 'image') {
    const btn = e.target.closest('button');
    const label = rangeLabel();
    const r = await shotAndShare(btn, selectionBlocks(), { footer: label, name: `${fileSafe(label)}.png`, title: label });
    if (r && r !== 'cancel') clearSelection();
  }
  if (act === 'bookmark') {
    const { existed } = await addBookmark(selectionKeys());
    toast(existed ? `已經在書籤裡：${rangeLabel()}` : `已加入書籤：${rangeLabel()}`);
    clearSelection();
  }
  if (act === 'note') {
    const keys = selectionKeys();
    clearSelection();
    const saved = await openEditor({ refs: keys, kind: 'note' });
    if (saved && saved !== 'deleted') toast('筆記已儲存');
  }
  if (act === 'syntax') {
    const n = Math.min(...selected);
    clearSelection();
    openSyntax(n);
  }
});

titleBtn.addEventListener('click', () => hooks.openPicker?.());
export { refLabel };
