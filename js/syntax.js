// Syntax view: collapsible, indented clause tree with role colours (主詞／動詞／受詞／補語／狀語).
// Data → view goes through an adapter so the on-disk format can change without touching the UI.
// Internal node: {cat, role, kids:[…]} | leaf {leaf:true, w (our word index) | null, p (morpheme) | null, x (text), role}
import { syntaxChapter, syntaxInfo } from './data.js';
import { h } from './util.js';

// ---------- adapters ----------
export const adapters = {
  /** DATA_FORMAT.md §8.1 (MACULA lowfat projected per verse): verse {n, k:[…], un:[…]} */
  'macula-v1': {
    verses(json) { return new Map((json?.verses || []).map(v => [v.n, v])); },
    tree(v) {
      const conv = (o) => ('w' in o || 'x' in o)
        ? { leaf: true, w: Number.isInteger(o.w) ? o.w : null, p: Number.isInteger(o.p) ? o.p : null, x: o.x || '', role: o.r || null, unmatched: !!o.u }
        : { cat: o.c || null, role: o.r || null, kids: (o.k || []).map(conv) };
      return { roots: (v.k || []).map(conv), unplaced: v.un || [] };
    },
  },
  /** Early draft format (task brief): {verses:{"16":{t:{cat,role,c:[…],w:[i]}}}} */
  'draft-v0': {
    verses(json) { return new Map(Object.entries(json?.verses || {}).map(([n, v]) => [+n, v])); },
    tree(v) {
      const conv = (o) => {
        const kids = (o.c || []).map(conv);
        for (const i of o.w || []) kids.push({ leaf: true, w: i, p: null, x: '', role: null });
        if (!o.c && (o.w || []).length === 1) return { ...kids[0], role: o.role || null };
        return { cat: o.cat || null, role: o.role || null, kids };
      };
      return { roots: [conv(v.t)], unplaced: [] };
    },
  },
};
export function pickAdapter(json) {
  return Array.isArray(json?.verses) ? adapters['macula-v1'] : adapters['draft-v0'];
}

/** Load one verse's tree: {roots, unplaced} or null. */
export async function verseTree(lang, book, ch, n) {
  const json = await syntaxChapter(lang, book, ch);
  if (!json) return null;
  const ad = pickAdapter(json);
  const v = ad.verses(json).get(n);
  return v ? ad.tree(v) : null;
}

// ---------- labels ----------
const ROLE_FALLBACK = { s: '主詞', v: '動詞', vc: '繫動詞', o: '受詞', o2: '第二受詞', io: '間接受詞', p: '補語', adv: '狀語', pp: '狀語', aux: '助詞' };
const CAT_FALLBACK = { cl: '子句', np: '名詞片語', pp: '介系詞片語', vp: '動詞片語', advp: '副詞片語', adv: '副詞片語', adjp: '形容詞片語', nump: '數詞片語', relp: '關係詞片語', cjp: '連接詞片語', ijp: '感嘆詞片語' };
// colour group per role (CSS: [data-rg])
const GROUP = { s: 's', v: 'v', vc: 'v', o: 'o', o2: 'o', io: 'o', p: 'p', adv: 'a', pp: 'a', aux: 'x' };
const LEGEND = [['s', '主詞'], ['v', '動詞'], ['o', '受詞'], ['p', '補語'], ['a', '狀語／修飾']];

/**
 * Render a tree. opts: {lang, words (verse w[]), focus (word index to mark), onWord(i)}
 */
export function renderTree(tree, { lang = 'grc', words = [], focus = null, onWord, labels = {} } = {}) {
  const roles = { ...ROLE_FALLBACK, ...(labels.roles || {}) };
  const cats = { ...CAT_FALLBACK, ...(labels.cats || {}) };
  const rtl = lang === 'hbo';
  const wordText = (leaf) => {
    if (leaf.w == null) return leaf.x || '∅';
    const w = words[leaf.w];
    if (!w) return `#${leaf.w}`;
    if (leaf.p != null) { const parts = String(w.l || '').split('+'); if (parts.length > 1 && parts[leaf.p]) return parts[leaf.p]; }
    return w.t.replace(/[¶]/g, '');
  };
  const leafGloss = (leaf) => {
    const w = words[leaf.w];
    if (!w?.g) return '';
    const parts = String(w.g).split('/');
    return (leaf.p != null && parts.length > 1 ? parts[leaf.p] : w.g).trim();
  };
  const leaves = (n) => n.leaf ? [n] : n.kids.flatMap(leaves);
  const preview = (n) => leaves(n).map(wordText).join(' ');

  let uid = 0;
  const build = (n, depth) => {
    const rg = GROUP[n.role] || null;
    if (n.leaf) {
      return h('li.syn-leaf', { role: 'treeitem', 'data-rg': rg, 'data-w': n.w ?? '', class: `syn-leaf${n.w === focus && focus != null ? ' on' : ''}${n.unmatched ? ' um' : ''}` },
        n.role ? h('span.syn-role', roles[n.role] || n.role) : null,
        h('button.syn-word.press', { type: 'button', lang, dir: rtl ? 'rtl' : null, disabled: n.w == null, 'data-w': n.w ?? '' }, wordText(n)),
        leafGloss(n) ? h('small.syn-gloss', leafGloss(n)) : null);
    }
    const id = `syn-g${++uid}`;
    const group = h('ul.syn-kids', { role: 'group', id }, n.kids.map(k => build(k, depth + 1)));
    return h('li.syn-node', { role: 'treeitem', 'aria-expanded': 'true', 'data-rg': rg, 'data-cat': n.cat || '' },
      h('div.syn-row',
        h('button.syn-tog.press', { type: 'button', 'aria-controls': id, 'aria-label': '收合／展開' }, h('i', { 'aria-hidden': 'true' })),
        n.role ? h('span.syn-role', roles[n.role] || n.role) : null,
        h('span.syn-cat', n.cat ? (cats[n.cat] || n.cat) : '片段'),
        h('span.syn-prev', { lang, dir: rtl ? 'rtl' : null }, preview(n))),
      group);
  };

  const root = h('div.syn', { 'data-lang': lang },
    h('div.syn-bar',
      h('div.syn-legend', { 'aria-label': '顏色說明' }, LEGEND.map(([g, t]) => h('span', { 'data-rg': g }, t))),
      h('button.linkbtn.press.syn-all', { type: 'button' }, '全部收合')),
    h('ul.syn-tree', { role: 'tree', 'aria-label': '句法樹' }, tree.roots.map(r => build(r, 0))),
    tree.unplaced?.length ? h('p.hint', '未對上句法樹的字：', h('span', { lang }, tree.unplaced.map(i => words[i]?.t || `#${i}`).join(' '))) : null);

  const setOpen = (li, open) => {
    li.setAttribute('aria-expanded', String(open));
    li.querySelector(':scope > .syn-kids').hidden = !open;
  };
  root.addEventListener('click', (e) => {
    const tog = e.target.closest('.syn-tog, .syn-row');
    if (tog && !e.target.closest('.syn-word')) {
      const li = tog.closest('.syn-node');
      setOpen(li, li.getAttribute('aria-expanded') !== 'true');
      return;
    }
    const all = e.target.closest('.syn-all');
    if (all) {
      const collapse = all.textContent === '全部收合';
      // keep the top level open so the outline stays readable
      root.querySelectorAll('.syn-node').forEach(li => setOpen(li, !collapse || li.parentElement.classList.contains('syn-tree')));
      all.textContent = collapse ? '全部展開' : '全部收合';
      return;
    }
    const wb = e.target.closest('.syn-word');
    if (wb && wb.dataset.w !== '') {
      const i = +wb.dataset.w;
      root.querySelectorAll('.syn-leaf.on').forEach(x => x.classList.remove('on'));
      root.querySelectorAll(`.syn-leaf[data-w="${i}"]`).forEach(x => x.classList.add('on'));
      onWord?.(i);
    }
  });
  return root;
}

/** Load + render, or a friendly message when there is no syntax data. */
export async function syntaxView({ lang, book, ch, n, words, focus, onWord }) {
  const info = syntaxInfo(lang);
  if (!info) return h('p.hint', '這個資料目錄沒有句法資料（MACULA）。');
  let tree = null;
  try { tree = await verseTree(lang, book, ch, n); } catch {}
  if (!tree || !tree.roots.length) return h('p.hint', '這一節沒有句法資料（或目前離線，這一章的句法還沒讀過）。');
  const view = renderTree(tree, { lang, words, focus, onWord, labels: { roles: info.roles, cats: info.cats } });
  if (info.attribution) view.append(h('p.syn-attr', info.attribution));
  return view;
}
