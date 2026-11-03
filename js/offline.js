// 設定 › 離線下載: whole-Bible download by data pack (DATA_FORMAT.md §10).
// packs.json lists packs; packs/{id}.json lists [path, bytes, sha256] per file. Files go into
// Cache Storage (PACKS_CACHE); the service worker answers data requests from it first.
// Testament rule: id ending in -nt / -ot → that testament; else a pack with `versions` takes
// the union of those versions' testaments (manifest); everything else (base, dict, dict-zh,
// search, versemap) is shared and belongs to both 新約 and 舊約. Required packs are always in.
import { store, url } from './data.js';
import { h, $, toast } from './util.js';
import { PACKS_CACHE } from './sw-names.js';

const STATE_KEY = 'il.packs';           // {id: {state:'done'|'partial', sha256, at, failed}}
const BATCH = 24;
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const CONCURRENCY = IOS ? 3 : 6;
const RETRIES = 3;

let packs = null;                        // packs.json entries (+ .t = Set of testaments)
let selected = new Set();
let job = null;                          // running / paused download
let view = null;                         // live DOM refs while the subpage is open
let est = null, persisted = null;

const mb = (b) => b >= 1e6 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; } }
function saveState(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {} }
function setPackState(id, v) { const s = loadState(); if (v) s[id] = v; else delete s[id]; saveState(s); }
const packStatus = (p) => {
  const s = loadState()[p.id];
  if (!s) return 'none';
  if (s.sha256 && p.sha256 && s.sha256 !== p.sha256) return 'stale';
  return s.state;
};
const LABEL = { none: '未下載', done: '已下載', partial: '部分', stale: '有更新' };

/** Testaments a pack belongs to (see rule at top). */
export function packTestaments(p, versions = store.versions) {
  if (/-nt$/.test(p.id)) return new Set(['NT']);
  if (/-ot$/.test(p.id)) return new Set(['OT']);
  if (p.versions?.length) {
    const t = new Set();
    for (const id of p.versions) for (const x of versions.find(v => v.id === id)?.testament || ['OT', 'NT']) t.add(x);
    return t;
  }
  return new Set(['OT', 'NT']);
}

async function loadPacks() {
  if (packs) return packs;
  const m = store.manifest || {};
  const p = typeof m.packs === 'string' ? m.packs : (m.packs?.path || 'packs.json');
  const res = await fetch(url(p), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  const j = await res.json();
  packs = (j.packs || []).map(x => ({ ...x, t: packTestaments(x) }));
  return packs;
}

async function refreshStorage() {
  try { est = await navigator.storage?.estimate?.(); } catch { est = null; }
  try { persisted = await navigator.storage?.persisted?.(); } catch { persisted = null; }
  draw();
}

// ---------- download engine ----------
async function fetchList(p, cache) {
  const u = url(p.list || `packs/${p.id}.json`);
  let res;
  try { res = await fetch(u, { cache: 'no-cache', headers: { 'x-il-pack': '1' } }); } catch { res = null; }
  if (res?.ok) { await cache.put(u, res.clone()); return res.json(); }
  const hit = await cache.match(u); // offline: a list stored by an earlier download
  if (hit) return hit.json();
  throw new Error(`無法取得 ${p.id} 檔案清單`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function putFile(cache, u) {
  const res = await fetch(u, { cache: 'no-cache', headers: { 'x-il-pack': '1' } });
  if (!res.ok) throw new Error(`${res.status}`);
  await cache.put(u, res);
}

/** Fetch `items` ([url, bytes]) with limited concurrency; returns the failed ones. */
async function runBatch(cache, items, onDone) {
  const failed = [];
  let i = 0;
  const worker = async () => {
    while (i < items.length && !job.cancelled) {
      const it = items[i++];
      try { await putFile(cache, it[0]); onDone(it); } catch { failed.push(it); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return failed;
}

function startJob(ids) {
  const list = packs.filter(p => ids.has(p.id));
  const j = job = {
    packs: list, total: list.reduce((a, p) => a + (p.bytes || 0), 0), done: 0,
    files: 0, nfiles: list.reduce((a, p) => a + (p.files || 0), 0),
    cur: null, paused: false, cancelled: false, error: null, finished: false, resume: null,
  };
  run(j).catch((e) => { j.error = e.message || String(e); j.finished = true; j.cur = null; draw(); refreshStorage(); });
  draw();
}

async function waitIfPaused(j) {
  if (!j.paused || j.cancelled) return;
  j.idle = true; draw();                 // in-flight batch has drained
  while (j.paused && !j.cancelled) await new Promise(r => { j.resume = r; });
  j.idle = false;
}

async function run(j) {
  try { persisted = await navigator.storage?.persist?.(); } catch {}
  const cache = await caches.open(PACKS_CACHE);
  const have = new Set((await cache.keys()).map(r => r.url));
  for (const p of j.packs) {
    if (j.cancelled) break;
    j.cur = p;
    const stale = packStatus(p) === 'stale';
    const list = await fetchList(p, cache);
    const items = list.files.map(([path, bytes]) => [url(path), bytes || 0]);
    // resume / re-run: files already cached count as done (unless the pack changed upstream)
    const todo = [];
    for (const it of items) {
      if (!stale && have.has(it[0])) { j.done += it[1]; j.files++; } else todo.push(it);
    }
    draw();
    const failedAll = [];
    for (let b = 0; b < todo.length; b += BATCH) {
      await waitIfPaused(j);
      if (j.cancelled) break;
      let batch = todo.slice(b, b + BATCH);
      for (let attempt = 0; attempt <= RETRIES && batch.length && !j.cancelled; attempt++) {
        if (attempt) { j.retrying = attempt; draw(); await sleep(400 * 2 ** (attempt - 1)); }
        batch = await runBatch(cache, batch, (it) => { j.done += it[1]; j.files++; have.add(it[0]); draw(); });
      }
      j.retrying = 0;
      failedAll.push(...batch);
      // whole batch failed even after retries → probably offline or quota: stop, keep progress
      if (batch.length && batch.length === Math.min(BATCH, todo.length - b)) {
        setPackState(p.id, { state: 'partial', sha256: p.sha256, at: Date.now(), failed: failedAll.length });
        throw new Error(`下載 ${p.name} 失敗（網路中斷或空間不足）。已下載的部分會保留，可按「重試」。`);
      }
      await new Promise(r => setTimeout(r, 0)); // yield to the UI between batches
    }
    const complete = !j.cancelled && !failedAll.length;
    setPackState(p.id, { state: complete ? 'done' : 'partial', sha256: p.sha256, at: Date.now(), failed: failedAll.length });
    if (failedAll.length) j.error = `${p.name}：${failedAll.length} 個檔案下載失敗，可按「重試」。`;
  }
  j.finished = true;
  j.cur = null;
  if (!j.cancelled && !j.error) toast('離線資料下載完成');
  refreshStorage();
}

function pause() { if (job && !job.finished) { job.paused = true; draw(); } }
function resume() { if (job?.paused) { job.paused = false; job.resume?.(); draw(); } }
function cancel() {
  if (!job || job.finished) return;
  job.cancelled = true; job.paused = false; job.resume?.();
  draw();
}

async function removePack(p) {
  if (job && !job.finished && job.packs.includes(p)) { toast('下載進行中，請先取消'); return; }
  const cache = await caches.open(PACKS_CACHE);
  let list = null;
  try { list = (await (await cache.match(url(p.list || `packs/${p.id}.json`)))?.json()); } catch {}
  if (!list) { try { list = await fetchList(p, cache); } catch {} }
  for (const [path] of list?.files || []) await cache.delete(url(path));
  await cache.delete(url(p.list || `packs/${p.id}.json`));
  setPackState(p.id, null);
  toast(`已刪除：${p.name}`);
  refreshStorage();
}

// ---------- UI ----------
function selectionBytes() {
  let total = 0, need = 0;
  for (const p of packs || []) if (selected.has(p.id)) { total += p.bytes || 0; if (packStatus(p) !== 'done') need += p.bytes || 0; }
  return { total, need };
}
function preset(kind) {
  selected = new Set(packs.filter(p => p.required || kind === 'all' || p.t.has(kind)).map(p => p.id));
  view.preset = kind;
  draw();
}

let raf = 0;
function draw() {
  if (!view || raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}

function paint() {
  if (!view || !packs) return;
  const { total, need } = selectionBytes();
  // storage
  view.storage.replaceChildren(est
    ? `已用 ${mb(est.usage || 0)}／可用配額 ${mb(est.quota || 0)}`
    : '這個瀏覽器無法查詢儲存空間。',
  persisted != null ? h('span.tag', persisted ? '已設為持久儲存' : '未持久儲存（系統可能清除）') : null);
  // presets
  for (const b of view.presets.children) b.setAttribute('aria-checked', String(b.dataset.preset === view.preset));
  // pack rows
  for (const p of packs) {
    const row = view.rows.get(p.id);
    const st = packStatus(p);
    row.cb.checked = selected.has(p.id);
    row.badge.textContent = LABEL[st];
    row.badge.dataset.st = st;
    row.del.hidden = st === 'none';
  }
  view.sum.textContent = `已選 ${selected.size} 個資料包，共 ${mb(total)}${need !== total ? `（尚需下載 ${mb(need)}）` : ''}`;
  const low = est?.quota && need * 1.2 > (est.quota - (est.usage || 0));
  view.warn.hidden = !low;
  // job
  const running = job && !job.finished;
  view.start.hidden = !!running;
  view.start.disabled = !need && !(job?.error);
  view.start.textContent = job?.error || job?.cancelled ? '重試／繼續下載' : '下載';
  view.pause.hidden = !running || job.paused;
  view.resume.hidden = !running || !job.paused;
  view.cancel.hidden = !running;
  const frac = job ? (job.total ? Math.min(1, job.done / job.total) : (job.finished ? 1 : 0)) : 0;
  view.bar.style.transform = `scaleX(${frac.toFixed(4)})`;
  view.prog.hidden = !job;
  view.prog.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  let status = '';
  if (job) {
    if (job.error) status = job.error;
    else if (job.cancelled && job.finished) status = '已取消。已下載的檔案會保留。';
    else if (job.cancelled) status = '取消中…';
    else if (job.finished) status = '完成';
    else if (job.paused) status = job.idle ? `已暫停 · ${job.files}/${job.nfiles} 個檔案` : '暫停中（等待進行中的檔案完成）…';
    else status = `目前：${job.cur?.name || '準備中'} · ${job.files}/${job.nfiles} 個檔案 · ${mb(job.done)}／${mb(job.total)}${job.retrying ? ` · 重試第 ${job.retrying} 次` : ''}`;
  }
  view.status.textContent = status;
  view.pct.textContent = job ? `${Math.round(frac * 100)}%` : '';
}

export async function openOffline() {
  const back = () => { panel.classList.remove('open'); view = null; setTimeout(() => panel.remove(), 320); };
  const body = h('div.settings.offline', h('p.hint', '載入資料包清單…'));
  const panel = h('section.subpage', { role: 'dialog', 'aria-label': '離線下載', id: 'offline' },
    h('header.viewhead', h('button.linkbtn.press', { type: 'button', onclick: back }, '‹ 設定'), h('h1', '離線下載')),
    body);
  document.body.append(panel);
  requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('open')));
  try { await loadPacks(); } catch (e) { body.replaceChildren(h('p.notice', `無法讀取資料包清單（${e.message}）。`)); return; }
  if (!selected.size) selected = new Set(packs.filter(p => p.required || p.default).map(p => p.id));

  const rows = new Map();
  const list = h('ul.packlist', packs.map((p) => {
    const cb = h('input', { type: 'checkbox', disabled: p.required, 'aria-label': p.name,
      onchange: (e) => { e.target.checked ? selected.add(p.id) : selected.delete(p.id); view.preset = null; draw(); } });
    const badge = h('span.pk-st');
    const del = h('button.pk-del.press', { type: 'button', 'aria-label': `刪除 ${p.name}`, onclick: () => removePack(p) }, '刪除');
    rows.set(p.id, { cb, badge, del });
    return h('li', { 'data-pack': p.id },
      h('label.check', cb, h('span', p.name, p.required ? h('small', ' 必要') : null)),
      h('span.pk-meta', h('small.pk-size', mb(p.bytes || 0)), badge, del));
  }));
  const presets = h('div.seg.pk-presets', { role: 'radiogroup', 'aria-label': '下載範圍' },
    [['all', '全部'], ['NT', '新約'], ['OT', '舊約']].map(([k, label]) =>
      h('button.press', { type: 'button', role: 'radio', 'data-preset': k, onclick: () => preset(k) }, label)));
  const bar = h('i');
  view = {
    preset: view?.preset ?? null, rows, presets, bar,
    storage: h('p.pk-storage'),
    sum: h('p.pk-sum'),
    warn: h('p.notice.pk-warn', '可用空間可能不足以放下這次選取的資料。建議先下載較小的部分（例如只下載新約或單一譯本）。'),
    start: h('button.press.primary.pk-btn', { type: 'button', 'data-act': 'start', onclick: () => {
      const ids = new Set(packs.filter(p => selected.has(p.id) && packStatus(p) !== 'done').map(p => p.id));
      if (!ids.size) { toast('選取的資料包都已下載'); return; }
      startJob(ids);
    } }, '下載'),
    pause: h('button.press.pk-btn', { type: 'button', 'data-act': 'pause', onclick: pause }, '暫停'),
    resume: h('button.press.pk-btn', { type: 'button', 'data-act': 'resume', onclick: resume }, '繼續'),
    cancel: h('button.press.pk-btn', { type: 'button', 'data-act': 'cancel', onclick: cancel }, '取消'),
    prog: h('div.pk-prog', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar),
    pct: h('span.pk-pct'),
    status: h('p.pk-status', { 'aria-live': 'polite' }),
  };
  body.replaceChildren(...[ // (replaceChildren would print a null as the text "null")
    IOS ? h('div.notice.pk-ios',
      h('b', 'iOS Safari 的限制'), h('br'),
      'iOS 給網頁的儲存空間較小，而且一段時間沒開啟時，系統可能清除下載的資料。',
      STANDALONE ? null : ' 建議先用「分享 › 加入主畫面」安裝這個 App，再下載。',
      ' 也建議分批下載（例如先下載新約），失敗時可以按「重試」接著下載。') : null,
    view.storage,
    h('h2', '範圍'), presets,
    h('h2', '資料包'), list,
    view.sum, view.warn,
    h('div.pk-actions', view.start, view.pause, view.resume, view.cancel),
    h('div.pk-progrow', view.prog, view.pct), view.status,
    h('p.hint', '下載的資料存在這台裝置的瀏覽器快取（Cache Storage），沒有網路時也能閱讀。'),
  ].filter(Boolean));
  paint();
  refreshStorage();
}

// test hook
export const _offline = { get job() { return job; }, packTestaments, IOS };
