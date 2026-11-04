// 「書籤筆記」tab: sortable list (經卷／時間), filter, swipe-left delete with undo,
// bottom-sheet editor, JSON export / import.
import { listItems, sortItems, removeItem, putRaw, exportJSON, importJSON, KINDS, COLORS } from './notes.js';
import { openEditor } from './editor.js';
import { refRangeLabel } from './ref.js';
import { spring, reducedMotion } from './spring.js';
import { h, $, toast } from './util.js';
import { icon } from './icons.js';

const root = $('#notes-list');
const PREF = 'il.notesView';
let pref = { sort: 'time', filter: 'all' };
try { pref = { ...pref, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch {}
const savePref = () => { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch {} };

let navigate = () => {};
export function initNotes({ onNavigate }) { navigate = onNavigate; }

const fmtDate = (t) => new Date(t).toLocaleDateString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' });

export async function renderNotes() {
  let items = [];
  try { items = await listItems(); } catch (e) { root.replaceChildren(h('p.hint', `無法讀取 IndexedDB（${e.message}）`)); return; }
  const shown = sortItems(items.filter(x => pref.filter === 'all' || x.kind === pref.filter), pref.sort);
  const seg = (key, opts, label) => h('div.nseg', { role: 'radiogroup', 'aria-label': label },
    Object.entries(opts).map(([id, text]) => h('button.press', {
      type: 'button', role: 'radio', 'aria-checked': String(pref[key] === id), ['data-' + key]: id,
      onclick: () => { pref[key] = id; savePref(); renderNotes(); },
    }, text)));
  const counts = { bookmark: items.filter(x => x.kind === 'bookmark').length, note: items.filter(x => x.kind === 'note').length };

  let lastBook = null;
  const list = h('ol.nlist', { 'aria-label': '書籤與筆記' });
  for (const it of shown) {
    const book = it.refs[0].split('.')[0];
    if (pref.sort === 'book' && book !== lastBook) {
      list.append(h('li.ngroup', { 'aria-hidden': 'true' }, refRangeLabel([it.refs[0]]).split(' ')[0]));
      lastBook = book;
    }
    list.append(row(it));
  }

  root.replaceChildren(
    h('div.ntools',
      seg('sort', { book: '依經卷', time: '依時間' }, '排序'),
      seg('filter', { all: `全部 ${items.length}`, bookmark: `書籤 ${counts.bookmark}`, note: `筆記 ${counts.note}` }, '篩選')),
    shown.length ? list : h('p.hint.nempty', items.length ? '沒有符合篩選的項目。' : '還沒有書籤或筆記。在讀經頁點節號選取經文，再按膠囊工具列的「書籤」或「筆記」。'),
    h('div.nio',
      h('button.press.nbtn', { type: 'button', id: 'notes-export', onclick: doExport, disabled: !items.length }, '匯出 JSON'),
      h('label.press.nbtn', { role: 'button', tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.querySelector('input').click(); } } },
        '匯入 JSON', h('input#notes-import', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: doImport }))),
  );
}
addEventListener('notes:changed', () => { if (!document.getElementById('view-notes').hidden) renderNotes(); });

function row(it) {
  const label = refRangeLabel(it.refs);
  const fg = h('div.nfg',
    h('a.nmain', { href: '#' + it.refs[0], 'data-ref': it.refs[0], draggable: 'false' },
      h('span.nhead',
        h('i.nkind', { 'data-kind': it.kind, 'aria-label': KINDS[it.kind] }),
        h('b', label),
        it.color ? h('i.ndot', { 'data-color': it.color, 'aria-label': `顏色：${COLORS[it.color]}` }) : null,
        h('small.date', fmtDate(it.updated))),
      it.text ? h('span.ntext', it.text) : null),
    h('button.press.nedit', { type: 'button', 'aria-label': `編輯 ${label}`, onclick: () => openEditor({ item: it, refs: it.refs }) }, icon('edit')),
    h('button.press.ndel', { type: 'button', 'aria-label': `刪除 ${label}`, onclick: (e) => del(e.currentTarget.closest('li'), it) }, icon('close')));
  const li = h('li.nrow', { 'data-id': it.id, 'data-kind': it.kind }, h('div.nunder', { 'aria-hidden': 'true' }, '刪除'), fg);
  swipe(li, fg, it);
  return li;
}

// ---------- swipe-left to delete (transform only) ----------
function swipe(li, fg, it) {
  let d = null, x = 0, anim = null;
  const set = (v) => { x = v; fg.style.transform = v ? `translate3d(${v}px,0,0)` : ''; li.style.setProperty('--reveal', Math.min(1, -v / 80).toFixed(3)); li.style.setProperty('--dx', `${v}px`); };
  fg.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('button')) return;
    anim?.stop();
    d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: x, on: false, s: [[e.timeStamp, e.clientX]] };
  });
  fg.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { d = null; return; }
      if (Math.abs(dx) < 8) return;
      d.on = true; li.classList.add('dragging');
      try { fg.setPointerCapture(e.pointerId); } catch {}
    }
    d.s.push([e.timeStamp, e.clientX]); if (d.s.length > 6) d.s.shift();
    const nx = d.base + dx;
    set(nx > 0 ? nx * 0.25 : nx);
  });
  const up = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const was = d.on, s = d.s;
    d = null;
    li.classList.remove('dragging');
    if (!was) return;
    fg.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); }, { capture: true, once: true });
    const a = s[0], b = s[s.length - 1];
    const v = e.type !== 'pointercancel' && b[0] > a[0] && e.timeStamp - b[0] < 80 ? (b[1] - a[1]) / (b[0] - a[0]) : 0;
    const W = fg.offsetWidth;
    if (x < -W * 0.4 || v < -0.6) { del(li, it, v * 1000); return; }
    anim = spring({ from: x, to: x < -60 && v <= 0 ? -80 : 0, velocity: v * 1000, onUpdate: set }); // half-open shows the 刪除 hint
  };
  fg.addEventListener('pointerup', up);
  fg.addEventListener('pointercancel', up);
  // a half-open row closes on tap; a tap on the revealed area deletes
  li.querySelector('.nunder').addEventListener('click', () => del(li, it));
  fg.addEventListener('click', (e) => { if (x < -4) { e.preventDefault(); e.stopPropagation(); anim = spring({ from: x, to: 0, onUpdate: set }); } }, true);
  li._slideOut = (velocity, done) => spring({ from: x, to: -fg.offsetWidth - 20, velocity, onUpdate: set, onDone: done });
}

async function del(li, it, velocity = 0) {
  const finish = async () => {
    const list = li.parentElement;
    const rest = [...list.children].filter(x => x !== li);
    const before = new Map(rest.map(x => [x, x.getBoundingClientRect().top]));
    li.remove();
    // FLIP: rows below slide up with transform, no height animation
    if (!reducedMotion.matches) for (const x of rest) {
      const dy = before.get(x) - x.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      x.style.transform = `translate3d(0,${dy}px,0)`;
      spring({ from: dy, to: 0, onUpdate: (v) => { x.style.transform = Math.abs(v) < 0.5 ? '' : `translate3d(0,${v}px,0)`; } });
    }
    await removeItem(it.id);
    toast(`已刪除${KINDS[it.kind]}：${refRangeLabel(it.refs)}`, { action: '復原', onAction: async () => { await putRaw(it); toast('已復原'); } });
  };
  if (li._slideOut && !reducedMotion.matches) li._slideOut(velocity, finish); else finish();
}

// ---------- export / import ----------
async function doExport() {
  const data = await exportJSON();
  const blob = new Blob([JSON.stringify(data, null, 1) + '\n'], { type: 'application/json' });
  const name = `interlinear-notes-${new Date().toISOString().slice(0, 10)}.json`;
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`已匯出 ${data.count} 筆`);
}

async function doImport(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  let data;
  try {
    if (f.size > 20 * 1024 * 1024) throw new Error('檔案太大');
    data = JSON.parse(await f.text());
  } catch (err) { report(`匯入失敗：不是有效的 JSON（${err.message}）`, true); return; }
  try {
    const r = await importJSON(data);
    report(`匯入完成：新增 ${r.added}、更新 ${r.updated}、重複略過 ${r.duplicates}${r.invalid.length ? `、格式錯誤 ${r.invalid.length}` : ''}`,
      false, r.invalid.slice(0, 5).map(x => `第 ${x.index + 1} 筆：${x.reason}`));
  } catch (err) { report(`匯入失敗：${err.message}`, true); }
}
function report(msg, bad, details = []) {
  renderNotes().then(() => {
    root.prepend(h('div.nreport', { role: 'status', class: `nreport${bad ? ' bad' : ''}` }, msg, details.length ? h('ul', details.map(d => h('li', d))) : null));
  });
  toast(msg);
}

root.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-ref]');
  if (a) { e.preventDefault(); navigate(a.dataset.ref); }
});
