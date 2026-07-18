/* ==========================================================
   actions — CRUD handlers for schedule entries
   Stable ID-based operations (no index bugs)
   ========================================================== */
import { $, toastMsg } from './utils.js';
import { writeConfigFile } from './config.js';
import { getEntries, pushEntry, removeEntry, updateEntry, findEntry } from './state.js';
import { render } from './render.js';

/* Validate time/cron format (matches C parser) */
function isValidTime(t) {
  if (/^\d{2}:\d{2}$/.test(t)) {
    const [, h, m] = t.match(/^(\d{2}):(\d{2})$/);
    return +h < 24 && +m < 60;
  }
  // Cron: 5 fields separated by whitespace, each field is digits/*/,-
  const fields = t.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every(f => /^[\d*,/\-*]+$/.test(f));
}

/* ---- Add dialog ---- */
export function openAddDialog() {
  $('new-time').value = '22:00';
  $('new-cmd').value = '';
  $('add-dialog').show();
}

export async function doAddFromDialog() {
  const time = $('new-time').value.trim();
  const cmd  = $('new-cmd').value.trim();
  if (!time) return toastMsg('Enter time or cron expression');
  if (!cmd)  return toastMsg('Enter a command');
  if (!isValidTime(time)) return toastMsg('Invalid time or cron format');

  const entries = getEntries();
  for (let i = 0; i < entries.length; i++)
    if (entries[i].time === time && entries[i].cmd === cmd)
      return toastMsg('Already exists');

  try {
    const isCron = !/^\d{2}:\d{2}$/.test(time);
    pushEntry({ time, cmd, disabled: false, isCron });
    await writeConfigFile(getEntries());
    toastMsg('Job added');
    $('add-dialog').close();
    render(getEntries());
  } catch (e) { toastMsg('Error: ' + e.message); }
}

/* ---- Toggle enable/disable (by stable ID) ---- */
export async function toggle(id, sw) {
  try {
    const entry = findEntry(id);
    if (!entry) return toastMsg('Entry not found');
    updateEntry(id, { disabled: !entry.disabled });
    await writeConfigFile(getEntries());
    toastMsg(entry.disabled ? 'Enabled' : 'Disabled');
    render(getEntries());
  } catch (e) { toastMsg('Error: ' + e.message); }
}

/* ---- Edit dialog ---- */
let editingId = null;

export function openEdit(id) {
  const entries = getEntries();
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].id === id) {
      editingId = id;
      $('edit-time').value = entries[i].time;
      $('edit-cmd').value = entries[i].cmd;
      $('edit-dialog').show();
      return;
    }
  }
  toastMsg('Entry not found');
}

/* Delete from within edit dialog */
export async function deleteFromEdit() {
  if (!editingId) return;
  deleteId = editingId;
  $('delete-dialog').show();
}

export async function saveEditFromDialog() {
  const newTime = $('edit-time').value.trim();
  const newCmd  = $('edit-cmd').value.trim();
  if (!newTime) return toastMsg('Enter time or cron expression');
  if (!newCmd)  return toastMsg('Enter a command');
  if (!isValidTime(newTime)) return toastMsg('Invalid time or cron format');
  try {
    const e = updateEntry(editingId, {
      time: newTime,
      cmd: newCmd,
      isCron: !/^\d{2}:\d{2}$/.test(newTime)
    });
    if (!e) return toastMsg('Entry not found');
    await writeConfigFile(getEntries());
    toastMsg('Saved');
    $('edit-dialog').close();
    render(getEntries());
  } catch (x) { toastMsg('Error: ' + x.message); }
}

/* ---- Delete dialog ---- */
let deleteId = null;

export function openDelete(id) {
  deleteId = id;
  $('delete-dialog').show();
}

export async function doDelFromDialog() {
  if (!deleteId) return;
  try {
    removeEntry(deleteId);
    await writeConfigFile(getEntries());
    toastMsg('Deleted');
    deleteId = null;
    $('delete-dialog').close();
    $('edit-dialog').close();
    render(getEntries());
  } catch (x) { toastMsg('Error: ' + x.message); }
}
