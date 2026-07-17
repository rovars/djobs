var CFG = '/data/adb/dailyjobs/config.txt'
var UPD = '/data/adb/modules/dailyjobs/update-cron.sh'
var JOBS_DIR = '/data/adb/modules/dailyjobs/jobs'
var CUSTOM_DIR = '/data/adb/dailyjobs/custom'

var COLORS = { data:'amber', airplane:'cyan' }
var COLOR_LIST = ['violet','pink','lime','orange','rose','sky']

function parseConfig(text) {
  var lines = text.split('\n'), out = []
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim()
    if (!t) continue
    var off = t[0] === '#'
    var cl = off ? t.replace(/^#\s*/,'') : t
    var m = cl.match(/^(\d{2}:\d{2})\s+(\S+)\s*(.*)$/)
    if (m) out.push({line:i, time:m[1], action:m[2], sub:m[3], disabled:off})
  }
  return out
}

function ksuExec(cmd) {
  if (typeof ksu === 'undefined') return Promise.resolve({ errno:0, stdout:'', stderr:'' })
  return new Promise(function(res, rej) {
    var cb = 'kc_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)
    window[cb] = function(e, o, er) { delete window[cb]; res({errno:e, stdout:o, stderr:er}) }
    try { ksu.exec(cmd, '{}', cb) }
    catch(x) { delete window[cb]; rej(x) }
  })
}

function $(id) { return document.getElementById(id) }
function toast(msg) {
  var t = $('toast')
  t.textContent = msg; t.className = 'toast show'
  setTimeout(function(){ t.className = 'toast' }, 2400)
}
function esc(s) { return "'" + s.replace(/'/g,"'\\''") + "'" }
function badgeColor(action, idx) { return COLORS[action] || COLOR_LIST[(idx || 0) % COLOR_LIST.length] }
function label(s) {
  return '<span class="type">' + s.action.charAt(0).toUpperCase() + s.action.slice(1) + '</span>' + (s.sub ? ' ' + s.sub : '')
}
function modal(html) { $('modal-overlay').style.display = 'flex'; $('modal-content').innerHTML = html }
function closeModal(e) { if (!e || e.target === $('modal-overlay')) $('modal-overlay').style.display = 'none' }

// Swipe to delete
var touchCtx = { el:null, startX:0, currentX:0, swiped:false }
function initSwipe(el) {
  var confirmed = false
  el.addEventListener('touchstart', function(e) {
    touchCtx.el = el; touchCtx.startX = e.touches[0].clientX
    touchCtx.currentX = touchCtx.startX; touchCtx.swiped = el.classList.contains('swiped')
    confirmed = false
  }, {passive:true})
  el.addEventListener('touchmove', function(e) {
    if (touchCtx.el !== el) return
    touchCtx.currentX = e.touches[0].clientX
    var dx = touchCtx.currentX - touchCtx.startX
    if (!touchCtx.swiped && dx < 0) el.style.transform = 'translateX(' + Math.max(dx, -80) + 'px)'
    if (touchCtx.swiped && dx > 0) el.style.transform = 'translateX(' + Math.min(dx - 80, 0) + 'px)'
  }, {passive:true})
  el.addEventListener('touchend', function(e) {
    if (touchCtx.el !== el) return
    var dx = touchCtx.currentX - touchCtx.startX
    if (!touchCtx.swiped && dx < -40) {
      el.classList.add('swiped'); touchCtx.swiped = true; confirmed = true
    } else if (touchCtx.swiped && dx > 20) {
      if (confirmed) { confirmed = false; return }
      el.classList.remove('swiped'); touchCtx.swiped = false
    }
    el.style.transform = ''; touchCtx.el = null
  }, {passive:true})
}

function render(list) {
  var el = $('schedule-list')
  $('job-count').textContent = list.length.toString()
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">⏰</div><p>No scheduled jobs yet</p></div>'
    return
  }
  el.innerHTML = list.map(function(s, idx) {
    var c = badgeColor(s.action, idx)
    return '<div class="swipe-container"><div class="swipe-bg">Delete</div><div class="swipe-content" data-idx="'+idx+'"><div class="job-row'+(s.disabled?' disabled':'')+'"><div class="job-indicator '+c+'"></div><div class="job-body" onclick="editEntry('+idx+')"><span class="job-time">'+s.time+'</span><span class="job-label">'+label(s)+'</span></div><div class="job-actions"><label class="toggle"><input type="checkbox"'+(s.disabled?'':' checked')+' onchange="toggle('+idx+')"><span class="slider"></span></label></div></div></div></div>'
  }).join('')
  setTimeout(function() {
    document.querySelectorAll('#schedule-list .swipe-content').forEach(function(el) { initSwipe(el) })
    document.querySelectorAll('#schedule-list .swipe-container').forEach(function(c, i) {
      var bg = c.querySelector('.swipe-bg')
      if (bg) bg.addEventListener('click', function() { confirmDel(i) })
    })
  }, 50)
}

async function loadScripts() {
  var sel = $('new-action')
  sel.innerHTML = ''
  var seen = {}, r1 = await ksuExec('ls ' + esc(JOBS_DIR) + ' 2>/dev/null')
  var r2 = await ksuExec('ls ' + esc(CUSTOM_DIR) + ' 2>/dev/null')
  ;[r1.stdout, r2.stdout].forEach(function(out) {
    (out.trim() ? out.trim().split('\n') : []).sort().forEach(function(f) {
      if (!f.endsWith('.sh') || seen[f]) return
      seen[f] = true
      var parts = f.replace(/\.sh$/, '').split('_')
      var name = parts.map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1) }).join(' ')
      sel.add(new Option(name, parts.join(' ')))
    })
  })
}

async function load() {
  await loadScripts()
  try { render(parseConfig((await ksuExec('cat ' + esc(CFG))).stdout)) }
  catch(e) { $('schedule-list').innerHTML = '<div class="empty-state"><p>Failed to load config</p></div>' }
}

async function toggle(idx) {
  try {
    var entries = parseConfig((await ksuExec('cat ' + esc(CFG))).stdout)
    if (idx >= entries.length) return
    var line = entries[idx].line + 1
    await ksuExec(entries[idx].disabled
      ? "sed -i '" + line + "s/^# *//' " + esc(CFG)
      : "sed -i '" + line + "s/^/# /' " + esc(CFG))
    await ksuExec('sh ' + esc(UPD))
    toast('Toggled'); load()
  } catch(e) { toast('Error: '+e) }
}

async function editEntry(idx) {
  try {
    var e = parseConfig((await ksuExec('cat ' + esc(CFG))).stdout)[idx]
    if (!e) return
    modal(
      '<div class="modal-header"><h3>Edit job</h3></div>' +
      '<div class="modal-body">' +
        '<div class="field" style="margin-bottom:12px"><label>Time</label>' +
          '<input type="time" id="edit-time" value="'+e.time+'" style="width:100%;background:var(--bg);border:1px solid var(--card-border);color:var(--text);padding:9px 12px;border-radius:8px;font-size:14px;font-family:var(--mono);outline:none"></div>' +
        '<div class="field" style="margin-bottom:12px"><label>Status</label>' +
          '<label class="toggle" style="display:inline-block"><input type="checkbox" id="edit-disabled"'+(e.disabled?'':' checked')+'><span class="slider"></span></label></div>' +
      '</div>' +
      '<div class="modal-actions" style="display:flex;gap:8px">' +
        '<button class="btn btn-primary" onclick="saveEdit('+idx+')" style="flex:1">Save</button>' +
        '<button class="btn btn-ghost" onclick="closeModal(null)" style="flex:1">Cancel</button></div>')
  } catch(x) { toast('Error: '+x) }
}

async function saveEdit(idx) {
  var newTime = $('edit-time').value, newDisabled = !$('edit-disabled').checked
  if (!newTime) return toast('Pick a time')
  try {
    var r = await ksuExec('cat ' + esc(CFG))
    var entries = parseConfig(r.stdout)
    if (idx >= entries.length) return
    var e = entries[idx], line = e.line + 1
    // Replace time (handles # HH:MM and HH:MM)
    await ksuExec("sed -i '" + line + "s/^\\(# \\{0,1\\}\\)[0-2][0-9]:[0-5][0-9]/\\1" + newTime + "/' " + esc(CFG))
    if (e.disabled !== newDisabled)
      await ksuExec(newDisabled ? "sed -i '" + line + "s/^/# /' " + esc(CFG) : "sed -i '" + line + "s/^# *//' " + esc(CFG))
    await ksuExec('sh ' + esc(UPD))
    toast('Saved'); load(); closeModal(null)
  } catch(x) { toast('Error: '+x) }
}

async function confirmDel(idx) {
  try {
    var e = parseConfig((await ksuExec('cat ' + esc(CFG))).stdout)[idx]
    if (!e) return
    var isCustom = e.action !== 'data' && e.action !== 'airplane'
    modal(
      '<div class="modal-header"><h3>Delete job?</h3></div>' +
      '<div class="modal-body"><p style="color:var(--muted);font-size:14px">This cannot be undone.</p>' +
        (isCustom ? '<label class="checkbox-row"><input type="checkbox" id="del-file" checked><span> Also delete script file</span></label>' : '') +
      '</div>' +
      '<div class="modal-actions" style="display:flex;gap:8px">' +
        '<button class="btn" onclick="doDel('+idx+')" style="flex:1;background:#ef4444;color:#fff">Delete</button>' +
        '<button class="btn btn-ghost" onclick="closeModal(null)" style="flex:1">Cancel</button></div>')
  } catch(x) { toast('Error: '+x) }
}

async function doDel(idx) {
  try {
    var r = await ksuExec('cat ' + esc(CFG))
    var entries = parseConfig(r.stdout)
    if (idx >= entries.length) return
    var e = entries[idx]
    if (e.action !== 'data' && e.action !== 'airplane' && $('del-file') && $('del-file').checked)
      await ksuExec('rm -f ' + esc(CUSTOM_DIR + '/' + e.action + (e.sub ? '_' + e.sub : '') + '.sh') + ' ' + esc(JOBS_DIR + '/' + e.action + (e.sub ? '_' + e.sub : '') + '.sh') + ' 2>/dev/null')
    await ksuExec('sed -i "' + (e.line + 1) + 'd" ' + esc(CFG))
    await ksuExec('sh ' + esc(UPD))
    toast('Deleted'); load(); closeModal(null)
  } catch(x) { toast('Error: '+x) }
}

async function add() {
  var time = $('new-time').value, sel = $('new-action').value
  if (!time) return toast('Pick a time')
  var parts = sel.split(' '), action = parts[0], sub = parts.slice(1).join(' ')
  try {
    var entries = parseConfig((await ksuExec('cat ' + esc(CFG))).stdout)
    for (var i = 0; i < entries.length; i++)
      if (entries[i].time === time && entries[i].action === action && entries[i].sub === sub)
        return toast('Already exists')
    await ksuExec('echo ' + esc(time + ' ' + action + (sub ? ' ' + sub : '')) + ' >> ' + esc(CFG))
    await ksuExec('sh ' + esc(UPD))
    toast('Job added'); load()
  } catch(e) { toast('Error: '+e) }
}

async function addCustom() {
  var name = $('custom-name').value.trim(), content = $('custom-args').value.trim()
  if (!name) return toast('Enter script name')
  if (!content) return toast('Enter script content')
  try {
    var b64 = btoa(unescape(encodeURIComponent(content)))
    await ksuExec('echo ' + b64 + ' | base64 -d > ' + esc(CUSTOM_DIR + '/' + name + '.sh'))
    await ksuExec('chmod 755 ' + esc(CUSTOM_DIR + '/' + name + '.sh'))
    await ksuExec('sh ' + esc(UPD))
    toast('Script created'); load()
  } catch(e) { toast('Error: '+e) }
}

async function restart() {
  try { await ksuExec('sh ' + esc(UPD)); toast('Restarted') }
  catch(e) { toast('Error: '+e) }
}

load()
