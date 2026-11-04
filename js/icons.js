// The app's one line-icon set: 24×24, stroke = currentColor, 1.75 wide, round caps/joins, no fill.
// index.html inlines the same paths for the tab bar and 首頁 (keep them in sync).
const NS = 'http://www.w3.org/2000/svg';
export const ICONS = {
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h4.75v-5.5h3.5V20h4.75V9.5"/>',
  read: '<path d="M4 5.5C6.5 4 9.5 4 12 5.5v14C9.5 18 6.5 18 4 19.5zM20 5.5C17.5 4 14.5 4 12 5.5v14c2.5-1.5 5.5-1.5 8 0z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  bookmark: '<path d="M6 3.5h12v17l-6-4.5-6 4.5z"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  syntax: '<circle cx="12" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M12 7v5M6 17v-2.5c0-1.4 1.1-2.5 2.5-2.5h7c1.4 0 2.5 1.1 2.5 2.5V17"/>',
};

/** icon('close') → <svg class="ic" …> (decorative: aria-hidden; label the button instead). */
export function icon(name, cls = '') {
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ class: `ic${cls ? ' ' + cls : ''}`, viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) s.setAttribute(k, v);
  s.innerHTML = Object.hasOwn(ICONS, name) ? ICONS[name] : ''; // static markup only
  return s;
}
