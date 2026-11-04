// Settings view, about/licence page and bookmarks/notes list.
import { settings, update, THEMES, enabledVersions, secondLineId, setSecondLine } from './settings.js';
import { store, dictInfo, DATA_BASE } from './data.js';
import { h, $ } from './util.js';
import { SHELL_VERSION } from './version.js';

// ---------- settings ----------
export function renderSettings() {
  const root = $('#settings-body');
  const themeRow = h('div.seg', { role: 'radiogroup', 'aria-label': '主題' },
    Object.entries(THEMES).map(([id, t]) => h('button.press', {
      type: 'button', role: 'radio', 'data-theme': id, 'aria-checked': String(settings.theme === id),
      onclick: () => { update({ theme: id }); renderSettings(); },
    }, h('i.sw', { style: `background:${t.color}` }), t.label)));

  const slider = (key, label, min, max, step, fmt) => {
    const out = h('output', fmt(settings[key]));
    const inp = h('input', { type: 'range', min, max, step, value: settings[key], 'aria-label': label, 'data-key': key });
    inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); update({ [key]: +inp.value }); });
    return h('label.slider', h('span', label), inp, out);
  };

  const list = enabledVersions(store.translations);
  const second = secondLineId(store.translations);
  const verRows = h('ol.verlist', list.map((x, i) => {
    const v = store.translations.find(t => t.id === x.id);
    const save = (nl) => { update({ versions: nl }); renderSettings(); };
    const tm = v.testament.length === 1 ? (v.testament[0] === 'NT' ? '新約' : '舊約') : null;
    return h('li', { 'data-ver': x.id },
      h('label.check', h('input', { type: 'checkbox', checked: x.on, onchange: (e) => save(list.map(y => y.id === x.id ? { ...y, on: e.target.checked } : y)) }),
        h('span.vname', h('span', v.name), h('small', [v.abbr, tm, v.tok ? '可點字' : null].filter(Boolean).join(' · ')),
          v.copyright ? h('small.copy', v.copyright) : null)),
      h('span.ord',
        h('button.press', { type: 'button', 'aria-label': `${v.abbr} 上移`, disabled: i === 0, onclick: () => { const nl = [...list]; [nl[i - 1], nl[i]] = [nl[i], nl[i - 1]]; save(nl); } }, '↑'),
        h('button.press', { type: 'button', 'aria-label': `${v.abbr} 下移`, disabled: i === list.length - 1, onclick: () => { const nl = [...list]; [nl[i + 1], nl[i]] = [nl[i], nl[i + 1]]; save(nl); } }, '↓')));
  }));
  const secondRow = second ? (() => {
    const v = store.translations.find(t => t.id === second);
    const on = list.findIndex(x => x.id === second && x.on);
    return h('label.toggle',
      h('span', `顯示${v.abbr.replace(/本$/, '')}本第二行`, h('small', `在第一個譯本下方加一行${v.name}${v.tok ? '（可點字對照原文）' : ''}`)),
      h('input', { type: 'checkbox', role: 'switch', 'data-key': 'secondLine', checked: on >= 0, onchange: (e) => { setSecondLine(store.translations, e.target.checked); renderSettings(); } }));
  })() : null;

  const toggle = (key, label, desc) => h('label.toggle',
    h('span', label, h('small', desc)),
    h('input', { type: 'checkbox', role: 'switch', checked: !!settings[key], 'data-key': key, onchange: (e) => update({ [key]: e.target.checked }) }));

  root.replaceChildren(
    h('h2', '外觀'), themeRow,
    slider('fontSize', '字級', 14, 28, 1, v => `${v}px`),
    slider('lineHeight', '行距', 1.3, 2.4, 0.05, v => v.toFixed(2)),
    h('p.preview', h('span', { lang: 'grc' }, 'Οὕτως γὰρ ἠγάπησεν ὁ θεὸς τὸν κόσμον'), h('br'), '神愛世人，甚至將他的獨生子賜給他們'),
    h('h2', '原文行'),
    toggle('showStrong', '小字 Strong 編號', '在每個原文字下方顯示'),
    toggle('showMorph', '小字詞形', '在每個原文字下方顯示詞形代碼'),
    toggle('hebAccents', '希伯來文重音符號', '關閉時只顯示子音和母音（cantillation 隱藏）'),
    h('h2', '譯本（勾選與排序）'), secondRow, verRows,
    h('h2', '其他'),
    h('button.row.press', { type: 'button', onclick: openAbout }, '關於與授權', h('span', '›')),
  );
}

// ---------- about / licences ----------
function openAbout() {
  const m = store.manifest || {};
  const panel = h('section.subpage', { role: 'dialog', 'aria-label': '關於與授權' },
    h('header.viewhead', h('button.linkbtn.press', { type: 'button', onclick: () => { panel.classList.remove('open'); setTimeout(() => panel.remove(), 320); } }, '‹ 設定'), h('h1', '關於與授權')),
    h('div.settings',
      h('p', '原文對照聖經 PWA：新約希臘文、舊約希伯來文。讀過的章節會留在這台裝置，沒有網路時也能閱讀。'),
      h('h2', '經文與資料'),
      h('ul.lic', store.versions.map(v => h('li',
        h('b', `${v.name}（${v.abbr}）`), h('small', ` ${v.lang}${v.size ? ` · ${(v.size / 1024 / 1024).toFixed(1)} MB` : ''}`),
        h('div', '授權：', v.license.url ? h('a', { href: v.license.url, target: '_blank', rel: 'noopener' }, v.license.name) : v.license.name,
          v.license.file ? [' · ', h('a', { href: new URL(v.license.file, DATA_BASE).href, target: '_blank' }, '授權全文')] : null),
        v.license.note ? h('div.attr', v.license.note) : null,
        v.copyright ? h('div.attr', '著作權：', v.copyright) : null,
        v.attribution ? h('div.attr', v.attribution) : null,
        v.source_url ? h('div.attr', '來源：', h('a', { href: v.source_url, target: '_blank', rel: 'noopener' }, v.source_url)) : null))),
      [...['G', 'H'].map(k => dictInfo(k)), ...['G', 'H'].map(k => m.dict_zh?.[k]), ...Object.values(m.syntax || {})].filter(Boolean)
        .filter((d, i, a) => a.findIndex(x => (x.name || x.attribution) === (d.name || d.attribution)) === i).map(d => h('div.lic',
        h('b', d.name || '字典'), d.license ? h('div', '授權：', normLic(d.license)) : null,
        (d.attribution || d.license?.attribution) ? h('div.attr', d.attribution || d.license.attribution) : null)),
      m.fixture ? h('p.notice', '目前載入的是開發用 fixture 資料。') : null,
      h('h2', '字型'),
      h('p', 'IL Greek：Gentium Plus 6.200 的希臘文子集；IL Hebrew：Ezra SIL 2.51 的希伯來文子集（含母音與重音符號）。兩者皆為 SIL International 製作，依 SIL Open Font License 1.1 授權（Ezra SIL 的希伯來文排版規則另依 MIT 授權）；詳見 ', h('a', { href: 'fonts/LICENSE', target: '_blank' }, 'fonts/LICENSE'), '。中文使用系統襯線字型。'),
      h('h2', '技術資訊'),
      h('p.small', `App 版本 ${SHELL_VERSION} · 資料目錄 ${DATA_BASE}`)));
  document.body.append(panel);
  requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('open')));
}
const normLic = (l) => typeof l === 'string' ? l : (l.url ? h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.name) : l.name);
