// 「加到主畫面」提示：網址帶 ?install=1 時（例如從 LINE 網頁圖卡的「📲 加到手機主畫面」按鈕進來）顯示。
// Android／電腦版 Chrome：瀏覽器給了安裝事件就直接跳出安裝視窗；沒給就教從選單安裝。
// iPhone／iPad：無法用程式安裝，顯示「分享 → 加入主畫面」的步驟。
// 已經從主畫面打開（standalone）就不顯示。
import { h, toast } from './util.js';

let deferred = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; render(); });
addEventListener('appinstalled', () => { deferred = null; close(); toast('已加到主畫面'); });

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const inLine = () => /\bLine\//i.test(navigator.userAgent);

let root = null;

const CSS = `
.inst-back{position:fixed;inset:0;z-index:2000;background:rgba(16,18,28,.55);display:flex;align-items:flex-end;justify-content:center;animation:inst-fade .2s}
.inst{width:min(480px,100%);background:var(--card);color:var(--fg);border-radius:20px 20px 0 0;padding:22px 20px calc(18px + var(--safe-b));box-shadow:var(--shadow);font-family:var(--ui);text-align:center;animation:inst-up .28s var(--ease)}
.inst img{width:72px;height:72px;border-radius:16px}
.inst h2{font:900 21px/1.4 var(--serif-zh);margin:10px 0 2px}
.inst p{margin:0;color:var(--muted);font-size:15px;line-height:1.6}
.inst ol{text-align:left;background:var(--bg2);border-radius:14px;margin:14px 0 0;padding:12px 16px 12px 34px;line-height:1.9;font-size:15px}
.inst .k{display:inline-block;min-width:1.6em;text-align:center;border:1px solid var(--line);border-radius:6px;background:var(--card);font-size:13px;line-height:1.5;padding:0 4px}
.inst .warn{background:color-mix(in srgb,var(--danger) 10%,transparent);color:var(--danger);border-radius:10px;padding:8px 12px;margin-top:12px;font-size:14px;text-align:left}
.inst button{display:block;width:100%;border:0;border-radius:14px;padding:14px;font:700 17px var(--ui);margin-top:12px;cursor:pointer}
.inst .go{background:var(--capsule);color:var(--capsule-fg)}
.inst .later{background:transparent;color:var(--muted);font-weight:500;font-size:15px;padding:8px;margin-top:6px}
@keyframes inst-fade{from{opacity:0}}
@keyframes inst-up{from{transform:translateY(40px);opacity:0}}
@media (prefers-reduced-motion:reduce){.inst-back,.inst{animation:none}}`;

function steps() {
  if (isIOS()) return h('ol', null,
    h('li', null, '點畫面下方的「分享」', h('span.k', null, '⬆︎'), '（iPad 在右上角）'),
    h('li', null, '往下滑，點「', h('b', null, '加入主畫面'), '」'),
    h('li', null, '按右上角「', h('b', null, '新增'), '」'));
  return h('ol', null,
    h('li', null, '點瀏覽器右上角的 ', h('span.k', null, '⋮')),
    h('li', null, '選「', h('b', null, '安裝應用程式'), '」或「', h('b', null, '加到主畫面'), '」'),
    h('li', null, '再按「安裝」或「新增」'));
}

function render() {
  if (!root) return;
  const box = h('div.inst', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'inst-title' },
    h('img', { src: 'icons/apple-touch-icon.png', alt: '' }),
    h('h2', { id: 'inst-title' }, '把原文對照聖經加到主畫面'),
    h('p', null, '以後像 App 一樣一點就開，沒有網路也能讀。'),
    inLine() ? h('p.warn', null, '現在是在 LINE 裡面開啟，無法加到主畫面。請點右上角「⋯」，選「用預設瀏覽器開啟」。') : null,
    deferred ? null : steps(),
    deferred ? h('button.go', { type: 'button', onclick: install }, '安裝到手機主畫面') : null,
    h('button.later', { type: 'button', onclick: close }, deferred ? '以後再說' : '我知道了'));
  root.replaceChildren(box);
  (box.querySelector('.go') || box.querySelector('.later')).focus({ preventScroll: true });
}

async function install() {
  const e = deferred;
  if (!e) return;
  deferred = null;
  e.prompt();
  const r = await e.userChoice.catch(() => null);
  if (r && r.outcome === 'accepted') close();
  else render();
}

function close() {
  if (!root) return;
  root.remove(); root = null;
  removeEventListener('keydown', onKey, true);
}
function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }

/** 網址有 ?install 就顯示提示，並把參數從網址拿掉（重新整理不會再跳）；回傳是否顯示了 */
export function maybeInstallPrompt() {
  const url = new URL(location.href);
  if (!url.searchParams.has('install')) return false;
  url.searchParams.delete('install');
  url.searchParams.delete('openExternalBrowser');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  if (isStandalone()) { toast('已經加到主畫面了'); return true; }
  if (!document.getElementById('inst-css')) document.head.append(h('style', { id: 'inst-css' }, CSS));
  root = h('div.inst-back', { onclick: e => { if (e.target === root) close(); } });
  document.body.append(root);
  addEventListener('keydown', onKey, true);
  render();
  return true;
}
