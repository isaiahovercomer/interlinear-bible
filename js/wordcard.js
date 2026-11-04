// Word card content for the bottom sheet: peek / half / full sections.
import { sheet } from './sheet.js';
import { dictEntry, dictZhEntry, occurrences, normStrong, chapter, store, versionById, verseText, originalFor, morphZh, mainStrong, mainLemma, wordStrongs } from './data.js';
import { syntaxView } from './syntax.js';
import { enabledVersions } from './settings.js';
import { parseMorph } from './morph.js';
import { parseKey, parseRef, refShort } from './ref.js';
import { BOOK, BOOKS } from './books.js';
import { h } from './util.js';
import { sayWord, canSpeak, onVoices } from './speech.js';

const HALF_N = 20;
const KNOWN = { lemma: '原形', translit: '音譯', gloss: '簡義', def: '字義', strong: 'Strong', m: '詞類', pos: '詞性', derivation: '字源', kjv: 'KJV 譯法', zh: '中文', from: '查詢編號' };

// STEPBible book abbreviations used in lexicon <ref='Mat.5.43'> tags → OSIS ids.
const STEP = 'Gen Exo Lev Num Deu Jos Jdg Rut 1Sa 2Sa 1Ki 2Ki 1Ch 2Ch Ezr Neh Est Job Psa Pro Ecc Sng Isa Jer Lam Ezk Dan Hos Jol Amo Oba Jon Mic Nam Hab Zep Hag Zec Mal Mat Mrk Luk Jhn Act Rom 1Co 2Co Gal Eph Php Col 1Th 2Th 1Ti 2Ti Tit Phm Heb Jas 1Pe 2Pe 1Jn 2Jn 3Jn Jud Rev'.split(' ');
const STEP_OSIS = Object.fromEntries(STEP.map((a, i) => [a.toLowerCase(), BOOKS[i].id]));
function stepRef(attr) {
  const m = /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)/.exec(attr || '');
  if (!m) return null;
  const book = STEP_OSIS[m[1].toLowerCase()] || parseRef(`${m[1]} ${m[2]}:${m[3]}`)?.book;
  return book ? `${book}.${m[2]}.${m[3]}` : null;
}

/** Lexicon HTML → safe DOM: keep b/i/br, turn <ref> into jump links, unwrap everything else. */
export function renderDef(html) {
  const src = String(html || '')
    .replace(/<ref='([^']*)'>/gi, (_, r) => `<a data-sref="${r.replace(/"/g, '')}">`)
    .replace(/<\/ref>/gi, '</a>')
    .replace(/__/g, '');
  const doc = new DOMParser().parseFromString(`<body>${src}</body>`, 'text/html');
  const frag = document.createDocumentFragment();
  const walk = (node, out) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out.append(n.textContent); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { out.append(document.createElement('br')); continue; }
      let el = null;
      if (tag === 'b' || tag === 'i') el = document.createElement(tag);
      else if (tag === 'a' && n.dataset.sref) {
        const key = stepRef(n.dataset.sref);
        if (key) { el = document.createElement('a'); el.href = '#' + key; el.dataset.ref = key; }
      }
      if (el) { walk(n, el); out.append(el); } else walk(n, out);
    }
  };
  walk(doc.body, frag);
  return frag;
}
const plain = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/__/g, '').trim();

// 🔊 speaker icon in the app's line-icon style (stroke = currentColor)
function speakerIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z', 'M15.5 9.5a3.5 3.5 0 0 1 0 5', 'M18 7a7 7 0 0 1 0 10']) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/** 🔊 button; taps must not reach the sheet (no drag, no close). */
function sayButton(letter, getWord) {
  const btn = h('button.wc-say.press', { type: 'button', 'aria-label': '播放發音', title: '播放發音', 'data-letter': letter }, speakerIcon());
  for (const t of ['pointerdown', 'touchstart']) btn.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  btn.addEventListener('click', (e) => { e.stopPropagation(); sayWord(btn, getWord); });
  if (!canSpeak(letter)) { btn.hidden = true; onVoices(() => { btn.hidden = !canSpeak(letter); }); }
  return btn;
}

function clean(t) { return String(t || '').replace(/[.,;:·’'"“”«»()\[\]—!?¶׃׀]/g, '').replace(/־$/, ''); }

// A tapped OT token of a version whose manifest tok_source has an OT entry (statistical mapping, e.g. 恢復本) gets a caveat line.
function otMappingNote(surface, refKey) {
  if (surface == null || BOOK[String(refKey || '').split('.')[0]]?.testament !== 'OT') return null;
  const tk = [...document.querySelectorAll('.tr .tk.hl')].find(e => e.textContent === surface);
  if (!versionById(tk?.closest('.tr')?.dataset.ver)?.tok_source?.OT) return null;
  return h('p.hint.wc-otnote', { style: 'font-size:12px;margin:2px 0 0' }, '舊約對應僅供參考');
}

export function openWordCard({ word, strong, surface, refKey, onClose, onNavigate, focus, verse, wordIndex, onSyntaxWord }) {
  const s = normStrong(word ? mainStrong(word) : strong);
  const lang = s?.[0] === 'H' ? 'hbo' : 'grc';
  const letter = s?.[0] || 'G';
  const parseEl = h('span', word ? (word.mz || word.parse || word.pz || (letter === 'G' ? parseMorph(word.m) : '')) : '');
  if (word?.m && !(word.mz || word.parse || word.pz)) morphZh(word.m, letter).then(z => { if (z) parseEl.textContent = z; });

  const lemmaEl = h('span.wc-lemma', { lang }, word ? mainLemma(word) : '');
  const trEl = h('span.wc-translit');
  const glossEl = h('p.wc-gloss', word?.g || '');
  const zhGlossEl = h('p.wc-gloss.wc-zh', { lang: 'zh-Hant', hidden: true });
  const zhDefEl = h('div.wc-zhdef.clamp', { lang: 'zh-Hant' });
  const zhSec = h('div.wc-zhsec', { hidden: true }, h('h3', '中文字義', h('small.wc-src', 'CBOL')), zhDefEl);
  const defEl = h('div.wc-def.clamp', '載入中…');
  const defFull = h('div.wc-def');
  const countEl = h('small.wc-count');
  const listHalf = h('ol.wc-refs');
  const listFull = h('ol.wc-refs', { start: HALF_N + 1 });
  const entryEl = h('dl.wc-entry');
  const moreEl = h('p.wc-more');
  // multi-morpheme words (Hebrew prefixes / suffixes, Greek crasis): one chip per morpheme
  const parts = word ? wordStrongs(word) : [];
  const lemmas = String(word?.l || '').split('+');
  const morphs = parts.length > 1 ? h('div.wc-morphs', parts.map((x, i) => h('button.chip.press', { type: 'button', 'data-see': x, class: `chip press${x === s ? ' on' : ''}` },
    h('span', { lang }, lemmas[i] || ''), ' ', x))) : null;

  // full section: 字典 | 句法 tabs (句法 needs the verse's words)
  const [book, chs, vs] = String(refKey || '').split('.');
  const canSyntax = !!(word && verse?.w && store.manifest?.syntax?.[lang === 'hbo' ? 'hbo' : 'grc']);
  const dictPane = h('div.wc-pane', { role: 'tabpanel', id: 'wc-pane-dict', 'aria-labelledby': 'wc-tab-dict' },
    h('h3', '字典條目'), defFull, entryEl,
    h('h3.wc-all-h', '全部出處'), listFull);
  const synPane = h('div.wc-pane', { role: 'tabpanel', id: 'wc-pane-syn', 'aria-labelledby': 'wc-tab-syn', hidden: true });
  let synLoaded = false;
  const tabs = canSyntax ? h('div.wc-tabs', { role: 'tablist', 'aria-label': '全屏內容' },
    h('button#wc-tab-dict.press', { type: 'button', role: 'tab', 'aria-selected': 'true', 'aria-controls': 'wc-pane-dict' }, '字典'),
    h('button#wc-tab-syn.press', { type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-controls': 'wc-pane-syn' }, '句法')) : null;
  const selectTab = async (name) => {
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.id === `wc-tab-${name}`));
    dictPane.hidden = name !== 'dict';
    synPane.hidden = name !== 'syn';
    if (name === 'syn' && !synLoaded) {
      synLoaded = true;
      synPane.replaceChildren(h('p.hint', '載入句法…'));
      synPane.replaceChildren(await syntaxView({ lang, book, ch: +chs, n: +vs, words: verse.w, focus: wordIndex, onWord: onSyntaxWord }));
      synPane.querySelector('.syn-leaf.on')?.scrollIntoView({ block: 'center' });
    }
    if (sheet.snap !== 'full') sheet.snapTo('full');
  };

  const headword = word ? clean(word.t) : (surface || '');
  const entryP = s ? dictEntry(s) : Promise.resolve(null);
  const say = sayButton(letter, async () => {
    const e = await entryP.catch(() => null);
    return { letter, surface: headword, lemma: e?.lemma || lemmaEl.textContent, translit: e?.translit || e?.xlit || '' };
  });

  const root = h('div.wc', { 'data-strong': s || '' },
    h('section.wc-peek',
      h('div.wc-top',
        h('span.wc-word', { lang, dir: lang === 'hbo' ? 'rtl' : null }, headword),
        say,
        s ? h('span.wc-strong', s) : null),
      h('div.wc-sub', lemmaEl, trEl),
      morphs,
      word?.m ? h('p.wc-parse', parseEl, h('code', word.m)) : null,
      zhGlossEl, glossEl, otMappingNote(surface, refKey)),
    h('section.wc-half',
      zhSec,
      h('h3', '字義', h('small.wc-src', 'English')), defEl,
      h('h3', '其他出處 ', countEl), listHalf, moreEl),
    h('section.wc-full', tabs, dictPane, synPane),
  );
  tabs?.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) selectTab(b.id.slice(7)); });
  tabs?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = tabs.querySelector('[aria-selected=false]');
    next.focus(); selectTab(next.id.slice(7));
  });

  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-ref]');
    if (a) { e.preventDefault(); onNavigate?.(a.dataset.ref); }
    const see = e.target.closest('[data-see]');
    if (see && see.dataset.see !== s) openWordCard({ strong: see.dataset.see, refKey, onClose, onNavigate });
    if (e.target.closest('.wc-more button')) sheet.snapTo('full');
  });

  sheet.show(root, { at: 'peek', onClose, focus });

  if (!s) { defEl.textContent = '這個字沒有 Strong 編號。'; return; }

  dictZhEntry(s).then((z) => {
    if (!z) return;
    zhGlossEl.hidden = false;
    zhGlossEl.textContent = [z.m, z.gloss].filter(Boolean).join('　');
    zhSec.hidden = false;
    zhDefEl.textContent = z.def || z.gloss || '';
    requestAnimationFrame(() => zhDefEl.classList.toggle('cut', zhDefEl.scrollHeight > zhDefEl.clientHeight + 2));
    if (!lemmaEl.textContent && z.lemma) lemmaEl.textContent = z.lemma;
  }).catch(() => {});

  entryP.then((e) => {
    if (!e) { defEl.textContent = '字典中找不到這個編號。'; return; }
    if (!lemmaEl.textContent) lemmaEl.textContent = e.lemma || '';
    trEl.textContent = e.translit || e.xlit || '';
    const g1 = e.gloss_zh || e.zh || e.gloss || word?.g || '';
    glossEl.textContent = word?.g && e.gloss && plain(word.g).toLowerCase() !== e.gloss.toLowerCase() ? `${e.gloss}（此處：${plain(word.g)}）` : g1;
    const def = e.def || e.definition;
    defEl.replaceChildren(def ? renderDef(def) : (g1 || '（無）'));
    defFull.replaceChildren(def ? renderDef(def) : '');
    requestAnimationFrame(() => defEl.classList.toggle('cut', defEl.scrollHeight > defEl.clientHeight + 2));
    entryEl.replaceChildren(...Object.entries(e).filter(([k, v]) => v != null && v !== '' && typeof v !== 'object' && k !== 'def')
      .flatMap(([k, v]) => [h('dt', KNOWN[k] || k), h('dd', { lang: k === 'lemma' ? lang : null }, String(v))]));
    if (e.see?.length > 1) entryEl.append(h('dt', '其他字義'), h('dd', e.see.map(x => h('button.chip.press', { type: 'button', 'data-see': x }, x))));
    const info = store.manifest?.dict?.[s[0]];
    if (info?.name) entryEl.append(h('dt', '來源'), h('dd', info.name));
    return e;
  }).then((e) => occurrences(s, e?.see)).then((refs) => {
    countEl.textContent = `共 ${refs.length} 處`;
    const mk = (k) => {
      const r = parseKey(k);
      if (!r) return null;
      const li = h('li', h('a', { href: '#' + k, 'data-ref': k, class: k === refKey ? 'here' : null }, h('b', refShort(r)), ' ', h('span.snip', '…')));
      li._key = k;
      io.observe(li);
      return li;
    };
    listHalf.replaceChildren(...refs.slice(0, HALF_N).map(mk).filter(Boolean));
    if (refs.length > HALF_N) {
      moreEl.replaceChildren(h('button.linkbtn.press', { type: 'button' }, `顯示全部 ${refs.length} 處`));
      listFull.replaceChildren(...refs.slice(HALF_N).map(mk).filter(Boolean));
    } else {
      root.querySelector('.wc-all-h').textContent = refs.length ? '全部出處（已全部列在上方）' : '全部出處';
    }
    if (!refs.length) listHalf.replaceChildren(h('li.none', '索引中沒有其他出處。'));
  });
}

// Snippets load lazily as list items scroll into view.
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    io.unobserve(en.target);
    fillSnippet(en.target);
  }
}, { rootMargin: '200px' });

async function fillSnippet(li) {
  const r = parseKey(li._key);
  const snip = li.querySelector('.snip');
  if (!r || !snip) return;
  const first = enabledVersions(store.translations).find(x => x.on);
  const ver = (first && versionById(first.id)) || originalFor(BOOK[r.book].testament);
  try {
    const c = await chapter(ver.id, r.book, r.ch);
    const v = c?.verses?.find(x => x.n === r.v);
    const t = verseText(v);
    snip.textContent = t ? (t.length > 42 ? t.slice(0, 42) + '…' : t) : '';
  } catch { snip.textContent = ''; }
}
