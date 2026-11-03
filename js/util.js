export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** h('div#id.cls', {attr}, ...children) — tiny DOM builder */
export function h(tag, attrs, ...kids) {
  const [head, ...cls] = tag.split('.');
  const [name, id] = head.split('#');
  const el = document.createElement(name || 'div');
  if (id) el.id = id;
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

let toastTimer = 0;
/** toast(msg) or toast(msg, {action:'復原', onAction, ms}) — one toast at a time. */
export function toast(msg, { action, onAction, ms } = {}) {
  const t = $('#toast');
  t.replaceChildren(h('span', msg));
  if (action) {
    t.append(h('button.toast-act.press', { type: 'button', onclick: () => { hide(); onAction?.(); } }, action));
  }
  t.classList.toggle('has-act', !!action);
  t.classList.add('show');
  clearTimeout(toastTimer);
  const hide = () => { clearTimeout(toastTimer); t.classList.remove('show'); };
  toastTimer = setTimeout(hide, ms || (action ? 5000 : 1800));
  return hide;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** Keep Tab / Shift+Tab inside `root` while `active()` is true. Returns a remover. */
export function trapFocus(root, active = () => true) {
  const onKey = (e) => {
    if (e.key !== 'Tab' || !active()) return;
    const items = [...root.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null || x === document.activeElement);
    if (!items.length) { e.preventDefault(); root.focus?.({ preventScroll: true }); return; }
    const first = items[0], last = items[items.length - 1], a = document.activeElement;
    if (!root.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus({ preventScroll: true }); return; }
    if (e.shiftKey && (a === first || a === root || !items.includes(a) && a.contains(first))) { e.preventDefault(); last.focus({ preventScroll: true }); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus({ preventScroll: true }); }
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
  document.body.append(ta); ta.select();
  const ok = document.execCommand('copy'); ta.remove();
  return ok;
}

/** Strip Greek accents/breathings, lowercase, final sigma → σ (fuzzy search key). */
export function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ').replace(/[’'ʼ]/g, '');
}

/** Run fn inside a View Transition when available (and motion allowed), else CSS fade. */
export function transition(fn, fallbackEl) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce) return document.startViewTransition(fn);
  fn();
  if (fallbackEl && !reduce) {
    fallbackEl.classList.remove('fade-in'); void fallbackEl.offsetWidth; fallbackEl.classList.add('fade-in');
  }
  return null;
}
