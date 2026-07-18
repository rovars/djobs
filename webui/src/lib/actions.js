/* ==========================================================
   actions — CRUD handlers for schedule entries
   Single-line format: "HH:MM command" or "cron_expression command"
   ========================================================== */
import { $, toastMsg } from './utils.js';
import { writeConfigFile } from './config.js';
import { getEntries } from './state.js';
import { load } from './ui.js';

/* Parse a single-line job entry into {time, cmd, isCron} */
function parseLine(line) {
  const t = line.trim();
  if (!t) return null;

  const isDisabled = t[0] === '#';
  const cl = isDisabled ? t.replace(/^#\s*/, '') : t;

  // Try HH:MM format
  let m = cl.match(/^(\d{2}:\d{2})\s+(.+)$/);
  if (m) return { time: m[1], cmd: m[2], disabled: isDisabled, isCron: false };

  // Try cron format
  m = cl.match(/^([\d*,/\-*\s]{5,}?)\s+(.+)$/);
  if (m) return { time: m[1].trim(), cmd: m[2], disabled: isDisabled, isCron: true };

  return null;
}

/* Close all open dialogs (called on re-render to prevent stale indices) */
function closeDialogs() {
  ['edit-dialog', 'delete-dialog'].forEach(id => {
    const d = $(id);
    if (d && d.open) d.close();
  });
}

/* Find entry index by comparing time+cmd (identity, not position) */
function findEntryIndex(time, cmd) {
  const entries = getEntries();
  for (let i = 0; i < entries.length; i++)
    if (entries[i].time === time && entries[i].cmd === cmd) return i;
  return -1;
}

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
    closeDialogs();
    load();
  } catch (e) { toastMsg('Error: ' + e.message); }
}

/* ---- Edit dialog ---- */
let editIdentity = null;  // {time, cmd} — not index

export function openEdit(idx) {
  const e = getEntries()[idx];
  if (!e) return;
  editIdentity = { time: e.time, cmd: e.cmd };
  $('edit-time').value = e.time;
  $('edit-cmd').value = e.cmd;
  $('edit-dialog').show();
}

/* Delete from within edit dialog */
export async function deleteFromEdit() {
  if (!editIdentity || !confirm('Remove this job?')) return;
  try {
    const idx = findEntryIndex(editIdentity.time, editIdentity.cmd);
    if (idx < 0) return toastMsg('Entry not found');
    const entries = getEntries();
    entries.splice(idx, 1);
    await writeConfigFile(entries);
    toastMsg('Deleted');
    $('edit-dialog').close();
    load();
  } catch (x) { toastMsg('Error: ' + x.message); }
}

export async function saveEditFromDialog() {
  const newTime = $('edit-time').value.trim();
  const newCmd  = $('edit-cmd').value.trim();
  if (!newTime) return toastMsg('Enter time or cron expression');
  if (!newCmd)  return toastMsg('Enter a command');
  try {
    const idx = findEntryIndex(editIdentity.time, editIdentity.cmd);
    if (idx < 0) return toastMsg('Entry not found (was it modified?)');
    const entries = getEntries();
    entries[idx].time = newTime;
    entries[idx].cmd = newCmd;
    entries[idx].isCron = !/^\d{2}:\d{2}$/.test(newTime);
    await writeConfigFile(entries);
    toastMsg('Saved');
    $('edit-dialog').close();
    load();
  } catch (x) { toastMsg('Error: ' + x.message); }
}

/* ---- Delete dialog ---- */
let deleteIdentity = null;  // {time, cmd} — not index

export function openDelete(idx) {
  const e = getEntries()[idx];
  if (!e) return;
  deleteIdentity = { time: e.time, cmd: e.cmd };
  $('delete-dialog').show();
}

export async function doDelFromDialog() {
  if (!deleteIdentity) return;
  try {
    const idx = findEntryIndex(deleteIdentity.time, deleteIdentity.cmd);
    if (idx < 0) return toastMsg('Entry not found (was it modified?)');
    const entries = getEntries();
    entries.splice(idx, 1);
    await writeConfigFile(entries);
    toastMsg('Deleted');
    deleteIdentity = null;
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
