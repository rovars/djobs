import { exec } from 'kernelsu-alt';

/* ─── Constants ─── */
const CFG = '/data/adb/dailyjobs/config.txt';
const DJOBS = '/data/adb/dailyjobs/djobs.service';

/* ─── DOM Helpers ─── */
const $ = id => document.getElementById(id);
let toastTimer;

function toast(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = 'toast', 2400);
}

/* ─── Shell ─── */
async function run(cmd) {
  const r = await exec(cmd);
  if (r.errno !== 0) throw new Error((r.stderr || '').trim() || 'command failed');
  return r;
}

/* ─── Config Parse / Serialize ─── */
function parseConfig(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const disabled = t[0] === '#';
    const body = disabled ? t.slice(1).trim() : t;

    let m = body.match(/^(\d{2}:\d{2})\s+(.+)$/);
    if (m) { out.push({ time: m[1], cmd: m[2].trim(), disabled, isCron: false }); continue; }

    m = body.match(/^([\d*,/\-*]+\s+[\d*,/\-*]+\s+[\d*,/\-*]+\s+[\d*,/\-*]+\s+[\d*,/\-*]+)\s+(.+)$/);
    if (m) { out.push({ time: m[1].replace(/\s+/g, ' ').trim(), cmd: m[2].trim(), disabled, isCron: true }); continue; }
  }
  return out;
}

function hhmmToCron(t) {
  const [h, m] = t.split(':');
  return `${parseInt(m)} ${parseInt(h)} * * *`;
}

function serializeConfig(entries) {
  return entries.map(e => {
    const cronTime = e.isCron ? e.time : hhmmToCron(e.time);
    return (e.disabled ? '# ' : '') + cronTime + ' ' + e.cmd;
  }).join('\n') + '\n';
}

async function readConfig() {
  const r = await run('cat \'' + CFG.replace(/'/g, "'\\''") + '\'');
  return parseConfig(r.stdout);
}

async function writeConfig(entries) {
  const tmp = CFG + '.tmp';
  const content = serializeConfig(entries);
  // Write via base64 to avoid shell escaping issues
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(content)));
  await run("printf '%s' '" + b64.replace(/'/g, "'\\''") + "' | base64 -d > '" + tmp.replace(/'/g, "'\\''") + "'");
  await run("mv -f '" + tmp.replace(/'/g, "'\\''") + "' '" + CFG.replace(/'/g, "'\\''") + "'");
  // Signal daemon to reload config
  try {
    const st = await run(DJOBS + " status");
    if (st.stdout.includes('Running')) {
      await run(DJOBS + " restart");
    }
  } catch (_) {}
}

/* ─── State ─── */
let entries = [];
let editingIdx = -1;  // -1 = add, >=0 = edit

function render() {
  renderJobs();
  renderStatusPending();
  $('job-count').textContent = entries.length;
}

/* ─── Service Status ─── */
async function checkStatus() {
  try {
    const r = await run(DJOBS + " status");
    const running = r.stdout.includes('Running');
    const pid = running ? (r.stdout.match(/PID (\d+)/) || [])[1] || '' : '';
    renderStatus(running, pid);
    return running;
  } catch (_) {
    renderStatus(false, '');
    return false;
  }
}

function renderStatusPending() {
  $('status-dot').className = 'status-dot';
  $('status-text').textContent = 'Checking...';
  $('status-pid').textContent = '';
}

function renderStatus(running, pid) {
  $('status-dot').className = 'status-dot' + (running ? ' running' : ' stopped');
  $('status-text').textContent = running ? 'Running' : 'Stopped';
  $('status-pid').textContent = pid ? 'PID ' + pid : '';
}

async function startDaemon() {
  $('btn-start').disabled = true;
  try {
    await run(DJOBS + " start");
    await checkStatus();
    toast('Daemon started');
  } catch (e) { toast('Start failed: ' + e.message); }
  $('btn-start').disabled = false;
}

async function stopDaemon() {
  $('btn-stop').disabled = true;
  try {
    await run(DJOBS + " stop");
    await checkStatus();
    toast('Daemon stopped');
  } catch (e) { toast('Stop failed: ' + e.message); }
  $('btn-stop').disabled = false;
}

/* ─── Render Jobs ─── */
function renderJobs() {
  const el = $('job-list');
  if (!entries.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">⏰</div><p>No jobs scheduled</p><span class="hint">Tap Add job to get started</span></div>';
    return;
  }
  el.innerHTML = entries.map((e, i) =>
    '<div class="job-row' + (e.disabled ? ' disabled' : '') + '" data-idx="' + i + '">' +
      '<div class="job-body">' +
        '<span class="job-time">' + esc(e.time) + (e.isCron ? '<span class="job-badge">CRON</span>' : '') + '</span>' +
        '<span class="job-cmd">' + esc(e.cmd) + '</span>' +
      '</div>' +
      '<label class="switch" onclick="event.stopPropagation()">' +
        '<input type="checkbox" class="job-toggle" data-idx="' + i + '"' + (e.disabled ? '' : ' checked') + '>' +
        '<span class="slider"></span>' +
      '</label>' +
    '</div>'
  ).join('');

  // Attach events
  el.querySelectorAll('.job-row').forEach(row => {
    const idx = +row.dataset.idx;
    row.querySelector('.job-body').addEventListener('click', () => openEdit(idx));
  });
  el.querySelectorAll('.job-toggle').forEach(cb => {
    cb.addEventListener('change', () => toggle(+cb.dataset.idx, cb.checked));
  });
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─── CRUD ─── */
function openAdd() {
  editingIdx = -1;
  $('modal-title').textContent = 'New Job';
  $('input-time').value = '22:00';
  $('input-cmd').value = '';
  $('btn-modal-delete').style.display = 'none';
  $('modal').classList.add('open');
  $('input-time').focus();
}

function openEdit(idx) {
  const e = entries[idx];
  if (!e) return;
  editingIdx = idx;
  $('modal-title').textContent = 'Edit Job';
  $('input-time').value = e.time;
  $('input-cmd').value = e.cmd;
  $('btn-modal-delete').style.display = '';
  $('modal').classList.add('open');
  $('input-time').focus();
}

function closeModal() {
  $('modal').classList.remove('open');
  editingIdx = -1;
}

function isValidTime(t) {
  if (/^\d{2}:\d{2}$/.test(t)) {
    const [, h, m] = t.match(/^(\d{2}):(\d{2})$/);
    return +h < 24 && +m < 60;
  }
  const f = t.trim().split(/\s+/);
  if (f.length !== 5) return false;
  return f.every(x => /^[\d*,/\-*]+$/.test(x));
}

async function save() {
  const time = $('input-time').value.trim();
  const cmd  = $('input-cmd').value.trim();
  if (!time) return toast('Enter time or cron expression');
  if (!cmd)  return toast('Enter a command');
  if (!isValidTime(time)) return toast('Invalid time or cron format');

  const isCron = !/^\d{2}:\d{2}$/.test(time);

  if (editingIdx >= 0) {
    entries[editingIdx] = { ...entries[editingIdx], time, cmd, isCron };
  } else {
    // Check duplicate
    for (const e of entries) {
      if (e.time === time && e.cmd === cmd) return toast('Already exists');
    }
    entries.push({ time, cmd, disabled: false, isCron });
  }

  try {
    await writeConfig(entries);
    toast('Saved');
    closeModal();
    render();
  } catch (e) { toast('Error: ' + e.message); }
}

async function remove() {
  if (editingIdx < 0) return;
  entries.splice(editingIdx, 1);
  try {
    await writeConfig(entries);
    toast('Deleted');
    closeModal();
    render();
  } catch (e) { toast('Error: ' + e.message); }
}

async function toggle(idx, checked) {
  if (idx < 0 || idx >= entries.length) return;
  entries[idx].disabled = !checked;
  try {
    await writeConfig(entries);
  } catch (e) { toast('Error: ' + e.message); }
}

/* ─── Init ─── */
async function init() {
  // Load config
  try {
    entries = await readConfig();
  } catch (_) {
    toast('Cannot read config');
  }
  render();

  // Check status (don't block render)
  checkStatus();

  // Bind events
  $('btn-add').addEventListener('click', openAdd);
  $('btn-modal-save').addEventListener('click', save);
  $('btn-modal-cancel').addEventListener('click', closeModal);
  $('btn-modal-delete').addEventListener('click', remove);
  $('btn-start').addEventListener('click', startDaemon);
  $('btn-stop').addEventListener('click', stopDaemon);
  $('btn-refresh').addEventListener('click', checkStatus);

  // Close modal on overlay click
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });

  // Enter key in cmd field triggers save
  $('input-cmd').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

  // Refresh status every 30s
  setInterval(checkStatus, 30000);
}

init();
