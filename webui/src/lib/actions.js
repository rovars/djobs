/* ==========================================================
   actions — CRUD handlers for schedule entries
   ========================================================== */
import { $, toastMsg, esc, run } from './utils.js';
import { writeConfigFile } from './config.js';
import { getEntries } from './state.js';
import { load } from './ui.js';

/* ---- Toggle enable/disable ---- */
export async function toggle(idx, sw) {
  try {
    const entries = getEntries();
    entries[idx].disabled = !sw.selected;
    await writeConfigFile(entries);
    toastMsg('Toggled');
    load();
  } catch (e) { toastMsg('Error: ' + e.message); }
}

/* ---- Edit dialog ---- */
let editIdx = -1;

export function openEdit(idx) {
  editIdx = idx;
  const e = getEntries()[idx];
  if (!e) return;
  $('edit-time').value = e.time;
  $('edit-disabled').selected = !e.disabled;
  $('edit-dialog').show();
}

export async function saveEditFromDialog() {
  const newTime = $('edit-time').value;
  const newDisabled = !$('edit-disabled').selected;
  if (!newTime) return toastMsg('Pick a time');
  try {
    const entries = getEntries();
    entries[editIdx].time = newTime;
    entries[editIdx].disabled = newDisabled;
    await writeConfigFile(entries);
    toastMsg('Saved');
    $('edit-dialog').close();
    load();
  } catch (x) { toastMsg('Error: ' + x.message); }
}

/* ---- Delete dialog ---- */
let delIdx = -1;

export function openDelete(idx) {
  delIdx = idx;
  const e = getEntries()[idx];
  if (!e) return;
  $('delete-dialog').show();
}

export async function doDelFromDialog() {
  try {
    const entries = getEntries();
    entries.splice(delIdx, 1);
    await writeConfigFile(entries);
    toastMsg('Deleted');
    $('delete-dialog').close();
    load();
  } catch (x) { toastMsg('Error: ' + x.message); }
}

/* ---- Add job to schedule ---- */
export async function add() {
  const time  = $('new-time').value;
  const sel   = $('new-action').value;
  if (!time)  return toastMsg('Pick a time');
  if (!sel)   return toastMsg('Pick an action');
  const parts = sel.split(' ');
  const action = parts[0];
  const sub    = parts.slice(1).join(' ');
  try {
    const entries = getEntries();
    for (let i = 0; i < entries.length; i++)
      if (entries[i].time === time && entries[i].action === action && entries[i].sub === sub)
        return toastMsg('Already exists');
    entries.push({ time, action, sub, disabled: false });
    await writeConfigFile(entries);
    toastMsg('Job added');
    load();
  } catch (e) { toastMsg('Error: ' + e.message); }
}
