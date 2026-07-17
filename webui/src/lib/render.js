/* ==========================================================
   render — timeline DOM rendering & swipe-to-delete
   ========================================================== */
import { $ } from './utils.js';
import { badgeColor, label } from './theme.js';

/* ---- Swipe-to-delete state ---- */
const touchCtx = { el: null, startX: 0, currentX: 0, swiped: false };

/** Initialise swipe gesture on a timeline row */
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

/** Rebuild the timeline DOM from a list of entries */
export function render(list) {
  const el = $('schedule-list');
  $('job-count').textContent = list.length.toString();

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
    const c = badgeColor(s.action, idx);
    return '<div class="swipe-container">' +
      '<div class="swipe-bg">Delete</div>' +
      '<div class="swipe-content" data-idx="' + idx + '">' +
        '<div class="timeline-row' + (s.disabled ? ' disabled' : '') + '">' +
          '<div class="timeline-dot ' + c + '"></div>' +
          '<div class="timeline-body" onclick="openEdit(' + idx + ')">' +
            '<span class="timeline-time">' + s.time + '</span>' +
            '<span class="timeline-label">' + label(s) + '</span>' +
          '</div>' +
          '<div class="timeline-actions">' +
            '<md-switch' + (s.disabled ? '' : ' selected') + ' onclick="event.stopPropagation()" onchange="toggle(' + idx + ', this)"></md-switch>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  // Wire up swipe & delete listeners
  setTimeout(() => {
    document.querySelectorAll('#schedule-list .swipe-content').forEach((e) => initSwipe(e));
    document.querySelectorAll('#schedule-list .swipe-container').forEach((c, i) => {
      const bg = c.querySelector('.swipe-bg');
      if (bg) bg.addEventListener('click', () => {
        // Dispatch to the global openDelete — imported via window
        if (window.openDelete) window.openDelete(i);
      });
    });
  }, 50);
}
