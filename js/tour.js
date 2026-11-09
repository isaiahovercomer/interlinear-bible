// First-run coach marks: a dimmed page with a spotlight cut out around one element and a
// bubble beside it (下一步 / 上一步 / 跳過, 「3 / 9」). Steps whose target is missing are skipped.
//
// When it starts (main.js calls maybeStartTour() once the first view is ready):
// - plain visit → 首頁 steps, then into a chapter, then 設定.
// - deep link (#John.3) → the user came for that passage: the tour waits until the reading view
//   has loaded and leaves the 首頁 steps out (no jump away from the linked chapter).
// Either way it ends on the tab where it began. Shown once: localStorage `il.tour` = TOUR_VERSION.
// 設定 › 「重新觀看使用教學」 replays the whole tour (replayTour()).
// 教學版本：步驟有 `since: N` 表示第 N 版才加入。看過舊版（il.tour < TOUR_VERSION）的人不會重播整套，
// 而是跳出小提示「有新功能介紹」，點「看看」只走新加的步驟。
import { spring, reducedMotion } from './spring.js';
import { sheet } from './sheet.js';
import { h, $ } from './util.js';
import { BOOK } from './books.js';
import { settings } from './settings.js';
import { syntaxInfo } from './data.js';
import { syntaxVerses } from './syntax.js';
import { canSpeak } from './speech.js';

const KEY = 'il.tour';
export const TOUR_VERSION = 3; // 新增步驟時加 1，並在新步驟標 since: TOUR_VERSION
const PAD = 6;          // spotlight padding around the target (px)
const GAP = 14;         // spotlight ↔ bubble
const EDGE = 12;        // bubble ↔ viewport edge
const WAIT = 3000;      // how long a step waits for its target before it is skipped

const cur = () => $('#pager').children[1]; // the reader's current chapter page
const firstWord = () => cur()?.querySelector('.orig .w') || cur()?.querySelector('.tr .tk');
const visibleIn = (el) => el && el.getClientRects().length > 0 && !el.closest('[hidden],[inert]');

/**
 * view: tab the step needs (null = any). card: word card open. select: a verse selected
 * (capsule toolbar shown). home: left out when the tour started from a deep link.
 * optional: shown only if the target already exists (no waiting) — e.g. 🔊.
 * wait: ms to wait for the target (default WAIT). A target returning SKIP stops waiting at once.
 * since: tour version that added the step (old users are offered just these). title/text may be (el) => string.
 * will(ctx): 開始前預判這一步會不會出現（true / false；undefined = 不確定）。預判 false 的步驟直接拿掉，
 *   預判 true 的 optional 步驟一開始就算進總數——「n / 總數」從第 1 步起就不變（不會中途 20 → 21）。
 *   ctx = { ref: 教學要打開的章, lang: 'grc' | 'hbo', letter: 'G' | 'H' }。
 */
const SKIP = 'skip';
// 首頁晨興卡片：資料到了才出現；讀不到時首頁顯示今日經文，就改指那張（home.js 設 data-votd）
const dailyCard = () => {
  const mrv = $('#home-mrv'), votd = $('#home-votd'), st = document.documentElement.dataset.votd;
  if (visibleIn(mrv)) return mrv;
  if (st) return visibleIn(votd) ? votd : SKIP;
  return null;
};
const isMrv = (el) => el?.id === 'home-mrv';
const STEPS = [
  { id: 'continue', view: 'home', home: true, target: () => $('#home-continue'),
    title: '繼續閱讀', text: '從上次讀到的書卷章節接著讀；第一次使用會從馬太福音 1 開始。' },
  { id: 'mrv', view: 'home', home: true, since: 2, wait: 8000, target: dailyCard,
    will: async () => { await hooks.daily(); const st = document.documentElement.dataset.votd; return st ? st !== 'none' : undefined; },
    title: (el) => isMrv(el) ? '今日晨興聖言經文' : '今日經文',
    text: (el) => isMrv(el) ? '每天自動換成當天的晨興聖言經文，有幾處就列幾處。點任一處就開到那一節，可以看原文、點字看字卡。'
      : '每天一節經文。點它就開到那一節，可以看原文、點字看字卡。' },
  { id: 'search', view: 'home', home: true, target: () => $('#home-search'),
    title: '搜尋', text: '輸入經文出處（約3:16）、Strong 編號（G25）或字詞，都能找到。' },
  { id: 'books', view: 'home', home: true, target: () => $('#home-books .bookgrid[data-t="NT"]') || $('#home-books .bookgrid'),
    title: '選書卷', text: '書卷用簡稱排列（太、可、路…）。點一卷展開章號，再點章號就開始讀。' },
  { id: 'tabbar', view: null, target: () => $('#tabbar'),
    title: '底部分頁', text: '首頁、讀經、搜尋、書籤筆記、原文入門、設定，隨時一點切換。' },
  { id: 'primer', view: null, since: 2, target: () => $('#tabbar [data-tab="primer"]'),
    title: '原文入門', text: '沒學過希臘文、希伯來文也沒關係：這裡教字母、讀音和拼讀，點字母就能聽發音。' },
  { id: 'swipe', view: 'read', target: () => cur()?.querySelector('.verse'),
    title: '左右滑動換章', text: '往左滑到下一章，往右滑回上一章。點上方的書卷章名可以快速選書。' },
  { id: 'word', view: 'read', target: firstWord,
    title: '點字看字卡', text: '點原文字，或可點字譯本（如和合本）裡的字，會在下方打開字卡。' },
  { id: 'card', view: 'read', card: true, target: () => sheet.open && $('#sheet'),
    title: '字卡', text: '原文、原形、Strong 編號、詞形和字義都在這裡。點背景或往下甩就關閉。' },
  { id: 'drag', view: 'read', card: true, target: () => sheet.open && $('#sheet .sheet-grip'),
    title: '往上拖看完整字典', text: '按住字卡上緣往上拖：半屏有完整字義，全屏有字典條目和全部出處。' },
  { id: 'speak', view: 'read', card: true, optional: true, will: ({ letter }) => canSpeak(letter),
    target: () => sheet.open && [...$('#sheet').querySelectorAll('button')].find(b => /🔊|發音|发音/.test(`${b.textContent} ${b.getAttribute('aria-label') || ''}`)),
    title: '🔊 發音', text: '點喇叭聽這個字的讀音。' },
  { id: 'copyshot', view: 'read', card: true, target: () => sheet.open && $('#sheet .wc-peek .wc-acts'),
    title: '複製與截圖', text: '「複製」把原文、音譯、Strong 編號、字義和出處複製成文字；「截圖」把字卡做成圖片，可以直接分享或存下來。' },
  { id: 'parallel', view: 'read', target: () => [...(cur()?.querySelectorAll('.verse .vb') || [])].find(b => b.querySelector('.tr')),
    title: '平行經文', text: '每節先列原文，下面是你選的譯本，右側小字是版本縮寫。要顯示哪些譯本、順序如何，在設定裡切換。' },
  { id: 'verse-say', view: 'read', since: 3, target: () => cur()?.querySelector('.verse .orig .vs-say'),
    title: '朗讀原文',
    text: '原文旁的喇叭用這台裝置的現代希臘語（el-GR）或現代以色列希伯來語（he-IL）朗讀整節，不是古音，也不是本 App 下載的語音。聲調、母音和吟誦符號可能不準；裝置沒有這種語音時，會告訴你到系統設定安裝。' },
  // shown when the chapter has syntax data (prepare() waits for the icons, then no extra wait)
  { id: 'syntax', view: 'read', wait: 0, target: () => cur()?.querySelector('.verse .orig .syn-ic'),
    will: async ({ ref, lang }) => !!settings.syntaxIcons && !!syntaxInfo(lang) && (await syntaxVerses(lang, ref.book, ref.ch)).length > 0,
    title: '句法圖示與顏色', text: '原文行末的小樹圖示表示這節有句法分析，點它打開句法圖。顏色區分主詞、動詞／述語、受詞、補語、修飾語／副詞和連接詞；點圖中的字，經文裡的字也用同一個顏色標出。圖示可以在設定裡關閉。' },
  { id: 'select', view: 'read', select: true, target: () => $('#selbar.show'),
    title: '書籤與筆記', text: '點節號選取經文，下方工具列可以複製、分享、截圖成圖片、加書籤或寫筆記；書籤筆記都收在「書籤筆記」分頁。' },
  { id: 'theme', view: 'settings', target: () => $('#settings-body .seg'),
    title: '主題', text: '暖白、淺色、深色、OLED 純黑、羊皮紙，依光線挑一個。' },
  { id: 'zh', view: 'settings', target: () => $('#settings-body .zh-seg'),
    title: '繁體／簡體', text: '經文、字典、書名和介面可以切換成簡體字。搜尋時繁體、簡體都可以直接輸入。' },
  { id: 'font', view: 'settings', target: () => $('#settings-body input[data-key="fontSize"]')?.closest('.slider'),
    title: '字級', text: '拖動滑桿調整字的大小；下面的行距也可以調。' },
  { id: 'editions', view: 'settings', target: () => $('#settings-body .ed-card'),
    title: '原文版本', text: '希臘文新約採 Nestle-Aland 第 28 版（NA28），希伯來文舊約採列寧格勒抄本（Leningrad Codex）。讀經頁每章上方和字卡底部也會標示。' },
  { id: 'versions', view: 'settings', target: () => $('#settings-body .verlist'),
    title: '譯本與順序', text: '勾選要平行顯示的譯本，用 ↑ ↓ 調整先後順序。' },
  { id: 'replay', view: 'settings', target: () => $('#tour-replay'),
    title: '隨時重看', text: '想再看一次，點這裡「重新觀看使用教學」。祝你讀經愉快！' },
];

let hooks = { setTab() {}, tab: () => 'home', chapter: () => null, daily: () => Promise.resolve() };
/** main.js: setTab(name), tab() → current tab name, chapter() → the chapter 讀經 will show,
 *  daily() → promise: 首頁今日經文卡片 loaded (starts loading it). */
export function initTour(h) { hooks = { ...hooks, ...h }; }

/** Tour version the user has seen: 0 = never; the old flag '1' = version 1. */
export const tourSeenVersion = () => {
  try { const v = localStorage.getItem(KEY); return v == null ? 0 : (parseInt(v, 10) || 1); } catch { return TOUR_VERSION; }
};
export const tourSeen = () => tourSeenVersion() > 0;
const markSeen = () => { try { localStorage.setItem(KEY, String(TOUR_VERSION)); } catch {} };
const newSteps = (seen) => STEPS.filter(s => (s.since || 1) > seen);

/** First visit: the whole tour. deepLink: started on #Book.Ch (reader already loaded).
 *  Seen an older version: a small prompt offers just the new steps (asked once). */
export function maybeStartTour({ deepLink = false } = {}) {
  if (active) return;
  const seen = tourSeenVersion();
  if (!seen) { start({ home: !deepLink }); return; }
  if (seen >= TOUR_VERSION) return;
  const fresh = newSteps(seen);
  markSeen();
  if (!fresh.length) return;
  hooks.toast?.(`新功能：${fresh.map(s => typeof s.title === 'string' ? s.title : '今日晨興聖言經文').join('、')}`,
    { action: '看介紹', ms: 12000, onAction: () => { if (!active) start({ home: true, steps: fresh }); } });
}
/** 設定 › 重新觀看使用教學: the full tour, from 首頁. */
export function replayTour() { if (!active) start({ home: true }); }
/** Just the steps added after version `seen` (the 新功能 prompt). */
export function startNewStepsTour(seen = TOUR_VERSION - 1) { if (!active) start({ home: true, steps: newSteps(seen) }); }
export const tourActive = () => !!active;

// ---------- runtime ----------
let active = null; // { steps, i, skipped:Set, found:Set, from, focus, el, ... }

async function start({ home, steps: only }) {
  markSeen();
  const a = active = { from: hooks.tab(), focus: document.activeElement }; // tourActive() while predicting
  const all = (only || STEPS).filter(s => home || !s.home);
  const will = await predict(all);
  if (active !== a) return;
  const steps = all.filter(s => will.get(s.id) !== false);
  if (!steps.length) { active = null; return; }
  const expect = new Set(steps.filter(s => will.get(s.id) === true).map(s => s.id));
  Object.assign(a, { steps, i: -1, skipped: new Set(), found: expect, busy: false, hole: null, bub: null });
  build();
  go(0, 1);
}

const PREDICT_MS = 5000;
/** Map step id → will(ctx) result (undefined when unknown, failed or too slow). */
async function predict(steps) {
  const ref = hooks.chapter();
  const ot = ref && BOOK[ref.book]?.testament === 'OT';
  const ctx = { ref, lang: ot ? 'hbo' : 'grc', letter: ot ? 'H' : 'G' };
  const out = new Map();
  const late = new Promise(r => setTimeout(r, PREDICT_MS));
  await Promise.all(steps.filter(s => s.will && (ref || s.view !== 'read')).map(async (s) => {
    try { out.set(s.id, await Promise.race([s.will(ctx), late.then(() => undefined)])); } catch {}
  }));
  return out;
}

function build() {
  const a = active;
  a.el = h('div.tour', { 'data-step': '' },
    a.catcher = h('div.tour-catch'), // swallows taps on the dim area: they never advance
    a.holeEl = h('div.tour-hole', { 'aria-hidden': 'true' }),
    a.bubble = h('div.tour-bubble', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title', 'aria-describedby': 'tour-text', lang: 'zh-Hant', dir: 'ltr' },
      a.arrow = h('i.tour-arrow', { 'aria-hidden': 'true' }),
      h('div.tour-head', a.titleEl = h('h2#tour-title'), a.countEl = h('span.tour-count', { 'aria-hidden': 'true' })),
      a.textEl = h('p#tour-text'),
      h('div.tour-btns',
        a.skipBtn = h('button.tour-skip.press', { type: 'button', onclick: () => end() }, '跳過'),
        a.prevBtn = h('button.tour-prev.press', { type: 'button', onclick: () => go(a.i - 1, -1) }, '上一步'),
        a.nextBtn = h('button.tour-next.press', { type: 'button', onclick: () => go(a.i + 1, 1) }, '下一步')),
      a.live = h('div.tour-live', { 'aria-live': 'polite', role: 'status' })));
  for (const t of ['pointerdown', 'click', 'touchstart']) a.catcher.addEventListener(t, (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
  // window-capture: before the word card's own Esc / focus trap (document listeners)
  addEventListener('keydown', onKey, true);
  document.body.append(a.el);
  requestAnimationFrame(() => a.el.classList.add('on'));
  a.raf = requestAnimationFrame(follow);
}

function onKey(e) {
  const a = active;
  if (!a) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); end(); return; }
  if (e.key === 'Tab') {
    e.preventDefault(); e.stopImmediatePropagation();
    const items = [a.skipBtn, a.prevBtn, a.nextBtn].filter(b => !b.disabled && !b.hidden);
    const at = items.indexOf(document.activeElement);
    const n = at < 0 ? (e.shiftKey ? items.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + items.length) % items.length;
    items[n].focus({ preventScroll: true });
    return;
  }
  // keys meant for the page underneath (arrows scroll the pager, Enter taps words): bubble only
  if (!a.bubble.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
}

const frame = () => new Promise(r => requestAnimationFrame(r));
async function waitFor(fn, ms) {
  const t0 = performance.now();
  for (;;) {
    const el = fn();
    if (el === SKIP) return null;
    if (visibleIn(el)) return el;
    if (performance.now() - t0 >= ms) return null;
    await frame();
  }
}

/** Put the app into the state step `s` needs (tab, word card, verse selection). */
async function prepare(s) {
  if (s.view && hooks.tab() !== s.view) {
    hooks.setTab(s.view);
    await waitFor(() => $(`.view[data-view="${s.view}"]`), 1000);
    if (s.view === 'read') await waitFor(firstWord, WAIT);
  }
  if (!s.select && $('#selbar.show')) $('#selbar [data-act="clear"]').click();
  if (s.card && !sheet.open) firstWord()?.click();
  if (!s.card && sheet.open) sheet.close();
  if (s.select && !$('#selbar.show')) cur()?.querySelector('.verse .vn')?.click();
  if (s.id === 'tabbar' || s.id === 'primer') $('#tabbar').classList.remove('hide');
  if (s.id === 'syntax') await cur()?._synReady;
}

async function go(i, dir) {
  const a = active;
  if (!a || a.busy) return;
  if (i < 0) return;
  if (i >= a.steps.length) { end(); return; }
  a.busy = true;
  a.el.dataset.busy = '1';
  const s = a.steps[i];
  let el = null;
  try {
    await prepare(s);
    if (active !== a) return;
    el = await waitFor(s.target, s.optional ? 0 : s.wait ?? WAIT);
  } catch { el = null; }
  if (active !== a) return;
  a.busy = false;
  delete a.el.dataset.busy;
  if (!el) {
    a.skipped.add(s.id);
    // nothing earlier to go back to: stay where we were
    if (dir < 0 && i === 0) { if (a.i >= 0) return; dir = 1; }
    go(i + dir, dir);
    return;
  }
  if (s.optional) a.found.add(s.id);
  a.i = i;
  a.target = el;
  a.el.dataset.step = s.id;
  scrollIntoViewIfNeeded(el);
  render(s);
}

function counter() {
  const a = active;
  const shown = a.steps.filter(s => !a.skipped.has(s.id) && (!s.optional || a.found.has(s.id)));
  return [shown.indexOf(a.steps[a.i]) + 1, shown.length];
}

function render(s) {
  const a = active;
  const [n, total] = counter();
  const last = !a.steps.slice(a.i + 1).some(x => !a.skipped.has(x.id) && (!x.optional || a.found.has(x.id)));
  const title = typeof s.title === 'function' ? s.title(a.target) : s.title;
  const text = typeof s.text === 'function' ? s.text(a.target) : s.text;
  a.titleEl.textContent = title;
  a.textEl.textContent = text;
  a.countEl.textContent = `${n} / ${total}`;
  a.prevBtn.disabled = n <= 1;
  a.nextBtn.textContent = last ? '完成' : '下一步';
  a.live.textContent = `第 ${n} 步，共 ${total} 步。${title}。${text}`;
  a.bubble.classList.remove('swap'); void a.bubble.offsetWidth; a.bubble.classList.add('swap');
  a.nextBtn.focus({ preventScroll: true });
  // spring the spotlight + bubble from where they are to the new target (follow() tracks it live)
  a.anim?.stop();
  a.start = a.hole ? { hole: a.hole, bub: a.bub } : { hole: viewportRect(), bub: null };
  a.t = 0;
  a.anim = spring({ from: 0, to: 1, onUpdate: (t) => { a.t = t; }, onDone: () => { a.t = 1; } });
}

// ---------- geometry ----------
const viewportRect = () => ({ x: 0, y: 0, w: innerWidth, h: innerHeight });
function holeFor(el) {
  const r = el.getBoundingClientRect();
  // clip to the viewport (the word card is a full-height sheet pushed down by a transform)
  const x1 = Math.max(r.left - PAD, 4), y1 = Math.max(r.top - PAD, 4);
  const x2 = Math.min(r.right + PAD, innerWidth - 4), y2 = Math.min(r.bottom + PAD, innerHeight - 4);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

/** Bubble below the spotlight if it fits, else above, else over the larger free side. */
function bubbleFor(hole, bw, bh) {
  const below = innerHeight - (hole.y + hole.h) - GAP - EDGE;
  const above = hole.y - GAP - EDGE;
  let y, side;
  if (below >= bh) { y = hole.y + hole.h + GAP; side = 'below'; }
  else if (above >= bh) { y = hole.y - GAP - bh; side = 'above'; }
  else if (below >= above) { y = innerHeight - EDGE - bh; side = 'inside'; }
  else { y = EDGE; side = 'inside'; }
  const cx = hole.x + hole.w / 2;
  const x = Math.min(Math.max(cx - bw / 2, EDGE), innerWidth - EDGE - bw);
  return { x, y: Math.max(EDGE, y), side, ax: Math.min(Math.max(cx - x, 22), bw - 22) };
}

const lerp = (p, q, t) => p + (q - p) * t;
const lerpRect = (p, q, t) => ({ x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t), w: lerp(p.w, q.w, t), h: lerp(p.h, q.h, t) });

// One rAF loop while the tour is open: the spotlight follows its target through scrolling,
// resizing and the word card's spring (none of which fire a single reliable event).
// The hole moves by transform; its box size is set directly (one fixed, contained element).
function follow() {
  const a = active;
  if (!a) return;
  a.raf = requestAnimationFrame(follow);
  if (!a.target) return;
  if (!a.target.isConnected) { const el = a.steps[a.i].target(); if (visibleIn(el)) a.target = el; else return; }
  const live = holeFor(a.target);
  const t = a.t ?? 1;
  const hole = t >= 1 ? live : lerpRect(a.start.hole, live, t);
  const bw = a.bubble.offsetWidth, bh = a.bubble.offsetHeight;
  const goal = bubbleFor(live, bw, bh);
  const bub = t >= 1 || !a.start.bub ? goal : { ...goal, x: lerp(a.start.bub.x, goal.x, t), y: lerp(a.start.bub.y, goal.y, t) };
  const k = `${hole.x.toFixed(1)},${hole.y.toFixed(1)},${hole.w.toFixed(1)},${hole.h.toFixed(1)}|${bub.x.toFixed(1)},${bub.y.toFixed(1)},${bub.side}`;
  if (k === a.key) return;
  a.key = k;
  a.hole = hole; a.bub = bub;
  Object.assign(a.holeEl.style, { width: `${hole.w}px`, height: `${hole.h}px`, transform: `translate3d(${hole.x}px,${hole.y}px,0)` });
  a.bubble.style.transform = `translate3d(${bub.x}px,${bub.y}px,0)`;
  a.bubble.dataset.side = bub.side;
  a.arrow.style.left = `${bub.ax}px`;
  a.el.toggleAttribute('data-moving', t < 1);
}

/** Scroll the target into the part of the screen not covered by the top bar / tab bar. */
function scrollIntoViewIfNeeded(el) {
  const r = el.getBoundingClientRect();
  if (el.closest('#tabbar,#sheet,#selbar')) return; // fixed chrome: always on screen
  const top = el.closest('#view-read') ? $('.topbar').getBoundingClientRect().bottom : 0;
  const bottom = innerHeight - $('#tabbar').offsetHeight;
  if (r.top >= top + 8 && r.bottom <= bottom - 8) return;
  el.scrollIntoView({ block: r.height < (bottom - top) * 0.6 ? 'center' : 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

function end() {
  const a = active;
  if (!a) return;
  active = null;
  a.anim?.stop();
  cancelAnimationFrame(a.raf);
  removeEventListener('keydown', onKey, true);
  if ($('#selbar.show')) $('#selbar [data-act="clear"]').click();
  sheet.close();
  if (a.from && hooks.tab() !== a.from) hooks.setTab(a.from);
  a.el.classList.remove('on');
  a.el.classList.add('closing');
  setTimeout(() => a.el.remove(), reducedMotion.matches ? 0 : 220);
  const back = a.focus?.isConnected && a.focus !== document.body ? a.focus : null;
  back?.focus({ preventScroll: true });
}
