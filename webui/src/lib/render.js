/* ==========================================================
   render — timeline DOM rendering & long-press to delete
   ========================================================== */
import { $ } from './utils.js';
import { label } from './theme.js';

/* Long-press: hold 600ms on a job row to trigger delete */
function initLongPress(row, idx) {
  let timer = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

  row.addEventListener('touchstart', () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      if (window.openDelete) window.openDelete(idx);
    }, 600);
  }, { passive: true });
  row.addEventListener('touchend', cancel, { passive: true });
  row.addEventListener('touchmove', cancel, { passive: true });

  /* Mouse fallback for desktop testing */
  row.addEventListener('mousedown', () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      if (window.openDelete) window.openDelete(idx);
    }, 600);
  });
  row.addEventListener('mouseup', cancel);
  row.addEventListener('mouseleave', cancel);
}

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
    return '<div class="timeline-row' + (s.disabled ? ' disabled' : '') + '" data-idx="' + idx + '">' +
        '<div class="timeline-body" onclick="openEdit(' + idx + ')">' +
          '<span class="timeline-time">' + s.time + typeBadge + '</span>' +
          '<span class="timeline-label">' + label(s) + '</span>' +
        '</div>' +
        '<div class="timeline-actions">' +
          '<md-switch' + (s.disabled ? '' : ' selected') + ' onclick="event.stopPropagation()" onchange="toggle(' + idx + ', this)"></md-switch>' +
        '</div>' +
      '</div>';
  }).join('');

  /* Attach long-press handlers after render */
  setTimeout(() => {
    document.querySelectorAll('#schedule-list .timeline-row').forEach((row) => {
      const idx = parseInt(row.dataset.idx, 10);
      if (!isNaN(idx)) initLongPress(row, idx);
    });
  }, 50);
}
