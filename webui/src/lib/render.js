/* ==========================================================
   render — timeline DOM rendering (tap to edit, toggle, delete)
   Uses stable entry IDs, no index-based onclick.
   ========================================================== */
import { $, escHtml } from './utils.js';

export function render(list) {
  const el = $('schedule-list');
  if (!el) return;

  if (!list.length) {
    el.innerHTML =
      '<div class="timeline-empty">' +
        '<div class="empty-icon">⏰</div>' +
        '<p>No jobs scheduled</p>' +
        '<span class="empty-hint">Tap Add job to get started</span>' +
      '</div>';
    return;
  }

  el.innerHTML = list.map((s) => {
    const typeBadge = s.isCron ? '<span class="cron-badge">CRON</span>' : '';
    const timeHtml = escHtml(s.time);
    const cmdHtml  = escHtml(s.cmd);
    return '<div class="timeline-row' + (s.disabled ? ' disabled' : '') + '" data-id="' + s.id + '">' +
        '<div class="timeline-body">' +
          '<span class="timeline-time">' + timeHtml + typeBadge + '</span>' +
          '<span class="timeline-label"><span class="tl-type">›</span> ' + cmdHtml + '</span>' +
        '</div>' +
        '<div class="timeline-actions">' +
          '<md-switch' + (s.disabled ? '' : ' selected') + '></md-switch>' +
        '</div>' +
      '</div>';
  }).join('');

  // Attach event listeners via delegates (not inline onclick)
  const rows = el.querySelectorAll('.timeline-row');
  rows.forEach(row => {
    const id = Number(row.dataset.id);
    const body = row.querySelector('.timeline-body');
    const sw = row.querySelector('md-switch');

    body.addEventListener('click', () => window.openEdit(id));
    sw.addEventListener('click', e => e.stopPropagation());
    sw.addEventListener('change', () => window.toggle(id, sw));
  });
}


