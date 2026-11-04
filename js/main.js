// App bootstrap: data init, tabs (View Transitions), bars, routing, service worker.
import { init, store } from './data.js';
import { apply as applySettings, onChange } from './settings.js';
import { parseKey, parseRef } from './ref.js';
import { BOOK } from './books.js';
import * as reader from './reader.js';
import { sheet } from './sheet.js';
import { initPicker, openPicker, close as closePicker, isOpen as pickerOpen } from './picker.js';
import { initSearch, run as runSearch } from './search.js';
import { renderSettings } from './views.js';
import { initPrimer, renderPrimer } from './primer.js';
import { renderNotes, initNotes } from './notesview.js';
import { initHome, homeReady, renderHome, lastRead, DEFAULT_START } from './home.js';
import { initTour, maybeStartTour } from './tour.js';
import { $, $$, h, transition, toast } from './util.js';

const tabbar = $('#tabbar');
let tab = 'read';
// a #Book.Ch deep link opens the reader; a plain visit lands on 首頁
const deepLink = parseKey(location.hash.slice(1));

// ---------- bars ----------
function showBars() { tabbar.classList.remove('hide'); }
function hideBars() {
  if (tab !== 'read' || sheet.open || $('#selbar').classList.contains('show')) return;
  tabbar.classList.add('hide');
}

// ---------- tabs ----------
function showTab(name) {
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
  if (name === 'home') renderHome();
  if (name === 'primer') renderPrimer();
  showBars();
}
// 首頁 has no hash (a reload stays home); the reader keeps #Book.Ch
function syncHash() {
  const r = reader.current();
  const hash = tab === 'home' || !r ? '' : `#${r.book}.${r.ch}`;
  if (location.hash !== hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
}
function setTab(name, query, navigating = false) {
  if (name === tab) return;
  const target = $(`.view[data-view="${name}"]`);
  tab = name; // now, not in the (async) View Transition callback: navigate() may follow at once
  const vt = transition(() => showTab(name), target);
  if (name !== 'read') { sheet.close(); closePicker(); }
  // the reader is empty when the app started on 首頁: open where the user left off
  if (name === 'read' && !navigating && !reader.current()) reader.open(lastRead() || DEFAULT_START);
  syncHash();
  if (name === 'search') {
    if (query) { $('#search-q').value = query; runSearch(query); }
    // focus once the view is shown (the View Transition swaps it in asynchronously)
    const focus = () => { if (tab === 'search') $('#search-q').focus({ preventScroll: true }); };
    vt ? vt.updateCallbackDone.then(focus, focus) : focus();
  }
}
tabbar.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

// ---------- navigation ----------
function toRef(x) { return typeof x === 'string' ? (parseKey(x) || parseRef(x)) : x; }
export async function navigate(x) {
  const r = toRef(x);
  if (!r || !BOOK[r.book]) return;
  if (pickerOpen()) closePicker();
  sheet.close(); // e.g. a #hash link while a word card / syntax sheet is open
  if (tab !== 'read') setTab('read', null, true);
  await reader.open(r, { v: r.v });
}
function onChapter(ref) {
  const key = `${ref.book}.${ref.ch}`;
  try { localStorage.setItem('il.last', key); } catch {}
  syncHash();
}
addEventListener('hashchange', () => { const r = parseKey(location.hash.slice(1)); if (r) navigate(r); });

// ---------- boot ----------
async function boot() {
  applySettings();
  try { localStorage.removeItem('il.packs'); } catch {} // state of the removed 離線下載 (≤ 0.2.x)
  reader.setHooks({ showBars, hideBars, onChapter, navigate, openPicker: () => openPicker(reader.current()) });
  initSearch({ onNavigate: navigate });
  initNotes({ onNavigate: navigate });
  initHome({ onNavigate: navigate, onTab: setTab });
  initPrimer({ onNavigate: navigate });
  initTour({ setTab, tab: () => tab });
  if (!deepLink) showTab('home'); // before the first await: no flash of the empty reader
  try {
    await init();
  } catch (err) {
    if (tab === 'home') showTab('read');
    $('#pager').children[1].replaceChildren(h('p.empty', `無法載入資料（${err.message}）。請確認資料目錄設定。`));
    $('#pager').scrollLeft = $('#pager').clientWidth;
    return;
  }
  initPicker({ onNavigate: navigate }); // after init(): greys out testaments the manifest lacks
  homeReady();
  onChange((keys) => { if (keys.some(k => k === 'theme')) {/* applied via CSS vars */} });
  if (deepLink) await reader.open(deepLink, { v: deepLink.v });
  document.documentElement.dataset.ready = '1';
  // first visit: coach marks (after a deep link: now that the chapter is on screen, see tour.js)
  maybeStartTour({ deepLink: !!deepLink });
}
boot();

// ---------- service worker ----------
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) toast('App 已更新到新版本'); });
}
