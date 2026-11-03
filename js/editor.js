// Note / bookmark editor in its own small bottom sheet (transform + spring only).
// openEditor({refs, item?, kind?}) → Promise<saved item | null | 'deleted'>.
import { spring } from './spring.js';
import { saveItem, removeItem, COLORS } from './notes.js';
import { h, trapFocus } from './util.js';
import { refRangeLabel } from './ref.js';

let el = null, backdrop = null, anim = null, y = 0, current = null;

function H() { return el.offsetHeight + 40; }
function render(v) {
  y = v;
  el.style.transform = `translate3d(0,${v - kb}px,0)`;
  backdrop.style.opacity = (0.35 * Math.max(0, 1 - v / H())).toFixed(3);
}
// keep the sheet above the on-screen keyboard (visualViewport shrinks, layout viewport doesn't)
let kb = 0;
function onViewport() {
  const vv = window.visualViewport;
  kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  if (el && current) render(y);
}
window.visualViewport?.addEventListener('resize', onViewport);
window.visualViewport?.addEventListener('scroll', onViewport);

function ensure() {
  if (el) return;
  backdrop = h('div.ed-backdrop', { 'aria-hidden': 'true' });
  el = h('section.ed-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ed-title', tabindex: '-1' });
  document.getElementById('app').append(backdrop, el);
  backdrop.addEventListener('click', () => current?.cancel());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); current?.cancel(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); current?.save(); }
  });
  trapFocus(el, () => !!current);
  // drag the grip down to dismiss
  let d = null;
  el.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.ed-grip, .ed-head')) return;
    d = { id: e.pointerId, y0: e.clientY, s: [[e.timeStamp, e.clientY]] };
    anim?.stop();
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y0;
    d.s.push([e.timeStamp, e.clientY]); if (d.s.length > 6) d.s.shift();
    render(dy > 0 ? dy : -Math.pow(-dy, 0.6));
  });
  const up = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const s = d.s, a = s[0], b = s[s.length - 1];
    const v = b[0] > a[0] && e.timeStamp - b[0] < 80 ? (b[1] - a[1]) / (b[0] - a[0]) : 0;
    d = null;
    if (y > H() * 0.35 || v > 0.5) current?.cancel(v * 1000);
    else go(0, v * 1000);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function go(to, velocity = 0, done) {
  anim?.stop();
  anim = spring({ from: y, to, velocity, onUpdate: render, onDone: done });
}

export const editorOpen = () => !!current;

export function openEditor({ refs, item = null, kind = 'note' }) {
  ensure();
  current?.cancel();
  const returnFocus = document.activeElement;
  kind = item?.kind || kind;
  let color = item?.color || null;
  const ta = h('textarea#ed-text', { rows: 6, placeholder: kind === 'note' ? '寫下你的筆記…' : '（可選）為這個書籤加上說明', 'aria-label': '筆記內容' });
  ta.value = item?.text || '';
  const chips = h('div.ed-colors', { role: 'radiogroup', 'aria-label': '顏色標籤' },
    [[null, '無'], ...Object.entries(COLORS)].map(([id, label]) => h('button.ed-color.press', {
      type: 'button', role: 'radio', 'data-color': id || 'none', 'aria-label': `顏色：${label}`, 'aria-checked': String(color === id),
      onclick: (e) => { color = id; for (const b of chips.children) b.setAttribute('aria-checked', String(b === e.currentTarget)); },
    }, id ? '' : '無')));
  const err = h('p.ed-err', { role: 'alert' });

  return new Promise((resolve) => {
    let closed = false;
    const close = (result, velocity = 0) => {
      if (closed) return;
      closed = true;
      current = null;
      el.removeAttribute('data-open');
      backdrop.classList.remove('open');
      ta.blur();
      go(H(), velocity, () => { el.style.visibility = 'hidden'; el.replaceChildren(); });
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      resolve(result);
    };
    const save = async () => {
      const text = ta.value.trim();
      if (kind === 'note' && !text) { err.textContent = '筆記內容不能是空的。'; ta.focus(); return; }
      const saved = await saveItem({ ...(item || {}), kind, refs: item?.refs || refs, text, color });
      close(saved);
    };
    const del = async () => { await removeItem(item.id); close('deleted'); };
    current = { cancel: (v) => close(null, v), save };

    el.replaceChildren(
      h('div.ed-grip', { 'aria-hidden': 'true' }, h('span')),
      h('header.ed-head',
        h('h2#ed-title', `${kind === 'note' ? (item ? '編輯筆記' : '新增筆記') : '編輯書籤'} · ${refRangeLabel(item?.refs || refs)}`)),
      ta, chips, err,
      h('menu.ed-actions',
        item ? h('button.press.ed-del', { type: 'button', onclick: del }, '刪除') : null,
        h('span.ed-sp'),
        h('button.press', { type: 'button', onclick: () => close(null) }, '取消'),
        h('button.press.primary', { type: 'button', onclick: save }, '儲存')),
    );
    el.style.visibility = 'visible';
    el.dataset.open = '1';
    backdrop.classList.add('open');
    onViewport();
    render(H());
    go(0);
    // focus after the first frame so iOS opens the keyboard with the sheet in place
    requestAnimationFrame(() => ta.focus({ preventScroll: true }));
  });
}
