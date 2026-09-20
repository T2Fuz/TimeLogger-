import { useState, useMemo } from "react";
import { Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { fmtClock, fmtHMS, fmt24, rootLogId, todayKey } from "./helpers.js";

// A session's own note takes priority (this is the per-session note baked in
// when the session was created). Sessions logged before that feature existed
// have no `note` field at all (undefined, not "") — for those, fall back to
// the old shared per-log-per-day note so old history still displays.
function noteFor(session, log, dateKey) {
  if (session && session.note !== undefined) return session.note;
  if (!log) return "";
  if (log.notesByDate) return log.notesByDate[dateKey] || "";
  return dateKey === todayKey() ? (log.note || "") : "";
}

export function SessionRow({ session, data, scheduleSave, dateKey }) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState("range"); // "range" | "duration"
  const [date, setDate] = useState(session.date);
  const [start, setStart] = useState(fmt24(session.start));
  const [end, setEnd] = useState(fmt24(session.end));
  const [hh, setHh] = useState(String(Math.floor(session.duration / 3600)));
  const [mm, setMm] = useState(String(Math.floor((session.duration % 3600) / 60)));
  const log = data.logs.find(l => l.id === session.logId);
  const [noteDraft, setNoteDraft] = useState(() => noteFor(session, log, dateKey));

  function save() {
    let s, e, duration;
    if (mode === "duration") {
      s = new Date(`${date}T${start}:00`);
      duration = (parseInt(hh || "0", 10) * 3600) + (parseInt(mm || "0", 10) * 60);
      if (duration <= 0 || isNaN(s.getTime())) return;
      e = new Date(s.getTime() + duration * 1000);
    } else {
      s = new Date(`${date}T${start}:00`);
      e = new Date(`${date}T${end}:00`);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return;
      if (e <= s) e = new Date(e.getTime() + 86400000);
      duration = Math.round((e.getTime() - s.getTime()) / 1000);
      if (duration <= 0) return;
    }
    // Defense in depth: never write a corrupted session, even if some future
    // change reintroduces a bad input format upstream of this point.
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || isNaN(duration)) return;
    scheduleSave({
      ...data,
      sessions: data.sessions.map(x => x.id === session.id ? { ...x, date, start: s.getTime(), end: e.getTime(), duration, note: noteDraft.trim() } : x),
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

        <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="Note for this session"
          rows={2} className="w-full bg-neutral-900 border border-neutral-700 text-gray-100 rounded px-2 py-1 text-xs resize-none" />

        <div className="flex gap-2">
          <button onClick={save} className="flex-1 bg-orange-500 text-white rounded py-1.5 text-xs font-medium">Save</button>
          <button onClick={remove} className="px-3 bg-neutral-900 border border-red-900 text-red-400 rounded py-1.5 text-xs">Delete</button>
          <button onClick={() => setEditing(false)} className="px-3 bg-neutral-900 border border-neutral-700 text-gray-400 rounded py-1.5 text-xs">Cancel</button>
        </div>
      </div>
    );
  }

  const note = noteFor(session, log, dateKey);

  return (
    <div className="bg-neutral-900 rounded-lg px-3 py-2 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: log?.color || "#999" }} />
        <span className="flex-1 text-gray-300">{log?.name || "Deleted log"}</span>
        <span className="text-gray-500 text-xs">{fmtClock(session.start)}–{fmtClock(session.end)}</span>
        <span className="text-gray-300 text-xs font-medium">{fmtHMS(session.duration)}</span>
        <button onClick={() => setEditing(true)} className="text-gray-500 hover:text-orange-400 shrink-0"><Pencil size={13} /></button>
      </div>
      {note && (
        <div className="flex gap-2 mt-1.5 pt-1.5 border-t border-neutral-800">
          <span className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: log?.color || "#999" }} />
          <div className="text-xs text-gray-500 whitespace-pre-wrap">{note}</div>
        </div>
      )}
    </div>
  );
}

export function GroupedSessionList({ sessions, data, scheduleSave, dateKey }) {
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
          return <SessionRow key={g.logId} session={g.list[0]} data={data} scheduleSave={scheduleSave} dateKey={dateKey} />;
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
                {g.list.map(s => <SessionRow key={s.id} session={s} data={data} scheduleSave={scheduleSave} dateKey={dateKey} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

