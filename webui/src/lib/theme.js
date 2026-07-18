/* ==========================================================
   theme — label formatting
   ========================================================== */

/** Build the label HTML for a schedule entry */
export function label(s) {
  return '<span class="tl-type">›</span> ' + s.cmd;
}
