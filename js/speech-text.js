// What the 🔊 button says (no DOM; also used by tools/tts-check.mjs).
// Conventions (docs/DESIGN.md §7):
// - Greek: the surface form as printed (lemma when there is none), reconstructed Koine / academic reading
//   close to Erasmian (not modern Greek); stress from the accent mark.
// - Hebrew: the dictionary's STEP transliteration of the lemma (`translit`, e.g. "be.re.shit", "o.khel"),
//   Israeli / modern-style reading; that is the dictionary form, which the card shows next to the button.
// The on-device model (Kitten TTS) was trained on US-English phonemes only, so both converters produce
// *English-style* IPA: English vowel qualities and diphthongs, ɹ for r, ː for length, and the stress mark ˈ
// written directly before the stressed vowel. Every utterance ends with " ." (the training input was tokenised
// with a space before punctuation; without it short words come out clipped).
// The choices below were tuned by synthesising test words and transcribing them with an English ASR.

/** Greek letters + combining marks only (drops punctuation, elision marks, digits). */
export function greekText(surface, lemma) {
  const g = (t) => String(t || '').normalize('NFC').replace(/[^\p{Script=Greek}\p{M}\s]/gu, '').replace(/\s+/g, ' ').trim();
  return g(surface) || g(String(lemma || '').split(/[,+]/)[0]);
}

/** Pointed Hebrew without cantillation (for a system he-IL voice). */
export function hebrewText(lemma) {
  return String(lemma || '').split(',')[0].replace(/[֑-ֽ֯׀׃]/g, '').replace(/[^ְ-ת\s־]/g, '').trim();
}

const STRESS = 'ˈ';
const ACCENT = /[́̀͂]/;   // acute, grave, circumflex (perispomeni)
const ROUGH = '̔', DIAERESIS = '̈';

// ---- Greek ----
// Erasmian-style values in English terms: ε is ɛ when stressed or in a closed syllable, otherwise eɪ;
// ι is ɪ in a closed syllable, otherwise iː;
// ο and ω are both oʊ (a distinct short ɔ was much less intelligible); χ is k (as English "Christ"; x and h
// tested worse); ζ is zd; rough breathing is h.
const G_VOWEL = { α: 'ɑː', ε: 'eɪ', η: 'eɪ', ι: 'iː', ο: 'oʊ', υ: 'uː', ω: 'oʊ' };
const G_CLOSED = { ε: 'ɛ', ι: 'ɪ' };
const G_DIPH = { αι: 'aɪ', ει: 'eɪ', οι: 'ɔɪ', υι: 'wiː', αυ: 'aʊ', ευ: 'juː', ηυ: 'juː', ου: 'uː' };
const G_CONS = { β: 'b', γ: 'ɡ', δ: 'd', ζ: 'zd', θ: 'θ', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'ks', π: 'p',
  ρ: 'ɹ', σ: 's', ς: 's', τ: 't', φ: 'f', χ: 'k', ψ: 'ps' };
const G_VELAR = new Set(['γ', 'κ', 'ξ', 'χ']); // γ before these is the nasal ŋ

/** One Greek word → English-style IPA syllable nuclei + consonants, stress mark included. */
function greekWord(word) {
  const letters = []; // {c, m: combining marks}
  for (const ch of word.normalize('NFD').toLowerCase()) {
    if (/\p{M}/u.test(ch)) { if (letters.length) letters[letters.length - 1].m += ch; }
    else if (G_VOWEL[ch] || G_CONS[ch]) letters.push({ c: ch, m: '' });
  }
  const units = []; // {ipa, vowel: base letter (monophthong) | true, stress}
  for (let i = 0; i < letters.length; i++) {
    const { c, m } = letters[i], next = letters[i + 1];
    if (G_VOWEL[c]) {
      let ipa = G_VOWEL[c], marks = m, vowel = c;
      if (next && G_DIPH[c + next.c] && !next.m.includes(DIAERESIS)) { ipa = G_DIPH[c + next.c]; marks += next.m; vowel = true; i++; }
      if (marks.includes(ROUGH) && !units.length) units.push({ ipa: 'h' });
      units.push({ ipa, vowel, stress: ACCENT.test(marks) });
    } else if (c === 'γ' && next && G_VELAR.has(next.c)) {
      units.push({ ipa: 'ŋ' });
    } else if (next && next.c === c) {
      continue; // doubled consonant (λλ, ρρ, σσ, ττ…): said once
    } else {
      units.push({ ipa: G_CONS[c] });
    }
  }
  // closed syllable: two consonant sounds before the next vowel (ξ, ψ, ζ count as two), or any at the end
  const vowels = units.filter(u => u.vowel);
  if (!vowels.length) return units.map(u => u.ipa).join('');
  // the first accent (a second one is an enclitic's); none written: penult (single vowel: that vowel)
  const stressed = vowels.find(u => u.stress) || vowels[Math.max(0, vowels.length - 2)];
  units.forEach((u, i) => {
    if (!G_CLOSED[u.vowel]) return;
    let n = 0, j = i + 1;
    for (; j < units.length && !units[j].vowel; j++) n += units[j].ipa.length;
    if (n >= 2 || (n >= 1 && j === units.length) || (u === stressed && u.vowel === 'ε')) u.ipa = G_CLOSED[u.vowel];
  });
  return units.map(u => (u === stressed ? STRESS : '') + u.ipa).join('');
}

/** Greek (as printed) → IPA for the model, or '' if there is no Greek letter. */
export function greekIPA(surface, lemma) {
  const words = greekText(surface, lemma).split(' ').map(greekWord).filter(Boolean);
  return words.length ? `${words.join(' ')} .` : '';
}

// ---- Hebrew (STEP transliteration) ----
const H_DIGRAPH = { sh: 'ʃ', ch: 'k', kh: 'k', ph: 'f', th: 't', ts: 'ts', tz: 'ts' };
const H_SINGLE = { b: 'b', c: 'k', d: 'd', f: 'f', g: 'ɡ', h: 'h', j: 'dʒ', k: 'k', l: 'l', m: 'm', n: 'n', p: 'p',
  q: 'k', r: 'ɹ', s: 's', t: 't', v: 'v', w: 'v', x: 'ks', y: 'j', z: 'z' };
const H_VOWEL = { a: 'ɑː', e: 'ɛ', i: 'iː', o: 'oʊ', u: 'uː' };
const H_VOWEL_FINAL = { e: 'eɪ' }; // e ending the word ("mo.sheh")
const H_GLIDE = { a: 'aɪ', e: 'eɪ', o: 'ɔɪ', u: 'uːi', i: 'iː' }; // vowel + y / i closing a syllable
const VOWEL = /^[aeiou]$/;

/** A syllable ("re", "shit") → segments: {c: consonant key} | {v: vowel letter}. */
function segs(syl) {
  const out = [];
  for (let i = 0; i < syl.length; i++) {
    const two = syl.slice(i, i + 2);
    if (H_DIGRAPH[two]) { out.push({ c: two }); i++; }
    else if (VOWEL.test(syl[i])) out.push({ v: syl[i] });
    else if (H_SINGLE[syl[i]]) out.push({ c: syl[i] });
  }
  return out;
}

/**
 * STEP transliteration → English-style IPA for the model, or '' if nothing usable.
 * Rules (kept deliberately simple):
 * - dots split syllables; the last syllable is stressed, unless the pointed lemma carries
 *   ole (U+05AB, as in אֹ֫כֶל), the lexicon's mark for penultimate stress (milel) → stress the penult;
 * - doubled consonants across a syllable dot (dagesh forte: "tsad.diq", "um.mah") are said once,
 *   and "iy.y" (chireq + yod before a geminated yod) is just "i.y";
 * - word-final h after a vowel (mater lectionis ה: "ma.a.qeh") is silent;
 * - a vowel + y at the end of a syllable is a diphthong ("lay.lah", "ba.yit" stays two syllables);
 * - sh → ʃ, ch / kh → k (Israeli ח / כ are [χ], but x / kʰ / h were less intelligible), q → k, r → ɹ, ts → ts;
 *   aleph / ayin are not pronounced (a glottal stop made words less intelligible);
 * - vowels a ɑː, e ɛ (word-final eɪ; unstressed final "-er" ɚ), i iː, o oʊ (word-initial oː), u uː.
 */
export function heIPA(translit, lemma) {
  const words = String(translit || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z.\s-]/g, ' ').split(/[\s-]+/).map(w => w.split('.').filter(Boolean)).filter(w => w.length);
  if (!words.length) return '';
  const milel = /֫/.test(String(lemma || '').split(',')[0]);
  const out = words.map((syls, wi) => {
    const S = syls.map(segs).filter(s => s.length);
    for (let i = 0; i + 1 < S.length; i++) {
      const a = S[i], b = S[i + 1], z = a[a.length - 1];
      if (a.length > 1 && z.c === 'y' && a[a.length - 2].v === 'i' && b[0].c === 'y') a.pop();
      else if (a.length > 1 && z.c && z.c === b[0].c) a.pop();
    }
    const last = S[S.length - 1];
    if (last.length > 1 && last[last.length - 1].c === 'h' && last[last.length - 2].v) last.pop();
    const stress = milel && wi === words.length - 1 && S.length > 1 ? S.length - 2 : S.length - 1;
    const lastSyl = S.length - 1;
    // y (or i after another vowel) closing a syllable after a vowel: glide of a diphthong ("lay", "laim")
    const isGlide = (s, k) => k > 0 && s[k - 1].v && (s[k].c === 'y' && k === s.length - 1 || s[k].v === 'i' && s[k + 1]?.v === undefined);
    // unstressed word-final "-er" (e at k): said as one ɚ ("bo.qer")
    const isEr = (s, si, k) => si === lastSyl && si !== stress && s[k]?.v === 'e' && s[k + 1]?.c === 'r' && k + 2 === s.length;
    return S.map((s, si) => s.map((x, k) => {
      if (isGlide(s, k) || isEr(s, si, k - 1)) return '';
      if (x.c) return H_DIGRAPH[x.c] || H_SINGLE[x.c];
      const final = si === lastSyl && k === s.length - 1;
      let ipa = s[k + 1] && isGlide(s, k + 1) ? H_GLIDE[x.v] : (final && H_VOWEL_FINAL[x.v]) || H_VOWEL[x.v];
      if (isEr(s, si, k)) ipa = 'ɚ';
      else if (x.v === 'o' && si === 0 && k === 0) ipa = 'oː'; // word-initial o: oʊ came out too weak
      return (si === stress && s.findIndex(y => y.v) === k ? STRESS : '') + ipa;
    }).join('')).join('');
  });
  return `${out.join(' ')} .`;
}
