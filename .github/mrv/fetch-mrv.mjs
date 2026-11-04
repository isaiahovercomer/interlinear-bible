#!/usr/bin/env node
// 抓台北召會追求進度（週別）＋淡水會所晨興聖言（每天經文）→ morning-revival.json。
// 用法：node fetch-mrv.mjs <輸出檔> [--books <books.js 路徑>]
// 只在內容有變化時才寫檔；兩邊都抓不到時不改檔（exit 1）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseTaipei, parseTamsui, merge, sameContent, taipeiToday } from './mrv-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outFile = resolve(args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--books') || 'morning-revival.json');
const bi = args.indexOf('--books');
const bookCands = [bi >= 0 ? resolve(args[bi + 1]) : null, resolve(here, '../../app/js/books.js'), resolve(here, '../../js/books.js')].filter(Boolean);
const booksPath = bookCands.find(p => existsSync(p));
if (!booksPath) { console.error('找不到 books.js'); process.exit(2); }
const { BOOKS } = await import(pathToFileURL(booksPath).href);

const TAIPEI = 'https://www.churchintaipei.org/pursuit';
const TAMSUI = 'https://churchintamsui.wixsite.com/index/morning-revival';
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (interlinear-bible morning-revival bot)' }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.text();
      console.warn(`${url} → HTTP ${r.status}`);
    } catch (e) { console.warn(`${url} → ${e.message}`); }
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

const today = taipeiToday().date;
const [tpHtml, tsHtml] = await Promise.all([get(TAIPEI), get(TAMSUI)]);
let tp = null, ts = null;
try { tp = tpHtml && parseTaipei(tpHtml, today); } catch (e) { console.warn('台北解析失敗', e.message); }
try { ts = tsHtml && parseTamsui(tsHtml, BOOKS); } catch (e) { console.warn('淡水解析失敗', e.message); }
if (ts && !Object.values(ts.days).some(d => d.length)) { console.warn('淡水頁沒有解析出經文'); ts = null; }
console.log('台北：', tp ? `${tp.range} ${tp.week}` : '失敗', '｜淡水：', ts ? `${ts.week} ${ts.weekTitle}` : '失敗');
if (!tp && !ts) { console.error('兩個來源都抓不到，不改檔'); process.exit(1); }

let prev = null;
try { prev = JSON.parse(readFileSync(outFile, 'utf8')); } catch {}
const next = merge(prev, tp, ts);
for (const w of next.meta.warnings) console.warn('警告：', w);
for (const d of next.meta.diff) console.warn('差異：', d);
if (prev && sameContent(prev, next)) { console.log('沒有變化'); process.exit(0); }
writeFileSync(outFile, JSON.stringify(next, null, 1) + '\n');
console.log('已更新', outFile);
