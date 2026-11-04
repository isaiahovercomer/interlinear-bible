// Book picker: OT / NT grids, chapter grid expands in place, quick-jump input.
import { store } from './data.js';
import { BOOKS, BOOK } from './books.js';
import { parseRef, refLabel } from './ref.js';
import { h, $ } from './util.js';

const panel = $('#picker');
const bodyEl = $('#picker-body');
const input = $('#jump');
const hint = $('#jump-hint');
let navigate = () => {};
let currentRef = null;

export function initPicker({ onNavigate }) {
  navigate = onNavigate;
  bodyEl.append(bookGrid({ scroller: bodyEl, onPick: go, current: () => currentRef }));
}

/** 舊約／新約 book grids with the in-place chapter grid (also used by the home view; needs init()). */
export function bookGrid({ scroller, onPick, current = () => null }) {
  const root = h('div.booksecs',
    section('舊約', 'OT', store.originals.some(v => v.testament.includes('OT')) ? null : h('span.tag', '尚無希伯來文原文')),
    section('新約', 'NT'));
  root.addEventListener('click', (e) => {
    const chb = e.target.closest('.chap');
    if (chb) { onPick({ book: chb.dataset.book, ch: +chb.dataset.ch }); return; }
    const bb = e.target.closest('.book');
    if (bb) toggleBook(bb, scroller, current());
  });
  return root;
}

// 「馬太福音」→「馬太」、「哥林多前書」→「哥林多前」；太長就用縮寫（帖前）。
function label(b) {
  const short = b.zh.replace(/(福音|書|記|紀)$/, '');
  return short.length <= 4 ? short : b.abbr;
}

function section(heading, testament, extra) {
  const grid = h('div.bookgrid', { 'data-t': testament });
  for (const b of BOOKS.filter(x => x.testament === testament)) {
    // a testament with no original and no translation in the manifest is greyed out
    const empty = !store.versions.some(v => v.testament.includes(testament));
    grid.append(h('button.book.press', { type: 'button', 'data-book': b.id, title: b.zh, class: `book press${empty ? ' ot' : ''}` }, label(b)));
  }
  return h('section.bsec', h('h2', heading, extra || null), grid);
}

function toggleBook(btn, scroller, cur) {
  const grid = btn.parentElement;
  const open = grid.querySelector('.chapgrid');
  const wasThis = open && open.dataset.book === btn.dataset.book;
  grid.querySelectorAll('.book.on').forEach(b => b.classList.remove('on'));
  open?.remove();
  if (wasThis) return;
  btn.classList.add('on');
  const b = BOOK[btn.dataset.book];
  // insert after the last button of the clicked button's row
  const items = [...grid.querySelectorAll('.book')];
  let last = btn;
  for (const it of items) if (it.offsetTop === btn.offsetTop) last = it;
  const cg = h('div.chapgrid', { 'data-book': b.id },
    !store.originals.some(v => v.testament.includes(b.testament)) ? h('p.notice', '目前的資料沒有這部分的原文；只顯示譯本（若有）。') : null,
    ...Array.from({ length: b.chapters }, (_, i) => h('button.chap.press', { type: 'button', 'data-book': b.id, 'data-ch': i + 1, class: `chap press${cur && cur.book === b.id && cur.ch === i + 1 ? ' cur' : ''}` }, i + 1)));
  last.after(cg);
  // keep the opened grid visible (above the tab bar when the scroller runs under it)
  requestAnimationFrame(() => {
    const r = cg.getBoundingClientRect(), pr = scroller.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
    // …but never scroll the tapped book itself out of view (long books: 詩篇 has 150 chapters)
    const over = Math.min(r.bottom - (pr.bottom - pad) + 12, btn.getBoundingClientRect().top - pr.top - 12);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (over > 0) scroller.scrollBy({ top: over, behavior: reduce ? 'auto' : 'smooth' });
  });
}

function go(ref) { close(); navigate(ref); }

input.addEventListener('input', () => {
  const r = parseRef(input.value);
  hint.textContent = input.value.trim() ? (r ? `→ ${refLabel(r)}${r.v2 ? '-' + r.v2 : ''}` : '看不懂這個出處') : '';
  hint.classList.toggle('bad', !!input.value.trim() && !r);
});
input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const r = parseRef(input.value);
  if (r) { input.blur(); go(r); }
});

export function openPicker(cur) {
  currentRef = cur;
  input.value = '';
  hint.textContent = '';
  panel.removeAttribute('inert');
  panel.setAttribute('aria-hidden', 'false');
  panel.classList.add('open');
  if (cur) {
    const btn = bodyEl.querySelector(`.book[data-book="${cur.book}"]`);
    if (btn && !btn.classList.contains('on')) toggleBook(btn, bodyEl, cur);
    btn?.scrollIntoView({ block: 'center' });
  }
}
export function close() {
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('inert', '');
  input.blur();
}
export const isOpen = () => panel.classList.contains('open');
$('#picker-close').addEventListener('click', close);
