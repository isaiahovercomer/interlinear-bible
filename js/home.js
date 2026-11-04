// 首頁: 繼續閱讀 card, quick search, shortcuts, 今日晨興聖言經文（退回：今日經文）, 舊約／新約 book grid.
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
let votd = null; // 今日經文卡片：首頁第一次顯示時才抓（深層連結開啟時不抓），或使用教學預先要求

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
  if (!$('#view-home').hidden) dailyReady();
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

/** 今日經文卡片（晨興聖言或每日一節）載入完成；還沒開始就現在開始。完成後 <html data-votd> = mrv | votd | none。 */
export function dailyReady() {
  if (ready && !votd) votd = renderVerseOfDay().catch(() => {});
  return votd || Promise.resolve();
}

async function renderVerseOfDay() {
  // 今日晨興聖言經文；讀不到當天（或附近）的進度就退回原本的每日一節
  const html = document.documentElement;
  try { if (await renderMorningRevival()) { html.dataset.votd = 'mrv'; return; } } catch { /* 退回今日經文 */ }
  $('#home-mrv').hidden = true;
  try { await renderDailyVerse(); } finally { html.dataset.votd = $('#home-votd').hidden ? 'none' : 'votd'; }
}

async function renderDailyVerse() {
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

// ---------- 今日晨興聖言經文 ----------
// morning-revival.json（站點根目錄，GitHub Actions 每天更新）：台北召會追求進度定週別，淡水會所晨興聖言給每天經文。
export const MRV_URL = 'morning-revival.json';
const WD = '日一二三四五六';
/** 台北時間的日期 YYYY-MM-DD 與星期（0 = 主日） */
export function taipeiDay(now = new Date()) {
  const t = new Date(now.getTime() + 8 * 3600e3);
  return { date: t.toISOString().slice(0, 10), dow: t.getUTCDay() };
}
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/**
 * 今天要列的那一天：今天有就用今天；否則（主日、資料還沒更新）用一週內最近、不晚於今天的那一天。
 * → {date, dow, today, week, weekTitle, refs} 或 null
 */
export function pickMorningRevival(json, now = new Date()) {
  const { date: today } = taipeiDay(now);
  const min = addDays(today, -7);
  let best = null;
  for (const w of json?.weeks || []) {
    if (!/^\d{4}-\d\d-\d\d$/.test(w?.weekStart || '')) continue;
    for (const [d, refs] of Object.entries(w.days || {})) {
      const date = addDays(w.weekStart, +d - 1);
      const ok = (refs || []).filter(r => BOOK[r?.book] && r.ch > 0 && r.v > 0);
      if (!ok.length || date > today || date < min) continue;
      if (!best || date > best.date) best = { date, dow: +d % 7, today: date === today, week: w.week || '', weekTitle: w.weekTitle || '', refs: ok };
    }
  }
  return best;
}

/** 使用者選的第一個含這部約的譯本（沒有就恢復本） */
function userVersion(testament) {
  const has = (v) => v && v.testament.includes(testament);
  return enabledVersions(store.translations).filter(x => x.on)
    .map(x => store.translations.find(t => t.id === x.id)).find(has) || votdVersion(testament);
}

const MAX_VERSES = 6;
async function passage(ver, r) {
  const c = await chapter(ver.id, r.book, r.ch);
  const last = Math.min(r.v2 || r.v, r.v + MAX_VERSES - 1);
  const parts = [];
  for (let n = r.v; n <= last; n++) {
    const t = verseText(c?.verses?.find(v => v.n === n)).trim();
    if (t) parts.push(t);
  }
  return parts.join(' ') + ((r.v2 || r.v) > last && parts.length ? ' …' : '');
}

const mrvLabel = (r) => `${BOOK[r.book].zh} ${r.ch}:${r.v}${r.v2 ? '-' + r.v2 : ''}`;

async function renderMorningRevival() {
  const card = $('#home-mrv');
  let json = null;
  try {
    const res = await fetch(MRV_URL, { cache: 'no-cache' });
    if (res.ok) json = await res.json();
  } catch { /* 離線又沒有快取 */ }
  const day = json && pickMorningRevival(json);
  if (!day) return false;
  const items = (await Promise.all(day.refs.map(async (r) => {
    const ver = userVersion(BOOK[r.book].testament);
    if (!ver) return null;
    let text = '';
    try { text = await passage(ver, r); } catch {}
    return text ? { r, ver, text } : null;
  }))).filter(Boolean);
  if (!items.length) return false;
  const sub = [day.week, `週${WD[day.dow]}`].filter(Boolean).join(' · ') + (day.weekTitle ? `　${day.weekTitle}` : '');
  card.replaceChildren(
    h('span.hc-label', '今日晨興聖言經文'),
    h('span.mrv-week', sub),
    ...items.map(({ r, ver, text }) => {
      const b = h('button.mrv-item.press', { type: 'button', 'data-ref': `${r.book}.${r.ch}.${r.v}` },
        h('span.votd-text', { lang: ver.lang || 'zh-Hant' }, text),
        h('span.votd-ref', mrvLabel(r), h('small', ver.abbr)));
      b.addEventListener('click', () => navigate({ book: r.book, ch: r.ch, v: r.v }));
      return b;
    }));
  card.dataset.date = day.date;
  card.hidden = false;
  $('#home-votd').hidden = true;
  return true;
}
