// Kitten TTS nano model I/O (no DOM; used by tts-worker.js and tools/tts-check.mjs).
// Mirrors the reference inference of KittenTTS (github.com/KittenML/KittenTTS, onnx_model.py):
// IPA characters → token ids, one style row per input length, 24 kHz float audio out.
// We feed our own IPA (speech-text.js); there is no text phonemizer.

export const SAMPLE_RATE = 24000;

const PAD = '$';
const PUNCT = ';:,.!?¡¿—…"«»"" ';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const IPA = "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";
// Same as the Python dict comprehension upstream: for repeated symbols (" and ') the LAST index wins.
const ID = new Map();
[PAD, ...PUNCT, ...LETTERS, ...IPA].forEach((c, i) => ID.set(c, i));

/** IPA string → int64 token ids: [0, …ids (unknown characters dropped)…, 10, 0] (as upstream). */
export function tokenIds(ipa) {
  const ids = [0];
  for (const c of ipa) if (ID.has(c)) ids.push(ID.get(c));
  ids.push(10, 0);
  return BigInt64Array.from(ids, BigInt);
}

/** Row of the voice table (Float32Array 400×256) used as `style` for this IPA string (upstream: by length). */
export function styleRow(voice, ipa) {
  const rows = voice.length / 256;
  const r = Math.min(ipa.length, rows - 1);
  return voice.subarray(r * 256, (r + 1) * 256);
}

/** Drop near-silence at both ends (keeps a few ms of margin). */
export function trimSilence(a, threshold = 0.01, marginMs = 30) {
  let s = 0, e = a.length;
  while (s < e && Math.abs(a[s]) < threshold) s++;
  while (e > s && Math.abs(a[e - 1]) < threshold) e--;
  const m = Math.round(SAMPLE_RATE * marginMs / 1000);
  return a.slice(Math.max(0, s - m), Math.min(a.length, e + m));
}
