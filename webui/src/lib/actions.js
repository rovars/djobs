/* ==========================================================
   actions — CRUD handlers for schedule entries
   ========================================================== */
import { $, toastMsg } from './utils.js';
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
  $('edit-cmd').value = e.cmd;
  $('edit-disabled').selected = !e.disabled;
  $('edit-dialog').show();
}

export async function saveEditFromDialog() {
  const newTime = $('edit-time').value;
  const newCmd  = $('edit-cmd').value.trim();
  const newDisabled = !$('edit-disabled').selected;
  if (!newTime) return toastMsg('Pick a time');
  if (!newCmd)  return toastMsg('Enter a command');
  try {
    const entries = getEntries();
    entries[editIdx].time = newTime;
    entries[editIdx].cmd = newCmd;
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
  if (!getEntries()[idx]) return;
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
  const time = $('new-time').value;
  const cmd  = $('new-cmd').value.trim();
  if (!time) return toastMsg('Pick a time');
  if (!cmd)  return toastMsg('Enter a command');
  try {
    const entries = getEntries();
    for (let i = 0; i < entries.length; i++)
      if (entries[i].time === time && entries[i].cmd === cmd)
        return toastMsg('Already exists');
    entries.push({ time, cmd, disabled: false });
    await writeConfigFile(entries);
    toastMsg('Job added');
    load();
  } catch (e) { toastMsg('Error: ' + e.message); }
}
