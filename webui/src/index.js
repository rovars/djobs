import { exec, toast } from 'kernelsu-alt';
import '@material/web/all.js';
import { styles as typescaleStyles } from '@material/web/typography/md-typescale-styles.js';
import './style.css';

document.adoptedStyleSheets.push(typescaleStyles.styleSheet);

const CFG = '/data/adb/dailyjobs/config.txt';
const UPD = '/data/adb/modules/dailyjobs/update-cron.sh';
const JOBS_DIR = '/data/adb/modules/dailyjobs/jobs';
const CUSTOM_DIR = '/data/adb/dailyjobs/custom';

const COLORS = { data: 'amber', airplane: 'cyan' };
const COLOR_LIST = ['violet', 'pink', 'lime', 'orange', 'rose', 'sky'];

function parseConfig(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const off = t[0] === '#';
    const cl = off ? t.replace(/^#\s*/, '') : t;
    const m = cl.match(/^(\d{2}:\d{2})\s+(\S+)\s*(.*)$/);
    if (m) out.push({ line: i, time: m[1], action: m[2], sub: m[3], disabled: off });
  }
  return out;
}

function $(id) { return document.getElementById(id); }

function toastMsg(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show';
  setTimeout(() => { t.className = 'toast'; }, 2400);
}

function esc(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function sanitizeName(name) {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

function badgeColor(action, idx) { return COLORS[action] || COLOR_LIST[(idx || 0) % COLOR_LIST.length]; }

function label(s) {
  return '<span class="type">' + s.action.charAt(0).toUpperCase() + s.action.slice(1) + '</span>' + (s.sub ? ' ' + s.sub : '');
}

async function run(cmd) {
  const r = await exec(cmd);
  if (r.errno !== 0) throw new Error((r.stderr || '').trim() || 'command failed');
  return r;
}

// ---- config file helpers (full-file rewrite) ----
function serializeConfig(entries) {
  return entries.map((e) => {
    const body = e.time + ' ' + e.action + (e.sub ? ' ' + e.sub : '');
    return e.disabled ? '# ' + body : body;
  }).join('\n') + '\n';
}

async function writeConfigFile(entries) {
  const content = serializeConfig(entries);
  const b64 = utf8ToBase64(content);
  await run("printf '%s' " + esc(b64) + ' | base64 -d > ' + esc(CFG));
  await run('sh ' + esc(UPD));
}

// ---- swipe to delete ----
const touchCtx = { el: null, startX: 0, currentX: 0, swiped: false };
function initSwipe(el) {
  let confirmed = false;
  el.addEventListener('touchstart', (e) => {
    touchCtx.el = el;
    touchCtx.startX = e.touches[0].clientX;
    touchCtx.currentX = touchCtx.startX;
    touchCtx.swiped = el.classList.contains('swiped');
    confirmed = false;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (touchCtx.el !== el) return;
    touchCtx.currentX = e.touches[0].clientX;
    const dx = touchCtx.currentX - touchCtx.startX;
    if (!touchCtx.swiped && dx < 0) el.style.transform = 'translateX(' + Math.max(dx, -80) + 'px)';
    if (touchCtx.swiped && dx > 0) el.style.transform = 'translateX(' + Math.min(dx - 80, 0) + 'px)';
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (touchCtx.el !== el) return;
    const dx = touchCtx.currentX - touchCtx.startX;
    if (!touchCtx.swiped && dx < -40) {
      el.classList.add('swiped');
      touchCtx.swiped = true;
      confirmed = true;
    } else if (touchCtx.swiped && dx > 20) {
      if (confirmed) { confirmed = false; return; }
      el.classList.remove('swiped');
      touchCtx.swiped = false;
    }
    el.style.transform = '';
    touchCtx.el = null;
  }, { passive: true });
}

function render(list) {
  const el = $('schedule-list');
  $('job-count').textContent = list.length.toString();
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon material-symbols-outlined">alarm</div><p>No scheduled jobs yet</p><span>Add one below</span></div>';
    return;
  }
  el.innerHTML = list.map((s, idx) => {
    const c = badgeColor(s.action, idx);
    return '<div class="swipe-container"><div class="swipe-bg">Delete</div><div class="swipe-content" data-idx="' + idx + '"><div class="job-row' + (s.disabled ? ' disabled' : '') + '"><div class="job-indicator ' + c + '"></div><div class="job-body" onclick="openEdit(' + idx + ')"><span class="job-time">' + s.time + '</span><span class="job-label">' + label(s) + '</span></div><div class="job-actions"><md-switch' + (s.disabled ? '' : ' selected') + ' onclick="event.stopPropagation()" onchange="toggle(' + idx + ', this)"></md-switch></div></div></div></div>';
  }).join('');
  setTimeout(() => {
    document.querySelectorAll('#schedule-list .swipe-content').forEach((e) => initSwipe(e));
    document.querySelectorAll('#schedule-list .swipe-container').forEach((c, i) => {
      const bg = c.querySelector('.swipe-bg');
      if (bg) bg.addEventListener('click', () => openDelete(i));
    });
  }, 50);
}

async function loadScripts() {
  const sel = $('new-action');
  sel.innerHTML = '';
  const seen = {};
  const r1 = await run('ls ' + esc(JOBS_DIR) + ' 2>/dev/null');
  const r2 = await run('ls ' + esc(CUSTOM_DIR) + ' 2>/dev/null');
  [r1.stdout, r2.stdout].forEach((out) => {
    (out.trim() ? out.trim().split('\n') : []).sort().forEach((f) => {
      if (!f.endsWith('.sh') || seen[f]) return;
      seen[f] = true;
      const parts = f.replace(/\.sh$/, '').split('_');
      const name = parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const opt = document.createElement('md-select-option');
      opt.value = parts.join(' ');
      opt.innerHTML = '<div slot="headline">' + name + '</div>';
      sel.appendChild(opt);
    });
  });
}

let currentEntries = [];
async function load() {
  await loadScripts();
  try {
    const r = await run('cat ' + esc(CFG));
    currentEntries = parseConfig(r.stdout);
    render(currentEntries);
  } catch (e) {
    const el = $('schedule-list');
    if (el) el.innerHTML = '<div class="empty-state"><p>Failed to load config</p></div>';
    toastMsg('Error: ' + e.message);
  }
}

async function toggle(idx, sw) {
  try {
    currentEntries[idx].disabled = !sw.selected;
    await writeConfigFile(currentEntries);
    toastMsg('Toggled');
    load();
  } catch (e) { toastMsg('Error: ' + e.message); }
}

let editIdx = -1;
function openEdit(idx) {
  editIdx = idx;
  const e = currentEntries[idx];
  if (!e) return;
  $('edit-time').value = e.time;
  $('edit-disabled').selected = !e.disabled;
  $('edit-dialog').show();
}

async function saveEditFromDialog() {
  const newTime = $('edit-time').value;
  const newDisabled = !$('edit-disabled').selected;
  if (!newTime) return toastMsg('Pick a time');
  try {
    currentEntries[editIdx].time = newTime;
    currentEntries[editIdx].disabled = newDisabled;
    await writeConfigFile(currentEntries);
    toastMsg('Saved');
    $('edit-dialog').close();
    load();
  } catch (x) { toastMsg('Error: ' + x.message); }
}

let delIdx = -1;
function openDelete(idx) {
  delIdx = idx;
  const e = currentEntries[idx];
  if (!e) return;
  const isCustom = e.action !== 'data' && e.action !== 'airplane';
  $('del-file-row').style.display = isCustom ? 'flex' : 'none';
  if (isCustom) $('del-file').checked = true;
  $('delete-dialog').show();
}

async function doDelFromDialog() {
  try {
    const e = currentEntries[delIdx];
    if (e.action !== 'data' && e.action !== 'airplane' && $('del-file') && $('del-file').checked)
      await run('rm -f ' + esc(CUSTOM_DIR + '/' + e.action + (e.sub ? '_' + e.sub : '') + '.sh') + ' ' + esc(JOBS_DIR + '/' + e.action + (e.sub ? '_' + e.sub : '') + '.sh') + ' 2>/dev/null');
    currentEntries.splice(delIdx, 1);
    await writeConfigFile(currentEntries);
    toastMsg('Deleted');
    $('delete-dialog').close();
    load();
  } catch (x) { toastMsg('Error: ' + x.message); }
}

async function add() {
  const time = $('new-time').value;
  const sel = $('new-action').value;
  if (!time) return toastMsg('Pick a time');
  const parts = sel.split(' ');
  const action = parts[0];
  const sub = parts.slice(1).join(' ');
  try {
    for (let i = 0; i < currentEntries.length; i++)
      if (currentEntries[i].time === time && currentEntries[i].action === action && currentEntries[i].sub === sub)
        return toastMsg('Already exists');
    currentEntries.push({ time, action, sub, disabled: false });
    await writeConfigFile(currentEntries);
    toastMsg('Job added');
    load();
  } catch (e) { toastMsg('Error: ' + e.message); }
}

async function addCustom() {
  const name = $('custom-name').value.trim();
  const content = $('custom-args').value.trim();
  if (!name) return toastMsg('Enter script name');
  if (!content) return toastMsg('Enter script content');
  if (!sanitizeName(name)) return toastMsg('Invalid name (use a-z, 0-9, . _ -)');
  try {
    const b64 = utf8ToBase64(content);
    const path = CUSTOM_DIR + '/' + name + '.sh';
    await run("printf '%s' " + esc(b64) + ' | base64 -d > ' + esc(path));
    await run('chmod 755 ' + esc(path));
    await run('sh ' + esc(UPD));
    toastMsg('Script created');
    load();
  } catch (e) { toastMsg('Error: ' + e.message); }
}

async function loadConfigFile() {
  const el = $('config-text');
  try {
    const res = await fetch('./dailyjobs/config.txt', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    el.value = await res.text();
    el.readOnly = false;
    toastMsg('Config loaded');
  } catch (e) {
    el.value = '';
    el.placeholder = 'Failed to load: ' + e.message;
    toastMsg('Error: ' + e.message);
  }
}

async function saveConfigFile() {
  const el = $('config-text');
  const content = el.value;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t[0] === '#') continue;
    if (!/^\d{2}:\d{2}\s+\S+/.test(t)) {
      toastMsg('Invalid line ' + (i + 1) + ': ' + t);
      return;
    }
  }
  try {
    const b64 = utf8ToBase64(content);
    await run("printf '%s' " + esc(b64) + ' | base64 -d > ' + esc(CFG));
    await run('sh ' + esc(UPD));
    toastMsg('Config saved');
    load();
  } catch (e) { toastMsg('Error: ' + e.message); }
}

function switchTab(tab) {
  const isJobs = tab === 'jobs';
  $('page-jobs').style.display = isJobs ? '' : 'none';
  $('page-config').style.display = isJobs ? 'none' : '';
  $('tab-jobs').active = isJobs;
  $('tab-config').active = !isJobs;
  if (!isJobs) loadConfigFile();
}

window.switchTab = switchTab;
window.add = add;
window.addCustom = addCustom;
window.toggle = toggle;
window.openEdit = openEdit;
window.saveEditFromDialog = saveEditFromDialog;
window.openDelete = openDelete;
window.doDelFromDialog = doDelFromDialog;
window.loadConfigFile = loadConfigFile;
window.saveConfigFile = saveConfigFile;

loadConfigFile();
load();
