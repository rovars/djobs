/* ==========================================================
   theme — colour palette, badge colour mapping, label formatting
   ========================================================== */

/** Semantic colour per action type */
export const COLORS = {
  data: 'amber',
  airplane: 'cyan',
};

/** Fallback colour wheel for custom scripts */
export const COLOR_LIST = ['violet', 'pink', 'lime', 'orange', 'rose', 'sky'];

/** Pick a colour class for a given action + index */
export function badgeColor(action, idx) {
  return COLORS[action] || COLOR_LIST[(idx || 0) % COLOR_LIST.length];
}

/** Build the label HTML for a schedule entry */
export function label(s) {
  const typeLabel = s.action.charAt(0).toUpperCase() + s.action.slice(1);
  return '<span class="tl-type">' + typeLabel + '</span>' + (s.sub ? ' ' + s.sub : '');
}
