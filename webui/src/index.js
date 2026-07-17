import { exec, toast } from 'kernelsu-alt';
import './style.css';

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

// Rebuild the whole config file from the entry array (avoids line-number drift).
// Disabled entries are written back commented out, preserving their order.
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

function modal(html) { $('modal-overlay').style.display = 'flex'; $('modal-content').innerHTML = html; }
function closeModal(e) { if (!e || e.target === $('modal-overlay')) $('modal-overlay').style.display = 'none'; }

async function run(cmd) {
  const r = await exec(cmd);
  if (r.errno !== 0) throw new Error((r.stderr || '').trim() || 'command failed');
  return r;
}

// Swipe to delete
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
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">⏰</div><p>No scheduled jobs yet</p><span>Add one below</span></div>';
    return;
  }
  el.innerHTML = list.map((s, idx) => {
    const c = badgeColor(s.action, idx);
    return '<div class="swipe-container"><div class="swipe-bg">Delete</div><div class="swipe-content" data-idx="' + idx + '"><div class="job-row' + (s.disabled ? ' disabled' : '') + '"><div class="job-indicator ' + c + '"></div><div class="job-body" onclick="editEntry(' + idx + ')"><span class="job-time">' + s.time + '</span><span class="job-label">' + label(s) + '</span></div><div class="job-actions"><label class="toggle"><input type="checkbox"' + (s.disabled ? '' : ' checked') + ' onchange="toggle(' + idx + ')"><span class="slider"></span></label></div></div></div></div>';
  }).join('');
  setTimeout(() => {
    document.querySelectorAll('#schedule-list .swipe-content').forEach((e) => initSwipe(e));
    document.querySelectorAll('#schedule-list .swipe-container').forEach((c, i) => {
      const bg = c.querySelector('.swipe-bg');
      if (bg) bg.addEventListener('click', () => confirmDel(i));
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
      sel.add(new Option(name, parts.join(' ')));
    });
  });
}

async function load() {
  await loadScripts();
  try {
    const r = await run('cat ' + esc(CFG));
    render(parseConfig(r.stdout));
  } catch (e) {
    const el = $('schedule-list');
    if (el) el.innerHTML = '<div class="empty-state"><p>Failed to load config</p></div>';
    toastMsg('Error: ' + e.message);
  }
}

async function toggle(idx) {
  try {
    const entries = parseConfig((await run('cat ' + esc(CFG))).stdout);
    if (idx >= entries.length) return;
    entries[idx].disabled = !entries[idx].disabled;
    await writeConfigFile(entries);
    toastMsg('Toggled');
    load();
  } catch (e) { toastMsg('Error: ' + e.message); }
}

async function editEntry(idx) {
  try {
    const e = parseConfig((await run('cat ' + esc(CFG))).stdout)[idx];
    if (!e) return;
    modal(
      '<div class="modal-header"><h3>Edit job</h3></div>' +
      '<div class="modal-body">' +
        '<div class="field" style="margin-bottom:12px"><label>Time</label>' +
          '<input type="time" id="edit-time" value="' + e.time + '" style="width:100%;background:var(--bg);border:1px solid var(--card-border);color:var(--text);padding:9px 12px;border-radius:8px;font-size:14px;font-family:var(--mono);outline:none"></div>' +
        '<div class="field" style="margin-bottom:12px"><label>Status</label>' +
          '<label class="toggle" style="display:inline-block"><input type="checkbox" id="edit-disabled"' + (e.disabled ? '' : ' checked') + '><span class="slider"></span></label></div>' +
      '</div>' +
      '<div class="modal-actions" style="display:flex;gap:8px">' +
        '<button class="btn btn-primary" onclick="saveEdit(' + idx + ')" style="flex:1">Save</button>' +
        '<button class="btn btn-ghost" onclick="closeModal(null)" style="flex:1">Cancel</button></div>');
  } catch (x) { toastMsg('Error: ' + x.message); }
}

async function saveEdit(idx) {
  const newTime = $('edit-time').value;
  const newDisabled = !$('edit-disabled').checked;
  if (!newTime) return toastMsg('Pick a time');
  try {
    const entries = parseConfig((await run('cat ' + esc(CFG))).stdout);
    if (idx >= entries.length) return;
    entries[idx].time = newTime;
    entries[idx].disabled = newDisabled;
    await writeConfigFile(entries);
    toastMsg('Saved');
    load();
    closeModal(null);
  } catch (x) { toastMsg('Error: ' + x.message); }
}

async function confirmDel(idx) {
  try {
    const e = parseConfig((await run('cat ' + esc(CFG))).stdout)[idx];
    if (!e) return;
    const isCustom = e.action !== 'data' && e.action !== 'airplane';
    modal(
      '<div class="modal-header"><h3>Delete job?</h3></div>' +
      '<div class="modal-body"><p style="color:var(--muted);font-size:14px">This cannot be undone.</p>' +
        (isCustom ? '<label class="checkbox-row"><input type="checkbox" id="del-file" checked><span> Also delete script file</span></label>' : '') +
      '</div>' +
      '<div class="modal-actions" style="display:flex;gap:8px">' +
        '<button class="btn" onclick="doDel(' + idx + ')" style="flex:1;background:#ef4444;color:#fff">Delete</button>' +
        '<button class="btn btn-ghost" onclick="closeModal(null)" style="flex:1">Cancel</button></div>');
  } catch (x) { toastMsg('Error: ' + x.message); }
}

async function doDel(idx) {
  try {
    const entries = parseConfig((await run('cat ' + esc(CFG))).stdout);
    if (idx >= entries.length) return;
    const e = entries[idx];
    if (e.action !== 'data' && e.action !== 'airplane' && $('del-file') && $('del-file').checked)
      await run('rm -f ' + esc(CUSTOM_DIR + '/' + e.action + (e.sub ? '_' + e.sub : '') + '.sh') + ' ' + esc(JOBS_DIR + '/' + e.action + (e.sub ? '_' + e.sub : '') + '.sh') + ' 2>/dev/null');
    entries.splice(idx, 1);
    await writeConfigFile(entries);
    toastMsg('Deleted');
    load();
    closeModal(null);
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
    const entries = parseConfig((await run('cat ' + esc(CFG))).stdout);
    for (let i = 0; i < entries.length; i++)
      if (entries[i].time === time && entries[i].action === action && entries[i].sub === sub)
        return toastMsg('Already exists');
    await run('echo ' + esc(time + ' ' + action + (sub ? ' ' + sub : '')) + ' >> ' + esc(CFG));
    await run('sh ' + esc(UPD));
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

async function restart() {
  try { await run('sh ' + esc(UPD)); toastMsg('Restarted'); }
  catch (e) { toastMsg('Error: ' + e.message); }
}

// Direct config file editing (uses the module/dailyjobs symlink -> /data/adb/dailyjobs)
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
  // Validate every non-blank, non-comment line before overwriting
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

window.editEntry = editEntry;
window.saveEdit = saveEdit;
window.confirmDel = confirmDel;
window.doDel = doDel;
window.toggle = toggle;
window.add = add;
window.addCustom = addCustom;
window.restart = restart;
window.loadConfigFile = loadConfigFile;
window.saveConfigFile = saveConfigFile;
window.closeModal = closeModal;

loadConfigFile();
load();
