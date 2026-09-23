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
// Always 24-hour "HH:MM", regardless of the display time-format setting.
// Native <input type="time"> only ever accepts/produces this format, so any
// code that reads or writes such an input must use this, never fmtClock —
// feeding it a 12h "11:53 AM" string silently produces an invalid Date.
export function fmt24(ts) {
  const d = new Date(ts);
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
// One-time migration for sessions logged before per-session notes existed.
// A session with no `note` field at all (undefined, not "") was still
// pointing at the old shared per-log-per-day note, which changes live as
// the note draft is edited — freeze it as of right now so it stops moving,
// same as if it had been baked in when the session was created.
export function migrateSessionNotes(sessions, logs) {
  return sessions.map(s => {
    if (s.note !== undefined) return s;
    const log = logs.find(l => l.id === s.logId);
    const legacyNote = log?.notesByDate ? (log.notesByDate[s.date] || "") : "";
    return { ...s, note: legacyNote };
  });
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

// Consecutive-day streak for a single log against a daily goal (in seconds),
// counting only days that actually hit the goal. opts.asOf lets a caller ask
// "what would this be if today were some other date" — used when figuring
// out how long a streak was right before it broke.
export function computeStreak(sessions, logId, goalSeconds, opts = {}) {
  if (!goalSeconds || goalSeconds <= 0) return 0;
  const { asOf } = opts;
  const totals = {};
  sessions.forEach(s => {
    if (s.logId !== logId) return;
    totals[s.date] = (totals[s.date] || 0) + s.duration;
  });
  const hit = (k) => (totals[k] || 0) >= goalSeconds;
  let streak = 0;
  let cursor = asOf ? new Date(asOf) : new Date();
  const todayStr = dateKey(cursor);
  if (hit(todayStr)) { streak++; }
  cursor = addDays(cursor, -1);
  while (true) {
    const k = dateKey(cursor);
    if (hit(k)) { streak++; cursor = addDays(cursor, -1); }
    else break;
  }
  return streak;
}

// The number that should actually be shown next to a log: whatever's been
// banked from before its last restored gap (streakOffset), plus however
// many real, consecutive days it's been hit since. A missed-and-restored
// gap contributes nothing to the count itself — it just doesn't zero out
// what came before it.
export function effectiveStreak(log, sessions, asOf) {
  if (!log.streakGoalSec) return 0;
  return (log.streakOffset || 0) + computeStreak(sessions, log.id, log.streakGoalSec, { asOf });
}
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
  return {
    logs: [], sessions: [], todos: [], planner: [], dday: { label: "D-DAY", date: null },
    settings: { timeFormat: "24h", dayResetHour: 3, storyHour: 8, storyMinute: 0 },
    // Comeback-story feature: lastShownDate is the plain calendar date (not the
    // logical/reset-hour day) the story was last completed on. pendingDate is
    // set when a story is due but hasn't been fetched/shown yet (e.g. no
    // internet) — the app keeps retrying on every open until it succeeds.
    // usedIds rotates through STORY_SUBJECTS without repeats; history keeps
    // every story ever shown so it can be revisited later.
    story: { lastShownDate: null, pendingDate: null, usedIds: [], history: [] },
    // XP: total is lifetime (drives level, never decreases), spendable is the
    // balance streak-restores draw down. capDate/capEarned track today's
    // earn-cap so a single day can't inflate level progress indefinitely.
    xp: { total: 0, spendable: 0, capDate: null, capEarned: 0 },
    // Bumped on every save (see scheduleSave) — lets the cloud-vs-local load
    // pick whichever copy is actually newer instead of always trusting one.
    updatedAt: 0,
    // Sessions that were unreadable (no usable start time) are parked here
    // instead of being deleted, so nothing is ever silently thrown away.
    quarantine: [],
  };
}

// Plain calendar date (device-local, NOT affected by dayResetHour) — the
// comeback-story feature runs on its own clock (storyHour/storyMinute),
// separate from the logging day.
export function calendarDateKey(d = new Date()) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// ===================== XP + streak restore =====================
// Design (see conversation): XP is a single global pool shared across all
// logs. It drives two things — a Duolingo-style level (lifetime total,
// never decreases) and a spendable balance that streak-restores draw down.
// A daily cap keeps one very long logging day from inflating either.

export const DAILY_XP_CAP = 300;
export const XP_PER_10MIN = 5;
export const DAILY_GOAL_BONUS_XP = 50;
export const RESTORE_XP_COST = 200;
export const MAX_FREEZE_TOKENS = 2;
export const FREEZE_MINUTES_PER_TOKEN = 60;
export const LIFELINE_COOLDOWN_DAYS = 30;

export function xpForSeconds(sec) {
  return Math.floor(Math.max(0, sec) / 600) * XP_PER_10MIN;
}

// Reading a streak's current length into a small multiplier so keeping a
// streak alive keeps paying off, not just hitting the goal once.
export function streakMultiplier(streakCount) {
  if (streakCount >= 30) return 1.5;
  if (streakCount >= 7) return 1.2;
  return 1;
}

// level 1 -> 2 costs 100 XP, each next level costs ~1.3x more (cumulative,
// based on lifetime total — spending XP on restores never drops your level).
export function levelInfo(totalXp) {
  let level = 1, need = 100, cumulative = 0;
  const xp = Math.max(0, totalXp || 0);
  while (xp >= cumulative + need) {
    cumulative += need;
    level++;
    need = Math.round(need * 1.3);
  }
  return { level, xpIntoLevel: xp - cumulative, xpForNextLevel: need };
}

// Adds `gained` XP to the pool, respecting the daily earn-cap. Returns a new
// xp object; never mutates the one passed in.
export function applyXpGain(xp, gained, todayKeyStr = todayKey()) {
  const base = xp || { total: 0, spendable: 0, capDate: null, capEarned: 0 };
  const reset = base.capDate !== todayKeyStr;
  const capEarned = reset ? 0 : (base.capEarned || 0);
  const room = Math.max(0, DAILY_XP_CAP - capEarned);
  const actual = Math.max(0, Math.min(gained, room));
  return {
    total: (base.total || 0) + actual,
    spendable: (base.spendable || 0) + actual,
    capDate: todayKeyStr,
    capEarned: capEarned + actual,
  };
}

// Freeze tokens accrue from logging extra time beyond the daily goal — every
// FREEZE_MINUTES_PER_TOKEN minutes of overtime banks one, capped at
// MAX_FREEZE_TOKENS. freezeCredit tracks how many of today's extra minutes
// have already been converted, so re-running this on every session save
// doesn't double-grant.
export function applyFreezeAccrual(log, todayTotalSec, todayKeyStr) {
  if (!log.streakGoalSec) return log;
  const extraMinutes = Math.floor(Math.max(0, todayTotalSec - log.streakGoalSec) / 60);
  const prevCredited = (log.freezeCredit && log.freezeCredit.date === todayKeyStr) ? log.freezeCredit.minutes : 0;
  if (extraMinutes <= prevCredited) {
    return log.freezeCredit && log.freezeCredit.date === todayKeyStr ? log : { ...log, freezeCredit: { date: todayKeyStr, minutes: extraMinutes } };
  }
  const newTokens = Math.floor((extraMinutes - prevCredited) / FREEZE_MINUTES_PER_TOKEN);
  if (newTokens <= 0) return { ...log, freezeCredit: { date: todayKeyStr, minutes: extraMinutes } };
  const current = log.freezeTokens || 0;
  const grantable = Math.min(newTokens, Math.max(0, MAX_FREEZE_TOKENS - current));
  return { ...log, freezeTokens: current + grantable, freezeCredit: { date: todayKeyStr, minutes: extraMinutes } };
}

// Runs after a session is added: awards time-based XP (with streak
// multiplier), the once-per-day goal-completion bonus, and freeze-token
// accrual — all in one pass so callers only need one scheduleSave.
export function applySessionEffects(data, session) {
  const sessions = [...data.sessions, session];
  let logs = data.logs;
  const log = logs.find(l => l.id === session.logId);
  let xp = data.xp;

  if (log) {
    const streakCount = log.streakGoalSec ? effectiveStreak(log, sessions) : 0;
    const mult = streakMultiplier(streakCount);
    xp = applyXpGain(xp, Math.round(xpForSeconds(session.duration) * mult), session.date);

    if (log.streakGoalSec) {
      const todayTotal = sessions.filter(s => s.logId === log.id && s.date === session.date).reduce((a, s) => a + s.duration, 0);
      let nextLog = applyFreezeAccrual(log, todayTotal, session.date);

      // Once-per-day bonus for hitting today's goal.
      if (todayTotal >= log.streakGoalSec && nextLog.lastBonusDate !== session.date) {
        xp = applyXpGain(xp, Math.round(DAILY_GOAL_BONUS_XP * mult), session.date);
        nextLog = { ...nextLog, lastBonusDate: session.date };
      }

      // Resolve a pending "catch-up" restore once today's (or a later day's,
      // if they didn't get to it same-day) total covers double the goal —
      // banks the pre-break streak length and drops the whole missed gap.
      if (nextLog.catchUpTarget && session.date >= nextLog.catchUpTarget.date && todayTotal >= nextLog.catchUpTarget.neededSeconds) {
        nextLog = {
          ...nextLog,
          streakOffset: nextLog.brokenStreak?.priorStreak || nextLog.streakOffset || 0,
          catchUpTarget: null,
          brokenStreak: null,
        };
      }

      logs = logs.map(l => (l.id === log.id ? nextLog : l));
    }
  }

  return { ...data, sessions, logs, xp };
}

// Looks for a streak-break that happened before today — walking back day by
// day from yesterday, collecting every consecutive missed day (there can be
// more than one) until it finds a real hit. If a real streak was standing
// right before that gap started, flags it (log.brokenStreak) so the restore
// modal can offer to bank that streak length and pick up from here — the
// missed days themselves are never counted, only skipped over.
export function detectBrokenStreak(log, sessions, now) {
  if (!log.streakGoalSec) return log;
  if (log.brokenStreak) return log; // already flagged, waiting on the user
  const yesterday = addDays(now, -1);
  const yKey = dateKey(yesterday);
  if (log.lastBrokenCheck === yKey) return log; // already checked this day, nothing new
  const totals = {};
  sessions.forEach(s => { if (s.logId === log.id) totals[s.date] = (totals[s.date] || 0) + s.duration; });
  const hit = (k) => (totals[k] || 0) >= log.streakGoalSec;

  if (hit(yKey)) return { ...log, lastBrokenCheck: yKey }; // no break

  const missedDates = [];
  let cursor = yesterday;
  while (!hit(dateKey(cursor))) {
    missedDates.unshift(dateKey(cursor));
    cursor = addDays(cursor, -1);
    // Bail out if this stretches back further than the log has any
    // sessions for at all — nothing to restore, just an old/unused log.
    if (missedDates.length > 365) return { ...log, lastBrokenCheck: yKey };
  }
  // cursor now sits on the last real hit before the gap — bank the full
  // effective streak (offset + real chain) as of that day.
  const priorStreak = effectiveStreak(log, sessions, cursor);
  if (priorStreak <= 0) return { ...log, lastBrokenCheck: yKey };
  return { ...log, lastBrokenCheck: yKey, brokenStreak: { dates: missedDates, priorStreak } };
}


// ===================== logical-day timestamps =====================
// Builds a real timestamp from a "logical day" + clock time picked in a form.
// A time earlier than the day-reset hour (e.g. 01:00 with a 3am reset) belongs
// to the NIGHT AFTER that day, so it lands on the next calendar date. This
// keeps dateKey(start) === the day the person picked — before, a manual entry
// like "Mon 01:00" was stored under Monday, then silently moved to Sunday the
// next time the app reloaded and re-derived the day from the start time.
export function logicalDateTime(dateStr, hhmm) {
  const d = new Date(`${dateStr}T${hhmm}:00`);
  if (isNaN(d.getTime())) return d;
  if (d.getHours() < CURRENT_RESET_HOUR) d.setDate(d.getDate() + 1);
  return d;
}

// ===================== load-time data safety =====================
function toNum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

// Repairs what can be repaired and separates what can't. NOTHING is deleted
// here: unrecoverable rows are returned in `quarantined` for the caller to keep.
export function repairSessions(list) {
  const kept = [];
  const quarantined = [];
  const seen = new Map(); // id -> fingerprint
  (Array.isArray(list) ? list : []).forEach(raw => {
    if (!raw || typeof raw !== "object") return;
    const s = { ...raw };
    s.start = toNum(s.start); s.end = toNum(s.end); s.duration = toNum(s.duration);
    const hasStart = Number.isFinite(s.start);
    const hasEnd = Number.isFinite(s.end);
    const hasDur = Number.isFinite(s.duration) && s.duration > 0;
    if (hasStart && hasEnd && !hasDur) s.duration = Math.round((s.end - s.start) / 1000);
    else if (hasStart && !hasEnd && hasDur) s.end = s.start + s.duration * 1000;
    else if (!hasStart && hasEnd && hasDur) s.start = s.end - s.duration * 1000;
    const ok = Number.isFinite(s.start) && Number.isFinite(s.end) && Number.isFinite(s.duration) && s.duration > 0 && !!s.logId;
    if (!ok) { quarantined.push(raw); return; }
    if (!s.id) s.id = uid();
    const fp = `${s.logId}|${s.start}|${s.end}`;
    if (seen.has(s.id)) {
      if (seen.get(s.id) === fp) return; // byte-for-byte copy of a row already kept
      s.id = uid(); // same id, different session: keep both
    }
    seen.set(s.id, fp);
    kept.push(s);
  });
  return { sessions: kept, quarantined };
}

// The ONE place any stored/cloud/imported copy of the data goes through before
// the app uses it. Order matters: the saved day-reset hour must be applied
// BEFORE any dateKey() call. Previously the load code ran dateKey() while the
// module still held the default 3am, so anyone with a different reset hour had
// every session's day re-derived with the wrong hour on each app open.
export function prepareLoadedData(raw) {
  const base = defaultData();
  const merged = { ...base, ...(raw || {}) };
  merged.settings = { ...base.settings, ...((raw && raw.settings) || {}) };
  updateAppSettings(merged.settings);
  if (!Array.isArray(merged.logs)) merged.logs = [];
  const { sessions: repaired, quarantined } = repairSessions(merged.sessions);
  const sessions = migrateSessionNotes(
    repaired.map(s => ({ ...s, date: dateKey(s.start) })),
    merged.logs,
  );
  let quarantine = Array.isArray(merged.quarantine) ? merged.quarantine : [];
  if (quarantined.length) {
    const have = new Set(quarantine.map(q => JSON.stringify(q)));
    quarantined.forEach(q => {
      const k = JSON.stringify(q);
      if (!have.has(k)) { have.add(k); quarantine = [...quarantine, q]; }
    });
  }
  return { ...merged, sessions, quarantine };
}

// ===================== health check + repair =====================
export function auditData(data) {
  const logs = Array.isArray(data?.logs) ? data.logs : [];
  const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
  const logIds = new Set(logs.map(l => l.id));
  const orphanIds = new Set();
  let orphanSessions = 0, duplicates = 0, totalSec = 0;
  const seen = new Set();
  sessions.forEach(s => {
    totalSec += s.duration || 0;
    if (!logIds.has(s.logId)) { orphanIds.add(s.logId); orphanSessions++; }
    const fp = `${s.logId}|${s.start}|${s.end}`;
    if (seen.has(fp)) duplicates++; else seen.add(fp);
  });
  const badParents = logs.filter(l => l.parentId && !logIds.has(l.parentId) && !orphanIds.has(l.parentId)).length;
  return {
    logCount: logs.length,
    sessionCount: sessions.length,
    totalSec,
    orphanLogCount: orphanIds.size,
    orphanSessions,
    duplicates,
    badParents,
    quarantined: Array.isArray(data?.quarantine) ? data.quarantine.length : 0,
  };
}

// Non-destructive fixes only: sessions whose timer vanished get a placeholder
// timer to live under (rename it afterwards), sub-logs pointing at a missing
// parent become top-level, and exact duplicate sessions collapse to one.
export function repairData(data) {
  const logs = [...(data.logs || [])];
  const ids = new Set(logs.map(l => l.id));
  const orphans = [];
  (data.sessions || []).forEach(s => { if (!ids.has(s.logId) && !orphans.includes(s.logId)) orphans.push(s.logId); });
  orphans.forEach((id, i) => {
    logs.push({ id, name: `Recovered timer ${i + 1}`, color: COLORS[logs.length % COLORS.length], parentId: null });
    ids.add(id);
  });
  const fixedLogs = logs.map(l => (l.parentId && !ids.has(l.parentId)) ? { ...l, parentId: null } : l);
  const seen = new Set();
  const sessions = (data.sessions || []).filter(s => {
    const fp = `${s.logId}|${s.start}|${s.end}`;
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
  return { ...data, logs: fixedLogs, sessions };
}

// ===================== automatic local snapshots =====================
// A rolling set of full copies kept on THIS device, taken right before other
// data (from the cloud, an import, a repair) replaces what's here. If a bad
// version of the app — or a bad sync — ever damages the data again, the last
// good copy is still one tap away in Settings → Data recovery.
export const SNAPSHOT_KEY = "timelogger-snapshots-v1";
const MAX_SNAPSHOTS = 8;
const GAP_MS = { auto: 6 * 3600 * 1000, protect: 2 * 60 * 1000, manual: 0 };

export function readSnapshots() {
  try {
    const list = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}
function snapshotSig(d) {
  const sessions = Array.isArray(d.sessions) ? d.sessions : [];
  let total = 0;
  sessions.forEach(s => { total += Number(s.duration) || 0; });
  return `${(d.logs || []).length}|${sessions.length}|${total}`;
}
export function pushSnapshot(data, reason, { mode = "auto" } = {}) {
  try {
    if (!data || !Array.isArray(data.sessions) || !Array.isArray(data.logs)) return;
    if (data.sessions.length === 0 && data.logs.length === 0) return;
    const snaps = readSnapshots();
    const sig = snapshotSig(data);
    const last = snaps[0];
    if (last && last.sig === sig) return;
    if (last && Date.now() - last.at < (GAP_MS[mode] ?? GAP_MS.auto)) return;
    let total = 0;
    data.sessions.forEach(s => { total += Number(s.duration) || 0; });
    const entry = { at: Date.now(), reason, sig, logs: data.logs.length, sessions: data.sessions.length, totalSec: total, data };
    let next = [entry, ...snaps].slice(0, MAX_SNAPSHOTS);
    while (next.length > 0) {
      try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next)); return; }
      catch (e) { next = next.slice(0, -1); } // storage full: drop the oldest and retry
    }
  } catch (e) { /* snapshots are best-effort; never break the app over them */ }
}
