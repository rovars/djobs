/* ==========================================================
   ui — boot, data loading
   ========================================================== */
import { $, toastMsg, esc, escHtml, tryRun, run } from './utils.js';
import { parseConfig } from './config.js';
import { render } from './render.js';
import { setEntries } from './state.js';

const JOBS_DIR = '/data/adb/modules/dailyjobs/jobs';
const CUSTOM_DIR = '/data/adb/dailyjobs/custom';
const CFG = '/data/adb/dailyjobs/config.txt';

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
