/* ==========================================================
   ui — boot, data loading
   ========================================================== */
import { $, toastMsg, esc, escHtml, run } from './utils.js';
import { parseConfig } from './config.js';
import { render } from './render.js';
import { setEntries } from './state.js';

const CFG = '/data/adb/dailyjobs/config.txt';

/** Full boot — load config, render timeline */
export async function load() {
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
          '<div class="empty-icon">⚠️</div>' +
          '<p>Failed to load config</p>' +
          '<span class="empty-hint">' + escHtml(e.message) + '</span>' +
        '</div>';
    }
    console.error('DailyJobs:', e.message);
  }
}
