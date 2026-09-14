import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import {
  Play, Pause, Plus, X, Check, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Trash2,
  Download, Upload, Home as HomeIcon, CheckSquare, Calendar as CalendarIcon,
  Cloud, CloudOff, Loader2, Pencil, Flag, StickyNote, LogOut, Settings as SettingsIcon, Flame
} from "lucide-react";
import { logout, watchAuth, signUpWithUsername, signInWithUsername, loadCloudData, saveCloudData, watchCloudData, setCloudActiveTimer, watchCloudActiveTimer } from "./firebase";

import {
  STORAGE_KEY, ACTIVE_TIMER_KEY, COLORS,
  hslToHex, satOf, hueOf, hsbToHex, hexToHsb, isValidHex, rootLogId, uid, pad,
  fmtHMS, fmtHM, updateAppSettings, fmtClock, fmtAMPM, dateKey, logicalMinutes,
  minutesToClock, todayKey, addDays, startOfWeek, weekdayIdx,
  WEEKDAYS, WEEKDAYS_SHORT3, MONTHS, MONTHS_LONG, fmtLongDate, defaultData, computeStreak,
  applySessionEffects, detectBrokenStreak, RESTORE_XP_COST, effectiveStreak,
} from "./helpers.js";
import { SessionRow, GroupedSessionList } from "./SessionViews.jsx";
import { StoryGate, StoryHistoryModal } from "./ComebackStory.jsx";
import { StreakRestoreModal, HeaderXpBadge, RestorePill } from "./Xp.jsx";
// Statistics uses recharts (the app's single heaviest dependency) — loading
// it lazily means it's only downloaded when the person actually opens the
// Statistics tab, instead of on every app open. This is the main fix for
// slow initial loads on phones.
const StatisticsPanel = lazy(() => import("./Statistics.jsx"));

function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-neutral-900 w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-100">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-neutral-800"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TopSyncBar({ isOnline, onExport, onImport, user, syncing, setSkippedLogin }) {
  const fileRef = useRef(null);
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-white/20 text-white">
        {isOnline ? <Cloud size={13} /> : <CloudOff size={13} />}
        {!isOnline ? "Offline" : syncing ? "Syncing…" : user ? "Synced" : "Online"}
      </span>
      <button onClick={onExport} title="Export backup" className="p-1.5 rounded-full bg-white/20 text-white"><Download size={14} /></button>
      <button onClick={() => fileRef.current?.click()} title="Import backup" className="p-1.5 rounded-full bg-white/20 text-white"><Upload size={14} /></button>
      <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onImport} />
      {user ? (
        <button onClick={() => logout().catch(() => {})} title={`Signed in as ${(user.email || "").replace("@timelogger.local", "")}`} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-white/20 text-white">
          <LogOut size={13} /> Sign out
        </button>
      ) : (
        <button onClick={() => setSkippedLogin(false)} title="Sign in to sync" className="text-[11px] px-2 py-1 rounded-full bg-white/20 text-white">Sign in</button>
      )}
    </div>
  );
}

function BottomNav({ nav, setNav }) {
  const items = [
    { id: "home", label: "Home", Icon: HomeIcon },
    { id: "todo", label: "To-Do", Icon: CheckSquare },
    { id: "calendar", label: "Calendar", Icon: CalendarIcon },
  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-neutral-900 border-t border-neutral-800 flex justify-around py-2 max-w-md mx-auto z-30">
      {items.map(({ id, label, Icon }) => (
        <button key={id} onClick={() => setNav(id)} className={`flex flex-col items-center gap-0.5 px-4 py-1 ${nav === id ? "text-orange-400" : "text-gray-500"}`}>
          <Icon size={20} />
          <span className="text-[11px] font-medium">{label}</span>
        </button>
      ))}
    </div>
  );
}


export default function App() {
  const [data, setData] = useState(defaultData());
  useEffect(() => { updateAppSettings(data.settings); }, [data.settings]);
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  const [loaded, setLoaded] = useState(false);
  const [activeTimer, setActiveTimer] = useState(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_TIMER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  });
  const [now, setNow] = useState(Date.now());
  const [nav, setNav] = useState("home");
  const [homeTab, setHomeTab] = useState("timer");
  const [statsTab, setStatsTab] = useState("day");
  const [periodRange, setPeriodRange] = useState(30);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [user, setUser] = useState(undefined); // undefined = still checking, null = logged out
  const [syncing, setSyncing] = useState(false);
  const [skippedLogin, setSkippedLogin] = useState(false);
  const [authUsername, setAuthUsername] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [authMode, setAuthMode] = useState("signin"); // "signin" | "signup"
  const [authError, setAuthError] = useState("");

  const [addLogOpen, setAddLogOpen] = useState(false);
  const [newLogName, setNewLogName] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualLogId, setManualLogId] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualMode, setManualMode] = useState("duration");
  const [manualStart, setManualStart] = useState("09:00");
  const [manualEnd, setManualEnd] = useState("10:00");
  const [manualH, setManualH] = useState("0");
  const [manualM, setManualM] = useState("30");
  const [logMenuId, setLogMenuId] = useState(null);
  const [renameId, setRenameId] = useState(null);
  const [renameVal, setRenameVal] = useState("");
  const [colorPickerId, setColorPickerId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [subLogOpen, setSubLogOpen] = useState(false);
  const [subLogParentId, setSubLogParentId] = useState(null);
  const [subLogName, setSubLogName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storyHistoryOpen, setStoryHistoryOpen] = useState(false);
  const [celebration, setCelebration] = useState(null); // { name, color, streak } | null

  // ---------- auth ----------
  useEffect(() => watchAuth(setUser), []);

  // ---------- load: local data, immediately, independent of auth ----------
  // This used to be nested inside the cloud-sync effect below, gated behind
  // "wait until we know if you're logged in" — which meant the whole app
  // sat on a blank loading screen until the Firebase SDK finished its
  // network round-trip, even though reading localStorage is instant. Now
  // the app is usable right away; the cloud check happens quietly after.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const local = JSON.parse(raw);
        setData({
          ...defaultData(),
          ...local,
          sessions: (local.sessions || []).map(s => ({ ...s, date: dateKey(s.start) })),
        });
      }
    } catch (e) { /* nothing saved locally yet */ }
    setLoaded(true);
  }, []);

  // ---------- load: cloud data, once auth resolves ----------
  // Always read from the local copy first (works fully offline, instant).
  // Once logged in, also check the cloud copy and use whichever is newer.
  useEffect(() => {
    if (user === undefined) return; // wait until auth state is known
    (async () => {
      let local = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) local = JSON.parse(raw);
      } catch (e) { /* nothing saved locally yet */ }

      let cloud = null;
      if (user) {
        try { cloud = await loadCloudData(user.uid); } catch (e) { /* offline, that's fine */ }
      }

      // Pick whichever copy was actually saved more recently — a device
      // that's been offline (or a reload that raced the debounced cloud
      // write) shouldn't have its newer local data clobbered by an older
      // cloud snapshot just because a cloud copy exists at all.
      const chosen = (cloud && (cloud.updatedAt || 0) >= (local?.updatedAt || 0)) ? cloud : local;
      if (chosen) {
        const migrated = {
          ...defaultData(),
          ...chosen,
          sessions: (chosen.sessions || []).map(s => ({ ...s, date: dateKey(s.start) })),
        };
        setData(migrated);
        // If local turned out to be the newer copy (this device had data the
        // cloud didn't have yet, or a save never made it up before a reload),
        // push it up right away — don't wait for the next log entry.
        if (user && chosen === local) {
          persist(migrated);
        }
      }
      setLoaded(true);
    })();
  }, [user]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  const saveTimer = useRef(null);
  const lastSavedAtRef = useRef(0);
  function scheduleSave(next) {
    const stamped = { ...next, updatedAt: Date.now() };
    setData(stamped);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(stamped), 350);
    return stamped;
  }
  async function persist(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) { /* local write failed; data still lives in memory/state */ }
    if (user) {
      try {
        setSyncing(true);
        const savedAt = Date.now();
        await saveCloudData(user.uid, next); // Firestore queues this offline and sends it once online
        lastSavedAtRef.current = savedAt;
        setSyncing(false);
      } catch (e) { setSyncing(false); /* will retry on next save, or Firestore's own offline queue handles it */ }
    }
  }

  // ---------- live cross-device sync ----------
  // Besides the load-once-on-login above, keep listening: if the data
  // changes from another device (a session gets logged, a log renamed,
  // etc.), pull it in here too — skip it if it's just the echo of our own
  // last save landing back from the server.
  useEffect(() => {
    if (!user) return;
    const unsub = watchCloudData(user.uid, (doc) => {
      if (!doc || !doc.updatedAt || doc.updatedAt <= lastSavedAtRef.current) return;
      const chosen = doc.payload;
      if (!chosen) return;
      const migrated = {
        ...defaultData(),
        ...chosen,
        sessions: (chosen.sessions || []).map(s => ({ ...s, date: dateKey(s.start) })),
      };
      setData(migrated);
    });
    return unsub;
  }, [user]);

  // The currently-running timer (if any) is mirrored live across devices —
  // so if you start "Study" on your PC, your phone shows it running too,
  // in real time, without needing to stop it first.
  useEffect(() => {
    if (!user) return;
    const unsub = watchCloudActiveTimer(user.uid, (remote) => {
      setActiveTimer((current) => {
        if (JSON.stringify(current) === JSON.stringify(remote)) return current;
        return remote;
      });
    });
    return unsub;
  }, [user]);

  // ---------- timer tick ----------
  useEffect(() => {
    try {
      if (activeTimer) localStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(activeTimer));
      else localStorage.removeItem(ACTIVE_TIMER_KEY);
    } catch (e) {}
    if (!activeTimer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeTimer]);

  // A slower independent tick (no active timer required) so the comeback-story
  // gate notices its scheduled time passing even if the person just has the
  // app sitting open without a timer running.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Sweeps every streak-goal log once in a while, looking for a streak that
  // broke yesterday, and flags it (log.brokenStreak) so the restore modal
  // can offer to fix it. Cheap no-op once a day per log once already checked.
  useEffect(() => {
    const cur = dataRef.current;
    let changed = false;
    const logs = cur.logs.map(l => {
      const next = detectBrokenStreak(l, cur.sessions, new Date(now));
      if (next !== l) changed = true;
      return next;
    });
    if (changed) scheduleSave({ ...cur, logs });
  }, [now]);

  const [restoreModalLogId, setRestoreModalLogId] = useState(null);
  const restoreModalLog = data.logs.find(l => l.id === restoreModalLogId) || null;

  function resolveStreakRestore(logId, method) {
    const log = dataRef.current.logs.find(l => l.id === logId);
    if (!log || !log.brokenStreak) return;
    const bankedStreak = log.brokenStreak.priorStreak;
    let nextData = dataRef.current;

    if (method === "freeze" && (log.freezeTokens || 0) > 0) {
      nextData = {
        ...nextData,
        logs: nextData.logs.map(l => l.id === logId ? {
          ...l, freezeTokens: (l.freezeTokens || 0) - 1, catchUpTarget: null,
          streakOffset: bankedStreak, brokenStreak: null,
        } : l),
      };
    } else if (method === "xp" && (nextData.xp?.spendable || 0) >= RESTORE_XP_COST) {
      nextData = {
        ...nextData,
        xp: { ...nextData.xp, spendable: nextData.xp.spendable - RESTORE_XP_COST },
        logs: nextData.logs.map(l => l.id === logId ? {
          ...l, catchUpTarget: null,
          streakOffset: bankedStreak, brokenStreak: null,
        } : l),
      };
    } else if (method === "catchup") {
      // Doesn't resolve immediately — stays pending (and brokenStreak stays
      // set, holding the banked amount) until today's logged time actually
      // covers it, or the person reopens this and picks something else.
      nextData = {
        ...nextData,
        logs: nextData.logs.map(l => l.id === logId ? {
          ...l,
          catchUpTarget: { date: todayKey(), neededSeconds: (l.streakGoalSec || 0) * 2 },
        } : l),
      };
    } else if (method === "lifeline") {
      nextData = {
        ...nextData,
        logs: nextData.logs.map(l => l.id === logId ? {
          ...l, lastLifelineDate: todayKey(), catchUpTarget: null,
          streakOffset: bankedStreak, brokenStreak: null,
        } : l),
      };
    } else {
      return;
    }
    scheduleSave(nextData);
    setRestoreModalLogId(null);
  }

  function dismissStreakRestore(logId) {
    scheduleSave({
      ...dataRef.current,
      logs: dataRef.current.logs.map(l => l.id === logId ? { ...l, brokenStreak: null, catchUpTarget: null, streakOffset: 0 } : l),
    });
    setRestoreModalLogId(null);
  }

  function toggleLog(logId) {
    setActiveTimer((prev) => {
      let next;
      if (prev) {
        const endedAt = Date.now();
        const duration = Math.round((endedAt - prev.startedAt) / 1000);
        if (duration > 0) {
          // Bake in a snapshot of the log's current note draft at the moment
          // this session is finalized, rather than pointing at a shared
          // per-log-per-day note. This is what session.note captures — once
          // written it belongs to this session only, so later edits to the
          // draft (for the next session) can never rewrite history.
          const sKey = dateKey(prev.startedAt);
          const draftLog = dataRef.current.logs.find(l => l.id === prev.logId);
          const noteSnapshot = draftLog?.notesByDate?.[sKey] || "";
          const session = { id: uid(), logId: prev.logId, date: sKey, start: prev.startedAt, end: endedAt, duration, note: noteSnapshot };
          const nextData = applySessionEffects(dataRef.current, session);
          scheduleSave(nextData);
          checkStreakCelebration(session, nextData.sessions, nextData.logs);
        }
        next = prev.logId === logId ? null : { logId, startedAt: Date.now() };
      } else {
        next = { logId, startedAt: Date.now() };
      }
      if (user) setCloudActiveTimer(user.uid, next).catch(() => {});
      return next;
    });
  }

  // Fires the Duolingo-style celebration once per log per day, the moment
  // that log's total for today first reaches its streak goal.
  const celebratedRef = useRef(new Set());
  function checkStreakCelebration(newSession, allSessions, allLogs) {
    const logId = newSession.logId;
    const log = (allLogs || dataRef.current.logs).find(l => l.id === logId);
    if (!log || !log.streakGoalSec) return;
    const key = `${todayKey()}-${logId}`;
    if (celebratedRef.current.has(key)) return;
    const todaysTotal = allSessions.filter(s => s.logId === logId && s.date === newSession.date).reduce((a, s) => a + s.duration, 0);
    if (todaysTotal < log.streakGoalSec) return;
    const beforeThisSession = todaysTotal - newSession.duration;
    if (beforeThisSession >= log.streakGoalSec) { celebratedRef.current.add(key); return; } // already celebrated earlier today
    celebratedRef.current.add(key);
    const streakCount = effectiveStreak(log, allSessions);
    setCelebration({ name: log.name, color: log.color, streak: streakCount });
  }

  function addLog(name, parentId = null) {
    if (!name.trim()) return;
    const log = { id: uid(), name: name.trim(), color: COLORS[data.logs.length % COLORS.length], parentId: parentId || null };
    scheduleSave({ ...data, logs: [...data.logs, log] });
    setNewLogName(""); setAddLogOpen(false);
    setSubLogName(""); setSubLogOpen(false);
  }
  function setLogParent(id, newParentId) {
    // Guard against creating a cycle (can't move a log under one of its own
    // descendants) — only top-level logs are offered as targets in the UI
    // anyway, but this keeps the data safe if that ever changes.
    if (newParentId === id) return;
    scheduleSave({ ...data, logs: data.logs.map(l => l.id === id ? { ...l, parentId: newParentId || null } : l) });
    setLogMenuId(null);
  }
  function renameLog(id, name) {
    if (!name.trim()) return;
    scheduleSave({ ...data, logs: data.logs.map(l => l.id === id ? { ...l, name: name.trim() } : l) });
    setRenameId(null); setLogMenuId(null);
  }
  function setLogColor(id, color) {
    scheduleSave({ ...data, logs: data.logs.map(l => l.id === id ? { ...l, color } : l) });
    setColorPickerId(null); setLogMenuId(null);
  }
  // Same update, but keeps the color-wheel popover open — used while the
  // user is actively dragging, so it doesn't vanish after the first move.
  function setLogColorLive(id, color) {
    scheduleSave({ ...data, logs: data.logs.map(l => l.id === id ? { ...l, color } : l) });
  }
  function setLogNote(id, note) {
    const key = todayKey();
    scheduleSave({
      ...data,
      logs: data.logs.map(l => l.id === id ? { ...l, notesByDate: { ...(l.notesByDate || {}), [key]: note } } : l),
    });
  }
  // goalSeconds of 0/null clears the goal (and its streak, since there's
  // nothing to measure against anymore).
  function setLogStreakGoal(id, goalSeconds) {
    scheduleSave({
      ...data,
      logs: data.logs.map(l => l.id === id ? { ...l, streakGoalSec: goalSeconds || null } : l),
    });
  }
  function deleteLog(id) {
    // "Delete" now archives instead of erasing: the log (and its sub-logs)
    // disappear from the Timer list so you can't accidentally log more time
    // against them, but every session already recorded stays intact and
    // keeps showing up in Statistics/Calendar under that log's name and
    // colour — deleting a timer should never wipe out history you already
    // built up under it.
    const childIds = data.logs.filter(l => l.parentId === id).map(l => l.id);
    const archiveIds = [id, ...childIds];
    if (activeTimer && archiveIds.includes(activeTimer.logId)) setActiveTimer(null);
    scheduleSave({
      ...data,
      logs: data.logs.map(l => archiveIds.includes(l.id) ? { ...l, archived: true } : l),
    });
    setLogMenuId(null);
    setExpandedId(prev => (prev === id ? null : prev));
  }
  function moveLog(id, dir) {
    scheduleSave({ ...data, logs: reorderLog(data.logs, id, dir) });
  }

  function addManualSession() {
    if (!manualLogId || !manualDate) return;
    let duration = 0, startTs = null, endTs = null;
    if (manualMode === "duration") {
      duration = (parseInt(manualH || "0", 10) * 3600) + (parseInt(manualM || "0", 10) * 60);
      const base = new Date(manualDate + "T12:00:00");
      startTs = base.getTime();
      endTs = startTs + duration * 1000;
    } else {
      const s = new Date(`${manualDate}T${manualStart}:00`);
      let e = new Date(`${manualDate}T${manualEnd}:00`);
      if (e <= s) e = new Date(e.getTime() + 86400000);
      startTs = s.getTime(); endTs = e.getTime();
      duration = Math.round((endTs - startTs) / 1000);
    }
    if (duration <= 0) return;
    const session = { id: uid(), logId: manualLogId, date: manualDate, start: startTs, end: endTs, duration };
    const nextData = applySessionEffects(dataRef.current, session);
    scheduleSave(nextData);
    checkStreakCelebration(session, nextData.sessions, nextData.logs);
    setManualOpen(false);
  }

  // ---------- derived: today totals ----------
  const tKey = todayKey();
  const todaySessions = useMemo(() => data.sessions.filter(s => s.date === tKey), [data.sessions, tKey]);
  const todayTotal = useMemo(() => {
    let t = todaySessions.reduce((a, s) => a + s.duration, 0);
    if (activeTimer && dateKey(activeTimer.startedAt) === tKey) t += Math.floor((now - activeTimer.startedAt) / 1000);
    return t;
  }, [todaySessions, activeTimer, now, tKey]);
  const currentFocus = activeTimer ? Math.floor((now - activeTimer.startedAt) / 1000) : 0;

  function logTodayTotal(logId) {
    const childIds = data.logs.filter(l => l.parentId === logId).map(l => l.id);
    const ids = [logId, ...childIds];
    let t = todaySessions.filter(s => ids.includes(s.logId)).reduce((a, s) => a + s.duration, 0);
    if (activeTimer && ids.includes(activeTimer.logId) && dateKey(activeTimer.startedAt) === tKey) t += currentFocus;
    return t;
  }

  // ---------- export / import ----------
  function handleExport() {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `timelogger-backup-${todayKey()}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {}
  }
  function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        // An explicit import should win outright and land in the cloud
        // immediately — no waiting on the debounce, which a quick reload
        // right after importing could otherwise race and lose.
        const stamped = scheduleSave({ ...defaultData(), ...parsed });
        if (saveTimer.current) clearTimeout(saveTimer.current);
        persist(stamped);
      } catch (err) {}
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500"><Loader2 className="animate-spin mr-2" size={18} />Loading…</div>;
  }

  if (user === null && !skippedLogin) {
    async function handleAuth(e) {
      e.preventDefault();
      setAuthError("");
      if (authUsername.trim().length < 3) { setAuthError("Username must be at least 3 characters."); return; }
      try {
        if (authMode === "signup") await signUpWithUsername(authUsername, authPass);
        else await signInWithUsername(authUsername, authPass);
      } catch (err) {
        const code = err.code || "";
        if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
          setAuthError("Wrong username or password.");
        } else if (code.includes("email-already-in-use")) {
          setAuthError("That username is already taken.");
        } else if (code.includes("weak-password")) {
          setAuthError("Password must be at least 6 characters.");
        } else {
          setAuthError(err.message.replace("Firebase: ", ""));
        }
      }
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-neutral-950 text-gray-100 px-6 text-center">
        <Cloud size={40} className="text-orange-400" />
        <h1 className="text-lg font-semibold">Sign in to sync across devices</h1>
        <p className="text-sm text-gray-400 max-w-xs">Logging works offline either way. Signing in lets this device's data follow you to your other devices.</p>

        <form onSubmit={handleAuth} className="w-full max-w-xs flex flex-col gap-2 mt-2">
          <input type="text" required autoCapitalize="off" autoCorrect="off" placeholder="Username" value={authUsername} onChange={e => setAuthUsername(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-sm text-gray-100 placeholder:text-gray-500" />
          <input type="password" required placeholder="Password" value={authPass} onChange={e => setAuthPass(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-sm text-gray-100 placeholder:text-gray-500" />
          {authError && <div className="text-xs text-red-400 text-left">{authError}</div>}
          <button type="submit" className="px-4 py-2 rounded-lg bg-orange-500 text-white font-medium text-sm">
            {authMode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
        <button onClick={() => { setAuthMode(m => m === "signup" ? "signin" : "signup"); setAuthError(""); }} className="text-xs text-gray-400 underline">
          {authMode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
        <button onClick={() => setSkippedLogin(true)} className="text-xs text-gray-500 underline mt-2">Skip, use this device only</button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto min-h-screen bg-neutral-950 pb-20 font-sans text-gray-100">
      {nav === "home" && (
        <HomeScreen
          data={data} setData={setData} scheduleSave={scheduleSave}
          activeTimer={activeTimer} toggleLog={toggleLog} currentFocus={currentFocus}
          todayTotal={todayTotal} logTodayTotal={logTodayTotal}
          homeTab={homeTab} setHomeTab={setHomeTab}
          statsTab={statsTab} setStatsTab={setStatsTab}
          periodRange={periodRange} setPeriodRange={setPeriodRange}
          customFrom={customFrom} setCustomFrom={setCustomFrom}
          customTo={customTo} setCustomTo={setCustomTo}
          addLogOpen={addLogOpen} setAddLogOpen={setAddLogOpen}
          newLogName={newLogName} setNewLogName={setNewLogName} addLog={addLog}
          manualOpen={manualOpen} setManualOpen={setManualOpen}
          manualLogId={manualLogId} setManualLogId={setManualLogId}
          manualDate={manualDate} setManualDate={setManualDate}
          manualMode={manualMode} setManualMode={setManualMode}
          manualStart={manualStart} setManualStart={setManualStart}
          manualEnd={manualEnd} setManualEnd={setManualEnd}
          manualH={manualH} setManualH={setManualH} manualM={manualM} setManualM={setManualM}
          addManualSession={addManualSession}
          logMenuId={logMenuId} setLogMenuId={setLogMenuId}
          renameId={renameId} setRenameId={setRenameId} renameVal={renameVal} setRenameVal={setRenameVal}
          renameLog={renameLog} deleteLog={deleteLog} moveLog={moveLog}
          colorPickerId={colorPickerId} setColorPickerId={setColorPickerId} setLogColor={setLogColor} setLogColorLive={setLogColorLive} setLogParent={setLogParent}
          setLogNote={setLogNote} setLogStreakGoal={setLogStreakGoal}
          expandedId={expandedId} setExpandedId={setExpandedId}
          subLogOpen={subLogOpen} setSubLogOpen={setSubLogOpen}
          subLogParentId={subLogParentId} setSubLogParentId={setSubLogParentId}
          subLogName={subLogName} setSubLogName={setSubLogName}
          isOnline={isOnline} user={user} syncing={syncing} setSkippedLogin={setSkippedLogin}
          settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen}
          onOpenRestore={setRestoreModalLogId}
          setStoryHistoryOpen={setStoryHistoryOpen}
          onExport={handleExport} onImport={handleImport}
          now={now}
        />
      )}
      {nav === "todo" && <TodoScreen data={data} scheduleSave={scheduleSave} />}
      {nav === "calendar" && <CalendarScreen data={data} activeTimer={activeTimer} currentFocus={currentFocus} scheduleSave={scheduleSave} />}

      <BottomNav nav={nav} setNav={setNav} />

      <StreakCelebration celebration={celebration} onClose={() => setCelebration(null)} />
      <StreakRestoreModal
        log={restoreModalLog}
        data={data}
        onResolve={(method) => resolveStreakRestore(restoreModalLog.id, method)}
        onDismiss={() => dismissStreakRestore(restoreModalLog.id)}
        onClose={() => setRestoreModalLogId(null)}
      />
      {/* Comeback story feature disabled for now — flip back on by uncommenting.
      <StoryGate data={data} scheduleSave={scheduleSave} now={now} /> */}
      {/* <StoryHistoryModal open={storyHistoryOpen} onClose={() => setStoryHistoryOpen(false)} story={data.story} /> */}
    </div>
  );
}

function StreakCelebration({ celebration, onClose }) {
  if (!celebration) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-6" onClick={onClose}>
      <div className="bg-neutral-900 rounded-3xl px-6 py-8 max-w-xs w-full text-center shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="relative w-28 h-28 mx-auto mb-5 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full opacity-20" style={{ backgroundColor: celebration.color }} />
          <Flame size={64} className="fill-orange-400 text-orange-400" style={{ filter: "drop-shadow(0 0 12px rgba(255,138,42,0.6))" }} />
        </div>
        <div className="text-3xl font-extrabold text-white mb-1">{celebration.streak} Day{celebration.streak === 1 ? "" : "s"} Streak!</div>
        <p className="text-sm text-gray-400 mb-6">You hit your daily goal for <span className="text-gray-200 font-medium">{celebration.name}</span> — keep it up!</p>
        <button onClick={onClose} className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-xl py-3 text-sm font-semibold">
          Continue
        </button>
      </div>
    </div>
  );
}

// ================= HOME =================
// Circular hue/saturation picker: angle around the wheel sets hue, distance
// from the center sets saturation (center = white/desaturated, edge = full
// hue). Lightness stays fixed so colors read consistently in the app's UI.
// Photoshop-style colour picker: a saturation/brightness square (for the
// currently-selected hue) plus a vertical hue slider and a hex input,
// all draggable with pointer/touch events.
function ColorWheel({ color, onChange }) {
  const safeColor = isValidHex(color) ? color : "#3399cc";
  const { h: hue, s: sat, v: bri } = hexToHsb(safeColor);
  const [hexDraft, setHexDraft] = useState(safeColor.slice(1));
  const squareRef = useRef(null);
  const hueRef = useRef(null);

  useEffect(() => { setHexDraft(safeColor.slice(1)); }, [safeColor]);

  function dragTrack(ref, onMove) {
    return function startDrag(e) {
      e.preventDefault();
      const move = (ev) => {
        const rect = ref.current.getBoundingClientRect();
        const point = ev.touches ? ev.touches[0] : ev;
        const x = Math.max(0, Math.min(1, (point.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (point.clientY - rect.top) / rect.height));
        onMove(x, y);
      };
      move(e);
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("touchmove", move);
        window.removeEventListener("touchend", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("touchmove", move, { passive: false });
      window.addEventListener("touchend", stop);
    };
  }

  const onSquareDrag = dragTrack(squareRef, (x, y) => {
    onChange(hsbToHex(hue, Math.round(x * 100), Math.round((1 - y) * 100)));
  });
  const onHueDrag = dragTrack(hueRef, (x, y) => {
    onChange(hsbToHex(Math.round(Math.max(0, Math.min(1, y)) * 360), sat, bri));
  });

  function commitHex(raw) {
    const cleaned = raw.trim().replace(/^#/, "");
    setHexDraft(cleaned);
    const withHash = `#${cleaned}`;
    if (isValidHex(withHash)) onChange(withHash.toLowerCase());
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-3">
        <div
          ref={squareRef}
          onPointerDown={onSquareDrag}
          onTouchStart={onSquareDrag}
          className="relative rounded-lg cursor-crosshair touch-none select-none"
          style={{
            width: 180, height: 180,
            backgroundColor: `hsl(${hue}, 100%, 50%)`,
            backgroundImage: "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
          }}
        >
          <div
            className="absolute w-4 h-4 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${sat}%`, top: `${100 - bri}%`, backgroundColor: safeColor, boxShadow: "0 0 0 1px rgba(0,0,0,0.4)" }}
          />
        </div>
        <div
          ref={hueRef}
          onPointerDown={onHueDrag}
          onTouchStart={onHueDrag}
          className="relative rounded-lg cursor-pointer touch-none select-none"
          style={{
            width: 20, height: 180,
            background: "linear-gradient(to bottom, red, yellow, lime, cyan, blue, magenta, red)",
          }}
        >
          <div
            className="absolute left-1/2 w-6 h-2.5 rounded-sm border-2 border-white -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ top: `${(hue / 360) * 100}%`, backgroundColor: `hsl(${hue}, 100%, 50%)`, boxShadow: "0 0 0 1px rgba(0,0,0,0.4)" }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-gray-400">
        <span className="w-5 h-5 rounded-full border border-neutral-700 shrink-0" style={{ backgroundColor: safeColor }} />
        <span>#</span>
        <input
          value={hexDraft}
          onChange={e => commitHex(e.target.value)}
          maxLength={6}
          className="w-20 bg-neutral-950 border border-neutral-700 text-gray-100 rounded px-2 py-1 text-xs uppercase tracking-wide"
        />
      </div>
      <div className="text-[10px] text-gray-500">drag the square or the bar to pick a colour</div>
    </div>
  );
}

function LogRow({ log, data, activeTimer, toggleLog, logTodayTotal, siblings,
  renameId, setRenameId, renameVal, setRenameVal, renameLog,
  logMenuId, setLogMenuId, colorPickerId, setColorPickerId, setLogColor, setLogColorLive, setLogParent, setLogNote, setLogStreakGoal, deleteLog, moveLog,
  allLogs, sessions, onOpenRestore,
  isChild, isExpanded, onToggleExpand }) {
  const isActive = activeTimer && activeTimer.logId === log.id;
  const idx = siblings.findIndex(l => l.id === log.id);
  const hasDatedNotes = !!log.notesByDate;
  const todayNote = hasDatedNotes ? (log.notesByDate[todayKey()] || "") : (log.note || "");
  const streakCount = log.streakGoalSec ? effectiveStreak(log, sessions || []) : 0;
  const [goalMenuOpen, setGoalMenuOpen] = useState(false);
  const [goalH, setGoalH] = useState(String(Math.floor((log.streakGoalSec || 0) / 3600)));
  const [goalM, setGoalM] = useState(String(Math.floor(((log.streakGoalSec || 0) % 3600) / 60)));
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(todayNote);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const moveTargets = (allLogs || []).filter(l => !l.parentId && l.id !== log.id && !l.archived);
  const hasOwnChildren = (allLogs || []).some(l => l.parentId === log.id);

  function openNote() {
    setNoteDraft(todayNote);
    setNoteOpen(true);
  }
  function saveNote() {
    setLogNote(log.id, noteDraft.trim());
    setNoteOpen(false);
  }

  return (
    <div className={`${isChild ? "pl-10 pr-5 py-2.5 bg-neutral-950/40" : "px-5 py-3.5"} border-b border-neutral-800 relative`}>
      <div className="flex items-center gap-2">
        {!isChild && (
          <button onClick={onToggleExpand} className="text-gray-500 shrink-0 p-1 -ml-1">
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
        <button onClick={() => toggleLog(log.id)} className={`${isChild ? "w-7 h-7" : "w-9 h-9"} rounded-full flex items-center justify-center text-white shrink-0`} style={{ backgroundColor: log.color }}>
          {isActive ? <Pause size={isChild ? 13 : 16} fill="white" /> : <Play size={isChild ? 13 : 16} fill="white" className="ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          {renameId === log.id ? (
            <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && renameLog(log.id, renameVal)}
              onBlur={() => renameLog(log.id, renameVal)}
              className="w-full border-b border-orange-300 outline-none text-sm py-0.5 bg-transparent" />
          ) : (
            <>
              <div className={isChild ? "text-sm text-gray-300" : "text-[15px] text-gray-100 font-medium"}>{log.name}</div>
              {todayNote && !noteOpen && (
                <div className="text-[11px] text-gray-500 truncate max-w-[160px]">{todayNote}</div>
              )}
            </>
          )}
        </div>
        {streakCount > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] text-orange-400 font-semibold shrink-0" title={`${streakCount}-day streak`}>
            <Flame size={12} className="fill-orange-400" />{streakCount}
          </span>
        )}
        <RestorePill log={log} onClick={() => onOpenRestore(log.id)} />
        <span className={`text-sm tabular-nums ${isActive ? "text-orange-400 font-semibold" : "text-gray-400"}`}>{fmtHMS(logTodayTotal(log.id))}</span>
        <button onClick={() => (noteOpen ? setNoteOpen(false) : openNote())} className={`p-1 shrink-0 ${todayNote ? "text-orange-400" : "text-gray-500"} hover:text-orange-400`}>
          <StickyNote size={15} />
        </button>
        <div className="flex flex-col shrink-0">
          <button onClick={() => moveLog(log.id, -1)} disabled={idx === 0}
            className={`leading-none px-1 ${idx === 0 ? "text-gray-700" : "text-gray-500 hover:text-orange-400"}`}>
            <ChevronUp size={13} />
          </button>
          <button onClick={() => moveLog(log.id, 1)} disabled={idx === siblings.length - 1}
            className={`leading-none px-1 ${idx === siblings.length - 1 ? "text-gray-700" : "text-gray-500 hover:text-orange-400"}`}>
            <ChevronDown size={13} />
          </button>
        </div>
        <button onClick={() => { setLogMenuId(logMenuId === log.id ? null : log.id); setColorPickerId(null); }} className="p-1 text-gray-500">⋮</button>
        {logMenuId === log.id && (
          <div className="absolute right-4 top-12 bg-neutral-900 shadow-lg rounded-lg border border-neutral-800 z-20 overflow-hidden min-w-[150px]">
            <button onClick={() => { setRenameId(log.id); setRenameVal(log.name); setLogMenuId(null); }} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-neutral-800 w-full"><Pencil size={14} />Rename</button>
            <button onClick={() => setColorPickerId(colorPickerId === log.id ? null : log.id)} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-neutral-800 w-full">
              <span className="w-3.5 h-3.5 rounded-full border border-neutral-600" style={{ backgroundColor: log.color }} />Change colour
            </button>
            {colorPickerId === log.id && (
              <div className="px-4 pb-3 pt-1 flex justify-center">
                <ColorWheel color={log.color} onChange={(hex) => setLogColorLive(log.id, hex)} />
              </div>
            )}
            {!hasOwnChildren && (
              <button onClick={() => setMoveMenuOpen(o => !o)} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-neutral-800 w-full">
                <ChevronRight size={14} />Move to…
              </button>
            )}
            {hasOwnChildren && (
              <div className="px-4 py-2 text-[10px] text-gray-600">Has sub-logs of its own, so it can't be moved under another log.</div>
            )}
            {moveMenuOpen && !hasOwnChildren && (
              <div className="max-h-40 overflow-y-auto border-t border-neutral-800">
                {log.parentId && (
                  <button onClick={() => setLogParent(log.id, null)} className="flex items-center gap-2 px-6 py-2 text-xs text-gray-400 hover:bg-neutral-800 w-full">
                    Make top-level log
                  </button>
                )}
                {moveTargets.length === 0 && !log.parentId && (
                  <div className="px-6 py-2 text-xs text-gray-500">No other top-level logs yet</div>
                )}
                {moveTargets.map(t => (
                  <button key={t.id} onClick={() => setLogParent(log.id, t.id)} className="flex items-center gap-2 px-6 py-2 text-xs text-gray-300 hover:bg-neutral-800 w-full">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                    Sub-log of {t.name}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setGoalMenuOpen(o => !o)} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-neutral-800 w-full">
              <Flame size={14} />Streak goal{log.streakGoalSec ? ` (${fmtHM(log.streakGoalSec)})` : ""}
            </button>
            {goalMenuOpen && (
              <div className="px-4 pb-3 pt-1 border-t border-neutral-800">
                <p className="text-[10px] text-gray-500 mb-2">Hit this much time on this log every day to build a streak.</p>
                <div className="flex gap-2 items-center mb-2">
                  <input type="number" min="0" value={goalH} onChange={e => setGoalH(e.target.value)}
                    className="w-14 bg-neutral-900 border border-neutral-700 text-gray-100 rounded px-2 py-1 text-xs text-center" />
                  <span className="text-gray-500 text-xs">h</span>
                  <input type="number" min="0" max="59" value={goalM} onChange={e => setGoalM(e.target.value)}
                    className="w-14 bg-neutral-900 border border-neutral-700 text-gray-100 rounded px-2 py-1 text-xs text-center" />
                  <span className="text-gray-500 text-xs">m</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setLogStreakGoal(log.id, (parseInt(goalH || "0", 10) * 3600) + (parseInt(goalM || "0", 10) * 60)); setGoalMenuOpen(false); }}
                    className="bg-orange-500 text-white rounded-lg px-3 py-1 text-xs font-medium">Save</button>
                  {log.streakGoalSec > 0 && (
                    <button onClick={() => { setLogStreakGoal(log.id, 0); setGoalH("0"); setGoalM("0"); setGoalMenuOpen(false); }} className="text-red-400 text-xs">Remove goal</button>
                  )}
                </div>
              </div>
            )}
            <button onClick={() => deleteLog(log.id)} className="flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-neutral-800 w-full"><Trash2 size={14} />Delete</button>
          </div>
        )}
      </div>

      {noteOpen && (
        <div className={`mt-2 ${isChild ? "ml-9" : "ml-11"}`}>
          <textarea
            autoFocus rows={2} value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
            placeholder="Add a note for today…"
            className="w-full bg-neutral-950 border border-neutral-700 text-gray-100 rounded-lg px-3 py-2 text-xs placeholder:text-gray-500 resize-none"
          />
          <div className="text-[10px] text-gray-600 mt-1">Resets when the day rolls over (see Settings → Day reset time).</div>
          <div className="flex gap-2 mt-1.5">
            <button onClick={saveNote} className="bg-orange-500 text-white rounded-lg px-3 py-1 text-xs font-medium">Save</button>
            <button onClick={() => setNoteOpen(false)} className="border border-neutral-700 text-gray-400 rounded-lg px-3 py-1 text-xs">Cancel</button>
            {todayNote && (
              <button onClick={() => { setLogNote(log.id, ""); setNoteDraft(""); setNoteOpen(false); }} className="text-red-400 text-xs ml-auto">Remove note</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HomeScreen(props) {
  const {
    data, activeTimer, toggleLog, currentFocus, todayTotal, logTodayTotal,
    homeTab, setHomeTab, addLogOpen, setAddLogOpen, newLogName, setNewLogName, addLog,
    logMenuId, setLogMenuId, renameId, setRenameId, renameVal, setRenameVal, renameLog, deleteLog, moveLog,
    colorPickerId, setColorPickerId, setLogColor, setLogColorLive, setLogParent, setLogNote, setLogStreakGoal,
    expandedId, setExpandedId, subLogOpen, setSubLogOpen, subLogParentId, setSubLogParentId, subLogName, setSubLogName,
    isOnline, user, syncing, setSkippedLogin, settingsOpen, setSettingsOpen, onExport, onImport,
    manualOpen, setManualOpen, manualLogId, setManualLogId, manualDate, setManualDate,
    manualMode, setManualMode, manualStart, setManualStart, manualEnd, setManualEnd,
    manualH, setManualH, manualM, setManualM, addManualSession,
    onOpenRestore,
  } = props;

  const topLevelLogs = data.logs.filter(l => !l.parentId && !l.archived);
  const subLogParent = data.logs.find(l => l.id === subLogParentId);

  return (
    <div>
      <div className="rounded-b-3xl px-5 pt-5 pb-6 text-white" style={{ background: "linear-gradient(135deg,#FF8A2A,#FF6B00)" }}>
        <div className="flex items-center justify-end mb-4 gap-2">
          <TopSyncBar isOnline={isOnline} onExport={onExport} onImport={onImport} user={user} syncing={syncing} setSkippedLogin={setSkippedLogin} />
          <button onClick={() => setSettingsOpen(true)} title="Settings" className="p-1.5 rounded-full bg-white/20 text-white"><SettingsIcon size={14} /></button>
        </div>
        <div className="flex items-stretch gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white/80 mb-1">{fmtLongDate(new Date())}</div>
            <div className="text-4xl font-bold tracking-tight tabular-nums">{fmtHMS(todayTotal)}</div>
            <div className="flex gap-6 text-sm text-white/90 mt-4">
              <div><div className="text-white/70 text-xs mb-0.5">Today</div>{fmtHMS(todayTotal)}</div>
              <div><div className="text-white/70 text-xs mb-0.5">Current focus</div>{fmtHMS(currentFocus)}</div>
            </div>
          </div>
          <div className="w-[46%] shrink-0">
            <HeaderXpBadge data={data} />
          </div>
        </div>
      </div>

      <div className="flex border-b border-neutral-800 bg-neutral-900 sticky top-0 z-10">
        {[["timer", "Timer"], ["stats", "Statistics"], ["planner", "Planner"]].map(([id, label]) => (
          <button key={id} onClick={() => setHomeTab(id)}
            className={`flex-1 py-3 text-sm font-medium ${homeTab === id ? "text-orange-400 border-b-2 border-orange-500" : "text-gray-500"}`}>
            {label}
          </button>
        ))}
      </div>

      {homeTab === "timer" && (
        <div className="bg-neutral-900">
          {data.logs.length === 0 && (
            <div className="px-5 py-10 text-center text-gray-500 text-sm">No logs yet. Add one to start tracking time.</div>
          )}
          {topLevelLogs.map(log => {
            const children = data.logs.filter(l => l.parentId === log.id && !l.archived);
            const isExpanded = expandedId === log.id;
            return (
              <div key={log.id}>
                <LogRow
                  log={log} data={data} activeTimer={activeTimer} toggleLog={toggleLog} logTodayTotal={logTodayTotal}
                  siblings={topLevelLogs}
                  renameId={renameId} setRenameId={setRenameId} renameVal={renameVal} setRenameVal={setRenameVal} renameLog={renameLog}
                  logMenuId={logMenuId} setLogMenuId={setLogMenuId} colorPickerId={colorPickerId} setColorPickerId={setColorPickerId}
                  setLogColor={setLogColor} setLogColorLive={setLogColorLive} setLogParent={setLogParent} deleteLog={deleteLog} moveLog={moveLog} setLogNote={setLogNote} setLogStreakGoal={setLogStreakGoal}
                  allLogs={data.logs} sessions={data.sessions} onOpenRestore={onOpenRestore}
                  isExpanded={isExpanded} onToggleExpand={() => setExpandedId(isExpanded ? null : log.id)}
                />
                {isExpanded && (
                  <div>
                    {children.map(child => (
                      <LogRow
                        key={child.id}
                        log={child} data={data} activeTimer={activeTimer} toggleLog={toggleLog} logTodayTotal={logTodayTotal}
                        siblings={children} isChild
                        renameId={renameId} setRenameId={setRenameId} renameVal={renameVal} setRenameVal={setRenameVal} renameLog={renameLog}
                        logMenuId={logMenuId} setLogMenuId={setLogMenuId} colorPickerId={colorPickerId} setColorPickerId={setColorPickerId}
                        setLogColor={setLogColor} setLogColorLive={setLogColorLive} setLogParent={setLogParent} deleteLog={deleteLog} moveLog={moveLog} setLogNote={setLogNote} setLogStreakGoal={setLogStreakGoal}
                        allLogs={data.logs} sessions={data.sessions} onOpenRestore={onOpenRestore}
                      />
                    ))}
                    <div className="pl-10 pr-5 py-2.5 bg-neutral-950/40 border-b border-neutral-800">
                      <button onClick={() => { setSubLogParentId(log.id); setSubLogOpen(true); }}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-400">
                        <Plus size={13} /> Add sub-log to {log.name}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div className="p-4 space-y-2">
            <button onClick={() => setAddLogOpen(true)} className="w-full border border-dashed border-neutral-700 rounded-xl py-3 text-sm text-gray-400 flex items-center justify-center gap-1">
              <Plus size={15} /> Add log name
            </button>
            {data.logs.length > 0 && (
              <button onClick={() => { setManualDate(todayKey()); setManualLogId(data.logs[0].id); setManualOpen(true); }}
                className="w-full border border-neutral-800 rounded-xl py-3 text-sm text-gray-400 flex items-center justify-center gap-1">
                <Pencil size={14} /> Add time manually
              </button>
            )}
          </div>
        </div>
      )}

      {homeTab === "stats" && (
        <Suspense fallback={<div className="p-8 text-center text-gray-500 text-sm">Loading statistics…</div>}>
          <StatisticsPanel data={data} activeTimer={activeTimer} now={props.now} statsTab={props.statsTab} setStatsTab={props.setStatsTab} periodRange={props.periodRange} setPeriodRange={props.setPeriodRange} customFrom={props.customFrom} setCustomFrom={props.setCustomFrom} customTo={props.customTo} setCustomTo={props.setCustomTo} scheduleSave={props.scheduleSave} />
        </Suspense>
      )}

      {homeTab === "planner" && <PlannerPanel data={data} scheduleSave={props.scheduleSave} />}

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings">
        <div className="mb-5">
          <label className="text-xs text-gray-400 block mb-2">Time format</label>
          <div className="flex gap-2">
            {[["24h", "24-hour (14:30)"], ["12h", "12-hour (2:30 PM)"]].map(([val, label]) => (
              <button key={val}
                onClick={() => props.scheduleSave({ ...data, settings: { ...(data.settings || {}), timeFormat: val } })}
                className={`flex-1 py-2 rounded-lg text-xs font-medium ${(data.settings?.timeFormat || "24h") === val ? "bg-orange-500 text-white" : "bg-neutral-800 text-gray-400"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-2">Day reset time</label>
          <p className="text-[11px] text-gray-500 mb-2">A new "day" starts at this hour. Anything logged before it still counts toward the previous day — handy if you stay up past midnight.</p>
          <select
            value={data.settings?.dayResetHour ?? 3}
            onChange={e => props.scheduleSave({ ...data, settings: { ...(data.settings || {}), dayResetHour: Number(e.target.value) } })}
            className="w-full border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm">
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{h === 0 ? "12:00 AM (midnight)" : h < 12 ? `${h}:00 AM` : h === 12 ? "12:00 PM (noon)" : `${h - 12}:00 PM`}</option>
            ))}
          </select>
        </div>

        {/* Comeback story settings hidden while the feature is disabled — see StoryGate above.
        <div className="mt-5 pt-4 border-t border-neutral-800">
          <label className="text-xs text-gray-400 block mb-2">Comeback story time</label>
          <p className="text-[11px] text-gray-500 mb-2">Once you open the app at or after this time each day, a comeback story pops up — read the whole thing (up to a minute) before it lets you close it.</p>
          <div className="flex gap-2 mb-2">
            <select
              value={data.settings?.storyHour ?? 8}
              onChange={e => props.scheduleSave({ ...data, settings: { ...(data.settings || {}), storyHour: Number(e.target.value) } })}
              className="flex-1 border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm">
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}</option>
              ))}
            </select>
            <select
              value={data.settings?.storyMinute ?? 0}
              onChange={e => props.scheduleSave({ ...data, settings: { ...(data.settings || {}), storyMinute: Number(e.target.value) } })}
              className="w-20 border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm">
              {[0, 15, 30, 45].map(m => <option key={m} value={m}>:{pad(m)}</option>)}
            </select>
          </div>
          <button onClick={() => props.setStoryHistoryOpen(true)} className="text-xs text-orange-400 underline">View past stories</button>
        </div>
        */}

        {data.logs.some(l => l.archived) && (
          <div className="mt-5 pt-4 border-t border-neutral-800">
            <label className="text-xs text-gray-400 block mb-2">Deleted timers</label>
            <p className="text-[11px] text-gray-500 mb-2">Deleting a timer only hides it here — its logged time stays in Statistics. Restore one if you deleted it by mistake.</p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {data.logs.filter(l => l.archived).map(l => (
                <div key={l.id} className="flex items-center gap-2 bg-neutral-900 rounded-lg px-3 py-2 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                  <span className="flex-1 text-gray-300">{l.parentId ? `— ${l.name}` : l.name}</span>
                  <button
                    onClick={() => props.scheduleSave({ ...data, logs: data.logs.map(x => x.id === l.id ? { ...x, archived: false } : x) })}
                    className="text-xs text-orange-400 hover:text-orange-300 font-medium">
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={addLogOpen} onClose={() => setAddLogOpen(false)} title="Add log name">
        <input autoFocus value={newLogName} onChange={e => setNewLogName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addLog(newLogName)}
          placeholder="e.g. Reading, Coding, Physics…" className="w-full border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm placeholder:text-gray-500 mb-3" />
        <button onClick={() => addLog(newLogName)} className="w-full bg-orange-500 text-white rounded-lg py-2 text-sm font-medium">Add</button>
      </Modal>

      <Modal open={subLogOpen} onClose={() => setSubLogOpen(false)} title={subLogParent ? `Add sub-log to ${subLogParent.name}` : "Add sub-log"}>
        <p className="text-xs text-gray-500 mb-3">Time logged under this sub-log also counts toward {subLogParent?.name || "the parent log"}'s total.</p>
        <input autoFocus value={subLogName} onChange={e => setSubLogName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addLog(subLogName, subLogParentId)}
          placeholder="e.g. Physics, Chemistry, Biology…" className="w-full border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm placeholder:text-gray-500 mb-3" />
        <button onClick={() => addLog(subLogName, subLogParentId)} className="w-full bg-orange-500 text-white rounded-lg py-2 text-sm font-medium">Add sub-log</button>
      </Modal>

      <Modal open={manualOpen} onClose={() => setManualOpen(false)} title="Add time manually">
        <label className="text-xs text-gray-400">Log</label>
        <select value={manualLogId} onChange={e => setManualLogId(e.target.value)} className="w-full border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm placeholder:text-gray-500 mb-3 mt-1">
          {data.logs.filter(l => !l.archived).map(l => <option key={l.id} value={l.id}>{l.parentId ? `— ${l.name}` : l.name}</option>)}
        </select>
        <label className="text-xs text-gray-400">Date</label>
        <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} className="w-full border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm placeholder:text-gray-500 mb-3 mt-1" />

        <div className="flex gap-2 mb-3">
          <button onClick={() => setManualMode("duration")} className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${manualMode === "duration" ? "bg-orange-500 text-white" : "bg-neutral-800 text-gray-400"}`}>Duration</button>
          <button onClick={() => setManualMode("range")} className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${manualMode === "range" ? "bg-orange-500 text-white" : "bg-neutral-800 text-gray-400"}`}>Start / End time</button>
        </div>

        {manualMode === "duration" ? (
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="text-xs text-gray-400">Hours</label>
              <input type="number" min="0" value={manualH} onChange={e => setManualH(e.target.value)} className="w-full border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm placeholder:text-gray-500 mt-1" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400">Minutes</label>
              <input type="number" min="0" max="59" value={manualM} onChange={e => setManualM(e.target.value)} className="w-full border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm placeholder:text-gray-500 mt-1" />
            </div>
          </div>
        ) : (
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="text-xs text-gray-400">Start</label>
              <input type="time" value={manualStart} onChange={e => setManualStart(e.target.value)} className="w-full border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm placeholder:text-gray-500 mt-1" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400">End</label>
              <input type="time" value={manualEnd} onChange={e => setManualEnd(e.target.value)} className="w-full border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm placeholder:text-gray-500 mt-1" />
            </div>
          </div>
        )}
        <button onClick={addManualSession} className="w-full bg-orange-500 text-white rounded-lg py-2 text-sm font-medium">Add entry</button>
      </Modal>
    </div>
  );
}

// ================= PLANNER =================
function PlannerPanel({ data, scheduleSave }) {
  const [date, setDate] = useState(todayKey());
  const [time, setTime] = useState("09:00");
  const [title, setTitle] = useState("");

  const items = useMemo(() => data.planner.filter(p => p.date === date).sort((a, b) => a.time.localeCompare(b.time)), [data.planner, date]);

  function addItem() {
    if (!title.trim()) return;
    scheduleSave({ ...data, planner: [...data.planner, { id: uid(), date, time, title: title.trim() }] });
    setTitle("");
  }
  function removeItem(id) { scheduleSave({ ...data, planner: data.planner.filter(p => p.id !== id) }); }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setDate(dateKey(addDays(date, -1)))} className="p-2 text-gray-400"><ChevronLeft size={18} /></button>
        <div className="text-sm font-semibold text-gray-100">{date === todayKey() ? "Today · " : ""}{date}</div>
        <button onClick={() => setDate(dateKey(addDays(date, 1)))} className="p-2 text-gray-400"><ChevronRight size={18} /></button>
      </div>

      <div className="flex gap-2 mb-4">
        <input type="time" value={time} onChange={e => setTime(e.target.value)} className="border border-neutral-700 rounded-lg px-2 py-2 text-sm w-28" />
        <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && addItem()} placeholder="Plan item…" className="flex-1 border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm placeholder:text-gray-500" />
        <button onClick={addItem} className="bg-orange-500 text-white rounded-lg px-3"><Plus size={16} /></button>
      </div>

      {items.length === 0 && <div className="text-center text-gray-500 text-sm py-10">No plans for this day yet.</div>}
      <div className="space-y-2">
        {items.map(p => (
          <div key={p.id} className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 shadow-sm">
            <div className="text-xs font-semibold text-orange-400 w-12">{p.time}</div>
            <div className="flex-1 text-sm text-gray-300">{p.title}</div>
            <button onClick={() => removeItem(p.id)} className="text-gray-300 hover:text-red-400"><X size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================= TODO =================
function TodoScreen({ data, scheduleSave }) {
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");

  function addTodo() {
    if (!text.trim()) return;
    scheduleSave({ ...data, todos: [{ id: uid(), text: text.trim(), done: false, date: dueDate || null }, ...data.todos] });
    setText(""); setDueDate("");
  }
  function toggle(id) { scheduleSave({ ...data, todos: data.todos.map(t => t.id === id ? { ...t, done: !t.done } : t) }); }
  function remove(id) { scheduleSave({ ...data, todos: data.todos.filter(t => t.id !== id) }); }

  const pending = data.todos.filter(t => !t.done);
  const done = data.todos.filter(t => t.done);

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-gray-100 mb-4">To-Do</h2>
      <div className="flex gap-2 mb-2">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && addTodo()} placeholder="Add a task…" className="flex-1 border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm placeholder:text-gray-500" />
        <button onClick={addTodo} className="bg-orange-500 text-white rounded-lg px-3"><Plus size={16} /></button>
      </div>
      <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-gray-400 mb-5" />

      {pending.length === 0 && done.length === 0 && <div className="text-center text-gray-500 text-sm py-10">Nothing on your list yet.</div>}

      <div className="space-y-2 mb-6">
        {pending.map(t => (
          <div key={t.id} className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 shadow-sm">
            <button onClick={() => toggle(t.id)} className="w-5 h-5 rounded-full border-2 border-orange-400 shrink-0" />
            <div className="flex-1 text-sm text-gray-300">{t.text}{t.date && <span className="ml-2 text-[11px] text-orange-500">{t.date}</span>}</div>
            <button onClick={() => remove(t.id)} className="text-gray-300 hover:text-red-400"><X size={15} /></button>
          </div>
        ))}
      </div>

      {done.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-2">Completed</div>
          <div className="space-y-2">
            {done.map(t => (
              <div key={t.id} className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 opacity-60">
                <button onClick={() => toggle(t.id)} className="w-5 h-5 rounded-full bg-orange-400 flex items-center justify-center shrink-0"><Check size={12} className="text-white" /></button>
                <div className="flex-1 text-sm text-gray-400 line-through">{t.text}</div>
                <button onClick={() => remove(t.id)} className="text-gray-300 hover:text-red-400"><X size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ================= CALENDAR =================
function reorderLog(logs, id, dir) {
  const target = logs.find(l => l.id === id);
  if (!target) return logs;
  const siblingIdx = logs.reduce((arr, l, i) => (l.parentId === target.parentId ? [...arr, i] : arr), []);
  const posInSiblings = siblingIdx.indexOf(logs.findIndex(l => l.id === id));
  const swapPos = posInSiblings + dir;
  if (swapPos < 0 || swapPos >= siblingIdx.length) return logs;
  const i = siblingIdx[posInSiblings], j = siblingIdx[swapPos];
  const next = [...logs];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function CalendarScreen({ data, activeTimer, currentFocus, scheduleSave }) {
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState(todayKey());

  const dayTotals = useMemo(() => {
    const map = {};
    data.sessions.forEach(s => { map[s.date] = (map[s.date] || 0) + s.duration; });
    if (activeTimer) { const k = dateKey(activeTimer.startedAt); map[k] = (map[k] || 0) + currentFocus; }
    return map;
  }, [data.sessions, activeTimer, currentFocus]);

  const todoDates = useMemo(() => {
    const set = new Set();
    data.todos.forEach(t => { if (t.date) set.add(t.date); });
    return set;
  }, [data.todos]);

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function heat(sec) {
    const h = sec / 3600;
    if (h <= 0) return "transparent";
    if (h < 1) return "#FFE3C9";
    if (h < 3) return "#FFC08A";
    if (h < 5) return "#FF9A4D";
    return "#FF6B00";
  }

  const selSessions = data.sessions.filter(s => s.date === selected).sort((a, b) => a.start - b.start);
  const selTodos = data.todos.filter(t => t.date === selected);

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-gray-100 mb-4">Calendar</h2>
      <div className="bg-neutral-900 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-1 text-gray-500"><ChevronLeft size={18} /></button>
          <div className="text-sm font-semibold text-gray-100">{MONTHS[month]} {year}</div>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-1 text-gray-500"><ChevronRight size={18} /></button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-gray-500 mb-1">
          {WEEKDAYS.map(w => <div key={w}>{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const key = `${year}-${pad(month + 1)}-${pad(d)}`;
            const sec = dayTotals[key] || 0;
            const isSel = key === selected;
            return (
              <button key={i} onClick={() => setSelected(key)}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center text-[11px] relative ${isSel ? "ring-2 ring-orange-500" : ""}`}
                style={{ backgroundColor: heat(sec) }}>
                <span className={sec <= 0 ? "text-gray-300" : sec > 3600 * 5 ? "text-white font-semibold" : "text-neutral-900 font-medium"}>{d}</span>
                {todoDates.has(key) && <span className="w-1 h-1 rounded-full bg-blue-500 absolute bottom-1" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        <div className="text-sm font-semibold text-gray-100 mb-2">{selected} · {fmtHM(dayTotals[selected] || 0)}h logged</div>
        {selSessions.length === 0 && selTodos.length === 0 && <div className="text-gray-500 text-sm py-4">Nothing logged for this day.</div>}
        <GroupedSessionList sessions={selSessions} data={data} scheduleSave={scheduleSave} dateKey={selected} />
        <div className="space-y-1.5 mt-1.5">
          {selTodos.map(t => (
            <div key={t.id} className="flex items-center gap-2 bg-blue-500/10 rounded-lg px-3 py-2 text-sm">
              <Flag size={13} className="text-blue-500 shrink-0" />
              <span className={`flex-1 ${t.done ? "line-through text-gray-500" : "text-gray-300"}`}>{t.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

