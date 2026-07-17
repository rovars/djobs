/* ==========================================================
   state — shared in-memory entries (no dependencies)
   ========================================================== */

/** Current schedule entries parsed from config.txt */
let currentEntries = [];

export function getEntries() {
  return currentEntries;
}

export function setEntries(entries) {
  currentEntries = entries;
}
