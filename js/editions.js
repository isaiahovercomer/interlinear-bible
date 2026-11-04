// Original-language text editions, lexicons and morphology actually used by the data build.
// Verified against the STEPBible-Data file headers (commit 5de0a47) — see DATA_SOURCES.md §1, §2, §2a, §5c.
// Version names only (no licence text); everything is rendered with h() / textContent.
export const EDITIONS = {
  grc: {
    label: '希臘文新約',
    short: 'NA28',
    name: 'Nestle-Aland 第 28 版（NA28）',
    note: 'NA28 未收的少數經節（如羅 16:24）採 Scrivener 1894 公認經文（TR）',
    via: 'STEPBible TAGNT',
    lex: 'Abbott-Smith 希臘文字典',
    lexShort: 'Abbott-Smith',
    lexVia: 'TBESG',
    morph: 'TAGNT 詞形',
  },
  hbo: {
    label: '希伯來文舊約',
    short: '列寧格勒抄本',
    name: '列寧格勒抄本（Leningrad Codex）',
    note: '依 WLC 4.20 與 BHS 校訂，採 Qere 讀法',
    via: 'STEPBible TAHOT',
    lex: 'BDB 希伯來文字典（節本）',
    lexShort: 'BDB',
    lexVia: 'TBESH',
    morph: 'ETCBC 詞形',
  },
};
export const ZH_LEX = 'CBOL 中文 Strong 字典（信望愛）';
export const STRONG_SCHEME = 'Extended Strong 編號（STEPBible）';

export const edFor = (lang) => EDITIONS[lang === 'hbo' ? 'hbo' : 'grc'];
/** One-line caption for a chapter's original text, e.g. 「原文：Nestle-Aland 第 28 版（NA28）」. */
export const chapterCaption = (lang) => `原文：${edFor(lang).name}`;
