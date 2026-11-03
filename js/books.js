// Canonical book table: OSIS id, 繁中全名, 繁中縮寫, English name, extra aliases.
// books.json from the data pipeline supplies chapter counts; names live here so the
// jump parser works even if books.json only carries ids.
const RAW = [
  // OT
  ['Gen', '創世記', '創', 'Genesis', 'gn ge'],
  ['Exod', '出埃及記', '出', 'Exodus', 'ex exo'],
  ['Lev', '利未記', '利', 'Leviticus', 'lv le'],
  ['Num', '民數記', '民', 'Numbers', 'nm nu'],
  ['Deut', '申命記', '申', 'Deuteronomy', 'dt de'],
  ['Josh', '約書亞記', '書', 'Joshua', 'jos'],
  ['Judg', '士師記', '士', 'Judges', 'jdg jg'],
  ['Ruth', '路得記', '得', 'Ruth', 'ru rt'],
  ['1Sam', '撒母耳記上', '撒上', '1 Samuel', '1sa 1sm'],
  ['2Sam', '撒母耳記下', '撒下', '2 Samuel', '2sa 2sm'],
  ['1Kgs', '列王紀上', '王上', '1 Kings', '1ki 1kgs 1kg'],
  ['2Kgs', '列王紀下', '王下', '2 Kings', '2ki 2kgs 2kg'],
  ['1Chr', '歷代志上', '代上', '1 Chronicles', '1ch 1chr'],
  ['2Chr', '歷代志下', '代下', '2 Chronicles', '2ch 2chr'],
  ['Ezra', '以斯拉記', '拉', 'Ezra', 'ezr'],
  ['Neh', '尼希米記', '尼', 'Nehemiah', 'ne'],
  ['Esth', '以斯帖記', '斯', 'Esther', 'est es'],
  ['Job', '約伯記', '伯', 'Job', 'jb'],
  ['Ps', '詩篇', '詩', 'Psalms', 'psa psalm pss'],
  ['Prov', '箴言', '箴', 'Proverbs', 'pr pro prv'],
  ['Eccl', '傳道書', '傳', 'Ecclesiastes', 'ecc ec qoh'],
  ['Song', '雅歌', '歌', 'Song of Songs', 'sos so canticles songofsolomon'],
  ['Isa', '以賽亞書', '賽', 'Isaiah', 'is'],
  ['Jer', '耶利米書', '耶', 'Jeremiah', 'je jr'],
  ['Lam', '耶利米哀歌', '哀', 'Lamentations', 'la'],
  ['Ezek', '以西結書', '結', 'Ezekiel', 'eze ezk'],
  ['Dan', '但以理書', '但', 'Daniel', 'da dn'],
  ['Hos', '何西阿書', '何', 'Hosea', 'ho'],
  ['Joel', '約珥書', '珥', 'Joel', 'jl'],
  ['Amos', '阿摩司書', '摩', 'Amos', 'am'],
  ['Obad', '俄巴底亞書', '俄', 'Obadiah', 'ob'],
  ['Jonah', '約拿書', '拿', 'Jonah', 'jon jnh'],
  ['Mic', '彌迦書', '彌', 'Micah', 'mi'],
  ['Nah', '那鴻書', '鴻', 'Nahum', 'na'],
  ['Hab', '哈巴谷書', '哈', 'Habakkuk', 'hb'],
  ['Zeph', '西番雅書', '番', 'Zephaniah', 'zep zp'],
  ['Hag', '哈該書', '該', 'Haggai', 'hg'],
  ['Zech', '撒迦利亞書', '亞', 'Zechariah', 'zec zc'],
  ['Mal', '瑪拉基書', '瑪', 'Malachi', 'ml'],
  // NT
  ['Matt', '馬太福音', '太', 'Matthew', 'mt mat'],
  ['Mark', '馬可福音', '可', 'Mark', 'mk mr mrk'],
  ['Luke', '路加福音', '路', 'Luke', 'lk luk'],
  ['John', '約翰福音', '約', 'John', 'jn jhn joh'],
  ['Acts', '使徒行傳', '徒', 'Acts', 'ac act'],
  ['Rom', '羅馬書', '羅', 'Romans', 'ro rm'],
  ['1Cor', '哥林多前書', '林前', '1 Corinthians', '1co'],
  ['2Cor', '哥林多後書', '林後', '2 Corinthians', '2co'],
  ['Gal', '加拉太書', '加', 'Galatians', 'ga'],
  ['Eph', '以弗所書', '弗', 'Ephesians', 'ep'],
  ['Phil', '腓立比書', '腓', 'Philippians', 'php pp'],
  ['Col', '歌羅西書', '西', 'Colossians', 'co'],
  ['1Thess', '帖撒羅尼迦前書', '帖前', '1 Thessalonians', '1th 1thes'],
  ['2Thess', '帖撒羅尼迦後書', '帖後', '2 Thessalonians', '2th 2thes'],
  ['1Tim', '提摩太前書', '提前', '1 Timothy', '1ti 1tm'],
  ['2Tim', '提摩太後書', '提後', '2 Timothy', '2ti 2tm'],
  ['Titus', '提多書', '多', 'Titus', 'tit ti'],
  ['Phlm', '腓利門書', '門', 'Philemon', 'phm philem'],
  ['Heb', '希伯來書', '來', 'Hebrews', 'he'],
  ['Jas', '雅各書', '雅', 'James', 'jm ja jam'],
  ['1Pet', '彼得前書', '彼前', '1 Peter', '1pe 1pt 1p'],
  ['2Pet', '彼得後書', '彼後', '2 Peter', '2pe 2pt 2p'],
  // 約翰書信顯示和合本慣用的「約壹／約貳／約參」。「約一／約二／約三」是弱別名，
  // 見 ref.js 和 DESIGN 決策 6 註記（「約三16」= 約翰福音 3:16）。
  ['1John', '約翰一書', '約壹', '1 John', '1jn 1jo 1jhn 約一書 約壹書 約一'],
  ['2John', '約翰二書', '約貳', '2 John', '2jn 2jo 2jhn 約二書 約貳書 約二'],
  ['3John', '約翰三書', '約參', '3 John', '3jn 3jo 3jhn 約三書 約參書 約三'],
  ['Jude', '猶大書', '猶', 'Jude', 'jud jd'],
  ['Rev', '啟示錄', '啟', 'Revelation', 're rv apoc'],
];

// Default chapter counts (Protestant canon); books.json overrides.
const CHAPTERS = [50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4,
  28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22];

export const BOOKS = RAW.map(([id, zh, abbr, en, alias], i) => ({
  id, zh, abbr, en, alias: alias.split(' '), testament: i < 39 ? 'OT' : 'NT', chapters: CHAPTERS[i], order: i,
}));
export const BOOK = Object.fromEntries(BOOKS.map(b => [b.id, b]));

// Merge pipeline books.json (array or {books:[...]}) — tolerant of field names.
export function mergeBooks(json) {
  const list = Array.isArray(json) ? json : (json?.books || []);
  for (const raw of list) {
    const id = raw.id || raw.osis || raw.book || raw.code;
    const b = BOOK[id];
    if (!b) continue;
    const ch = raw.chapters ?? raw.ch ?? raw.chapterCount;
    if (Number.isFinite(+ch) && +ch > 0) b.chapters = +ch;
    if (raw.zh || raw.name_zh || raw.nameZh) b.zh = raw.zh || raw.name_zh || raw.nameZh;
    const vc = raw.vc || raw.verses; // optional per-chapter verse counts
    if (Array.isArray(vc)) b.verses = vc;
    // zhAbbr from the pipeline is only an alias here: display keeps 和合本 abbreviations (約壹…)
    b.extraAliases = [...(raw.aliases || []), raw.zhAbbr, raw.usfm].filter(Boolean);
  }
}

export const bookName = (id) => BOOK[id]?.zh || id;
