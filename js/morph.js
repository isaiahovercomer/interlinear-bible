// Robinson morphology code → 繁體中文詞形解析（新約）。
// The pipeline may already ship a Chinese parse; parseMorph() is the fallback.

const POS = {
  N: '名詞', A: '形容詞', T: '冠詞', P: '人稱代名詞', R: '關係代名詞', C: '相互代名詞', D: '指示代名詞',
  K: '相關代名詞', I: '疑問代名詞', X: '不定代名詞', Q: '相關疑問代名詞', F: '反身代名詞', S: '所有格代名詞', V: '動詞',
};
const WORD = {
  ADV: '副詞', CONJ: '連接詞', COND: '條件連接詞', PREP: '介系詞', PRT: '質詞', 'PRT-N': '否定質詞', 'PRT-I': '疑問質詞',
  INJ: '感嘆詞', HEB: '希伯來文音譯（不變格）', ARAM: '亞蘭文音譯（不變格）', 'ADV-N': '否定副詞', 'ADV-I': '疑問副詞',
  'CONJ-N': '否定連接詞', 'N-PRI': '專有名詞（不變格）', 'A-NUI': '數詞（不變格）', 'N-LI': '字母（不變格）', 'N-OI': '名詞（不變格）',
};
const CASE = { N: '主格', G: '屬格', D: '與格', A: '受格', V: '呼格' };
const NUM = { S: '單數', P: '複數' };
const GEN = { M: '陽性', F: '陰性', N: '中性' };
const TENSE = { P: '現在', I: '未完成', F: '未來', A: '不定過去', R: '完成', L: '過去完成', X: '無時態' };
const VOICE = { A: '主動', M: '關身', P: '被動', E: '關身或被動', D: '關身異態', O: '被動異態', N: '關身或被動異態', Q: '不及物', X: '無語態' };
const MOOD = { I: '直說語氣', S: '假設語氣', O: '祈願語氣', M: '命令語氣', N: '不定詞', P: '分詞', R: '命令式分詞' };
const SUFFIX = {
  C: '比較級', S: '最高級', N: '否定', I: '疑問', P: '人名', L: '地名', T: '稱號', G: '族名', ATT: '阿提卡形', K: '縮合形', ABB: '縮寫', LI: '字母',
};

function cng(s) { // e.g. NSM / 2NS / ASF
  const out = [];
  let i = 0;
  if (/[123]/.test(s[0])) { out.push(`第${'一二三'[+s[0] - 1]}人稱`); i = 1; }
  if (CASE[s[i]]) out.push(CASE[s[i]]);
  if (NUM[s[i + 1]]) out.push(NUM[s[i + 1]]);
  if (GEN[s[i + 2]]) out.push(GEN[s[i + 2]]);
  return out;
}

export function parseMorph(code) {
  if (!code) return '';
  code = code.trim().toUpperCase();
  if (WORD[code]) return WORD[code];
  const parts = code.split('-');
  const head = parts[0];
  if (head === 'V') {
    const out = ['動詞'];
    let tvm = parts[1] || '';
    let second = '';
    if (tvm[0] === '2') { second = '第二'; tvm = tvm.slice(1); }
    if (TENSE[tvm[0]]) out.push(second + TENSE[tvm[0]] + '式');
    if (VOICE[tvm[1]]) out.push(VOICE[tvm[1]]);
    if (MOOD[tvm[2]]) out.push(MOOD[tvm[2]]);
    const pn = parts[2];
    if (pn) {
      if (/^[123][SP]$/.test(pn)) out.push(`第${'一二三'[+pn[0] - 1]}人稱${NUM[pn[1]]}`);
      else out.push(...cng(pn));
    }
    for (const s of parts.slice(3)) if (SUFFIX[s]) out.push(SUFFIX[s]);
    return out.join('・');
  }
  if (POS[head]) {
    const out = [POS[head]];
    if (parts[1]) {
      if (WORD[`${head}-${parts[1]}`]) return WORD[`${head}-${parts[1]}`];
      out.push(...cng(parts[1]));
    }
    for (const s of parts.slice(2)) if (SUFFIX[s]) out.push(SUFFIX[s]);
    return out.join('・');
  }
  if (WORD[head]) {
    const extra = parts.slice(1).map(s => SUFFIX[s]).filter(Boolean);
    return [WORD[head], ...extra].join('・');
  }
  return code;
}
