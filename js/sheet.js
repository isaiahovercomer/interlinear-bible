// Bottom sheet with three snaps (peek ≈30% / half / full), Pointer-Events drag,
// fling-aware snapping and a spring settle. Only transform / opacity are animated.
import { spring } from './spring.js';
import { trapFocus } from './util.js';

const el = document.getElementById('sheet');
const body = document.getElementById('sheet-body');
const backdrop = document.getElementById('sheet-backdrop');

const ORDER = ['full', 'half', 'peek'];
let y = 0;            // current translateY (px)
let snap = 'closed';
let anim = null;
let onCloseCb = null;
let returnFocus = null; // keyboard-opened sheet: element to refocus when it closes

function H() { return window.innerHeight; }
function topInset() { return parseFloat(getComputedStyle(el).getPropertyValue('--sheet-top')) || 0; }
function snapY(name) {
  const h = H();
  switch (name) {
    case 'full': return topInset();
    case 'half': return Math.round(h * 0.5);
    case 'peek': return Math.round(h * 0.7);
    default: return h;
  }
}

function render(v) {
  y = v;
  el.style.transform = `translate3d(0,${v}px,0)`;
  const peek = snapY('peek'), h = H();
  // backdrop: 0 when closed, .32 at peek, up to .5 at full
  const o = v >= peek ? 0.32 * (1 - (v - peek) / (h - peek)) : 0.32 + 0.18 * (peek - v) / (peek - snapY('full'));
  backdrop.style.opacity = Math.max(0, Math.min(0.5, o)).toFixed(3);
}

function setSnap(name) {
  snap = name;
  el.dataset.snap = name;
  el.classList.toggle('is-full', name === 'full');
  const open = name !== 'closed';
  el.setAttribute('aria-hidden', String(!open));
  backdrop.classList.toggle('open', open);
  if (name !== 'full') body.scrollTop = 0;
  updateTouchAction();
}

function go(name, velocity = 0) {
  anim?.stop();
  const target = snapY(name);
  el.dataset.moving = '1';
  setSnap(name);
  if (name !== 'closed') el.style.visibility = 'visible';
  else {
    // run the close callback now, not when the spring settles: a word tapped during the
    // closing animation must not have its fresh highlight cleared by the old card
    const cb = onCloseCb; onCloseCb = null; cb?.();
  }
  if (name === 'closed' && returnFocus) {
    if (returnFocus.isConnected && (el.contains(document.activeElement) || document.activeElement === document.body)) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  anim = spring({
    from: y, to: target, velocity, onUpdate: render,
    onDone: () => {
      delete el.dataset.moving;
      if (name === 'closed' && snap === 'closed') { el.style.visibility = 'hidden'; body.replaceChildren(); }
      el.dispatchEvent(new CustomEvent('sheet:settle', { detail: name }));
    },
  });
}

export const sheet = {
  get snap() { return snap; },
  get open() { return snap !== 'closed'; },
  show(content, { at = 'peek', onClose, focus = false } = {}) {
    body.replaceChildren(content);
    if (onCloseCb && onCloseCb !== onClose) onCloseCb();
    onCloseCb = onClose || null;
    if (snap === 'closed') render(H());
    go(snap === 'closed' ? at : (snap === 'full' ? 'full' : at));
    if (focus) {
      if (!el.contains(document.activeElement)) returnFocus = document.activeElement;
      body.focus({ preventScroll: true });
    }
  },
  snapTo: (name) => go(name),
  close: () => { if (snap !== 'closed') go('closed'); },
  body,
};

// ---- dragging ----
// Within the sheet body at `full`, native scroll wins while scrollTop > 0. At scrollTop 0
// the body's touch-action becomes `pan-down` (finger moving up scrolls content) so a
// downward drag is left to us and turns into a sheet drag.
function updateTouchAction() {
  if (snap === 'full') body.style.touchAction = body.scrollTop <= 0 ? 'pan-down' : 'pan-y';
  else body.style.touchAction = 'none';
}
body.addEventListener('scroll', updateTouchAction, { passive: true });

let drag = null; // {id, startY, startSheetY, samples, active, fromBody}
let suppressClick = false;

el.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || snap === 'closed') return;
  drag = { id: e.pointerId, startY: e.clientY, startSheetY: y, samples: [[e.timeStamp, e.clientY]], active: false, fromBody: body.contains(e.target) };
});

el.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.startY;
  drag.samples.push([e.timeStamp, e.clientY]);
  if (drag.samples.length > 8) drag.samples.shift();
  if (!drag.active) {
    if (Math.abs(dy) < 6) return;
    // at full, inside scrolled content (or dragging up): leave it to native scroll
    if (snap === 'full' && drag.fromBody && (body.scrollTop > 0 || dy < 0)) { drag = null; return; }
    drag.active = true;
    drag.startY = e.clientY; drag.startSheetY = y;
    anim?.stop();
    el.dataset.moving = '1';
    try { el.setPointerCapture(e.pointerId); } catch {}
  }
  let ny = drag.startSheetY + (e.clientY - drag.startY);
  const top = snapY('full');
  if (ny < top) ny = top - Math.pow(top - ny, 0.7); // rubber band above full
  render(ny);
  e.preventDefault();
});

function velocityOf(samples, now) {
  // px/ms over the last ~100ms; a pause before lifting the finger means no fling
  const last = samples[samples.length - 1];
  if (now - last[0] > 80) return 0;
  let first = samples[0];
  for (const s of samples) if (last[0] - s[0] <= 100) { first = s; break; }
  const dt = last[0] - first[0];
  return dt > 0 ? (last[1] - first[1]) / dt : 0;
}

function release(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const wasActive = drag.active;
  const v = e?.type === 'pointercancel' ? 0 : velocityOf(drag.samples, e.timeStamp);
  drag = null;
  if (!wasActive) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  go(chooseSnap(y, v), v * 1000);
}
el.addEventListener('pointerup', release);
el.addEventListener('pointercancel', release);
el.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);

// ---- hand-off from content scroll to sheet drag within one gesture ----
// Once native scrolling owns a touch the browser sends `pointercancel` and no more pointer
// events, but touch events keep coming. So when the content (full snap) has been scrolled
// back to the top and the same finger keeps moving down, we continue as a sheet drag.
let td = null; // {id, armed, active, prevY, anchorY, baseY, samples}
const touchOf = (e) => td && [...e.changedTouches].find(t => t.identifier === td.id);

body.addEventListener('touchstart', (e) => {
  td = snap === 'full' && e.touches.length === 1
    ? { id: e.touches[0].identifier, armed: false, active: false, prevY: e.touches[0].clientY, samples: [] }
    : null;
}, { passive: true });
// native scroll took over → pointer path is out; touch path may take over later
el.addEventListener('pointercancel', (e) => { if (td && e.pointerType === 'touch') td.armed = true; });

body.addEventListener('touchmove', (e) => {
  const t = touchOf(e);
  if (!t || !td.armed) return;
  const cy = t.clientY, dy = cy - td.prevY;
  td.prevY = cy;
  if (!td.active) {
    if (dy <= 0 || body.scrollTop > 0) return;
    td.active = true;
    td.anchorY = cy - dy; td.baseY = y;
    td.samples = [];
    anim?.stop();
    el.dataset.moving = '1';
  }
  td.samples.push([e.timeStamp, cy]);
  if (td.samples.length > 8) td.samples.shift();
  const top = snapY('full');
  const ny = td.baseY + (cy - td.anchorY);
  if (ny <= top) { // back at full: hand the gesture back to content scrolling
    td.active = false;
    render(top);
    delete el.dataset.moving;
    return;
  }
  if (body.scrollTop) body.scrollTop = 0; // native scroll is still running underneath: pin it
  render(ny);
}, { passive: true });

function touchRelease(e) {
  const t = touchOf(e);
  if (!t) return;
  const was = td.active, samples = td.samples;
  td = null;
  if (!was) return;
  const v = e.type === 'touchcancel' ? 0 : velocityOf(samples, e.timeStamp);
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  go(chooseSnap(y, v), v * 1000);
}
body.addEventListener('touchend', touchRelease, { passive: true });
body.addEventListener('touchcancel', touchRelease, { passive: true });

/** Pick the snap from current position + fling velocity (px/ms, + = down). */
export function chooseSnap(pos, v) {
  const snaps = ORDER.map(n => [n, snapY(n)]);          // ascending y
  const FLING = 0.45;
  if (v > 2.2) return 'closed';                          // hard fling down closes from anywhere
  if (v > FLING) {
    const below = snaps.find(([, sy]) => sy > pos + 4);
    return below ? below[0] : 'closed';
  }
  if (v < -FLING) {
    const above = [...snaps].reverse().find(([, sy]) => sy < pos - 4);
    return above ? above[0] : 'full';
  }
  const projected = pos + v * 160;
  const cands = [...snaps, ['closed', H()]];
  let best = cands[0];
  for (const c of cands) if (Math.abs(c[1] - projected) < Math.abs(best[1] - projected)) best = c;
  return best[0];
}

backdrop.addEventListener('click', () => sheet.close());
// aria-modal: while open, Tab / Shift+Tab cycle inside the sheet (focus moves in if it was outside)
trapFocus(el, () => snap !== 'closed');
addEventListener('keydown', (e) => { if (e.key === 'Escape' && snap !== 'closed') sheet.close(); });
addEventListener('resize', () => { if (snap !== 'closed' && !drag) render(snapY(snap)); });
el.style.visibility = 'hidden';
render(H());
