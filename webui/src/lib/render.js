/* ==========================================================
   render — timeline DOM rendering (tap to edit, delete in dialog)
   ========================================================== */
import { $ } from './utils.js';
import { label } from './theme.js';

export function render(list) {
  const el = $('schedule-list');
  if (!el) return;

  if (!list.length) {
    el.innerHTML =
      '<div class="timeline-empty">' +
        '<div class="empty-icon material-symbols-outlined">alarm</div>' +
        '<p>No jobs scheduled</p>' +
        '<span class="empty-hint">Add one below</span>' +
      '</div>';
    return;
  }

  el.innerHTML = list.map((s, idx) => {
    const typeBadge = s.isCron ? '<span class="cron-badge">CRON</span>' : '';
    return '<div class="timeline-row' + (s.disabled ? ' disabled' : '') + '">' +
        '<div class="timeline-body" onclick="openEdit(' + idx + ')">' +
          '<span class="timeline-time">' + s.time + typeBadge + '</span>' +
          '<span class="timeline-label">' + label(s) + '</span>' +
        '</div>' +
        '<div class="timeline-actions">' +
          '<md-switch' + (s.disabled ? '' : ' selected') + ' onclick="event.stopPropagation()" onchange="toggle(' + idx + ', this)"></md-switch>' +
        '</div>' +
      '</div>';
  }).join('');
}
