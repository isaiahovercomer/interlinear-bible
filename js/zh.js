// 繁體／簡體 display + Simplified search input.
// Tables: js/zh/t2s.json, js/zh/s2t.json (tools/build-zhconv.mjs, from OpenCC, Apache-2.0).
// - Display: the app renders Traditional everywhere; in 簡體 mode a MutationObserver converts
//   text nodes (and a few attributes) in place, textContent only, keeping the original per node
//   so switching back restores it without a reload. Editable areas are left alone.
// - Search: queries are always normalised to Traditional (toTrad), whatever the setting.
const HAN = /[\u3400-\u9fff\uf900-\ufaff]|[\u{20000}-\u{2ffff}]/u;
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-label'];
const SKIP = 'script,style,textarea,[contenteditable=""],[contenteditable="true"],[data-zh-skip]';

/** Converter from a {c, p} table: longest phrase match, else per character. */
function makeConv({ c, p }) {
  const chars = new Map();
  const cc = Array.from(c);
  for (let i = 0; i < cc.length; i += 2) chars.set(cc[i], cc[i + 1]);
  const phrases = new Map();
  const maxLen = new Map(); // first char → longest phrase (code points)
  for (const e of p ? p.split('|') : []) {
    const [k, v] = e.split('\t');
    if (!k || v == null) continue;
    const a = Array.from(k);
    phrases.set(k, v);
    maxLen.set(a[0], Math.max(maxLen.get(a[0]) || 0, a.length));
  }
  return (s) => {
    s = String(s ?? '');
    if (!HAN.test(s)) return s;
    const a = Array.from(s);
    let out = '';
    for (let i = 0; i < a.length;) {
      const m = maxLen.get(a[i]);
      if (m) {
        let hit = false;
        for (let n = Math.min(m, a.length - i); n >= 2; n--) {
          const k = a.slice(i, i + n).join('');
          const v = phrases.get(k);
          if (v != null) { out += v; i += n; hit = true; break; }
        }
        if (hit) continue;
      }
      out += chars.get(a[i]) ?? a[i];
      i++;
    }
    return out;
  };
}

const tables = {};
function load(name) {
  return (tables[name] ||= fetch(new URL(`./zh/${name}.json`, import.meta.url))
    .then(r => { if (!r.ok) throw new Error(`zh/${name}.json: ${r.status}`); return r.json(); })
    .then(j => ({ conv: makeConv(j), raw: j }))
    .catch(err => { delete tables[name]; throw err; }));
}
let t2s = null, s2t = null, s2tRaw = null;

// ---------- search input (always) ----------
/** Load the Simplified → Traditional table (search calls this before the first query). */
export async function readySearch() {
  if (s2t) return;
  const t = await load('s2t');
  s2t = t.conv; s2tRaw = t.raw;
}
/** Query typed in 簡體 (or mixed) → the Traditional forms the Bibles use. Identity until loaded. */
export const toTrad = (s) => (s2t ? s2t(s) : String(s ?? ''));
const variantMaps = new Map();
/** Per text set (cuv, rcv-zh): swap characters that set never uses for its own variant (裡 ↔ 裏). */
export function forSet(set, s) {
  const pairs = s2tRaw?.v?.[set];
  if (!pairs) return s;
  let m = variantMaps.get(set);
  if (!m) {
    m = new Map(); const a = Array.from(pairs);
    for (let i = 0; i < a.length; i += 2) m.set(a[i], a[i + 1]);
    variantMaps.set(set, m);
  }
  return Array.from(s, ch => m.get(ch) ?? ch).join('');
}

// ---------- display ----------
let mode = 'hant';
const orig = new WeakMap();    // text node → original (Traditional) data
const written = new WeakMap(); // text node → data we wrote
const origAttr = new WeakMap(); // element → {attr: [original, written]}
let observer = null;

export const isHans = () => mode === 'hans' && !!t2s;
/** Text for copy / images: converted when 簡體 is on. */
export const out = (s) => (isHans() ? t2s(s) : String(s ?? ''));

const skipped = (el) => !!el?.closest?.(SKIP);
function convText(n) {
  if (!HAN.test(n.data)) return;
  if (written.get(n) === n.data) return;
  if (skipped(n.parentElement)) return;
  const v = n.data, s = t2s(v);
  orig.set(n, v);
  written.set(n, s);
  if (s !== v) n.data = s;
}
function convAttrs(el) {
  if (skipped(el)) return;
  if (el.getAttribute('lang') === 'zh-Hant' && el !== document.documentElement) {
    let rec = origAttr.get(el); if (!rec) origAttr.set(el, (rec = {}));
    rec.lang = ['zh-Hant', 'zh-Hans']; el.setAttribute('lang', 'zh-Hans');
  }
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v == null || !HAN.test(v)) continue;
    let rec = origAttr.get(el);
    if (rec?.[a]?.[1] === v) continue;
    const s = t2s(v);
    if (!rec) origAttr.set(el, (rec = {}));
    rec[a] = [v, s];
    if (s !== v) el.setAttribute(a, s);
  }
}
function walk(root) {
  if (root.nodeType === 3) { convText(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) { if (skipped(root)) return; convAttrs(root); }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) n.nodeType === 3 ? convText(n) : convAttrs(n);
}
function restore() {
  const tw = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) {
      if (written.has(n) && written.get(n) === n.data) n.data = orig.get(n);
      written.delete(n); orig.delete(n);
    } else {
      const rec = origAttr.get(n);
      if (!rec) continue;
      for (const [a, [v, s]] of Object.entries(rec)) if (n.getAttribute(a) === s) n.setAttribute(a, v);
      origAttr.delete(n);
    }
  }
}
function flush(list) {
  for (const m of list) {
    if (m.type === 'characterData') convText(m.target);
    else if (m.type === 'attributes') convAttrs(m.target);
    else for (const n of m.addedNodes) walk(n);
  }
}
let titleOrig = null;
function start() {
  if (observer) return;
  observer = new MutationObserver(flush);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, 'lang'] });
  walk(document.documentElement);
  titleOrig = document.title; document.title = t2s(titleOrig);
}
function stop() {
  if (observer) { const left = observer.takeRecords(); observer.disconnect(); observer = null; flush(left); }
  restore();
  if (titleOrig != null) { document.title = titleOrig; titleOrig = null; }
}

/** Original (Traditional) text of an element, whatever is shown. */
export function plain(el) {
  if (!el) return '';
  if (!isHans()) return el.textContent;
  let s = '';
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) s += written.get(n) === n.data ? orig.get(n) : n.data;
  return s;
}

/** Switch the display: 'hant' (default) | 'hans'. Resolves once the page shows that script. */
export async function setScript(m) {
  mode = m === 'hans' ? 'hans' : 'hant';
  const r = document.documentElement;
  if (mode === 'hans') {
    try { t2s ||= (await load('t2s')).conv; } catch (err) { console.warn('繁簡轉換表載入失敗', err); mode = 'hant'; }
  }
  if (mode !== (m === 'hans' ? 'hans' : 'hant')) return; // failed
  if (!r.dataset.zhLang) r.dataset.zhLang = r.lang || 'zh-Hant';
  r.lang = mode === 'hans' ? 'zh-Hans' : r.dataset.zhLang;
  r.dataset.zh = mode;
  if (mode === 'hans') start(); else stop();
}
