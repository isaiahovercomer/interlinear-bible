// User preferences (localStorage) + live application to the document.
const KEY = 'il.settings';
const DEFAULTS = { theme: 'warm', fontSize: 19, lineHeight: 1.75, showStrong: false, showMorph: false, hebAccents: true, versions: null, zh: 'hant' };
// id 'warm' = 暖白 default reading theme (kept for saved settings); color = page background (swatch + <meta theme-color>)
export const THEMES = {
  warm: { label: '暖白', color: '#FAF6EE' }, light: { label: '淺色', color: '#FFFFFF' }, dark: { label: '深色', color: '#2F3343' },
  oled: { label: 'OLED 純黑', color: '#000000' }, sepia: { label: '羊皮紙', color: '#F1E6CE' },
};

let state = { ...DEFAULTS };
try { state = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
const subs = new Set();

export const settings = new Proxy(state, { set() { throw new Error('use update()'); } });
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }

export function update(patch) {
  const changed = Object.keys(patch).filter(k => JSON.stringify(state[k]) !== JSON.stringify(patch[k]));
  if (!changed.length) return;
  Object.assign(state, patch);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  apply();
  for (const fn of subs) fn(changed, state);
}

export function apply() {
  const r = document.documentElement;
  r.dataset.theme = state.theme;
  r.style.setProperty('--fs', state.fontSize + 'px');
  r.style.setProperty('--lh', state.lineHeight);
  r.classList.toggle('ann-strong', !!state.showStrong);
  r.classList.toggle('ann-morph', !!state.showMorph);
  r.classList.toggle('no-heb-accents', !state.hebAccents);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#2F3343') // brand navy (matches header/tab bar);
}

let manifestOrder = null;   // manifest.default_order (translations shown by default, in order)
let suggestedSecond = null; // a translation offered as the optional 「第二行」 (manifest / version flag)
/** Called once the manifest is loaded. */
export function setDefaults(manifest, translations) {
  manifestOrder = Array.isArray(manifest?.default_order) ? manifest.default_order : null;
  const flagged = translations.find(v => v.suggested_second === true || v.suggested_second === 'second');
  const named = typeof manifest?.suggested_second === 'string' ? manifest.suggested_second : null;
  suggestedSecond = named || flagged?.id || (translations.some(v => v.id === 'cuv') ? 'cuv' : null);
}

/** Ordered list of {id, on} for every translation, reconciled against the manifest. */
export function enabledVersions(translations) {
  const all = translations.map(v => v.id);
  let list = state.versions;
  if (!Array.isArray(list)) {
    // default: manifest.default_order (on, in that order), then the rest (off) in manifest order;
    // without default_order: the first two translations
    const order = (manifestOrder || all.slice(0, 2)).filter(id => all.includes(id));
    const rest = all.filter(id => !order.includes(id)).map(id => ({ id, on: false }));
    const out = [...order.map(id => ({ id, on: true })), ...rest];
    // RcV (English) sits directly below 中文恢復本 by default (a saved custom order is left alone)
    const ri = out.findIndex(x => x.id === 'rcv-en'), zi = out.findIndex(x => x.id === 'rcv-zh');
    if (ri >= 0 && zi >= 0 && ri !== zi + 1) { const [r] = out.splice(ri, 1); out.splice(out.findIndex(x => x.id === 'rcv-zh') + 1, 0, r); }
    return out;
  }
  list = list.filter(x => all.includes(x.id));
  for (const id of all) if (!list.some(x => x.id === id)) list.push({ id, on: false });
  return list;
}

export function secondLineId(translations) {
  return translations.some(v => v.id === suggestedSecond) ? suggestedSecond : null;
}
/** 「顯示和合本第二行」: on → enable it right after the first enabled translation; off → disable. */
export function setSecondLine(translations, on) {
  const id = secondLineId(translations);
  if (!id) return;
  const list = enabledVersions(translations).filter(x => x.id !== id);
  if (on) {
    const first = list.findIndex(x => x.on);
    list.splice(first < 0 ? 0 : first + 1, 0, { id, on: true });
  } else list.push({ id, on: false });
  update({ versions: list });
}
