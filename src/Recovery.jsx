import { useState, useMemo } from "react";
import { Download, RotateCcw, ShieldCheck, AlertTriangle } from "lucide-react";
import { auditData, repairData, readSnapshots, fmtHM } from "./helpers.js";

function downloadJson(obj, filename) {
  try {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {}
}

function fmtWhen(ts) {
  try { return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return ""; }
}

// Settings → Data recovery. Two jobs:
//  1. Health check: spots timers that vanished but still have sessions,
//     duplicate sessions, and unreadable rows — and fixes them without
//     deleting anything.
//  2. Snapshots: automatic copies of this device's data, taken right before
//     other data replaced it. Restoring one is one tap (and snapshots the
//     current data first, so a restore can always be undone).
export default function RecoveryPanel({ data, exportData, replaceAllData }) {
  const [snaps, setSnaps] = useState(() => readSnapshots());
  const audit = useMemo(() => auditData(data), [data]);
  const problems = audit.orphanSessions + audit.duplicates + audit.badParents;

  function fixAll() {
    const parts = [];
    if (audit.orphanSessions) parts.push(`${audit.orphanSessions} session(s) whose timer is missing will be put under new "Recovered timer" entries (rename them afterwards)`);
    if (audit.duplicates) parts.push(`${audit.duplicates} exact duplicate session(s) will be merged into one`);
    if (audit.badParents) parts.push(`${audit.badParents} sub-log(s) with a missing parent will become top-level`);
    if (!window.confirm(`This will:\n\n• ${parts.join("\n• ")}\n\nYour current data is saved as a snapshot first. Continue?`)) return;
    replaceAllData(repairData(data), "before repair");
    setSnaps(readSnapshots());
  }

  function restore(snap) {
    const ok = window.confirm(
      `Restore the copy from ${fmtWhen(snap.at)}?\n\nIt has ${snap.logs} timers and ${snap.sessions} sessions (${fmtHM(snap.totalSec)} h in total). Right now you have ${data.logs.length} timers and ${data.sessions.length} sessions.\n\nYour current data is saved as a snapshot first, so this can be undone.`
    );
    if (!ok) return;
    replaceAllData(snap.data, "before restore");
    setSnaps(readSnapshots());
  }

  return (
    <div className="mt-5 pt-4 border-t border-neutral-800">
      <label className="text-xs text-gray-400 block mb-2">Data recovery</label>

      <div className="bg-neutral-900 rounded-lg px-3 py-2.5 text-xs text-gray-300 mb-2">
        <div className="flex items-center gap-2">
          {problems === 0 ? <ShieldCheck size={14} className="text-green-500 shrink-0" /> : <AlertTriangle size={14} className="text-orange-400 shrink-0" />}
          <span className="flex-1">
            {audit.logCount} timers · {audit.sessionCount} sessions · {fmtHM(audit.totalSec)} h logged
          </span>
        </div>
        {problems === 0 && audit.quarantined === 0 && (
          <div className="text-[11px] text-gray-500 mt-1.5">No problems found in your data.</div>
        )}
        {audit.orphanSessions > 0 && (
          <div className="text-[11px] text-orange-300 mt-1.5">{audit.orphanSessions} session(s) belong to {audit.orphanLogCount} timer(s) that no longer exist.</div>
        )}
        {audit.duplicates > 0 && (
          <div className="text-[11px] text-orange-300 mt-1">{audit.duplicates} duplicate session(s) (same timer, same start and end).</div>
        )}
        {audit.badParents > 0 && (
          <div className="text-[11px] text-orange-300 mt-1">{audit.badParents} sub-log(s) point to a parent that no longer exists.</div>
        )}
        {audit.quarantined > 0 && (
          <div className="text-[11px] text-gray-400 mt-1">{audit.quarantined} unreadable row(s) are set aside (not deleted) — they're included in Export backup.</div>
        )}
        {problems > 0 && (
          <button onClick={fixAll} className="mt-2 w-full bg-orange-500 text-white rounded-lg py-1.5 text-xs font-medium">Fix safely</button>
        )}
      </div>

      <div className="flex gap-2 mb-3">
        <button onClick={exportData} className="flex-1 flex items-center justify-center gap-1.5 bg-neutral-900 border border-neutral-700 text-gray-300 rounded-lg py-1.5 text-xs">
          <Download size={13} /> Export backup now
        </button>
      </div>

      <p className="text-[11px] text-gray-500 mb-2">
        Automatic copies of this device's data, saved right before newer data from the cloud, an import, or a repair replaced it.
      </p>
      {snaps.length === 0 ? (
        <div className="text-[11px] text-gray-600">No snapshots yet.</div>
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {snaps.map(snap => (
            <div key={snap.at} className="bg-neutral-900 rounded-lg px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-gray-300">{fmtWhen(snap.at)}</span>
                <span className="text-[10px] text-gray-500">{snap.reason}</span>
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                {snap.logs} timers · {snap.sessions} sessions · {fmtHM(snap.totalSec)} h
              </div>
              <div className="flex gap-2 mt-1.5">
                <button onClick={() => restore(snap)} className="flex-1 flex items-center justify-center gap-1 bg-orange-500 text-white rounded py-1 text-[11px] font-medium">
                  <RotateCcw size={11} /> Restore
                </button>
                <button onClick={() => downloadJson(snap.data, `timelogger-snapshot-${new Date(snap.at).toISOString().slice(0, 10)}.json`)}
                  className="px-3 bg-neutral-800 border border-neutral-700 text-gray-300 rounded py-1 text-[11px]">
                  <Download size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
