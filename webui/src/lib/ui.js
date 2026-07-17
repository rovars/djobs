/* ==========================================================
   ui — boot, data loading, tab switching, config text editor
   ========================================================== */
import { $, toastMsg, esc, utf8ToBase64, escHtml, tryRun, run } from './utils.js';
import { parseConfig } from './config.js';
import { render } from './render.js';
import { setEntries } from './state.js';

const JOBS_DIR = '/data/adb/modules/dailyjobs/jobs';
const CUSTOM_DIR = '/data/adb/dailyjobs/custom';
const CFG = '/data/adb/dailyjobs/config.txt';
const UPD = '/data/adb/modules/dailyjobs/update-cron.sh';

/* ==========================================================
   Load script names into the action <select>
   ========================================================== */
async function loadScripts() {
  const sel = $('new-action');
  sel.innerHTML = '';
  const seen = {};

  const [r1, r2] = await Promise.all([
    tryRun('ls ' + esc(JOBS_DIR) + ' 2>/dev/null'),
    tryRun('ls ' + esc(CUSTOM_DIR) + ' 2>/dev/null'),
  ]);

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

/* ==========================================================
   Full boot — load scripts + config, render timeline
   ========================================================== */
export async function load() {
  await loadScripts();
  try {
    const r = await run('cat ' + esc(CFG));
    const entries = parseConfig(r.stdout);
    setEntries(entries);
    render(entries);
  } catch (e) {
    const el = $('schedule-list');
    if (el) {
      el.innerHTML =
        '<div class="timeline-empty">' +
          '<div class="empty-icon material-symbols-outlined">error_outline</div>' +
          '<p>Failed to load config</p>' +
          '<span class="empty-hint">' + escHtml(e.message) + '</span>' +
        '</div>';
    }
    toastMsg('Error: ' + e.message);
  }
}

/* ==========================================================
   Config file direct-edit tab
   ========================================================== */
export async function loadConfigFile() {
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

export async function saveConfigFile() {
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
    el.value = content;
  } catch (e) { toastMsg('Error: ' + e.message); }
}

/* ==========================================================
   Tab switching
   ========================================================== */
export function switchTab(tab) {
  const isJobs = tab === 'jobs';
  $('page-jobs').style.display   = isJobs ? '' : 'none';
  $('page-config').style.display = isJobs ? 'none' : '';
  $('tab-jobs').active   = isJobs;
  $('tab-config').active = !isJobs;
  if (!isJobs) loadConfigFile();
}
