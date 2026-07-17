/* ==========================================================
   theme — colour palette, badge colour mapping, label formatting
   ========================================================== */

/** Fallback colour wheel for jobs */
export const COLOR_LIST = ['violet', 'pink', 'lime', 'orange', 'rose', 'sky', 'amber', 'cyan'];

/** Pick a colour class for a given index */
export function badgeColor(idx) {
  return COLOR_LIST[(idx || 0) % COLOR_LIST.length];
}

/** Build the label HTML for a schedule entry */
export function label(s) {
  return '<span class="tl-type">›</span> ' + s.cmd;
}
