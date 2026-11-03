// Scripture reference parser: 「約三16」「約3:16」「約翰福音3」「jn3:16」「John 3」「太5」…
import { BOOKS, BOOK } from './books.js';

const ZH_DIGIT = { 〇: 0, 零: 0, 一: 1, 壹: 1, 二: 2, 貳: 2, 兩: 2, 三: 3, 參: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const ZH_UNIT = { 十: 10, 拾: 10, 百: 100, 佰: 100 };
const ZH_NUM_CHARS = '〇零一壹二貳兩三參四五六七八九十拾百佰';

/** 中文數字 → number：三、十六、二十一、一百五十、一五〇 */
export function parseZhNumber(s) {
  if (!s) return NaN;
  if (/^\d+$/.test(s)) return +s;
  if (![...s].every(c => ZH_NUM_CHARS.includes(c))) return NaN;
  if (![...s].some(c => c in ZH_UNIT)) { // digit-by-digit: 一五〇
    return +[...s].map(c => ZH_DIGIT[c]).join('');
  }
  let total = 0, cur = 0;
  for (const c of s) {
    if (c in ZH_DIGIT) cur = ZH_DIGIT[c];
    else { total += (cur || 1) * ZH_UNIT[c]; cur = 0; }
  }
  return total + cur;
}

const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

// name → bookId; longest-match lookup. Rebuilt after books.json adds aliases.
// An alias that is another book's name + a Chinese numeral (「約三」= 約翰三書, but also 約 + 三)
// is *weak*: it is only used when that reading is a real chapter/verse (DESIGN 決策 6 註記).
let NAMES = [];
const ZH_TAIL = /[一二三四五六七八九十]$/;
export function refreshNames() {
  const own = new Map();
  for (const b of BOOKS) for (const k of [b.zh, b.abbr, b.id, b.en]) own.set(norm(k), b.id);
  const all = new Map([...own].map(([k, id]) => [k, [id, false]]));
  for (const b of BOOKS) {
    for (const a of [...b.alias, ...(b.extraAliases || [])]) {
      const k = norm(a);
      if (!k || all.has(k)) continue;
      const base = ZH_TAIL.test(k) && (own.get(k.slice(0, -1)) ?? all.get(k.slice(0, -1))?.[0]);
      all.set(k, [b.id, !!base && base !== b.id]);
    }
  }
  NAMES = [...all].map(([k, [id, weak]]) => [k, id, weak]).sort((a, b) => b[0].length - a[0].length);
}
refreshNames();

function bookCandidates(s) {
  const out = [];
  for (const [k, id, weak] of NAMES) if (s.startsWith(k)) out.push([k.length, id, weak]);
  // English prefix match (e.g. "joh", "revel") when nothing exact
  if (!out.length) {
    const m = s.match(/^([1-3]?[a-z]+)/);
    if (m && m[1].length >= 3) {
      for (const b of BOOKS) if (norm(b.en).startsWith(m[1])) out.push([m[1].length, b.id, false]);
    }
  }
  return out;
}

const NUM = `(\\d+|[${ZH_NUM_CHARS}]+)`;
const REST = new RegExp(`^(?:第)?${NUM}?(?:章|篇)?(?:[:.,，：;；章篇]|\\s)*${NUM}?(?:節)?(?:[-–~～至到]${NUM})?$`);

/**
 * Parse a reference. Returns {book, ch, v?, v2?} or null.
 * The longest ordinary name wins (「約壹16」is never 約 + 壹16). A longer weak alias is tried
 * first and kept only if it names a real chapter (and verse): 「約三1」= 約參 1,
 * 「約一5」= 約壹 5, but 「約三16」「約一6」「約二3」= 約翰福音 3:16 / 1:6 / 2:3.
 */
export function parseRef(input) {
  if (!input) return null;
  const s = norm(input).replace(/[：]/g, ':');
  if (!s) return null;
  const cands = bookCandidates(s);
  const strongLen = Math.max(0, ...cands.filter(c => !c[2]).map(c => c[0]));
  const order = [
    ...cands.filter(c => c[2] && c[0] > strongLen),
    ...cands.filter(c => !c[2] && c[0] === strongLen),
  ];
  for (const [len, id, weak] of order) {
    const r = readRest(id, s.slice(len), !weak);
    if (r) return r;
  }
  return null;
}

function readRest(id, rest, singleChapterVerse) {
  const m = rest.match(REST);
  if (!m) return null;
  const ch = m[1] ? parseZhNumber(m[1]) : 1;
  const v = m[2] ? parseZhNumber(m[2]) : undefined;
  const v2 = m[3] ? parseZhNumber(m[3]) : undefined;
  const b = BOOK[id];
  const maxV = b.verses?.[ch - 1];
  const valid = Number.isFinite(ch) && ch >= 1 && ch <= b.chapters && (v === undefined || (Number.isFinite(v) && v >= 1 && (!maxV || v <= maxV)));
  if (valid) return { book: id, ch, ...(v ? { v } : {}), ...(v2 ? { v2 } : {}) };
  // a single-chapter book's name followed by one number means verse ("猶3" → Jude 1:3)
  if (singleChapterVerse && b.chapters === 1 && m[1] && !m[2] && Number.isFinite(ch) && (!b.verses?.[0] || ch <= b.verses[0])) return { book: id, ch: 1, v: ch };
  return null;
}

export const refKey = (r) => `${r.book}.${r.ch}${r.v ? '.' + r.v : ''}`;
export function parseKey(k) {
  const m = /^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?$/.exec(k || '');
  return m && BOOK[m[1]] ? { book: m[1], ch: +m[2], ...(m[3] ? { v: +m[3] } : {}) } : null;
}
export const refLabel = (r) => `${BOOK[r.book]?.zh || r.book} ${r.ch}${r.v ? ':' + r.v : ''}`;
export const refShort = (r) => `${BOOK[r.book]?.abbr || r.book}${r.ch}${r.v ? ':' + r.v : ''}`;

/** ['John.3.16','John.3.17','John.3.19'] → 「約翰福音 3:16-17,19」 */
export function refRangeLabel(keys) {
  const rs = (keys || []).map(parseKey).filter(Boolean);
  if (!rs.length) return '';
  const f = rs[0];
  const ns = rs.filter(r => r.book === f.book && r.ch === f.ch).map(r => r.v).sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    parts.push(i === j ? `${ns[i]}` : `${ns[i]}-${ns[j]}`);
    i = j;
  }
  return `${BOOK[f.book]?.zh || f.book} ${f.ch}:${parts.join(',')}`;
}
