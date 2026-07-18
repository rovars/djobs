/* ==========================================================
   actions — CRUD handlers for schedule entries
   ========================================================== */
import { $, toastMsg } from './utils.js';
import { writeConfigFile } from './config.js';
import { getEntries } from './state.js';
import { load } from './ui.js';

/* ---- Clear add form ---- */
export function clearAddForm() {
  $('new-time').value = '22:00';
  $('new-cmd').value = '';
}

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
  const newTime = $('edit-time').value.trim();
  const newCmd  = $('edit-cmd').value.trim();
  const newDisabled = !$('edit-disabled').selected;
  if (!newTime) return toastMsg('Enter time or cron expression');
  if (!newCmd)  return toastMsg('Enter a command');
  try {
    const entries = getEntries();
    entries[editIdx].time = newTime;
    entries[editIdx].cmd = newCmd;
    entries[editIdx].disabled = newDisabled;
    entries[editIdx].isCron = !/^\d{2}:\d{2}$/.test(newTime);
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
  const time = $('new-time').value.trim();
  const cmd  = $('new-cmd').value.trim();
  if (!time) return toastMsg('Enter time or cron expression');
  if (!cmd)  return toastMsg('Enter a command');
  try {
    const entries = getEntries();
    for (let i = 0; i < entries.length; i++)
      if (entries[i].time === time && entries[i].cmd === cmd)
        return toastMsg('Already exists');
    const isCron = !/^\d{2}:\d{2}$/.test(time);
    entries.push({ time, cmd, disabled: false, isCron });
    await writeConfigFile(entries);
    toastMsg('Job added');
    clearAddForm();
    load();
  } catch (e) { toastMsg('Error: ' + e.message); }
}
