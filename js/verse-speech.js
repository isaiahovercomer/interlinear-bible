// Whole-verse original reading via the device speechSynthesis only.
// Modern Greek (prefer el-GR) and modern Israeli Hebrew (prefer he-IL). Never a different language,
// never the word-card Kitten TTS engine, and never a downloaded or offline voice pack.
// speak() runs synchronously inside the click so iOS Safari still has the user gesture.
// Audible output depends on the OS voice list; unit tests cover matching, and browser tests mock the API.
import { h } from './util.js';
import { icon } from './icons.js';

const MAQAF = '\u05BE';
const PILCROW = /¶\s?/g;
const CANTILLATION = /[\u0591-\u05AF\u05BD\u05C0]/g;

export const VERSE_SPEECH_NOTE = '每節原文旁的喇叭朗讀整節原文，用的是這台裝置的現代希臘語（el-GR）或現代以色列希伯來語（he-IL），不是古音。聲調、母音符號和吟誦符號可能不準。語音要在系統裡安裝，有時需要網路，不是本 App 的離線語音包。';

const COPY = {
  el: {
    name: '現代希臘語（el-GR）',
    ancient: '不是古希臘文讀音',
    marks: '聲調與變音符號可能不準',
    missing: '這台裝置沒有現代希臘語（el-GR）語音，所以這節不會朗讀，也不會改用其他語言。請到系統的語言或語音設定安裝希臘語（el-GR）；有些系統要連上網路才會下載。這是裝置上的語音，不是本 App 內建或離線語音包，也不是古希臘文讀音。',
  },
  he: {
    name: '現代以色列希伯來語（he-IL）',
    ancient: '不是古代希伯來文讀音',
    marks: '母音符號與吟誦符號可能不準',
    missing: '這台裝置沒有現代以色列希伯來語（he-IL）語音，所以這節不會朗讀，也不會改用其他語言。請到系統的語言或語音設定安裝希伯來語（he-IL）；有些系統要連上網路才會下載。這是裝置上的語音，不是本 App 內建或離線語音包，也不是古代希伯來文讀音。',
  },
};

const UNSUPPORTED = '這個瀏覽器沒有語音合成（speechSynthesis），無法朗讀。請改用有語音合成的瀏覽器。朗讀需要裝置上的現代希臘語（el-GR）或現代以色列希伯來語（he-IL），不是古音，也不是本 App 下載的語音包；系統可能要另外安裝語音並連上網路。';
const LOADING = '這台裝置的語音清單還在載入，請稍後再按一次喇叭。載入完成前不會出聲，也不會改用其他語言。若仍然沒有現代希臘語（el-GR）或現代以色列希伯來語（he-IL），請到系統的語言與語音設定安裝；有些系統要連上網路。這不是本 App 的離線語音包。';

export function normLang(lang) {
  return String(lang || '').trim().replace(/_/g, '-').toLowerCase();
}

/** 'el' modern Greek, 'he' modern Israeli Hebrew, or null (translations and unknown codes). */
export function speechKind(lang) {
  const l = normLang(lang).split('-')[0];
  if (l === 'grc' || l === 'el' || l === 'ell' || l === 'gre') return 'el';
  if (l === 'hbo' || l === 'he' || l === 'heb' || l === 'iw') return 'he';
  return null;
}

/**
 * Rank a voice lang for this original. -1 = do not use (wrong language, including ancient Greek `grc`).
 * Lower is better. el-GR / he-IL win.
 */
export function voiceRank(kind, lang) {
  const l = normLang(lang);
  if (!l || (kind !== 'el' && kind !== 'he')) return -1;
  if (kind === 'el') {
    if (l === 'el-gr') return 0;
    if (l === 'el') return 1;
    if (/^el-/.test(l)) return 2;
    if (l === 'ell' || /^ell-/.test(l)) return 3;
    return -1;
  }
  if (l === 'he-il') return 0;
  if (l === 'iw-il') return 1;
  if (l === 'he') return 2;
  if (l === 'iw') return 3;
  if (/^(he|iw)-/.test(l)) return 4;
  return -1;
}

/** Best matching voice, or null. Ties keep the earlier voice unless a later one is the OS default. */
export function pickVoice(kind, voices) {
  let best = null;
  let rank = Infinity;
  for (const v of voices || []) {
    const r = voiceRank(kind, v?.lang);
    if (r < 0) continue;
    if (r < rank || (r === rank && v?.default && !best?.default)) {
      best = v;
      rank = r;
    }
  }
  return best;
}

/** Plain original surfaces only: no Strong's numbers, morphology, verse numbers, or pilcrows. */
export function originalSpeakText(verse, { stripCantillation = false } = {}) {
  const words = verse?.w;
  if (!Array.isArray(words) || !words.length) return '';
  let s = '';
  for (const w of words) {
    let t = String(w?.t ?? '').replace(PILCROW, '');
    if (stripCantillation) t = t.replace(CANTILLATION, '');
    if (!t) continue;
    if (s && !s.endsWith(MAQAF)) s += ' ';
    s += t;
  }
  return s.replace(/[ \t\f\v]+/g, ' ').trim();
}

export function buttonLabel(kind, n, state = 'idle') {
  const c = COPY[kind];
  if (!c) return '朗讀原文';
  const which = Number(n) === 0 ? '標題' : `第 ${n} 節`;
  if (state === 'playing') return `停止朗讀${which}原文`;
  if (state === 'paused') return `${which}原文已暫停。再按一次停止，不會改用其他語言繼續。`;
  return `朗讀${which}原文：${c.name}，${c.ancient}；${c.marks}。使用裝置上的語音，本 App 不會下載語音包。`;
}

let halt = () => {
  try { speechSynthesis.cancel(); } catch { /* API missing */ }
};
/** reader.js passes haltPronunciation so a verse and the word-card engine never sound together. */
export function bindVerseSpeech(api = {}) {
  if (typeof api.halt === 'function') halt = api.halt;
}

const texts = new WeakMap();
let gen = 0;
let announced = false;
let armed = false;
let prompt = null;
let promptBtn = null;

function supported() {
  return typeof window !== 'undefined'
    && !!window.speechSynthesis
    && typeof window.SpeechSynthesisUtterance === 'function';
}

function currentVoices() {
  if (!supported()) return [];
  let list = [];
  try { list = speechSynthesis.getVoices() || []; } catch { list = []; }
  if (list.length) announced = true;
  return list;
}

function arm() {
  if (!supported() || armed) return;
  armed = true;
  try {
    speechSynthesis.addEventListener('voiceschanged', () => { announced = true; currentVoices(); });
    currentVoices();
  } catch { /* ignore */ }
}

function voicesKnown() {
  return announced || currentVoices().length > 0;
}

function mark(btn, state) {
  if (!btn?.isConnected) return;
  const kind = btn.dataset.kind;
  const n = btn.dataset.n;
  if (state === 'idle') delete btn.dataset.vs;
  else btn.dataset.vs = state;
  btn.setAttribute('aria-pressed', state === 'playing' ? 'true' : 'false');
  btn.setAttribute('aria-label', buttonLabel(kind, n, state));
  btn.replaceChildren(icon(state === 'idle' ? 'speak' : 'stop'));
}

function clearAll() {
  if (typeof document === 'undefined') return;
  for (const b of document.querySelectorAll('.vs-say')) mark(b, 'idle');
}

function closePrompt() {
  const was = promptBtn;
  prompt?.close();
  prompt?.remove();
  prompt = null;
  promptBtn = null;
  if (was?.isConnected && !was.closest('[inert]')) was.focus();
}

function showPrompt(title, body, btn) {
  closePrompt();
  promptBtn = btn || null;
  const dlg = h('dialog.note-dialog.vs-ask', { 'aria-labelledby': 'vs-ask-t', 'aria-describedby': 'vs-ask-b' },
    h('h2#vs-ask-t', title),
    h('p#vs-ask-b', body),
    h('menu', h('button.primary.press', { type: 'button' }, '知道了')));
  const done = () => { if (prompt === dlg) closePrompt(); };
  dlg.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('button') || e.target === dlg) done();
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(); });
  for (const t of ['pointerdown', 'touchstart']) dlg.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  document.body.append(dlg);
  prompt = dlg;
  dlg.showModal();
  dlg.querySelector('button').focus();
}

function errorBody(kind, err) {
  const name = COPY[kind]?.name || '對應的裝置語音';
  const why = err ? `（${err}）` : '';
  return `朗讀沒有成功${why}。請確認系統裡的${name}語音仍可使用；有些裝置要連上網路。本 App 不會改用其他語言，也沒有離線語音包可下載。`;
}

function speakNow(btn, voice) {
  const text = texts.get(btn);
  const kind = btn.dataset.kind;
  if (!text || !voice) return;
  const my = ++gen;
  let busy = false;
  try { busy = !!(speechSynthesis.speaking || speechSynthesis.pending); } catch { busy = false; }
  // Stop the word-card engine. Cancel synthesis only when one is already running, then speak
  // synchronously so iOS Safari still sees this tap as the user gesture.
  halt({ cancelSpeech: busy });
  if (my !== gen) return;
  let u;
  try {
    u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.92;
  } catch {
    showPrompt('這個瀏覽器不能朗讀', UNSUPPORTED, btn);
    return;
  }
  const live = () => my === gen && btn.isConnected;
  let timer = 0;
  const stopTimer = () => { clearTimeout(timer); timer = 0; };
  timer = setTimeout(() => {
    if (!live() || btn.dataset.vs !== 'playing') return;
    mark(btn, 'idle');
    showPrompt('朗讀沒有開始', errorBody(kind, 'no-start'), btn);
  }, 1500);
  u.onstart = () => { stopTimer(); if (live()) mark(btn, 'playing'); };
  u.onresume = () => { if (live()) mark(btn, 'playing'); };
  u.onpause = () => { stopTimer(); if (live()) mark(btn, 'paused'); };
  u.onend = () => { stopTimer(); if (live()) mark(btn, 'idle'); };
  u.onerror = (e) => {
    stopTimer();
    if (!live()) return;
    mark(btn, 'idle');
    const err = e?.error || '';
    if (err === 'interrupted' || err === 'canceled' || err === 'cancelled') return;
    showPrompt('朗讀中斷', errorBody(kind, err), btn);
  };
  mark(btn, 'playing');
  try {
    speechSynthesis.speak(u);
  } catch {
    stopTimer();
    if (live()) {
      mark(btn, 'idle');
      showPrompt('這個瀏覽器不能朗讀', UNSUPPORTED, btn);
    }
  }
}

function onClick(btn) {
  const state = btn.dataset.vs;
  if (state === 'playing' || state === 'paused') {
    stopVerseSpeech();
    return;
  }
  if (!supported()) {
    showPrompt('這個瀏覽器不能朗讀', UNSUPPORTED, btn);
    return;
  }
  arm();
  const kind = btn.dataset.kind;
  const voice = pickVoice(kind, currentVoices());
  if (!voice) {
    showPrompt(voicesKnown() ? '沒有對應的裝置語音' : '裝置語音還在載入',
      voicesKnown() ? COPY[kind].missing : LOADING, btn);
    return;
  }
  speakNow(btn, voice);
}

if (typeof window !== 'undefined') {
  window.addEventListener('il:pron-halt', () => clearAll());
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopVerseSpeech(); });
  arm();
}

/** Stop whatever this module started and clear every play/pause indicator. */
export function stopVerseSpeech() {
  gen++;
  try { halt(); } catch { /* ignore */ }
  clearAll();
  closePrompt();
}

/**
 * Button for one original verse, or null when there is nothing to read / the language is not Greek or Hebrew.
 * `stripCantillation` follows 設定 › 隱藏希伯來文重音符號 so the spoken text matches the line.
 */
export function verseSayButton({ n, lang, verse, stripCantillation = false }) {
  const kind = speechKind(lang);
  const text = originalSpeakText(verse, { stripCantillation });
  if (!kind || !text || typeof document === 'undefined') return null;
  const btn = h('button.vs-say.press', {
    type: 'button',
    'aria-pressed': 'false',
    'aria-label': buttonLabel(kind, n, 'idle'),
  });
  btn.dataset.kind = kind;
  btn.dataset.n = String(n);
  btn.dir = 'ltr';
  texts.set(btn, text);
  btn.append(icon('speak'));
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(btn); });
  return btn;
}
