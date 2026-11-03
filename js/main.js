// App bootstrap: data init, tabs (View Transitions), bars, routing, service worker.
import { init, store } from './data.js';
import { apply as applySettings, onChange } from './settings.js';
import { parseKey, parseRef } from './ref.js';
import { BOOK } from './books.js';
import * as reader from './reader.js';
import { sheet } from './sheet.js';
import { initPicker, openPicker, close as closePicker, isOpen as pickerOpen } from './picker.js';
import { initSearch } from './search.js';
import { renderSettings } from './views.js';
import { renderNotes, initNotes } from './notesview.js';
import { $, $$, h, transition, toast } from './util.js';

const tabbar = $('#tabbar');
let tab = 'read';

// ---------- bars ----------
function showBars() { tabbar.classList.remove('hide'); }
function hideBars() {
  if (tab !== 'read' || sheet.open || $('#selbar').classList.contains('show')) return;
  tabbar.classList.add('hide');
}

// ---------- tabs ----------
function setTab(name) {
  if (name === tab) return;
  const target = $(`.view[data-view="${name}"]`);
  transition(() => {
    tab = name;
    for (const v of $$('.view')) {
      if (v.dataset.view === 'read') v.toggleAttribute('inert', name !== 'read');
      else v.hidden = v.dataset.view !== name;
    }
    for (const b of $$('button', tabbar)) {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
    }
    if (name === 'settings') renderSettings();
    if (name === 'notes') renderNotes();
    showBars();
  }, target);
  if (name !== 'read') { sheet.close(); closePicker(); }
  if (name === 'search') setTimeout(() => $('#search-q').focus({ preventScroll: true }), 50);
}
tabbar.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

// ---------- navigation ----------
function toRef(x) { return typeof x === 'string' ? (parseKey(x) || parseRef(x)) : x; }
export async function navigate(x) {
  const r = toRef(x);
  if (!r || !BOOK[r.book]) return;
  if (pickerOpen()) closePicker();
  sheet.close(); // e.g. a #hash link while a word card / syntax sheet is open
  if (tab !== 'read') setTab('read');
  await reader.open(r, { v: r.v });
}
function onChapter(ref) {
  const key = `${ref.book}.${ref.ch}`;
  try { localStorage.setItem('il.last', key); } catch {}
  history.replaceState(null, '', `${location.pathname}${location.search}#${key}`);
}
addEventListener('hashchange', () => { const r = parseKey(location.hash.slice(1)); if (r) navigate(r); });

// ---------- boot ----------
async function boot() {
  applySettings();
  reader.setHooks({ showBars, hideBars, onChapter, navigate, openPicker: () => openPicker(reader.current()) });
  initSearch({ onNavigate: navigate });
  initNotes({ onNavigate: navigate });
  try {
    await init();
  } catch (err) {
    $('#pager').children[1].replaceChildren(h('p.empty', `無法載入資料（${err.message}）。請確認資料目錄設定。`));
    $('#pager').scrollLeft = $('#pager').clientWidth;
    return;
  }
  initPicker({ onNavigate: navigate }); // after init(): greys out testaments the manifest lacks
  onChange((keys) => { if (keys.some(k => k === 'theme')) {/* applied via CSS vars */} });
  const start = parseKey(location.hash.slice(1)) || parseKey(localStorage.getItem('il.last') || '') || { book: 'Matt', ch: 1 };
  await reader.open(start, { v: start.v });
  document.documentElement.dataset.ready = '1';
}
boot();

// ---------- service worker ----------
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) toast('App 已更新到新版本'); });
}
