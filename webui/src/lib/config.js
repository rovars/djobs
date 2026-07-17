/* ==========================================================
   config — parse, serialise, and persist config.txt
   ========================================================== */
import { esc, utf8ToBase64, run } from './utils.js';

const CFG = '/data/adb/dailyjobs/config.txt';

/** Parse raw config.txt text into structured entries */
export function parseConfig(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const off = t[0] === '#';
    const cl = off ? t.replace(/^#\s*/, '') : t;
    const m = cl.match(/^(\d{2}:\d{2})\s+(\S+)\s*(.*)$/);
    if (m) out.push({ line: i, time: m[1], action: m[2], sub: m[3], disabled: off });
  }
  return out;
}

/** Serialise entries back to config.txt format */
export function serializeConfig(entries) {
  return entries.map((e) => {
    const body = e.time + ' ' + e.action + (e.sub ? ' ' + e.sub : '');
    return e.disabled ? '# ' + body : body;
  }).join('\n') + '\n';
}

/** Write entries to disk — daemon picks up changes live */
export async function writeConfigFile(entries) {
  const content = serializeConfig(entries);
  const b64 = utf8ToBase64(content);
  await run("printf '%s' " + esc(b64) + ' | base64 -d > ' + esc(CFG));
}
