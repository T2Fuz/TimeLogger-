// Pure, framework-free helpers shared by App.jsx and the lazy-loaded
// Statistics.jsx — kept dependency-free (no React, no recharts, no
// lucide-react) so importing this file never pulls in heavy code.

export const STORAGE_KEY = "timelogger-data-v1";
export const ACTIVE_TIMER_KEY = "timelogger-active-timer-v1";
export const COLORS = ["#FF7A1A", "#8B5FBF", "#E8637A", "#3FA66B", "#3B82C4", "#6B7280", "#F0B429", "#1AA6A6"];

export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
export function satOf(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return 0;
  const s = d / (1 - Math.abs(2 * l - 1));
  return Math.round(s * 100);
}
export function hueOf(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  return h < 0 ? h + 360 : h;
}
// HSB/HSV <-> hex, used by the Photoshop-style square colour picker below
// (kept separate from the HSL helpers above, which other parts of the app rely on).
export function hsbToHex(h, s, v) {
  s /= 100; v /= 100;
  const k = n => (n + h / 60) % 6;
  const f = n => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`;
}
export function hexToHsb(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : Math.round((d / max) * 100);
  const v = Math.round(max * 100);
  return { h, s, v };
}
export function isValidHex(hex) { return /^#([0-9a-fA-F]{6})$/.test(hex); }

// Resolves a log id (parent or sub-log) up to its top-level ancestor id,
// so statistics can roll sub-log time into the parent it belongs to.
export function rootLogId(logs, logId) {
  let log = logs.find(l => l.id === logId);
  let guard = 0;
  while (log && log.parentId && guard < 10) {
    log = logs.find(l => l.id === log.parentId);
    guard++;
  }
  return log ? log.id : logId;
}

export function uid() { return Math.random().toString(36).slice(2, 10); }
export function pad(n) { return String(n).padStart(2, "0"); }
export function fmtHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
export function fmtHM(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}:${pad(m)}`;
}
// App-wide display settings. Kept as plain mutable module state (not React
// state/props) on purpose: dozens of small formatting functions across many
// components read these, and threading them through every prop chain is
// exactly the kind of wiring that has caused missed-prop bugs before here.
// updateAppSettings() is called whenever the user's saved settings change.
let CURRENT_RESET_HOUR = 3;
let CURRENT_TIME_FORMAT = "24h"; // "24h" | "12h"
export function updateAppSettings(settings) {
  if (!settings) return;
  if (typeof settings.dayResetHour === "number") CURRENT_RESET_HOUR = settings.dayResetHour;
  if (settings.timeFormat === "12h" || settings.timeFormat === "24h") CURRENT_TIME_FORMAT = settings.timeFormat;
}

export function fmtClock(ts) {
  const d = new Date(ts);
  if (CURRENT_TIME_FORMAT === "12h") return fmtAMPM(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fmtAMPM(ts) {
  const d = new Date(ts);
  let h = d.getHours();
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12; if (h === 0) h = 12;
  return `${ap} ${h}:${pad(d.getMinutes())}`;
}
export function dateKey(d) {
  const dt = new Date(d);
  dt.setHours(dt.getHours() - CURRENT_RESET_HOUR);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
// hour-of-day on a 3AM-3AM scale: times before 3AM read as 24:xx-26:xx so they still
// plot on the previous logical day instead of wrapping to 0
export function logicalMinutes(ts) {
  const d = new Date(ts);
  let h = d.getHours() + d.getMinutes() / 60;
  if (h < CURRENT_RESET_HOUR) h += 24;
  return Math.round(h * 60);
}
export function minutesToClock(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
export function todayKey() { return dateKey(new Date()); }
export function addDays(d, n) { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt; }
export function startOfWeek(d) {
  const dt = new Date(d); const day = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - day); dt.setHours(0, 0, 0, 0); return dt;
}
export function weekdayIdx(dateStr) { const d = new Date(dateStr + "T00:00:00"); return (d.getDay() + 6) % 7; }
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAYS_SHORT3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export function fmtLongDate(d) {
  const dt = new Date(d);
  return `${dt.getDate()} ${MONTHS_LONG[dt.getMonth()]} ${dt.getFullYear()}, ${WEEKDAYS_SHORT3[dt.getDay()]}`;
}
export const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export function defaultData() {
  return { logs: [], sessions: [], todos: [], planner: [], dday: { label: "D-DAY", date: null }, settings: { timeFormat: "24h", dayResetHour: 3 } };
}

