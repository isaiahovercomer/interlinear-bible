// Word pronunciation for the word card's 🔊 button (docs/DESIGN.md §7).
// Order on tap: 1. a matching system speechSynthesis voice (the phone's built-in voice; voices may load late on
// Android, so wait briefly)  2. if none works (no voice, onerror, or no onstart in time): the on-device engine
// (Kitten TTS nano on onnxruntime-web) if already downloaded (Cache Storage TTS_CACHE)  3. ask to download the
// engine (size from tts-info.js). The engine runs in a module worker (tts-worker.js); its 24 kHz PCM is played
// through Web Audio. Per session (sessionStorage il.voice) we remember per letter whether the system voice worked.
import { TTS_VERSION, TTS_CACHE, TTS_FILES, TTS_BYTES } from './tts-info.js';
import { greekText, greekIPA, hebrewText, heIPA } from './speech-text.js';
import { h, toast } from './util.js';

const FLAG = 'il.tts'; // localStorage: engine version that was downloaded completely
const URLS = Object.keys(TTS_FILES).map(f => new URL(`../tts/${f}`, import.meta.url).href);
const mb = (n) => (n / 1e6).toFixed(1);
export const TTS_MB = mb(TTS_BYTES);
const BIG = TTS_BYTES > 15e6; // add a Wi-Fi hint to the download question

const AC = window.AudioContext || window.webkitAudioContext;
export const engineSupported = () => !!AC && typeof Worker === 'function';
const synthOK = () => 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';

let memReady = false; // downloaded in this session (also covers browsers without Cache Storage)
const hasEngine = () => engineSupported() && (memReady || localStorage.getItem(FLAG) === String(TTS_VERSION));
function forgetEngine() { memReady = false; localStorage.removeItem(FLAG); }

// The flag is the synchronous answer at tap time; if the cache was evicted meanwhile, drop the flag.
if (localStorage.getItem(FLAG) && 'caches' in window) {
  caches.open(TTS_CACHE).then(c => Promise.all(URLS.map(u => c.match(u))))
    .then(rs => { if (!rs.every(Boolean)) forgetEngine(); }).catch(() => {});
}

// ---- system voices ----
// v.lang normalised (`_` → `-`, lowercase); Android reports e.g. `iw_IL` or the ISO 639-2 code `ell`.
const VOICE_LANG = { G: /^(el|ell|grc)(-|$)/, H: /^(he|iw|heb)(-|$)/ };
const VOICE_NAME = { G: /greek|ελληνικά/i, H: /hebrew|עברית/i }; // only for voices with a blank lang
const VOICE_WAIT = 1200, VOICE_POLL = 200, START_WAIT = 1500;
if (synthOK()) speechSynthesis.getVoices(); // starts async voice loading in some browsers
function voiceMatches(v, letter) {
  const lang = String(v.lang || '').replace(/_/g, '-').toLowerCase();
  if (lang) return !!VOICE_LANG[letter]?.test(lang);
  return !!VOICE_NAME[letter]?.test(String(v.name || ''));
}
export function systemVoice(letter) {
  if (!synthOK()) return null;
  return speechSynthesis.getVoices().find(v => voiceMatches(v, letter)) || null;
}
/** Can this device pronounce words of `letter` (G/H) at all? (engine possible, or a system voice) */
export function canSpeak(letter) { return engineSupported() || !!systemVoice(letter); }
/** Call cb once when system voices (re)load. */
export function onVoices(cb) { if (synthOK()) speechSynthesis.addEventListener('voiceschanged', cb, { once: true }); }

/** The voice for `letter`; if the list is still empty, wait (≤ VOICE_WAIT) for voiceschanged, polling meanwhile. */
function waitVoice(letter) {
  if (!synthOK()) return Promise.resolve(null);
  if (speechSynthesis.getVoices().length) return Promise.resolve(systemVoice(letter));
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearInterval(poll);
      speechSynthesis.removeEventListener('voiceschanged', check);
      resolve(systemVoice(letter));
    };
    const check = () => { if (speechSynthesis.getVoices().length) finish(); };
    speechSynthesis.addEventListener('voiceschanged', check);
    const poll = setInterval(check, VOICE_POLL); // some Android builds never fire voiceschanged
    const timer = setTimeout(finish, VOICE_WAIT);
  });
}

// Per session and letter: 'ok' = the system voice started before, 'none' = no working system voice.
const VOICE_KEY = 'il.voice';
const voiceMem = (() => {
  try { const o = JSON.parse(sessionStorage.getItem(VOICE_KEY)); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
})();
function rememberVoice(letter, state) {
  voiceMem[letter] = state;
  try { sessionStorage.setItem(VOICE_KEY, JSON.stringify(voiceMem)); } catch {}
}

// ---- audio ----
let ctx = null, source = null, seq = 0;
/** Must run synchronously inside the tap gesture (iOS unlocks audio only there). */
function unlockAudio() {
  ctx ??= new AC();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  const s = ctx.createBufferSource(); // silent one-sample buffer: unlocks iOS output
  s.buffer = ctx.createBuffer(1, 1, 22050);
  s.connect(ctx.destination); s.start(0);
}
function stopAll() {
  seq++;
  try { source?.stop(); } catch {}
  source = null;
  if (synthOK()) speechSynthesis.cancel();
}
function play(pcm, rate) {
  const buf = ctx.createBuffer(1, pcm.length, rate);
  buf.copyToChannel(pcm, 0);
  source = ctx.createBufferSource();
  source.buffer = buf;
  source.connect(ctx.destination);
  source.start();
}

// ---- engine worker ----
let worker = null;
const pending = new Map();
function synth(ipa) {
  if (!worker) {
    worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) p?.reject(new Error(data.error)); else p?.resolve(data);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'worker error'));
      pending.clear(); worker?.terminate(); worker = null;
    };
  }
  const id = ++synth.n;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, ipa }); });
}
synth.n = 0;

async function engineSay(ipa) {
  const my = seq;
  const { pcm, rate } = await synth(ipa);
  if (!pcm.length) throw new Error('silent');
  if (my !== seq) return; // a newer tap took over
  play(pcm, rate);
}

let utter = null; // keep the utterance referenced until it settles (Chrome may drop its events otherwise)
/**
 * Speak with a system voice. Resolves 'ok' once it starts, 'fail' on onerror or (unless `trusted`) when onstart
 * does not come within START_WAIT, 'stale' when a newer tap took over.
 */
function systemSay(voice, text, trusted) {
  const my = seq;
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice; u.lang = voice.lang; u.rate = 0.8;
    let settled = false, timer = 0;
    const settle = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(my !== seq ? 'stale' : r);
    };
    u.onstart = () => settle('ok');
    u.onend = () => { settle('ok'); if (utter === u) utter = null; };
    u.onerror = (e) => {
      if (utter === u) utter = null;
      // our own stopAll() for a newer tap cancels this one: not a failure of the voice
      if (my !== seq && (e?.error === 'interrupted' || e?.error === 'canceled')) settle('stale');
      else settle('fail');
    };
    if (!trusted) {
      timer = setTimeout(() => {
        if (settled) return;
        if (my !== seq) { settle('stale'); return; } // a newer tap owns speechSynthesis now
        settle('fail');
        speechSynthesis.cancel();
      }, START_WAIT);
    }
    utter = u;
    speechSynthesis.speak(u);
  });
}

// ---- download ----
let downloading = null;
/** Fetch the engine files into Cache Storage; onProgress(bytes so far). */
function download(onProgress) {
  downloading ??= (async () => {
    const cache = 'caches' in window ? await caches.open(TTS_CACHE) : null;
    let got = 0;
    for (const url of URLS) {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(), parts = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length;
        onProgress?.(got);
      }
      const type = res.headers.get('Content-Type') || (/\.m?js$/.test(url) ? 'text/javascript' : 'application/octet-stream');
      await cache?.put(url, new Response(new Blob(parts, { type }), { headers: { 'Content-Type': type } }));
    }
    memReady = true;
    localStorage.setItem(FLAG, String(TTS_VERSION));
  })().finally(() => { downloading = null; });
  return downloading;
}

/** What to say for a word: IPA for the engine + text for a system voice ('' when there is nothing usable). */
export function speechFor({ letter, surface, lemma, translit }) {
  if (letter === 'H') return { engine: heIPA(translit, lemma), system: hebrewText(lemma) };
  return { engine: greekIPA(surface, lemma), system: greekText(surface, lemma) };
}

/** Small confirm dialog in the app's dialog style; resolves true for 下載. */
function confirmDownload(host) {
  return new Promise((resolve) => {
    const dlg = h('dialog.note-dialog.tts-ask', { 'aria-labelledby': 'tts-ask-t' },
      h('p#tts-ask-t', `發音需要下載語音引擎（約 ${TTS_MB} MB），要下載嗎？`),
      BIG ? h('p.tts-ask-note', '檔案較大，建議使用 Wi-Fi 下載。') : null,
      h('menu',
        h('button.press', { type: 'button', value: 'no' }, '取消'),
        h('button.primary.press', { type: 'button', value: 'yes' }, '下載')));
    let answered = false;
    const done = (yes) => { if (answered) return; answered = true; dlg.close(); dlg.remove(); resolve(yes); };
    // keep taps / keys inside the dialog away from the sheet (drag, backdrop close, Escape close)
    for (const t of ['pointerdown', 'touchstart']) dlg.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
    dlg.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('button');
      if (b) done(b.value === 'yes'); else if (e.target === dlg) done(false); // backdrop
    });
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(false); } });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    host.append(dlg);
    dlg.showModal();
    dlg.querySelector('.primary').focus();
  });
}

/**
 * Handle a tap on a 🔊 button. `getWord()` returns {letter, surface, lemma, translit} (may be async:
 * the dictionary entry can still be loading). The button shows download progress (data-p, --p).
 */
export async function sayWord(btn, getWord) {
  if (btn.classList.contains('loading')) return; // download in progress
  if (engineSupported()) unlockAudio(); // in the gesture, so a later engine fallback can still play
  stopAll();
  const my = seq;
  const word = await getWord();
  if (my !== seq) return;
  const what = speechFor(word);
  const letter = word.letter;

  if (what.system && voiceMem[letter] !== 'none') {
    const voice = await waitVoice(letter);
    if (my !== seq) return;
    const r = voice ? await systemSay(voice, what.system, voiceMem[letter] === 'ok') : 'fail';
    if (r === 'stale') return;
    if (r === 'ok') { rememberVoice(letter, 'ok'); return; }
    rememberVoice(letter, 'none'); // engine or download prompt for the rest of the session
  }
  if (hasEngine() && what.engine) {
    try { await engineSay(what.engine); return; } catch {
      forgetEngine(); // cache evicted / broken: ask again
    }
  }
  if (my !== seq) return;
  if (!engineSupported() || !what.engine) { toast(what.engine ? '這個裝置無法播放發音' : '這個字沒有可用的讀音'); return; }

  if (!(await confirmDownload(btn.closest('.wc') || document.body))) return;
  unlockAudio(); // the 下載 click is a fresh gesture
  btn.classList.add('loading');
  btn.setAttribute('aria-busy', 'true');
  const label = btn.getAttribute('aria-label');
  const prog = h('span.wc-say-prog', { 'aria-hidden': 'true' });
  btn.after(prog);
  const show = (got) => {
    const pct = Math.min(100, Math.round(got / TTS_BYTES * 100));
    btn.dataset.p = pct;
    btn.style.setProperty('--p', pct);
    btn.setAttribute('aria-label', `下載語音引擎 ${pct}%`);
    prog.textContent = `${pct}% · ${mb(got)} / ${TTS_MB} MB`;
  };
  show(0);
  try {
    await download(show);
  } catch {
    toast('語音引擎下載失敗，請檢查網路後再試');
    return;
  } finally {
    btn.classList.remove('loading');
    btn.removeAttribute('aria-busy');
    prog.remove();
    btn.setAttribute('aria-label', label);
    delete btn.dataset.p;
    btn.style.removeProperty('--p');
  }
  stopAll();
  try { await engineSay(what.engine); } catch { forgetEngine(); toast('語音引擎無法啟動'); }
}
