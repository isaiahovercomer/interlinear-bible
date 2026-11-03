// Text normalisation for search (pure: no DOM, usable in the window and in the search worker).
// The *-plain search sets of the data pipeline are built with the same rules
// (DATA_FORMAT.md §9: Greek NFD → drop \p{Mn} → lowercase → ς→σ; Hebrew consonants only).

export const nfc = (s) => String(s ?? '').normalize('NFC');

// ---------- Greek ----------
/** Drop every combining mark (accents, breathings, iota subscript, diaeresis); NFC result. */
export const stripMarks = (s) => String(s ?? '').normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC');
/** ς → σ (final sigma folded to medial). */
export const foldFinalSigma = (s) => String(s ?? '').replace(/ς/g, 'σ');
/** Search key for Greek, identical to the pipeline's grc-plain set: no accents, no punctuation, lowercase, σ. */
export function foldGreek(s) {
  return foldFinalSigma(stripMarks(s).toLowerCase())
    .replace(/[^\p{L}\p{N}_\s]/gu, '').replace(/\s+/g, ' ').trim();
}

// ---------- Hebrew ----------
// Cantillation (U+0591–05AF), meteg (05BD), paseq (05C0). Sof pasuq (05C3) and maqaf (05BE) are punctuation.
const CANTILLATION = /[֑-ֽ֯׀]/g;
// Vowel points, dagesh/mappiq, rafe, shin/sin dots, upper/lower dots, qamats qatan.
const NIQQUD = /[ְ-ׇּֿׁׂׅׄ]/g;
export const stripCantillation = (s) => String(s ?? '').normalize('NFD').replace(CANTILLATION, '').normalize('NFC');
export const stripNiqqud = (s) => String(s ?? '').normalize('NFD').replace(NIQQUD, '').normalize('NFC');
/** Both cantillation and niqqud removed; maqaf, sof pasuq and letters stay. */
export const stripPoints = (s) => String(s ?? '').normalize('NFD').replace(CANTILLATION, '').replace(NIQQUD, '').normalize('NFC');
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export const foldHebrewFinals = (s) => String(s ?? '').replace(/[ךםןףץ]/g, (c) => FINALS[c]);
/** Consonants only (U+05D0–05EA), maqaf → space — identical to the pipeline's hbo-plain set. */
export function hebrewConsonants(s) {
  return String(s ?? '').replace(/־/g, ' ').normalize('NFD')
    .replace(/[^א-ת\s]/g, '').replace(/\s+/g, ' ').trim();
}
/** Hebrew search key; `finals` also folds final letters (fuzzy: ך = כ …). */
export const foldHebrew = (s, { finals = false } = {}) => (finals ? foldHebrewFinals(hebrewConsonants(s)) : hebrewConsonants(s));

// ---------- Latin / Chinese ----------
export function foldLatin(s) {
  return String(s ?? '').normalize('NFKD').replace(/\p{Mn}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}
/** NFKC (full-width → half-width), no whitespace, no punctuation / symbols. */
export const foldChinese = (s) => String(s ?? '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
/** Exact Chinese: only whitespace is ignored (the pipeline's zh sets have none). */
export const exactChinese = (s) => nfc(s).replace(/\s/g, '');

// ---------- detection ----------
const RE_HEB = /[֐-׿יִ-ﭏ]/;
const RE_GRK = /[Ͱ-Ͽἀ-῿]/;
const RE_HAN = /\p{Script=Han}/u;
/** Dominant script of a query: 'hbo' | 'grc' | 'zh' | 'en'. */
export function detectScript(s) {
  s = String(s ?? '');
  if (RE_HEB.test(s)) return 'hbo';
  if (RE_GRK.test(s)) return 'grc';
  if (RE_HAN.test(s)) return 'zh';
  return 'en';
}
export const STRONG_RE = /^\s*([GHgh])0*(\d{1,5})([A-Za-z]?)\s*$/;
/**
 * Classify a search box entry. `parseRef` (optional, from ref.js) recognises references;
 * a reference needs a chapter number so that a bare book name like 「約」 stays a keyword.
 * → { kind: 'strong'|'ref'|'keyword', script, ref?, strong? }
 */
export function detectQuery(text, parseRef) {
  const t = String(text ?? '').trim();
  const script = detectScript(t);
  const m = STRONG_RE.exec(t);
  if (m) return { kind: 'strong', script: 'en', strong: m[1].toUpperCase() + m[2].padStart(4, '0') + m[3] };
  if (parseRef && script !== 'grc' && script !== 'hbo' && /\d|[一二三四五六七八九十百]/.test(t)) {
    const ref = parseRef(t);
    if (ref) return { kind: 'ref', script, ref };
  }
  return { kind: 'keyword', script };
}

/** Search key for `script` in `mode` ('exact' | 'fuzzy'). */
export function keyFor(script, mode, s) {
  if (mode === 'exact') return script === 'zh' ? exactChinese(s) : nfc(s);
  switch (script) {
    case 'grc': return foldGreek(s);
    case 'hbo': return foldHebrew(s, { finals: true });
    case 'zh': return foldChinese(s);
    default: return foldLatin(s);
  }
}

/**
 * Locate `needle` (already keyed) in raw `text`, folding char by char so the range maps back
 * to the original string. Returns [start, end) in `text` or null.
 */
export function locate(script, mode, text, needle) {
  if (!needle) return null;
  if (mode === 'exact' && script !== 'zh') { // text is NFC already (pipeline output / worker nfc())
    const i = text.indexOf(needle);
    return i < 0 ? null : [i, i + needle.length];
  }
  let acc = '';
  const map = [];
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i));
    const k = /\s/.test(ch) ? (script === 'zh' ? '' : ' ') : keyFor(script, mode, ch);
    for (let j = 0; j < k.length; j++) map.push(i);
    acc += k;
    i += ch.length;
  }
  const j = acc.indexOf(needle);
  if (j < 0) return null;
  const a = map[j] ?? 0;
  const last = map[j + needle.length - 1];
  return [a, last == null ? text.length : last + String.fromCodePoint(text.codePointAt(last)).length];
}
