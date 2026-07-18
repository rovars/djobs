/* ==========================================================
   utils — DOM helpers, shell, encoding
   ========================================================== */
import { exec } from 'kernelsu-alt';

/** Shortcut for document.getElementById */
export function $(id) {
  return document.getElementById(id);
}

/** Show a transient toast message */
export function toastMsg(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show';
  setTimeout(() => { el.className = 'toast'; }, 2400);
}

/** Shell-escape a string for single-quoted context */
export function esc(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Encode a UTF-8 string to base64 */
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

/** Run a shell command; throws on non-zero exit */
export async function run(cmd) {
  const r = await exec(cmd);
  if (r.errno !== 0) throw new Error((r.stderr || '').trim() || 'command failed');
  return r;
}

/** Minimal HTML entity escaping (safe for innerHTML) */
export function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
