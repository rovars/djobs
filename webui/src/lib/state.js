/* ==========================================================
   state — shared in-memory entries with stable IDs
   ========================================================== */

let currentEntries = [];
let nextId = 1;

export function getEntries() {
  return currentEntries;
}

export function setEntries(entries) {
  // Assign stable IDs on load if missing
  currentEntries = entries.map(e => ({ ...e, id: e.id || nextId++ }));
  nextId = currentEntries.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
}

export function pushEntry(entry) {
  const e = { ...entry, id: nextId++ };
  currentEntries.push(e);
  return e;
}

export function removeEntry(id) {
  const idx = findIndex(id);
  if (idx >= 0) currentEntries.splice(idx, 1);
}

export function updateEntry(id, patch) {
  const idx = findIndex(id);
  if (idx < 0) return null;
  currentEntries[idx] = { ...currentEntries[idx], ...patch };
  return currentEntries[idx];
}

export function findIndex(id) {
  for (let i = 0; i < currentEntries.length; i++)
    if (currentEntries[i].id === id) return i;
  return -1;
}

export function findEntry(id) {
  const idx = findIndex(id);
  return idx >= 0 ? currentEntries[idx] : null;
}
