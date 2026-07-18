/* ==========================================================
   render — timeline DOM rendering & swipe-to-delete
   ========================================================== */
import { $ } from './utils.js';
import { label } from './theme.js';

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
    return '<div class="swipe-container">' +
      '<div class="swipe-bg">Delete</div>' +
      '<div class="swipe-content" data-idx="' + idx + '">' +
        '<div class="timeline-row' + (s.disabled ? ' disabled' : '') + '">' +
          '<div class="timeline-body" onclick="openEdit(' + idx + ')">' +
            '<span class="timeline-time">' + s.time + typeBadge + '</span>' +
            '<span class="timeline-label">' + label(s) + '</span>' +
          '</div>' +
          '<div class="timeline-actions">' +
            '<md-switch' + (s.disabled ? '' : ' selected') + ' onclick="event.stopPropagation()" onchange="toggle(' + idx + ', this)"></md-switch>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  setTimeout(() => {
    document.querySelectorAll('#schedule-list .swipe-content').forEach((e) => initSwipe(e));
    document.querySelectorAll('#schedule-list .swipe-container').forEach((c, i) => {
      const bg = c.querySelector('.swipe-bg');
      if (bg) bg.addEventListener('click', () => {
        if (window.openDelete) window.openDelete(i);
      });
    });
  }, 50);
}
