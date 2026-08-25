import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  AreaChart, Area, Scatter, ScatterChart, ReferenceLine
} from "recharts";
import {
  Play, Pause, Plus, X, Check, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Trash2,
  Download, Upload, Home as HomeIcon, CheckSquare, Calendar as CalendarIcon,
  Cloud, CloudOff, Loader2, Pencil, Flag, StickyNote, LogOut, Settings as SettingsIcon
} from "lucide-react";
import { logout, watchAuth, signUpWithUsername, signInWithUsername, loadCloudData, saveCloudData } from "./firebase";

const STORAGE_KEY = "timelogger-data-v1";
const ACTIVE_TIMER_KEY = "timelogger-active-timer-v1";
const COLORS = ["#FF7A1A", "#8B5FBF", "#E8637A", "#3FA66B", "#3B82C4", "#6B7280", "#F0B429", "#1AA6A6"];

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
function satOf(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return 0;
  const s = d / (1 - Math.abs(2 * l - 1));
  return Math.round(s * 100);
}
function hueOf(hex) {
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
function hsbToHex(h, s, v) {
  s /= 100; v /= 100;
  const k = n => (n + h / 60) % 6;
  const f = n => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`;
}
function hexToHsb(hex) {
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
function isValidHex(hex) { return /^#([0-9a-fA-F]{6})$/.test(hex); }

// Resolves a log id (parent or sub-log) up to its top-level ancestor id,
// so statistics can roll sub-log time into the parent it belongs to.
function rootLogId(logs, logId) {
  let log = logs.find(l => l.id === logId);
  let guard = 0;
  while (log && log.parentId && guard < 10) {
    log = logs.find(l => l.id === log.parentId);
    guard++;
  }
  return log ? log.id : logId;
}

function uid() { return Math.random().toString(36).slice(2, 10); }
function pad(n) { return String(n).padStart(2, "0"); }
function fmtHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function fmtHM(totalSeconds) {
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
function updateAppSettings(settings) {
  if (!settings) return;
  if (typeof settings.dayResetHour === "number") CURRENT_RESET_HOUR = settings.dayResetHour;
  if (settings.timeFormat === "12h" || settings.timeFormat === "24h") CURRENT_TIME_FORMAT = settings.timeFormat;
}

function fmtClock(ts) {
  const d = new Date(ts);
  if (CURRENT_TIME_FORMAT === "12h") return fmtAMPM(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtAMPM(ts) {
  const d = new Date(ts);
  let h = d.getHours();
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12; if (h === 0) h = 12;
  return `${ap} ${h}:${pad(d.getMinutes())}`;
}
function dateKey(d) {
  const dt = new Date(d);
  dt.setHours(dt.getHours() - CURRENT_RESET_HOUR);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
// hour-of-day on a 3AM-3AM scale: times before 3AM read as 24:xx-26:xx so they still
// plot on the previous logical day instead of wrapping to 0
function logicalMinutes(ts) {
  const d = new Date(ts);
  let h = d.getHours() + d.getMinutes() / 60;
  if (h < CURRENT_RESET_HOUR) h += 24;
  return Math.round(h * 60);
}
function minutesToClock(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
function todayKey() { return dateKey(new Date()); }
function addDays(d, n) { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt; }
function startOfWeek(d) {
  const dt = new Date(d); const day = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - day); dt.setHours(0, 0, 0, 0); return dt;
}
function weekdayIdx(dateStr) { const d = new Date(dateStr + "T00:00:00"); return (d.getDay() + 6) % 7; }
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_SHORT3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtLongDate(d) {
  const dt = new Date(d);
  return `${dt.getDate()} ${MONTHS_LONG[dt.getMonth()]} ${dt.getFullYear()}, ${WEEKDAYS_SHORT3[dt.getDay()]}`;
}
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function defaultData() {
  return { logs: [], sessions: [], todos: [], planner: [], dday: { label: "D-DAY", date: null }, settings: { timeFormat: "24h", dayResetHour: 3 } };
}

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

function tooltipMin(v) { return `${Math.round(v)} min`; }

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

  // ---------- auth ----------
  useEffect(() => watchAuth(setUser), []);

  // ---------- load ----------
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

      let chosen = cloud || local;
      if (chosen) {
        const migrated = {
          ...defaultData(),
          ...chosen,
          sessions: (chosen.sessions || []).map(s => ({ ...s, date: dateKey(s.start) })),
        };
        setData(migrated);
        // If we just signed in and this device had local data the cloud
        // didn't have yet (or didn't have at all), push it up right away —
        // don't wait for the next log entry to trigger a save.
        if (user && !cloud) {
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
  function scheduleSave(next) {
    setData(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(next), 350);
  }
  async function persist(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) { /* local write failed; data still lives in memory/state */ }
    if (user) {
      try {
        setSyncing(true);
        await saveCloudData(user.uid, next); // Firestore queues this offline and sends it once online
        setSyncing(false);
      } catch (e) { setSyncing(false); /* will retry on next save, or Firestore's own offline queue handles it */ }
    }
  }

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

  function toggleLog(logId) {
    setActiveTimer((prev) => {
      if (prev) {
        const endedAt = Date.now();
        const duration = Math.round((endedAt - prev.startedAt) / 1000);
        if (duration > 0) {
          const session = { id: uid(), logId: prev.logId, date: dateKey(prev.startedAt), start: prev.startedAt, end: endedAt, duration };
          const next = { ...dataRef.current, sessions: [...dataRef.current.sessions, session] };
          scheduleSave(next);
        }
        if (prev.logId === logId) return null;
      }
      return { logId, startedAt: Date.now() };
    });
  }

  function addLog(name, parentId = null) {
    if (!name.trim()) return;
    const log = { id: uid(), name: name.trim(), color: COLORS[data.logs.length % COLORS.length], parentId: parentId || null };
    scheduleSave({ ...data, logs: [...data.logs, log] });
    setNewLogName(""); setAddLogOpen(false);
    setSubLogName(""); setSubLogOpen(false);
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
    scheduleSave({ ...data, logs: data.logs.map(l => l.id === id ? { ...l, note } : l) });
  }
  function deleteLog(id) {
    const childIds = data.logs.filter(l => l.parentId === id).map(l => l.id);
    const removeIds = [id, ...childIds];
    if (activeTimer && removeIds.includes(activeTimer.logId)) setActiveTimer(null);
    scheduleSave({
      ...data,
      logs: data.logs.filter(l => !removeIds.includes(l.id)),
      sessions: data.sessions.filter(s => !removeIds.includes(s.logId)),
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
    scheduleSave({ ...dataRef.current, sessions: [...dataRef.current.sessions, session] });
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
        scheduleSave({ ...defaultData(), ...parsed });
      } catch (err) {}
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  if (user === undefined || !loaded) {
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
          colorPickerId={colorPickerId} setColorPickerId={setColorPickerId} setLogColor={setLogColor} setLogColorLive={setLogColorLive}
          setLogNote={setLogNote}
          expandedId={expandedId} setExpandedId={setExpandedId}
          subLogOpen={subLogOpen} setSubLogOpen={setSubLogOpen}
          subLogParentId={subLogParentId} setSubLogParentId={setSubLogParentId}
          subLogName={subLogName} setSubLogName={setSubLogName}
          isOnline={isOnline} user={user} syncing={syncing} setSkippedLogin={setSkippedLogin}
          settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen}
          onExport={handleExport} onImport={handleImport}
          now={now}
        />
      )}
      {nav === "todo" && <TodoScreen data={data} scheduleSave={scheduleSave} />}
      {nav === "calendar" && <CalendarScreen data={data} activeTimer={activeTimer} currentFocus={currentFocus} scheduleSave={scheduleSave} />}

      <BottomNav nav={nav} setNav={setNav} />
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
  logMenuId, setLogMenuId, colorPickerId, setColorPickerId, setLogColor, setLogColorLive, setLogNote, deleteLog, moveLog,
  isChild, isExpanded, onToggleExpand }) {
  const isActive = activeTimer && activeTimer.logId === log.id;
  const idx = siblings.findIndex(l => l.id === log.id);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(log.note || "");

  function openNote() {
    setNoteDraft(log.note || "");
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
              {log.note && !noteOpen && (
                <div className="text-[11px] text-gray-500 truncate max-w-[160px]">{log.note}</div>
              )}
            </>
          )}
        </div>
        <span className={`text-sm tabular-nums ${isActive ? "text-orange-400 font-semibold" : "text-gray-400"}`}>{fmtHMS(logTodayTotal(log.id))}</span>
        <button onClick={() => (noteOpen ? setNoteOpen(false) : openNote())} className={`p-1 shrink-0 ${log.note ? "text-orange-400" : "text-gray-500"} hover:text-orange-400`}>
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
            <button onClick={() => deleteLog(log.id)} className="flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-neutral-800 w-full"><Trash2 size={14} />Delete</button>
          </div>
        )}
      </div>

      {noteOpen && (
        <div className={`mt-2 ${isChild ? "ml-9" : "ml-11"}`}>
          <textarea
            autoFocus rows={2} value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
            placeholder="Add a note for this log…"
            className="w-full bg-neutral-950 border border-neutral-700 text-gray-100 rounded-lg px-3 py-2 text-xs placeholder:text-gray-500 resize-none"
          />
          <div className="flex gap-2 mt-1.5">
            <button onClick={saveNote} className="bg-orange-500 text-white rounded-lg px-3 py-1 text-xs font-medium">Save</button>
            <button onClick={() => setNoteOpen(false)} className="border border-neutral-700 text-gray-400 rounded-lg px-3 py-1 text-xs">Cancel</button>
            {log.note && (
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
    colorPickerId, setColorPickerId, setLogColor, setLogColorLive, setLogNote,
    expandedId, setExpandedId, subLogOpen, setSubLogOpen, subLogParentId, setSubLogParentId, subLogName, setSubLogName,
    isOnline, user, syncing, setSkippedLogin, settingsOpen, setSettingsOpen, onExport, onImport,
    manualOpen, setManualOpen, manualLogId, setManualLogId, manualDate, setManualDate,
    manualMode, setManualMode, manualStart, setManualStart, manualEnd, setManualEnd,
    manualH, setManualH, manualM, setManualM, addManualSession,
  } = props;

  const topLevelLogs = data.logs.filter(l => !l.parentId);
  const subLogParent = data.logs.find(l => l.id === subLogParentId);

  return (
    <div>
      <div className="rounded-b-3xl px-5 pt-5 pb-6 text-white" style={{ background: "linear-gradient(135deg,#FF8A2A,#FF6B00)" }}>
        <div className="flex items-center justify-end mb-4 gap-2">
          <TopSyncBar isOnline={isOnline} onExport={onExport} onImport={onImport} user={user} syncing={syncing} setSkippedLogin={setSkippedLogin} />
          <button onClick={() => setSettingsOpen(true)} title="Settings" className="p-1.5 rounded-full bg-white/20 text-white"><SettingsIcon size={14} /></button>
        </div>
        <div className="text-sm font-medium text-white/80 mb-1">{fmtLongDate(new Date())}</div>
        <div className="text-4xl font-bold tracking-tight tabular-nums">{fmtHMS(todayTotal)}</div>
        <div className="flex gap-8 mt-4 text-sm text-white/90">
          <div><div className="text-white/70 text-xs mb-0.5">Today</div>{fmtHMS(todayTotal)}</div>
          <div><div className="text-white/70 text-xs mb-0.5">Current focus</div>{fmtHMS(currentFocus)}</div>
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
            const children = data.logs.filter(l => l.parentId === log.id);
            const isExpanded = expandedId === log.id;
            return (
              <div key={log.id}>
                <LogRow
                  log={log} data={data} activeTimer={activeTimer} toggleLog={toggleLog} logTodayTotal={logTodayTotal}
                  siblings={topLevelLogs}
                  renameId={renameId} setRenameId={setRenameId} renameVal={renameVal} setRenameVal={setRenameVal} renameLog={renameLog}
                  logMenuId={logMenuId} setLogMenuId={setLogMenuId} colorPickerId={colorPickerId} setColorPickerId={setColorPickerId}
                  setLogColor={setLogColor} setLogColorLive={setLogColorLive} deleteLog={deleteLog} moveLog={moveLog} setLogNote={setLogNote}
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
                        setLogColor={setLogColor} setLogColorLive={setLogColorLive} deleteLog={deleteLog} moveLog={moveLog} setLogNote={setLogNote}
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

      {homeTab === "stats" && <StatisticsPanel data={data} activeTimer={activeTimer} now={props.now} statsTab={props.statsTab} setStatsTab={props.setStatsTab} periodRange={props.periodRange} setPeriodRange={props.setPeriodRange} customFrom={props.customFrom} setCustomFrom={props.setCustomFrom} customTo={props.customTo} setCustomTo={props.setCustomTo} scheduleSave={props.scheduleSave} />}

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
          {data.logs.map(l => <option key={l.id} value={l.id}>{l.parentId ? `— ${l.name}` : l.name}</option>)}
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
function SessionRow({ session, data, scheduleSave }) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState("range"); // "range" | "duration"
  const [date, setDate] = useState(session.date);
  const [start, setStart] = useState(fmtClock(session.start));
  const [end, setEnd] = useState(fmtClock(session.end));
  const [hh, setHh] = useState(String(Math.floor(session.duration / 3600)));
  const [mm, setMm] = useState(String(Math.floor((session.duration % 3600) / 60)));
  const log = data.logs.find(l => l.id === session.logId);

  function save() {
    let s, e, duration;
    if (mode === "duration") {
      s = new Date(`${date}T${start}:00`);
      duration = (parseInt(hh || "0", 10) * 3600) + (parseInt(mm || "0", 10) * 60);
      if (duration <= 0) return;
      e = new Date(s.getTime() + duration * 1000);
    } else {
      s = new Date(`${date}T${start}:00`);
      e = new Date(`${date}T${end}:00`);
      if (e <= s) e = new Date(e.getTime() + 86400000);
      duration = Math.round((e.getTime() - s.getTime()) / 1000);
      if (duration <= 0) return;
    }
    scheduleSave({
      ...data,
      sessions: data.sessions.map(x => x.id === session.id ? { ...x, date, start: s.getTime(), end: e.getTime(), duration } : x),
    });
    setEditing(false);
  }
  function remove() {
    scheduleSave({ ...data, sessions: data.sessions.filter(x => x.id !== session.id) });
  }

  if (editing) {
    return (
      <div className="bg-neutral-800 rounded-lg px-3 py-2.5 text-sm space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: log?.color || "#999" }} />
          <span className="flex-1 text-gray-200">{log?.name || "Deleted log"}</span>
        </div>

        <div className="flex gap-2">
          <button onClick={() => setMode("range")} className={`flex-1 py-1 rounded text-[11px] font-medium ${mode === "range" ? "bg-orange-500 text-white" : "bg-neutral-900 border border-neutral-700 text-gray-400"}`}>Start / End</button>
          <button onClick={() => setMode("duration")} className={`flex-1 py-1 rounded text-[11px] font-medium ${mode === "duration" ? "bg-orange-500 text-white" : "bg-neutral-900 border border-neutral-700 text-gray-400"}`}>Hours / Minutes</button>
        </div>

        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 text-gray-100 rounded px-2 py-1 text-xs" />

        {mode === "range" ? (
          <div className="flex gap-2">
            <input type="time" value={start} onChange={e => setStart(e.target.value)} className="flex-1 bg-neutral-900 border border-neutral-700 text-gray-100 rounded px-2 py-1 text-xs" />
            <input type="time" value={end} onChange={e => setEnd(e.target.value)} className="flex-1 bg-neutral-900 border border-neutral-700 text-gray-100 rounded px-2 py-1 text-xs" />
          </div>
        ) : (
          <div className="flex gap-2 items-center">
            <input type="time" value={start} onChange={e => setStart(e.target.value)} className="flex-1 bg-neutral-900 border border-neutral-700 text-gray-100 rounded px-2 py-1 text-xs" title="Start time" />
            <input type="number" min="0" value={hh} onChange={e => setHh(e.target.value)} className="w-14 bg-neutral-900 border border-neutral-700 text-gray-100 rounded px-2 py-1 text-xs text-center" />
            <span className="text-gray-500 text-xs">h</span>
            <input type="number" min="0" max="59" value={mm} onChange={e => setMm(e.target.value)} className="w-14 bg-neutral-900 border border-neutral-700 text-gray-100 rounded px-2 py-1 text-xs text-center" />
            <span className="text-gray-500 text-xs">m</span>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={save} className="flex-1 bg-orange-500 text-white rounded py-1.5 text-xs font-medium">Save</button>
          <button onClick={remove} className="px-3 bg-neutral-900 border border-red-900 text-red-400 rounded py-1.5 text-xs">Delete</button>
          <button onClick={() => setEditing(false)} className="px-3 bg-neutral-900 border border-neutral-700 text-gray-400 rounded py-1.5 text-xs">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-neutral-900 rounded-lg px-3 py-2 text-sm shadow-sm">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: log?.color || "#999" }} />
      <span className="flex-1 text-gray-300">{log?.name || "Deleted log"}</span>
      <span className="text-gray-500 text-xs">{fmtClock(session.start)}–{fmtClock(session.end)}</span>
      <span className="text-gray-300 text-xs font-medium">{fmtHMS(session.duration)}</span>
      <button onClick={() => setEditing(true)} className="text-gray-500 hover:text-orange-400 shrink-0"><Pencil size={13} /></button>
    </div>
  );
}

function GroupedSessionList({ sessions, data, scheduleSave }) {
  const [expanded, setExpanded] = useState({});
  const groups = useMemo(() => {
    // Group by the top-level ancestor log, not the exact log a session was
    // logged against — so sub-logs (e.g. "Maghrib"/"Asr" under a "Prayers"
    // parent, or "Breakfast"/"Lunch"/"Dinner" under "Eating") roll up into
    // one entry for their parent instead of each showing up separately.
    const map = {};
    sessions.forEach(s => { const rid = rootLogId(data.logs, s.logId); (map[rid] = map[rid] || []).push(s); });
    return Object.entries(map)
      .map(([logId, list]) => ({
        logId,
        log: data.logs.find(l => l.id === logId),
        list: [...list].sort((a, b) => a.start - b.start),
        total: list.reduce((a, s) => a + s.duration, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [sessions, data.logs]);

  if (groups.length === 0) return <div className="text-gray-500 text-sm">No sessions logged.</div>;

  return (
    <div className="space-y-1.5">
      {groups.map(g => {
        if (g.list.length === 1) {
          return <SessionRow key={g.logId} session={g.list[0]} data={data} scheduleSave={scheduleSave} />;
        }
        const isOpen = !!expanded[g.logId];
        return (
          <div key={g.logId} className="bg-neutral-900 rounded-lg overflow-hidden">
            <button onClick={() => setExpanded(e => ({ ...e, [g.logId]: !e[g.logId] }))}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.log?.color || "#999" }} />
              <span className="flex-1 text-left text-gray-300">{g.log?.name || "Deleted log"}</span>
              <span className="text-[10px] text-gray-500">{g.list.length}×</span>
              <span className="text-gray-300 text-xs font-medium">{fmtHMS(g.total)}</span>
              {isOpen ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
            </button>
            {isOpen && (
              <div className="px-2 pb-2 space-y-1">
                {g.list.map(s => <SessionRow key={s.id} session={s} data={data} scheduleSave={scheduleSave} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
        <GroupedSessionList sessions={selSessions} data={data} scheduleSave={scheduleSave} />
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

// ================= STATISTICS =================
function StatisticsPanel({ data, activeTimer, now, statsTab, setStatsTab, periodRange, setPeriodRange, customFrom, setCustomFrom, customTo, setCustomTo, scheduleSave }) {
  const tabs = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["trend", "Trend"], ["period", "Period"]];
  return (
    <div className="p-4">
      <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setStatsTab(id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${statsTab === id ? "bg-orange-500 text-white" : "bg-neutral-800 text-gray-400"}`}>
            {label}
          </button>
        ))}
      </div>
      {statsTab === "period" && <PeriodStats data={data} activeTimer={activeTimer} now={now} range={periodRange} setRange={setPeriodRange} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />}
      {statsTab === "day" && <DayStats data={data} activeTimer={activeTimer} now={now} scheduleSave={scheduleSave} />}
      {statsTab === "week" && <WeekStats data={data} activeTimer={activeTimer} now={now} />}
      {statsTab === "month" && <MonthStats data={data} activeTimer={activeTimer} now={now} />}
      {statsTab === "trend" && <TrendStats data={data} activeTimer={activeTimer} now={now} />}
    </div>
  );
}

function sessionsWithActive(data, activeTimer, now) {
  const list = [...data.sessions];
  if (activeTimer) {
    const duration = Math.floor((now - activeTimer.startedAt) / 1000);
    if (duration > 0) list.push({ id: "live", logId: activeTimer.logId, date: dateKey(activeTimer.startedAt), start: activeTimer.startedAt, end: now, duration });
  }
  return list;
}

function Card({ title, children }) {
  return (
    <div className="bg-neutral-900 rounded-2xl p-4 shadow-sm mb-4">
      {title && <div className="text-sm font-semibold text-gray-300 mb-3">{title}</div>}
      {children}
    </div>
  );
}

function PeriodStats({ data, activeTimer, now, range, setRange, customFrom, setCustomFrom, customTo, setCustomTo }) {
  const sessions = sessionsWithActive(data, activeTimer, now);

  const isCustom = range === "custom";
  let start, end;
  if (isCustom && customFrom && customTo) {
    start = new Date(customFrom + "T00:00:00");
    end = new Date(customTo + "T00:00:00");
    if (end < start) { const t = start; start = end; end = t; }
  } else {
    end = new Date(); end.setHours(0, 0, 0, 0);
    start = addDays(end, -((typeof range === "number" ? range : 30) - 1));
  }
  const rangeDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const startKey = dateKey(start), endKey = dateKey(end);
  const inRange = sessions.filter(s => s.date >= startKey && s.date <= endKey);
  const total = inRange.reduce((a, s) => a + s.duration, 0);
  const dailyAvg = total / rangeDays;

  const topLogs = data.logs.filter(l => !l.parentId);

  const bySubject = {};
  inRange.forEach(s => { const rid = rootLogId(data.logs, s.logId); bySubject[rid] = (bySubject[rid] || 0) + s.duration; });
  const subjectData = topLogs.map(l => ({ name: l.name, value: bySubject[l.id] || 0, color: l.color }))
    .filter(d => d.value > 0);

  // per-day or per-month bars
  let barData = [];
  if (rangeDays <= 30) {
    for (let i = 0; i < rangeDays; i++) {
      const d = addDays(start, i); const k = dateKey(d);
      const row = { label: `${d.getMonth() + 1}/${d.getDate()}` };
      topLogs.forEach(l => { row[l.id] = 0; });
      inRange.filter(s => s.date === k).forEach(s => { const rid = rootLogId(data.logs, s.logId); row[rid] = (row[rid] || 0) + s.duration / 60; });
      barData.push(row);
    }
  } else {
    const map = {};
    inRange.forEach(s => {
      const mk = s.date.slice(0, 7);
      const rid = rootLogId(data.logs, s.logId);
      map[mk] = map[mk] || {};
      map[mk][rid] = (map[mk][rid] || 0) + s.duration / 60;
    });
    barData = Object.keys(map).sort().map(mk => ({ label: mk.slice(5) + "/" + mk.slice(2, 4), ...map[mk] }));
  }

  // weekday avg
  const wdTotals = Array(7).fill(0), wdCounts = Array(7).fill(0);
  for (let i = 0; i < rangeDays; i++) {
    const d = addDays(start, i); wdCounts[(d.getDay() + 6) % 7]++;
  }
  inRange.forEach(s => { wdTotals[weekdayIdx(s.date)] += s.duration; });
  const weekdayData = WEEKDAYS.map((w, i) => ({ label: w, min: wdCounts[i] ? (wdTotals[i] / wdCounts[i]) / 60 : 0 }));

  // hourly distribution (avg minutes per range)
  const hourTotals = Array(24).fill(0);
  inRange.forEach(s => { hourTotals[new Date(s.start).getHours()] += s.duration; });
  const hourData = hourTotals.map((sec, h) => ({ label: h, min: sec / 60 / rangeDays }));

  // ---- start/end per day + consistency (capped to most recent 60 logical days for readability) ----
  const dayList = [];
  const capStart = rangeDays > 60 ? addDays(end, -59) : start;
  for (let d = new Date(capStart); d <= end; d = addDays(d, 1)) {
    dayList.push({ key: dateKey(d), label: `${d.getMonth() + 1}/${d.getDate()}` });
  }
  const startPoints = [], endPoints = [];
  const perDay = {};
  dayList.forEach(d => { perDay[d.key] = { starts: [], ends: [], total: 0 }; });
  inRange.forEach(s => {
    if (!perDay[s.date]) return;
    const sm = logicalMinutes(s.start), em = logicalMinutes(s.end);
    perDay[s.date].starts.push(sm);
    perDay[s.date].ends.push(em);
    perDay[s.date].total += s.duration;
    startPoints.push({ label: dayList.find(d => d.key === s.date)?.label, value: sm });
    endPoints.push({ label: dayList.find(d => d.key === s.date)?.label, value: em });
  });
  const activeDays = dayList.filter(d => perDay[d.key].starts.length);
  const overallAvgStart = activeDays.length
    ? activeDays.reduce((a, d) => a + perDay[d.key].starts.reduce((x, y) => x + y, 0) / perDay[d.key].starts.length, 0) / activeDays.length
    : null;
  const overallAvgEnd = activeDays.length
    ? activeDays.reduce((a, d) => a + perDay[d.key].ends.reduce((x, y) => x + y, 0) / perDay[d.key].ends.length, 0) / activeDays.length
    : null;
  const overallAvgTotalMin = activeDays.length
    ? activeDays.reduce((a, d) => a + perDay[d.key].total, 0) / activeDays.length / 60
    : 0;
  const consistencyPoints = activeDays.map(d => {
    const dow = new Date(d.key + "T00:00:00").getDay();
    return {
      label: d.label,
      x: perDay[d.key].starts.reduce((a, b) => a + b, 0) / perDay[d.key].starts.length,
      y: perDay[d.key].total / 60,
      weekend: dow === 0 || dow === 6,
    };
  });
  const consistencyOrange = consistencyPoints.filter(p => p.weekend);
  const consistencyGray = consistencyPoints.filter(p => !p.weekend);

  return (
    <div>
      <div className="flex gap-2 mb-2 overflow-x-auto -mx-1 px-1">
        {[[7, "Last 7 days"], [30, "Last 30 days"], [365, "Last 365 days"]].map(([n, label]) => (
          <button key={n} onClick={() => setRange(n)} className={`flex-1 py-2 rounded-xl text-xs font-medium whitespace-nowrap ${range === n ? "bg-orange-500 text-white" : "bg-neutral-800 text-gray-400"}`}>{label}</button>
        ))}
        <button onClick={() => setRange("custom")} className={`flex-1 py-2 rounded-xl text-xs font-medium whitespace-nowrap ${isCustom ? "bg-orange-500 text-white" : "bg-neutral-800 text-gray-400"}`}>Custom</button>
      </div>

      {isCustom && (
        <div className="flex items-end gap-2 mb-4">
          <div className="flex-1">
            <label className="text-xs text-gray-500">From</label>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="w-full border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500">To</label>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="w-full border border-neutral-700 bg-neutral-900 text-gray-100 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
        </div>
      )}

      <Card>
        <div className="flex justify-around text-center">
          <div><div className="text-xs text-gray-500 mb-1">Total time</div><div className="text-xl font-bold text-orange-400">{fmtHMS(total)}</div></div>
          <div><div className="text-xs text-gray-500 mb-1">Daily average</div><div className="text-xl font-bold text-gray-300">{fmtHMS(dailyAvg)}</div></div>
        </div>
      </Card>

      {subjectData.length > 0 && (
        <Card title="Time ratio">
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={150} height={150}>
              <PieChart>
                <Pie
                  data={subjectData} dataKey="value" innerRadius={38} outerRadius={68} paddingAngle={2}
                  label={({ percent, cx, cy, midAngle, innerRadius, outerRadius }) => {
                    const RAD = Math.PI / 180;
                    const r = innerRadius + (outerRadius - innerRadius) * 0.6;
                    const x = cx + r * Math.cos(-midAngle * RAD);
                    const y = cy + r * Math.sin(-midAngle * RAD);
                    const pct = Math.round(percent * 100);
                    if (pct < 6) return null;
                    return (
                      <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={600}>
                        {pct}%
                      </text>
                    );
                  }}
                  labelLine={false}
                >
                  {subjectData.map((d, i) => <Cell key={i} fill={d.color} stroke="none" />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-1.5">
              {subjectData.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="flex-1 text-gray-300">{d.name}</span>
                  <span className="text-gray-400">{fmtHM(d.value)} · {Math.round((d.value / total) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      <Card title={`Time per ${rangeDays <= 30 ? "day" : "month"}`}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={barData}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9CA3AF" }} interval={Math.ceil(barData.length / 8)} />
            <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} />
            <Tooltip formatter={tooltipMin} contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e5e5e5" }} itemStyle={{ color: "#e5e5e5" }} />
            {topLogs.map(l => <Bar key={l.id} dataKey={l.id} stackId="a" fill={l.color} />)}
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Start/end per day">
        {activeDays.length === 0 ? (
          <div className="text-gray-500 text-sm py-6 text-center">No sessions in this range.</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <XAxis dataKey="label" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 9, fill: "#9CA3AF" }} interval={Math.ceil(dayList.length / 8)} />
                <YAxis dataKey="value" type="number" domain={[180, 1620]} ticks={[180, 360, 540, 720, 900, 1080, 1260, 1440, 1620]} tickFormatter={minutesToClock} tick={{ fontSize: 9, fill: "#9CA3AF" }} width={36} />
                <Tooltip formatter={(v) => minutesToClock(v)} contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e5e5e5" }} itemStyle={{ color: "#e5e5e5" }} cursor={{ strokeDasharray: "3 3" }} />
                <Scatter name="End" data={endPoints} fill="#9CA3AF" />
                <Scatter name="Start" data={startPoints} fill="#FF8A2A" />
              </ScatterChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-1 text-[11px] text-gray-400">
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-400" />Start</div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-400" />End</div>
            </div>
          </>
        )}
      </Card>

      <Card title="Avg. focus time per weekday">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={weekdayData}>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9CA3AF" }} />
            <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} />
            <Tooltip formatter={tooltipMin} contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e5e5e5" }} itemStyle={{ color: "#e5e5e5" }} />
            <Bar dataKey="min" fill="#FF9A4D" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Avg. focus time by hour">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={hourData}>
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#9CA3AF" }} interval={2} />
            <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} />
            <Tooltip formatter={tooltipMin} contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e5e5e5" }} itemStyle={{ color: "#e5e5e5" }} />
            <Area type="monotone" dataKey="min" stroke="#FF7A1A" fill="#FFD9B3" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Consistency">
        {activeDays.length === 0 ? (
          <div className="text-gray-500 text-sm py-6 text-center">No sessions in this range.</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <XAxis type="number" dataKey="x" domain={[180, 1620]} ticks={[180, 360, 540, 720, 900, 1080, 1260, 1440, 1620]} tickFormatter={minutesToClock} tick={{ fontSize: 9, fill: "#9CA3AF" }} name="Start" />
                <YAxis type="number" dataKey="y" tick={{ fontSize: 9, fill: "#9CA3AF" }} name="Study" tickFormatter={(v) => fmtHM(v * 60)} width={40} />
                <Tooltip formatter={(v, n) => n === "x" ? minutesToClock(v) : fmtHM(v * 60)} contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e5e5e5" }} itemStyle={{ color: "#e5e5e5" }} cursor={{ strokeDasharray: "3 3" }} />
                {overallAvgStart !== null && <ReferenceLine x={overallAvgStart} stroke="#525252" strokeDasharray="3 3" />}
                <ReferenceLine y={overallAvgTotalMin} stroke="#525252" strokeDasharray="3 3" />
                <Scatter name="Weekday" data={consistencyGray} fill="#9CA3AF" />
                <Scatter name="Weekend" data={consistencyOrange} fill="#FF8A2A" />
              </ScatterChart>
            </ResponsiveContainer>
            <div className="flex justify-around text-center mt-1">
              <div><div className="text-[11px] text-gray-500">Avg start</div><div className="text-xs text-gray-300 font-medium">{overallAvgStart !== null ? minutesToClock(overallAvgStart) : "–"}</div></div>
              <div><div className="text-[11px] text-gray-500">Avg end</div><div className="text-xs text-gray-300 font-medium">{overallAvgEnd !== null ? minutesToClock(overallAvgEnd) : "–"}</div></div>
              <div><div className="text-[11px] text-gray-500">Study (avg)</div><div className="text-xs text-gray-300 font-medium">{fmtHM(overallAvgTotalMin * 60)}</div></div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function DonutRatio({ data, total }) {
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={150} height={150}>
        <PieChart>
          <Pie
            data={data} dataKey="value" innerRadius={38} outerRadius={68} paddingAngle={2}
            label={({ percent, cx, cy, midAngle, innerRadius, outerRadius }) => {
              const RAD = Math.PI / 180;
              const r = innerRadius + (outerRadius - innerRadius) * 0.6;
              const x = cx + r * Math.cos(-midAngle * RAD);
              const y = cy + r * Math.sin(-midAngle * RAD);
              const pct = Math.round(percent * 100);
              if (pct < 6) return null;
              return <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={600}>{pct}%</text>;
            }}
            labelLine={false}
          >
            {data.map((d, i) => <Cell key={i} fill={d.color} stroke="none" />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="flex-1 text-gray-300">{d.name}</span>
            <span className="text-gray-400">{fmtHM(d.value)} · {total ? Math.round((d.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DaySummary({ data, sessions, selected, dayTotals }) {
  const daySessions = sessions.filter(s => s.date === selected).sort((a, b) => a.start - b.start);
  const totalSec = dayTotals[selected] || 0;
  const maxFocus = daySessions.reduce((m, s) => Math.max(m, s.duration), 0);
  const firstStart = daySessions.length ? daySessions[0].start : null;
  const lastEnd = daySessions.length ? Math.max(...daySessions.map(s => s.end)) : null;

  const prevKey = dateKey(addDays(new Date(selected + "T12:00:00"), -1));
  function cumulativeSeries(dateStr) {
    const daySess = sessions.filter(s => s.date === dateStr);
    const bins = Array(48).fill(0);
    daySess.forEach(s => {
      const d = new Date(s.start);
      let mins = d.getHours() * 60 + d.getMinutes() - 5 * 60;
      if (mins < 0) mins += 1440;
      const idx = Math.min(47, Math.floor(mins / 30));
      bins[idx] += s.duration;
    });
    let running = 0;
    return bins.map(v => (running += v));
  }
  const curSeries = cumulativeSeries(selected);
  const prevSeries = cumulativeSeries(prevKey);
  const chartData = curSeries.map((v, i) => ({ idx: i, cur: v / 60, prev: prevSeries[i] / 60 }));
  const tickIdx = [0, 24, 47];
  const tickLabel = { 0: "5:00", 24: "17:00", 47: "5:00" };

  const bySubject = {};
  daySessions.forEach(s => { const rid = rootLogId(data.logs, s.logId); bySubject[rid] = (bySubject[rid] || 0) + s.duration; });
  const subjectData = data.logs.filter(l => !l.parentId).map(l => ({ name: l.name, value: bySubject[l.id] || 0, color: l.color })).filter(d => d.value > 0);

  const other = Math.max(0, 86400 - totalSec);
  const studyOtherData = [
    { name: "Logged", value: totalSec, color: "#FF8A2A" },
    { name: "Other", value: other, color: "#6B7280" },
  ];

  return (
    <>
      <Card>
        <div className="grid grid-cols-2 gap-y-5 text-center mb-4">
          <div>
            <div className="text-xs text-orange-400 font-medium mb-1">Total time</div>
            <div className="text-2xl font-bold text-gray-100">{fmtHMS(totalSec)}</div>
          </div>
          <div>
            <div className="text-xs text-orange-400 font-medium mb-1">Max focus time</div>
            <div className="text-2xl font-bold text-gray-100">{fmtHMS(maxFocus)}</div>
          </div>
          <div>
            <div className="text-xs text-orange-400 font-medium mb-1">Start time</div>
            <div className="text-2xl font-bold text-gray-100">{firstStart ? fmtClock(firstStart) : "--:--"}</div>
          </div>
          <div>
            <div className="text-xs text-orange-400 font-medium mb-1">End time</div>
            <div className="text-2xl font-bold text-gray-100">{lastEnd ? fmtClock(lastEnd) : "--:--"}</div>
          </div>
        </div>
        <div className="border-t border-neutral-800 pt-3">
          <div className="text-xs text-gray-500 mb-1">vs. previous day (cumulative)</div>
          <ResponsiveContainer width="100%" height={110}>
            <AreaChart data={chartData}>
              <XAxis dataKey="idx" ticks={tickIdx} tickFormatter={i => tickLabel[i] || ""} tick={{ fontSize: 9, fill: "#9CA3AF" }} />
              <YAxis hide />
              <Tooltip formatter={(v) => fmtHM(v * 60)} contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} labelStyle={{ display: "none" }} itemStyle={{ color: "#e5e5e5" }} />
              <Area type="monotone" dataKey="prev" stroke="#6B7280" fill="#404040" fillOpacity={0.5} />
              <Area type="monotone" dataKey="cur" stroke="#FF8A2A" fill="#FF8A2A" fillOpacity={0.35} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-1 text-[11px] text-gray-500">
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-400" />{selected}</div>
            <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-neutral-500" />{prevKey}</div>
          </div>
        </div>
      </Card>

      {subjectData.length > 0 && (
        <Card title="Ratio">
          <DonutRatio data={subjectData} total={totalSec} />
        </Card>
      )}

      {totalSec > 0 && (
        <Card title="Logged vs. other">
          <DonutRatio data={studyOtherData} total={86400} />
        </Card>
      )}
    </>
  );
}

function DayStats({ data, activeTimer, now, scheduleSave }) {
  const sessions = sessionsWithActive(data, activeTimer, now);
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState(todayKey());
  const year = cursor.getFullYear(), month = cursor.getMonth();

  const dayTotals = useMemo(() => {
    const map = {};
    sessions.forEach(s => { map[s.date] = (map[s.date] || 0) + s.duration; });
    return map;
  }, [sessions]);

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function heat(sec) {
    const h = sec / 3600;
    if (h <= 0) return "#262626";
    if (h < 4) return "#FFDDB0";
    if (h < 7) return "#FFB570";
    if (h < 10) return "#FF8A2A";
    if (h < 12) return "#FF6B00";
    return "#C24C00";
  }

  const selSessions = data.sessions.filter(s => s.date === selected).sort((a, b) => a.start - b.start);

  return (
    <div>
      <Card>
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-1 text-gray-500"><ChevronLeft size={18} /></button>
          <div className="text-sm font-semibold">{MONTHS[month]} {year}</div>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-1 text-gray-500"><ChevronRight size={18} /></button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-gray-500 mb-1">
          {WEEKDAYS.map(w => <div key={w}>{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1 mb-3">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const key = `${year}-${pad(month + 1)}-${pad(d)}`;
            const sec = dayTotals[key] || 0;
            const isSel = key === selected;
            return (
              <button key={i} onClick={() => setSelected(key)} className={`aspect-square rounded-md flex items-center justify-center text-[10px] ${isSel ? "ring-2 ring-orange-500" : ""}`} style={{ backgroundColor: heat(sec) }}>
                <span className={sec <= 0 ? "text-gray-400" : sec / 3600 >= 7 ? "text-white font-semibold" : "text-neutral-900 font-medium"}>{d}</span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 text-[10px] text-gray-500">
          {["0+", "4+", "7+", "10+", "12+"].map((l, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded" style={{ backgroundColor: ["#262626", "#FFDDB0", "#FFB570", "#FF8A2A", "#C24C00"][i], color: i > 2 ? "white" : (i === 0 ? "#9CA3AF" : "#666") }}>{l}</span>
          ))}
        </div>
      </Card>

      <DaySummary data={data} sessions={sessions} selected={selected} dayTotals={dayTotals} />

      <Card>
        <div className="text-sm font-semibold text-gray-300 mb-2">{selected} · {fmtHM(dayTotals[selected] || 0)}h</div>
        <GroupedSessionList sessions={selSessions} data={data} scheduleSave={scheduleSave} />
      </Card>
    </div>
  );
}

function WeekStats({ data, activeTimer, now }) {
  const sessions = sessionsWithActive(data, activeTimer, now);
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const topLogs = data.logs.filter(l => !l.parentId);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const barData = days.map(d => {
    const k = dateKey(d);
    const row = { label: WEEKDAYS[(d.getDay() + 6) % 7] };
    topLogs.forEach(l => { row[l.id] = 0; });
    sessions.filter(s => s.date === k).forEach(s => { const rid = rootLogId(data.logs, s.logId); row[rid] = (row[rid] || 0) + s.duration / 60; });
    return row;
  });
  const weekEnd = addDays(weekStart, 6);
  const total = sessions.filter(s => s.date >= dateKey(weekStart) && s.date <= dateKey(weekEnd)).reduce((a, s) => a + s.duration, 0);

  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="p-1 text-gray-500"><ChevronLeft size={18} /></button>
        <div className="text-sm font-semibold">{MONTHS[weekStart.getMonth()]} {weekStart.getDate()} – {MONTHS[weekEnd.getMonth()]} {weekEnd.getDate()}</div>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="p-1 text-gray-500"><ChevronRight size={18} /></button>
      </div>
      <div className="text-center text-xs text-gray-500 mb-3">Week total: <span className="text-orange-400 font-semibold">{fmtHMS(total)}</span></div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={barData}>
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9CA3AF" }} />
          <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} />
          <Tooltip formatter={tooltipMin} contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e5e5e5" }} itemStyle={{ color: "#e5e5e5" }} />
          {topLogs.map(l => <Bar key={l.id} dataKey={l.id} stackId="a" fill={l.color} />)}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 mt-3">
        {topLogs.map(l => (
          <div key={l.id} className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />{l.name}
          </div>
        ))}
      </div>
    </Card>
  );
}

function MonthStats({ data, activeTimer, now }) {
  const sessions = sessionsWithActive(data, activeTimer, now);
  const [cursor, setCursor] = useState(new Date());
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;

  const buckets = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const wk = Math.floor((d - 1 + firstWeekday) / 7);
    const k = `${year}-${pad(month + 1)}-${pad(d)}`;
    const sec = sessions.filter(s => s.date === k).reduce((a, s) => a + s.duration, 0);
    buckets[wk] = (buckets[wk] || 0) + sec;
  }
  const barData = Object.keys(buckets).sort((a, b) => a - b).map(wk => ({ label: `Wk ${Number(wk) + 1}`, min: buckets[wk] / 60 }));
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);

  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-1 text-gray-500"><ChevronLeft size={18} /></button>
        <div className="text-sm font-semibold">{MONTHS[month]} {year}</div>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-1 text-gray-500"><ChevronRight size={18} /></button>
      </div>
      <div className="text-center text-xs text-gray-500 mb-3">Month total: <span className="text-orange-400 font-semibold">{fmtHMS(total)}</span></div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={barData}>
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9CA3AF" }} />
          <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} />
          <Tooltip formatter={tooltipMin} contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e5e5e5" }} itemStyle={{ color: "#e5e5e5" }} />
          <Bar dataKey="min" fill="#FF8A2A" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function TrendStats({ data, activeTimer, now }) {
  const sessions = sessionsWithActive(data, activeTimer, now);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const dailyData = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i); const k = dateKey(d);
    const sec = sessions.filter(s => s.date === k).reduce((a, s) => a + s.duration, 0);
    dailyData.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, min: sec / 60 });
  }

  const weeklyData = [];
  for (let i = 11; i >= 0; i--) {
    const ws = addDays(startOfWeek(today), -7 * i);
    const we = addDays(ws, 6);
    const sec = sessions.filter(s => s.date >= dateKey(ws) && s.date <= dateKey(we)).reduce((a, s) => a + s.duration, 0);
    weeklyData.push({ label: `${ws.getMonth() + 1}/${ws.getDate()}`, min: sec / 60 });
  }

  const monthlyData = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const mk = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const sec = sessions.filter(s => s.date.startsWith(mk)).reduce((a, s) => a + s.duration, 0);
    monthlyData.push({ label: MONTHS[d.getMonth()], min: sec / 60 });
  }

  const chart = (title, chartData, max) => (
    <Card title={`${title} (max ${fmtHM(max * 60)})`}>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={chartData}>
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#9CA3AF" }} interval={Math.ceil(chartData.length / 7)} />
          <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} />
          <Tooltip formatter={tooltipMin} contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e5e5e5" }} itemStyle={{ color: "#e5e5e5" }} />
          <Bar dataKey="min" fill="#FF8A2A" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );

  return (
    <div>
      {chart("Last 14 days", dailyData, Math.max(1, ...dailyData.map(d => d.min)))}
      {chart("Last 12 weeks", weeklyData, Math.max(1, ...weeklyData.map(d => d.min)))}
      {chart("Last 12 months", monthlyData, Math.max(1, ...monthlyData.map(d => d.min)))}
    </div>
  );
}
