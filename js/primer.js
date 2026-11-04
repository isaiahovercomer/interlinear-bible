// 原文入門 tab: a beginner's primer for Greek and Hebrew (docs/DESIGN.md §8).
// All text comes from js/primer-data.js and is set as text nodes (h() / textContent), never innerHTML.
// 🔊: the word card's pronunciation (js/speech.js: system voice first, else the on-device engine prompt).
import { GREEK, HEBREW } from './primer-data.js';
import { sayWord } from './speech.js';
import { h, $ } from './util.js';
import { refLabel } from './ref.js';

const KEY = 'il.primer.lang';
let navigate = () => {};
let built = false;

export function initPrimer({ onNavigate }) { navigate = onNavigate; }

const G = (t) => h('span', { lang: 'grc' }, t);
const He = (t) => h('span', { lang: 'hbo', dir: 'rtl' }, t);

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

/** What to say: Greek → the word itself; Hebrew → pointed word (system voice) + STEP transliteration (engine). */
const wordG = (w) => () => ({ letter: 'G', surface: w, lemma: w });
const wordH = (heb, say) => () => ({ letter: 'H', surface: heb, lemma: heb, translit: say });

function sayBtn(label, getWord) {
  const b = h('button.pr-say.press', { type: 'button', 'aria-label': label, title: label }, speakerIcon());
  b.addEventListener('click', () => sayWord(b, getWord));
  return b;
}

function section(id, title, ...kids) {
  return h(`section#${id}.pr-sec`, { 'aria-labelledby': `${id}-h` }, h(`h2#${id}-h`, title), ...kids);
}
const p = (t) => h('p', t);
const list = (items, tag = 'ol') => h(tag, ...items.map(t => h('li', t)));
function table(rows, lang) {
  return h('dl.pr-rows', ...rows.flatMap(([a, b]) => [h('dt', { lang, dir: lang === 'hbo' ? 'rtl' : null }, a), h('dd', b)]));
}

// ---------- letters ----------
function greekLetter([up, lo, name, roman, tr, sound]) {
  const b = h('button.pr-letter.press', { type: 'button', 'aria-label': `${up} ${lo}，${roman}，音譯 ${tr}，${sound}。點一下聽名稱` },
    h('span.pr-glyph', { lang: 'grc', 'aria-hidden': 'true' }, `${up} ${lo}`),
    h('span.pr-name', { 'aria-hidden': 'true' }, roman),
    h('span.pr-tr', { 'aria-hidden': 'true' }, tr),
    h('span.pr-sound', { 'aria-hidden': 'true' }, sound));
  b.addEventListener('click', () => sayWord(b, wordG(name)));
  return b;
}
function hebrewLetter([glyph, fin, , roman, tr, sound, say, heb]) {
  const b = h('button.pr-letter.press', { type: 'button', 'aria-label': `${glyph}${fin ? `，字尾 ${fin}` : ''}，${roman}，音譯 ${tr}，${sound}。點一下聽名稱` },
    h('span.pr-glyph', { lang: 'hbo', dir: 'rtl', 'aria-hidden': 'true' }, glyph),
    fin ? h('span.pr-final', { 'aria-hidden': 'true' }, '字尾 ', h('span', { lang: 'hbo' }, fin)) : null,
    h('span.pr-name', { 'aria-hidden': 'true' }, roman),
    h('span.pr-tr', { 'aria-hidden': 'true' }, tr),
    h('span.pr-sound', { 'aria-hidden': 'true' }, sound));
  b.addEventListener('click', () => sayWord(b, wordH(heb, say)));
  return b;
}

// ---------- worked example ----------
function example(ex, lang) {
  const heb = lang === 'hbo';
  const words = ex.words.map((w) => h('li.pr-ex-word',
    h('div.pr-ex-head',
      h('span.pr-ex-w', { lang, dir: heb ? 'rtl' : null }, w.w),
      h('span.pr-ex-gloss', w.gloss),
      sayBtn(`播放 ${w.read}`, heb ? wordH(w.w, w.say) : wordG(w.w))),
    h('p.pr-step', h('b', '① 字母'), heb ? '（由右往左）' : ''),
    h('ol.pr-parts', { dir: heb ? 'rtl' : 'ltr' },
      ...w.parts.map(([g, t]) => h('li', h('span.pr-part-g', { lang }, g), h('span.pr-part-t', { dir: 'ltr' }, t)))),
    h('p.pr-step', h('b', '② 音節')),
    h('p.pr-syl', { lang, dir: heb ? 'rtl' : null }, w.syl.join(' · ')),
    h('p.pr-step', h('b', '③ 讀音 '), h('span.pr-read', w.read))));
  const go = h('button.pr-go.press', { type: 'button' }, `到${refLabel(ex.ref)} 讀經 →`);
  go.addEventListener('click', () => navigate(ex.ref));
  return [
    h('p.pr-ex-verse', { lang, dir: heb ? 'rtl' : null }, ex.words.map(w => w.w).join(' ')),
    h('p.pr-ex-mean', `${ex.label}「${ex.meaning}……」｜全句讀作：`, h('span.pr-read', ex.whole)),
    h('ol.pr-ex', ...words),
    go,
  ];
}

// ---------- quiz ----------
function quiz(letters, lang, glyphOf, optOf) {
  const box = h('div.pr-quiz');
  const live = h('p.pr-quiz-live', { role: 'status', 'aria-live': 'polite' });
  const score = h('p.pr-quiz-score');
  let right = 0, total = 0, answer = -1;
  const pick = (n, not) => { const s = new Set([not]); while (s.size < n + 1) s.add(Math.floor(Math.random() * letters.length)); s.delete(not); return [...s]; };
  function next() {
    answer = Math.floor(Math.random() * letters.length);
    const opts = [answer, ...pick(3, answer)].sort(() => Math.random() - 0.5);
    const card = h('div.pr-quiz-card', { lang, dir: lang === 'hbo' ? 'rtl' : null, 'data-key': String(answer), 'aria-label': '這是哪個字母？' }, glyphOf(letters[answer]));
    const optsEl = h('div.pr-quiz-opts', { role: 'group', 'aria-label': '選項' }, ...opts.map(k => {
      const b = h('button.pr-opt.press', { type: 'button', 'data-key': String(k) }, optOf(letters[k]));
      b.addEventListener('click', () => choose(b, k, optsEl));
      return b;
    }));
    const nextBtn = h('button.pr-next.press', { type: 'button', hidden: true }, '下一題');
    nextBtn.addEventListener('click', () => { next(); box.querySelector('.pr-opt')?.focus(); });
    box.replaceChildren(card, optsEl, live, score, nextBtn);
    live.textContent = '';
    score.textContent = total ? `答對 ${right} / ${total}` : '點選這個字母的名稱';
  }
  function choose(b, k, optsEl) {
    if (optsEl.dataset.done) return;
    optsEl.dataset.done = '1';
    total++;
    const ok = k === answer;
    if (ok) right++;
    for (const o of optsEl.children) {
      o.disabled = true;
      if (+o.dataset.key === answer) o.classList.add('right');
    }
    if (!ok) b.classList.add('wrong');
    live.textContent = ok ? '答對了！' : `再想想：正確答案是 ${optOf(letters[answer])}`;
    score.textContent = `答對 ${right} / ${total}`;
    const nb = box.querySelector('.pr-next');
    nb.hidden = false;
    nb.focus();
  }
  next();
  return box;
}

// ---------- the two languages ----------
function greekPage() {
  const g = GREEK;
  return [
    h('p.pr-intro', g.intro),
    section('pr-g-alpha', '1. 字母表',
      p('大寫｜小寫，下面是名稱、音譯和讀音。點字母聽名稱。'),
      h('div.pr-grid', ...g.letters.map(greekLetter))),
    section('pr-g-diph', '2. 雙母音',
      p('兩個母音連在一起唸成一個音：'),
      h('dl.pr-rows', ...g.diphthongs.flatMap(([a, tr, s]) => [h('dt', { lang: 'grc' }, a), h('dd', h('i', tr), '　', s)]))),
    section('pr-g-marks', '3. 讀音記號',
      h('dl.pr-rows.pr-marks', ...g.marks.flatMap(([a, n, t]) => [h('dt', { lang: 'grc' }, a), h('dd', h('b', n), '：', t)])),
      h('p.hint', g.breathingNote)),
    section('pr-g-syl', '4. 音節', list(g.syllables)),
    section('pr-g-struct', '5. 字的結構', ...g.structure.map(s => h('div.pr-card', h('h3', s.title), p(s.text), s.rows ? table(s.rows, 'grc') : null))),
    section('pr-g-ex', '6. 實例：一步步拼讀', ...example(g.example, 'grc')),
    section('pr-g-quiz', '7. 字母小測驗', quiz(g.letters, 'grc', (l) => `${l[0]} ${l[1]}`, (l) => `${l[3]}（${l[4]}）`)),
  ];
}

function hebrewPage() {
  const x = HEBREW;
  return [
    h('p.pr-intro', x.intro),
    section('pr-h-rtl', '1. 由右往左', list(x.rtl, 'ul'),
      h('div.pr-rtl-demo', { 'aria-hidden': 'true' },
        h('span.pr-arrow', '←'), h('span', { lang: 'hbo', dir: 'rtl' }, 'בְּרֵאשִׁית בָּרָא אֱלֹהִים'), h('span.pr-arrow', '開始'))),
    section('pr-h-alpha', '2. 子音字母',
      p('22 個子音，從右上開始讀。點字母聽名稱。'),
      h('div.pr-grid.pr-grid-he', { dir: 'rtl' }, ...x.letters.map(hebrewLetter)),
      h('p.hint', x.finals),
      h('h3', '容易看錯的字母'),
      table(x.lookalikes, 'hbo')),
    section('pr-h-dagesh', '3. 字母中的點（dagesh）', ...x.dagesh.map(d => h('div.pr-card', h('h3', d.title), p(d.text)))),
    section('pr-h-vowels', '4. 母音記號（niqqud）',
      p('用 מ（m）示範位置；表中由上到下依 a、e、i、o、u 五類排列。'),
      h('div.pr-vtable', { role: 'table', 'aria-label': '希伯來文母音表' },
        h('div.pr-vrow.pr-vhead', { role: 'row' }, ...['記號', '名稱', '長短', '讀音'].map(t => h('span', { role: 'columnheader' }, t))),
        ...x.vowels.map(([m, n, , len, tr, s]) => h('div.pr-vrow', { role: 'row' },
          h('span.pr-vm', { role: 'cell', lang: 'hbo', dir: 'rtl' }, m),
          h('span', { role: 'cell' }, n),
          h('span', { role: 'cell' }, len),
          h('span', { role: 'cell' }, h('i', tr), ' ', s)))),
      h('p.hint', x.vowelNote),
      h('div.pr-card', h('h3', 'Shewa ְ：唸或不唸？'),
        p(x.shewa.note),
        h('p', h('b', '要唸（有聲）：')), list(x.shewa.vocal, 'ul'),
        h('p', h('b', '不唸（無聲）：')), list(x.shewa.silent, 'ul'))),
    section('pr-h-more', '5. 其他記號', ...x.more.map(m => h('div.pr-card', h('h3', m.title),
      m.sample ? h('p.pr-sample', { lang: 'hbo', dir: 'rtl' }, m.sample) : null, p(m.text)))),
    section('pr-h-syl', '6. 音節', list(x.syllables)),
    section('pr-h-struct', '7. 字的結構', ...x.structure.map(s => h('div.pr-card', h('h3', s.title), p(s.text), s.rows ? table(s.rows, 'hbo') : null))),
    section('pr-h-ex', '8. 實例：一步步拼讀', ...example(x.example, 'hbo')),
    section('pr-h-quiz', '9. 字母小測驗', quiz(x.letters, 'hbo', (l) => l[0].split(' ')[0], (l) => `${l[3]}（${l[4]}）`)),
  ];
}

const PAGES = { grc: { label: '希臘文', native: 'Ἑλληνικά', build: greekPage }, hbo: { label: '希伯來文', native: 'עברית', build: hebrewPage } };

function show(lang) {
  for (const [k, pg] of Object.entries(PAGES)) {
    const on = k === lang;
    pg.tab.setAttribute('aria-selected', String(on));
    pg.tab.tabIndex = on ? 0 : -1;
    pg.panel.hidden = !on;
  }
  try { localStorage.setItem(KEY, lang); } catch {}
}

/** Build once (on first visit to the tab); later visits keep scroll position and quiz state. */
export function renderPrimer() {
  if (built) return;
  built = true;
  const root = $('#primer-body');
  const tabs = h('div.pr-switch', { role: 'tablist', 'aria-label': '選擇語言' });
  const panels = [];
  for (const [k, pg] of Object.entries(PAGES)) {
    pg.tab = h(`button#pr-tab-${k}.press`, { type: 'button', role: 'tab', 'aria-controls': `pr-panel-${k}`, 'data-lang': k },
      h('span', pg.label), h('span.pr-native', { lang: k, dir: k === 'hbo' ? 'rtl' : null }, pg.native));
    pg.tab.addEventListener('click', () => show(k));
    pg.panel = h(`div#pr-panel-${k}.pr-panel`, { role: 'tabpanel', 'aria-labelledby': `pr-tab-${k}`, tabindex: '0' }, ...pg.build());
    tabs.append(pg.tab);
    panels.push(pg.panel);
  }
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const k = $('[aria-selected="true"]', tabs)?.dataset.lang === 'grc' ? 'hbo' : 'grc';
    show(k);
    PAGES[k].tab.focus();
  });
  root.replaceChildren(tabs, ...panels);
  let lang = 'grc';
  try { if (localStorage.getItem(KEY) === 'hbo') lang = 'hbo'; } catch {}
  show(lang);
}
