// 首頁: 繼續閱讀 card, quick search, shortcuts, 今日經文, 舊約／新約 book grid.
import { store, chapter, originalFor, verseText } from './data.js';
import { BOOK } from './books.js';
import { parseKey, refLabel } from './ref.js';
import { enabledVersions } from './settings.js';
import { bookGrid } from './picker.js';
import { h, $ } from './util.js';

const LAST_KEY = 'il.last';
export const DEFAULT_START = { book: 'Matt', ch: 1 };

// 今日經文: one per day, picked by the local date (same verse all day, offline too).
export const VERSES = [
  'John.3.16', 'Ps.23.1', 'Rom.8.28', 'Matt.11.28', 'Isa.40.31', 'Phil.4.6', 'Prov.3.5', 'Gen.1.1',
  'Eph.2.8', 'Heb.11.1', 'Ps.119.105', 'Rom.12.2', '1John.4.8', 'Gal.2.20', 'Matt.5.3', 'John.1.1',
  'Ps.46.1', '2Cor.5.17', 'Isa.53.5', 'Col.3.16', 'Lam.3.22', 'John.14.6', 'Phil.4.13', 'Ps.27.1',
  'Rom.5.8', '1Cor.13.4', 'Heb.4.12', 'Matt.6.33', 'Jer.29.11', 'Rev.21.4', '2Tim.3.16',
];
const DAY = 864e5;
export const verseOfDay = (d = new Date()) =>
  VERSES[Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY) % VERSES.length];

/** Last chapter read (written by main.js on every chapter change), or null. */
export function lastRead() {
  let k = '';
  try { k = localStorage.getItem(LAST_KEY) || ''; } catch {}
  const r = parseKey(k);
  return r && BOOK[r.book] ? { book: r.book, ch: r.ch } : null;
}

let navigate = () => {};
let goTab = () => {};
let ready = false;
let votdStarted = false; // fetched the first time 首頁 is shown (not on deep-link starts)

export function initHome({ onNavigate, onTab }) {
  navigate = onNavigate;
  goTab = onTab;
  $('#home-continue').addEventListener('click', () => navigate(lastRead() || DEFAULT_START));
  $('#home-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#home-q').value.trim();
    $('#home-q').value = '';
    $('#home-q').blur();
    goTab('search', q);
  });
  for (const b of document.querySelectorAll('#view-home [data-go]')) b.addEventListener('click', () => goTab(b.dataset.go));
  renderContinue();
}

/** After data init(): version line, book grid, 今日經文. */
export function homeReady() {
  ready = true;
  $('#home-books').replaceChildren(bookGrid({ scroller: $('#view-home'), onPick: (r) => navigate(r), current: lastRead, short: true }));
  renderHome();
}

/** Refresh the parts that change while the app runs (called whenever 首頁 is shown). */
export function renderHome() {
  renderContinue();
  if (ready && !votdStarted && !$('#view-home').hidden) { votdStarted = true; renderVerseOfDay(); }
  // the expanded chapter grid follows the last-read chapter
  const open = $('#home-books .chapgrid');
  if (open) {
    const last = lastRead();
    for (const c of open.querySelectorAll('.chap')) c.classList.toggle('cur', !!last && last.book === c.dataset.book && last.ch === +c.dataset.ch);
  }
}

function renderContinue() {
  const last = lastRead();
  const r = last || DEFAULT_START;
  const btn = $('#home-continue');
  btn.dataset.ref = `${r.book}.${r.ch}`;
  btn.querySelector('.hc-label').textContent = last ? '繼續閱讀' : '開始閱讀';
  btn.querySelector('.hc-ref').textContent = refLabel(r);
  btn.querySelector('.hc-ver').textContent = ready ? versionLine(BOOK[r.book].testament) : '';
}

/** 「SBLGNT · 恢復本」: the original for that testament + the first enabled translation. */
function versionLine(testament) {
  const orig = originalFor(testament);
  const tr = enabledVersions(store.translations).filter(x => x.on)
    .map(x => store.translations.find(t => t.id === x.id))
    .find(v => v && v.testament.includes(testament));
  return [orig?.testament.includes(testament) ? orig.abbr : null, tr?.name].filter(Boolean).join(' · ');
}

// 恢復本 (the default version) when the data has it, else the first enabled translation.
function votdVersion(testament) {
  const has = (v) => v && v.testament.includes(testament);
  const rcv = store.translations.find(v => v.id === 'rcv-zh');
  if (has(rcv)) return rcv;
  return enabledVersions(store.translations).filter(x => x.on)
    .map(x => store.translations.find(t => t.id === x.id)).find(has) || null;
}

async function renderVerseOfDay() {
  const card = $('#home-votd');
  const r = parseKey(verseOfDay());
  const ver = r && votdVersion(BOOK[r.book].testament);
  card.hidden = true;
  if (!ver) return;
  let text = '';
  try {
    const c = await chapter(ver.id, r.book, r.ch);
    text = verseText(c?.verses?.find(v => v.n === r.v)).trim();
  } catch { /* offline and never cached: leave the card hidden */ }
  if (!text) return;
  card.dataset.ref = `${r.book}.${r.ch}.${r.v}`;
  card.replaceChildren(
    h('span.hc-label', '今日經文'),
    h('span.votd-text', { lang: ver.lang || 'zh-Hant' }, text),
    h('span.votd-ref', refLabel(r), h('small', ver.abbr)));
  card.onclick = () => navigate(r);
  card.hidden = false;
}
