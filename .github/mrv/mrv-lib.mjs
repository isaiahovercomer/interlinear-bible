// 今日晨興聖言經文：解析台北召會「共同追求進度」(週別與日期) 與淡水會所「晨興聖言」(每天經文)。
// 純函式，沒有外部依賴；fetch-mrv.mjs 負責抓網頁與寫檔，tests/mrv-lib.test.mjs 用範本測試。

const ZH_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 中文數字 → 數字：五、十二、二一（逐位）、一百五十 */
export function zhNum(s) {
  if (!s) return NaN;
  if (/^\d+$/.test(s)) return +s;
  if (!/[十百]/.test(s)) return +[...s].map(c => ZH_DIGIT[c] ?? NaN).join('');
  let total = 0, cur = 0;
  for (const c of s) {
    if (c in ZH_DIGIT) cur = ZH_DIGIT[c];
    else if (c === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (c === '百') { total += (cur || 1) * 100; cur = 0; }
    else return NaN;
  }
  return total + cur;
}

/** HTML → 純文字行（去 script/style、標籤換行、解 entity）。 */
export function htmlToLines(html) {
  const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', bull: '•', middot: '·' };
  const t = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ent[n.toLowerCase()] ?? m);
  return t.split('\n').map(l => l.replace(/[\u200b\u00a0\s]+/g, ' ').trim()).filter(Boolean);
}

const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const NUMS = '〇零一二兩三四五六七八九十百';

/** books: [{id, abbr, zh, chapters}] → 由長到短的名稱表 */
export function bookTable(books) {
  const names = [];
  for (const b of books) {
    for (const n of new Set([b.abbr, b.zh, b.abbr.replace('啟', '啓'), b.zh.replace('啟', '啓')])) names.push([n, b]);
  }
  return names.sort((a, b) => b[0].length - a[0].length);
}

/**
 * 一行經文引用「加四22～24『…』」「來十二22～23『…』」「加26 『…』」→ {label, book, ch, v, v2?} 或 null。
 * prevCh: 同一天前一處的 {book→ch}，用來補「加26」這種缺章的錯字。
 */
export function parseRefLine(line, table, prevCh, warn = () => {}) {
  const m = /^(.+?)\s*『/.exec(line);
  if (!m) return null;
  const head = m[1].replace(/\s+/g, '');
  const hit = table.find(([n]) => head.startsWith(n));
  if (!hit) return null;
  const [name, b] = hit;
  const rest = head.slice(name.length);
  const r = new RegExp(`^([${NUMS}]*)(\\d+)(上|下)?(?:[～~\\-–至](\\d+)(上|下)?)?(.*)$`).exec(rest);
  if (!r) return null;
  let ch = r[1] ? zhNum(r[1]) : NaN;
  const v = +r[2];
  const v2 = r[4] ? +r[4] : undefined;
  if (!r[1]) {
    if (b.chapters === 1) ch = 1;
    else if (prevCh[b.id]) { warn(`「${head}」缺章數，沿用同一天前一處的第 ${prevCh[b.id]} 章`); ch = prevCh[b.id]; }
    else { warn(`「${head}」缺章數，無法判定，略過`); return null; }
  }
  if (!Number.isFinite(ch) || ch < 1 || ch > b.chapters) { warn(`「${head}」章數不合理，略過`); return null; }
  prevCh[b.id] = ch;
  const label = r[1] ? head : `${name}${chZh(ch)}${rest}`;
  return { label, book: b.id, ch, v, ...(v2 && v2 > v ? { v2 } : {}) };
}

/** 數字 → 恢復本式中文章數：4→四、12→十二、21→二一、119→一一九 */
export function chZh(n) {
  const d = '〇一二三四五六七八九';
  if (n < 10) return d[n];
  if (n < 20) return '十' + (n % 10 ? d[n % 10] : '');
  if (n % 10 === 0 && n < 100) return d[n / 10] + '十';
  return String(n).split('').map(c => d[+c]).join('');
}

/** 淡水會所「晨興聖言」頁 → {training, week, weekNo, weekTitle, days:{1..6:[ref]}, warnings} */
export function parseTamsui(html, books) {
  const lines = htmlToLines(html);
  const table = bookTable(books);
  const warnings = [];
  const out = { training: '', week: '', weekNo: 0, weekTitle: '', days: {}, warnings };
  const wi = lines.findIndex(l => /^第[一二三四五六七八九十]+週[、，,\s]/.test(l));
  if (wi >= 0) {
    const wm = /^(第([一二三四五六七八九十]+)週)[、，,\s]*(.*)$/.exec(lines[wi]);
    out.week = wm[1]; out.weekNo = zhNum(wm[2]); out.weekTitle = wm[3].trim();
    for (let k = wi - 1; k >= Math.max(0, wi - 4); k--) if (/訓練|特會|』/.test(lines[k])) { out.training = lines[k]; break; }
  }
  for (let i = 0; i < lines.length; i++) {
    const dm = /^第([一二三四五六七八九十]+)週\s*[•·・．.]\s*週\s*([一二三四五六])$/.exec(lines[i]);
    if (!dm) continue;
    if (!out.weekNo) { out.weekNo = zhNum(dm[1]); out.week = `第${dm[1]}週`; }
    const day = WEEKDAY[dm[2]];
    const refs = []; const prev = {};
    let j = i + 1;
    while (j < lines.length && !/『/.test(lines[j]) && j < i + 4) j++; // 跳過「晨興餧養」
    for (; j < lines.length; j++) {
      if (!/『/.test(lines[j])) break;
      const r = parseRefLine(lines[j], table, prev, (w) => warnings.push(`週${dm[2]}：${w}`));
      if (r) refs.push(r);
      else if (/^[^『]{1,12}『/.test(lines[j])) warnings.push(`週${dm[2]}：無法解析「${lines[j].slice(0, 20)}」`);
    }
    out.days[day] = refs;
  }
  return out;
}

/** 台北召會「共同追求進度」頁 → {range:'11/2～11/8', week:'第三週', weekNo, title, start, end}（start/end 為 YYYY-MM-DD） */
export function parseTaipei(html, today) {
  const li = /<li[^>]*class="[^"]*pursuit-week[^"]*is-current[^"]*"[^>]*>([\s\S]*?)<\/li>/.exec(html);
  if (!li) return null;
  const range = /pursuit-week-range[^>]*>\s*([0-9]{1,2})\/([0-9]{1,2})\s*[～~\-–]\s*([0-9]{1,2})\/([0-9]{1,2})/.exec(li[1]);
  const strong = /<strong[^>]*>([\s\S]*?)<\/strong>/.exec(li[1]);
  if (!range || !strong) return null;
  const title = htmlToLines(strong[1]).join(' ');
  const wk = /第([一二三四五六七八九十]+)週/.exec(title);
  const start = nearestDate(+range[1], +range[2], today);
  const end = nearestDate(+range[3], +range[4], start);
  return { range: `${+range[1]}/${+range[2]}～${+range[3]}/${+range[4]}`, title: title.replace(/\s+/g, ' ').trim(), week: wk ? wk[0] : '', weekNo: wk ? zhNum(wk[1]) : 0, start, end };
}

/** 月/日 → 離 ref（YYYY-MM-DD）最近的那一年的日期 */
export function nearestDate(mo, d, ref) {
  const y = +ref.slice(0, 4);
  const base = Date.parse(ref + 'T00:00:00Z');
  let best = null;
  for (const yy of [y - 1, y, y + 1]) {
    const t = Date.UTC(yy, mo - 1, d);
    if (!best || Math.abs(t - base) < Math.abs(best - base)) best = t;
  }
  return new Date(best).toISOString().slice(0, 10);
}

/** 台北時間的今天 YYYY-MM-DD 與星期（0=主日） */
export function taipeiToday(now = new Date()) {
  const t = new Date(now.getTime() + 8 * 3600e3);
  return { date: t.toISOString().slice(0, 10), dow: t.getUTCDay() };
}
export const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/** 簡單穩定雜湊（FNV-1a） */
export function hash(s) {
  let h = 0x811c9dc5;
  for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/**
 * 合併成新的 morning-revival.json。
 * prev: 舊 json 或 null；tp: parseTaipei 結果或 null；ts: parseTamsui 結果或 null。
 * 台北決定週別與日期；淡水提供每天經文。兩邊週別不同 → 以台北為準，不把淡水的經文套到台北那週，差異記在 meta。
 */
export function merge(prev, tp, ts, now = new Date()) {
  const { date: today, dow } = taipeiToday(now);
  const weeks = [...(prev?.weeks || [])];
  const haveTs = ts && Object.values(ts.days).some(d => d.length);
  const meta = {
    primary: 'https://www.churchintaipei.org/pursuit',
    fallback: 'https://churchintamsui.wixsite.com/index/morning-revival',
    taipei: tp ? { ok: true, range: tp.range, week: tp.week, title: tp.title } : { ok: false },
    tamsui: haveTs ? { ok: true, week: ts.week, weekTitle: ts.weekTitle } : { ok: false },
    match: null, diff: [], warnings: haveTs ? ts.warnings : [],
  };
  let entry = null;
  if (tp) {
    if (haveTs && ts.weekNo === tp.weekNo) {
      meta.match = true;
    } else if (haveTs) {
      meta.match = false;
      meta.diff.push(`週別不同：台北 ${tp.week}（${tp.range}），淡水 ${ts.week}；以台北為準，淡水經文未套用`);
    }
    entry = { weekStart: tp.start, week: tp.week, weekTitle: meta.match ? ts.weekTitle : '', training: meta.match ? ts.training : tp.title, days: meta.match ? ts.days : {}, by: meta.match ? 'taipei+tamsui' : 'taipei' };
  } else if (haveTs) {
    // 台北抓不到：用淡水內容指紋判斷換週（主日偵測到 → 視為下週一開始）
    const h = hash(JSON.stringify([ts.week, ts.days]));
    const same = weeks.find(w => w.hash === h);
    const monday = addDays(today, dow === 0 ? 1 : 1 - dow);
    entry = same ? null : { weekStart: monday, week: ts.week, weekTitle: ts.weekTitle, training: ts.training, days: ts.days, by: 'tamsui' };
  }
  if (entry) {
    entry.hash = hash(JSON.stringify([entry.week, entry.days]));
    const i = weeks.findIndex(w => w.weekStart === entry.weekStart);
    // 台北換週但淡水還沒更新：不要用空的覆蓋已有經文
    if (i >= 0 && !Object.keys(entry.days).length && Object.keys(weeks[i].days || {}).length) entry = null;
    else if (i >= 0) weeks[i] = entry; else weeks.push(entry);
  }
  weeks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  return { version: 1, weeks: weeks.slice(0, 3), meta };
}

/** 內容是否有實質變化（忽略 checkedAt） */
export const sameContent = (a, b) => JSON.stringify({ ...a, checkedAt: 0 }) === JSON.stringify({ ...b, checkedAt: 0 });
