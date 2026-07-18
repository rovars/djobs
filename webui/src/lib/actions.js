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

/* ---- Clear add form ---- */
export function clearAddForm() {
  $('new-line').value = '';
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
  const prefix = e.disabled ? '# ' : '';
  $('edit-line').value = prefix + e.time + ' ' + e.cmd;
  $('edit-disabled').selected = !e.disabled;
  $('edit-dialog').show();
}

export async function saveEditFromDialog() {
  const raw = $('edit-line').value;
  const parsed = parseLine(raw);
  if (!parsed) return toastMsg('Invalid format — use: HH:MM command');
  try {
    const entries = getEntries();
    entries[editIdx].time = parsed.time;
    entries[editIdx].cmd = parsed.cmd;
    entries[editIdx].disabled = parsed.disabled;
    entries[editIdx].isCron = parsed.isCron;
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
  const raw = $('new-line').value;
  const parsed = parseLine(raw);
  if (!parsed) return toastMsg('Use format: HH:MM command  or  cron command');
  try {
    const entries = getEntries();
    for (let i = 0; i < entries.length; i++)
      if (entries[i].time === parsed.time && entries[i].cmd === parsed.cmd)
        return toastMsg('Already exists');
    entries.push({ time: parsed.time, cmd: parsed.cmd, disabled: false, isCron: parsed.isCron });
    await writeConfigFile(entries);
    toastMsg('Job added');
    clearAddForm();
    load();
  } catch (e) { toastMsg('Error: ' + e.message); }
}
