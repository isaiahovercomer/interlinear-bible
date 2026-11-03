// Search worker (module worker). Keeps keyword matching off the UI thread.
// in:  {type:'search', qid, q, script, mode:'exact'|'fuzzy', sources:[descriptor], limit}
//      {type:'cancel'}
// out: {type:'progress', qid, done, total, label}
//      {type:'hits', qid, group, hits:[{key, text, range, abbr, src, lang, dir}], counts}
//      {type:'done', qid, counts, ms}
import { fromDescriptor } from './search-sources.js';
import { keyFor, locate, nfc } from './normalize.js';

let current = 0;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'cancel') { current = 0; return; }
  if (m.type === 'search') { current = m.qid; run(m).catch(err => post({ type: 'error', qid: m.qid, message: String(err?.message || err) })); }
};
const post = (m) => self.postMessage(m);

async function run({ qid, q, script, mode, sources, limit = 1000 }) {
  const t0 = Date.now();
  const fuzzy = mode === 'fuzzy';
  const needle = keyFor(script, mode, q);
  const counts = { orig: 0, zh: 0, en: 0 };
  if (!needle) { post({ type: 'done', qid, counts, ms: 0 }); return; }
  const srcs = sources.filter(d => d.script === script).map(fromDescriptor);
  const total = srcs.reduce((n, s) => n + s.units(), 0) || 1;
  let done = 0;
  const cancelled = () => current !== qid;
  let pending = [], lastFlush = Date.now();
  const flush = (group) => {
    if (!pending.length) return;
    post({ type: 'hits', qid, group, hits: pending, counts: { ...counts } });
    pending = []; lastFlush = Date.now();
  };
  for (const src of srcs) {
    const scope = {
      fuzzy, cancelled,
      onUnit: (label) => {
        done++;
        flush(src.group);
        post({ type: 'progress', qid, done, total, label: `${src.abbr} ${label}` });
      },
    };
    for await (const v of src.verses(scope)) {
      if (cancelled()) return;
      let hay;
      if (v.plain != null) hay = script === 'hbo' ? keyFor('hbo', 'fuzzy', v.plain) : v.plain;
      else hay = keyFor(script, mode, v.text) + (fuzzy && v.lemmas ? ' ' + keyFor(script, mode, v.lemmas) : '');
      if (!hay.includes(needle)) continue;
      counts[src.group]++;
      if (counts[src.group] > limit) continue;
      let text = v.text;
      if (text == null) text = await src.display(v);
      if (cancelled()) return;
      text = nfc(text);
      pending.push({ key: v.key, text, range: locate(script, mode, text, needle), abbr: src.abbr, src: src.id, lang: src.lang, dir: src.dir, group: src.group });
      if (pending.length >= 50 || Date.now() - lastFlush > 120) flush(src.group);
    }
    flush(src.group);
  }
  if (!cancelled()) post({ type: 'done', qid, counts, ms: Date.now() - t0 });
}
