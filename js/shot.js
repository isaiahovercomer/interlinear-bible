// One-tap copy + share-as-image (截圖) for the word card, verses and primer examples.
// Images are drawn on a <canvas> by hand (no library): text only (fillText), themed from the
// current CSS custom properties, RTL lines for Hebrew. Share = Web Share API with files when the
// browser can share PNGs (Android / iOS), else the PNG is downloaded.
import { h, toast, copyText } from './util.js';
import { out as zhOut } from './zh.js'; // 簡體 setting: copies and images follow it

const APP = '原文對照聖經';
const W = 360, PAD = 22, SCALE = 3, MAX_LINES = 90;
const CJK = '\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F';
const TOKEN = new RegExp(`\\n|[${CJK}]|\\s+|[^\\s${CJK}]+`, 'g');

/** Copy `text`, toast 「已複製」 (or a hint when no clipboard is available). */
export async function copyWithToast(text) {
  let ok = false;
  try { ok = await copyText(zhOut(text)); } catch { ok = false; }
  toast(ok ? '已複製' : '無法複製，請長按文字自行選取');
  return ok;
}

/** Element text with <br> / block boundaries as newlines (definitions are rendered DOM). */
export function textOf(el) {
  if (!el) return '';
  let out = '';
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.textContent;
      else if (c.nodeType === 1) {
        if (c.tagName === 'BR') { out += '\n'; continue; }
        walk(c);
        if (/^(P|DIV|LI|DD|H\d)$/.test(c.tagName)) out += '\n';
      }
    }
  };
  walk(el);
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function theme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k, d) => cs.getPropertyValue(k).trim() || d;
  return {
    bg: v('--card', '#FFFDF8'), fg: v('--fg', '#2F3343'), fg2: v('--fg2', '#4A4F63'), muted: v('--muted', '#67645F'),
    accent: v('--accent', '#8A6431'), line: v('--line', '#E4DCCC'), logo: v('--logo', '#9C733D'),
    chrome: v('--chrome', '#2F3343'), chromeFg: v('--chrome-accent', '#D9A466'),
    fonts: { grc: v('--greek', 'serif'), hbo: v('--hebrew', 'serif'), zh: v('--serif-zh', 'serif'), serif: v('--serif', 'serif'), ui: v('--ui', 'sans-serif') },
  };
}

function wrap(ctx, text, maxW) {
  const fits = (x) => ctx.measureText(x).width <= maxW;
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const tok of para.match(TOKEN) || []) {
      if (/^\s+$/.test(tok)) { if (line) line += ' '; continue; }
      if (fits(line + tok)) { line += tok; continue; }
      if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
      if (fits(tok)) { line = tok; continue; }
      for (const ch of tok) { // a single token wider than the line: break it by characters
        if (line && !fits(line + ch)) { lines.push(line); line = ''; }
        line += ch;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

let logoImg = null;
function logo() {
  if (!logoImg) logoImg = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'icons/in-christ.svg'; });
  return logoImg;
}

/**
 * Draw blocks into a PNG-ready canvas.
 * block: { text, size=15, font='zh'|'grc'|'hbo'|'serif'|'ui', weight, color='fg'|'fg2'|'muted'|'accent', dir, gap, lh, maxLines }
 *        { rule: true }
 */
export async function renderShot(blocks, { footer = '' } = {}) {
  blocks = blocks.map(b => (b && typeof b.text === 'string' ? { ...b, text: zhOut(b.text) } : b));
  footer = zhOut(footer);
  const t = theme();
  const font = (b) => `${b.weight || 400} ${b.size || 15}px ${t.fonts[b.font || 'zh']}`;
  try { await Promise.all(blocks.filter(b => b.text).map(b => document.fonts.load(font(b), b.text.slice(0, 200)))); } catch {}
  const probe = document.createElement('canvas').getContext('2d');
  const inner = W - PAD * 2;
  let y = PAD + 40, budget = MAX_LINES;
  const ops = [];
  for (const b of blocks) {
    if (b.rule) { y += 6; ops.push({ rule: true, y }); y += 10; continue; }
    if (!b.text || budget <= 0) continue;
    probe.font = font(b);
    probe.direction = b.dir === 'rtl' ? 'rtl' : 'ltr';
    let lines = wrap(probe, b.text, inner);
    const cap = Math.min(b.maxLines || Infinity, budget);
    if (lines.length > cap) { lines = lines.slice(0, cap); lines[cap - 1] = lines[cap - 1].replace(/.{0,2}$/u, '…'); }
    budget -= lines.length;
    const lh = Math.round((b.size || 15) * (b.lh || 1.6));
    y += b.gap ?? 4;
    for (const l of lines) { ops.push({ b, text: l, y: y + Math.round(lh * 0.75) }); y += lh; }
  }
  const H = y + PAD + 34;
  const c = document.createElement('canvas');
  c.width = W * SCALE; c.height = Math.ceil(H * SCALE);
  const ctx = c.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H);
  // header band: app name in gold on navy (the app's chrome colours)
  ctx.fillStyle = t.chrome; ctx.fillRect(0, 0, W, 34);
  ctx.fillStyle = t.chromeFg; ctx.font = `600 13px ${t.fonts.ui}`; ctx.textBaseline = 'alphabetic';
  const img = await logo();
  if (img) { try { ctx.drawImage(img, PAD, 6, 22, 22); } catch {} }
  ctx.fillText(zhOut(APP), PAD + (img ? 30 : 0), 22);
  for (const o of ops) {
    if (o.rule) { ctx.fillStyle = t.line; ctx.fillRect(PAD, o.y, inner, 1); continue; }
    ctx.font = font(o.b);
    ctx.fillStyle = t[o.b.color || 'fg'] || t.fg;
    const rtl = o.b.dir === 'rtl';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.fillText(o.text, rtl ? W - PAD : PAD, o.y);
  }
  ctx.direction = 'ltr'; ctx.textAlign = 'left';
  ctx.fillStyle = t.line; ctx.fillRect(PAD, H - PAD - 22, inner, 1);
  ctx.fillStyle = t.muted; ctx.font = `12px ${t.fonts.ui}`;
  ctx.fillText(footer, PAD, H - PAD - 4);
  ctx.textAlign = 'right'; ctx.fillStyle = t.logo;
  ctx.fillText(zhOut(APP), W - PAD, H - PAD - 4);
  return c;
}

const toBlob = (c) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));

/** Share a canvas as PNG (Web Share with files), else download it. Returns 'shared' | 'cancel' | 'download'. */
export async function shareCanvas(canvas, name, title) {
  name = zhOut(name); title = zhOut(title);
  const blob = await toBlob(canvas);
  const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
  if (file && navigator.canShare?.({ files: [file] }) && navigator.share) {
    try { await navigator.share({ files: [file], title }); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancel'; }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('已儲存圖片');
  return 'download';
}

/** Render + share with a busy state on the button. */
export async function shotAndShare(btn, blocks, { footer, name, title }) {
  if (btn?.dataset.busy) return;
  if (btn) btn.dataset.busy = '1';
  try { return await shareCanvas(await renderShot(blocks, { footer }), name, title); }
  catch { toast('無法產生圖片'); return null; }
  finally { if (btn) delete btn.dataset.busy; }
}

/** Safe file name piece (book abbr / Strong / ref). */
export const fileSafe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);

// ---- line icons (stroke = currentColor), in the app's icon style ----
const ICONS = {
  copy: ['M9 9h10v11H9z', 'M5 15V4h10'],
  shot: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
};
export function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
/** Small pill button「複製」/「截圖」; taps do not reach the sheet drag. */
export function actButton(kind, onClick, cls = '') {
  const label = kind === 'copy' ? '複製' : '截圖';
  const b = h(`button.act-btn.press${cls ? '.' + cls : ''}`, { type: 'button', 'data-act': kind, 'aria-label': kind === 'copy' ? '複製文字' : '截圖分享' }, icon(kind), h('span', label));
  for (const t of ['pointerdown', 'touchstart']) b.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
  return b;
}
