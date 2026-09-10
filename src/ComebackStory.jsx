import { useState, useEffect, useRef } from "react";
import { X, Sparkles, History } from "lucide-react";
import { calendarDateKey } from "./helpers.js";
import { STORY_SUBJECTS } from "./storySubjects.js";

// Read silently at ~200 wpm, a 1-minute story should stay under ~180 words
// to comfortably finish inside the minute. Wikipedia summaries run long, so
// we trim to this many words and add "…" if we had to cut it.
const MAX_WORDS = 170;
const READ_SECONDS = 60;

function trimToWords(text, maxWords) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ").replace(/[.,;:!?]*$/, "") + "…";
}

// Is a story due right now, and hasn't been completed for today's calendar
// date yet? Runs on the plain calendar date + a user-chosen wall-clock time
// (Settings → Story time) — deliberately separate from the logging day's
// reset-hour, since "start of my day" for motivation isn't the same concept
// as "when today's timer totals roll over".
export function isStoryDue(data, now) {
  const settings = data.settings || {};
  const hour = settings.storyHour ?? 8;
  const minute = settings.storyMinute ?? 0;
  const story = data.story || {};
  const today = calendarDateKey(now);

  if (story.lastShownDate === today) return false; // already completed today
  if (story.pendingDate === today) return true; // was due earlier, still hasn't loaded/shown

  const d = new Date(now);
  const scheduled = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0);
  return d.getTime() >= scheduled.getTime();
}

function pickNextSubject(story) {
  const used = new Set(story.usedIds || []);
  let pool = STORY_SUBJECTS.filter(s => !used.has(s.id));
  if (pool.length === 0) pool = STORY_SUBJECTS; // seen them all — start the rotation over
  return pool[Math.floor(Math.random() * pool.length)];
}

async function fetchWikipediaSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikipedia fetch failed: ${res.status}`);
  const json = await res.json();
  if (!json.extract) throw new Error("No extract in Wikipedia response");
  return {
    displayTitle: json.title || title,
    extract: json.extract,
    thumbnail: json.thumbnail?.source || null,
    pageUrl: json.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

// Blocking gate: shown at the top of the app (in App.jsx) whenever
// isStoryDue() is true. Fetches a fresh comeback story from Wikipedia,
// enforces a 60-second minimum read before the close button appears, and
// can't be dismissed by clicking outside or pressing Escape.
export function StoryGate({ data, scheduleSave, now }) {
  const due = isStoryDue(data, now);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [story, setStory] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(READ_SECONDS);
  const fetchedForRef = useRef(null);

  useEffect(() => {
    if (!due) return;
    const today = calendarDateKey(now);
    if (fetchedForRef.current === today) return; // already tried this date this session
    fetchedForRef.current = today;

    // Mark pending immediately so a reload/offline moment before this
    // resolves still counts as "due" next time the app opens.
    if (data.story?.pendingDate !== today) {
      scheduleSave({ ...data, story: { ...(data.story || {}), pendingDate: today } });
    }

    setStatus("loading");
    const subject = pickNextSubject(data.story || {});
    fetchWikipediaSummary(subject.title)
      .then(fetched => {
        setStory({ ...fetched, subjectId: subject.id, category: subject.category });
        setStatus("ready");
        setSecondsLeft(READ_SECONDS);
      })
      .catch(() => {
        setStatus("error"); // no internet or Wikipedia unreachable — retry next app open
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due]);

  useEffect(() => {
    if (status !== "ready") return;
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [status, secondsLeft]);

  if (!due || status === "idle") return null;

  function finish() {
    const today = calendarDateKey(now);
    const entry = { date: today, ...story, shownAt: Date.now() };
    const prevStory = data.story || {};
    scheduleSave({
      ...data,
      story: {
        lastShownDate: today,
        pendingDate: null,
        usedIds: [...(prevStory.usedIds || []), story.subjectId],
        history: [entry, ...(prevStory.history || [])].slice(0, 200),
      },
    });
  }

  const canClose = status === "ready" && secondsLeft <= 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 px-5">
      <div className="bg-neutral-900 w-full max-w-sm rounded-2xl p-5 max-h-[85vh] overflow-y-auto relative">
        <div className="flex items-center gap-2 mb-3 text-orange-400">
          <Sparkles size={16} />
          <span className="text-xs font-semibold uppercase tracking-wide">Comeback story</span>
        </div>

        {status === "loading" && (
          <div className="py-10 text-center text-sm text-gray-400">Fetching today's story…</div>
        )}

        {status === "error" && (
          <div className="py-10 text-center text-sm text-gray-400">
            Couldn't reach the internet to load today's story.<br />
            It'll show automatically once you're back online.
          </div>
        )}

        {status === "ready" && story && (
          <>
            {story.thumbnail && (
              <img src={story.thumbnail} alt="" className="w-full h-36 object-cover rounded-lg mb-3" />
            )}
            <h3 className="text-base font-bold text-gray-100 mb-2">{story.displayTitle}</h3>
            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
              {trimToWords(story.extract, MAX_WORDS)}
            </p>
            <div className="mt-5 flex items-center justify-between">
              <span className="text-[11px] text-gray-500">
                {canClose ? "" : `Unlocks in ${secondsLeft}s`}
              </span>
              <button
                onClick={canClose ? finish : undefined}
                disabled={!canClose}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${canClose ? "bg-orange-500 text-white" : "bg-neutral-800 text-gray-600 cursor-not-allowed"}`}>
                {canClose ? <><X size={14} /> Close</> : "Close"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Simple scrollable history of every comeback story shown so far — opened
// from a button in Settings.
export function StoryHistoryModal({ open, onClose, story }) {
  if (!open) return null;
  const history = story?.history || [];
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-neutral-900 w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-100 flex items-center gap-1.5"><History size={16} /> Story history</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-neutral-800"><X size={18} /></button>
        </div>
        {history.length === 0 && <p className="text-sm text-gray-500">No stories yet — check back after your first one shows.</p>}
        <div className="space-y-4">
          {history.map((h, i) => (
            <div key={`${h.subjectId}-${h.date}-${i}`} className="border-b border-neutral-800 pb-3 last:border-0">
              <div className="text-[11px] text-gray-500 mb-1">{h.date}</div>
              <div className="text-sm font-semibold text-gray-200 mb-1">{h.displayTitle}</div>
              <p className="text-xs text-gray-400 leading-relaxed">{trimToWords(h.extract, MAX_WORDS)}</p>
              {h.pageUrl && (
                <a href={h.pageUrl} target="_blank" rel="noreferrer" className="text-[11px] text-orange-400 mt-1 inline-block">Read more on Wikipedia →</a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
