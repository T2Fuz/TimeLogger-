import { Flame, Zap, Snowflake, RotateCcw, Heart, X } from "lucide-react";
import {
  levelInfo, todayKey, dateKey, addDays,
  RESTORE_XP_COST, MAX_FREEZE_TOKENS, LIFELINE_COOLDOWN_DAYS,
} from "./helpers.js";

// Compact badge for the orange header, in the space next to "Today" /
// "Current focus" — just level + a sliver of progress, full detail lives in
// the Settings XpSummary.
export function HeaderXpBadge({ data }) {
  const xp = data.xp || { total: 0, spendable: 0 };
  const { level, xpIntoLevel, xpForNextLevel } = levelInfo(xp.total);
  const pct = Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100));
  return (
    <div className="h-full bg-white/20 rounded-2xl px-4 py-3.5 flex flex-col justify-center">
      <div className="flex items-center gap-2 mb-2">
        <Zap size={20} className="text-white fill-white shrink-0" />
        <div className="text-xl font-bold text-white leading-none">Level {level}</div>
      </div>
      <div className="w-full h-2 rounded-full bg-white/25 overflow-hidden">
        <div className="h-full bg-white rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-white/80 mt-1.5">{xpIntoLevel}/{xpForNextLevel} XP</div>
      <div className="text-xs text-white/80">{xp.spendable || 0} XP available</div>
    </div>
  );
}


// Compact level/XP summary — dropped into Settings, near the old streak
// section. Shows lifetime level progress and the spendable balance that
// streak-restores draw down (spending never lowers the level).
export function XpSummary({ data }) {
  const xp = data.xp || { total: 0, spendable: 0 };
  const { level, xpIntoLevel, xpForNextLevel } = levelInfo(xp.total);
  const pct = Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100));
  return (
    <div className="mt-5 pt-4 border-t border-neutral-800">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-200">
          <Zap size={14} className="text-orange-400 fill-orange-400" />
          Level {level}
        </div>
        <span className="text-xs text-gray-500">{xp.spendable || 0} XP available</span>
      </div>
      <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
        <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[11px] text-gray-500 mt-1">{xpIntoLevel} / {xpForNextLevel} XP to level {level + 1}</div>
    </div>
  );
}

// Pops up when a log's streak broke yesterday and hasn't been resolved yet.
// Lets the person pick whichever restore method they're comfortable with,
// or let the streak reset. `onResolve` receives the chosen method id.
export function StreakRestoreModal({ log, data, onResolve, onDismiss }) {
  if (!log || !log.brokenStreak) return null;

  const xp = data.xp || { spendable: 0 };
  const freezeTokens = log.freezeTokens || 0;
  const canFreeze = freezeTokens > 0;
  const canBuy = (xp.spendable || 0) >= RESTORE_XP_COST;
  const lastLifeline = log.lastLifelineDate ? new Date(log.lastLifelineDate) : null;
  const canLifeline = !lastLifeline || dateKey(addDays(lastLifeline, LIFELINE_COOLDOWN_DAYS)) <= todayKey();
  const catchUpTarget = fmtGoalTimes(log.streakGoalSec);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-sm w-full p-5">
        <div className="flex items-center gap-2 mb-1">
          <Flame size={20} className="text-orange-400" />
          <div className="text-lg font-bold text-white">স্ট্রিক ভেঙে গেছে</div>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          "{log.name}" এর {log.brokenStreak.priorStreak}-দিনের স্ট্রিক গতকাল মিস হয়ে গেছে। ফিরিয়ে আনতে চাইলে নিচের যেকোনো একটা উপায় বেছে নিন।
        </p>

        <div className="space-y-2">
          <RestoreOption
            icon={<Snowflake size={16} />}
            title="ফ্রিজ টোকেন"
            detail={canFreeze ? `${freezeTokens}/${MAX_FREEZE_TOKENS} available — ফ্রি` : `কোনো টোকেন জমা নেই (${MAX_FREEZE_TOKENS} পর্যন্ত জমা হয়)`}
            enabled={canFreeze}
            onClick={() => onResolve("freeze")}
          />
          <RestoreOption
            icon={<Zap size={16} />}
            title={`${RESTORE_XP_COST} XP দিয়ে কিনুন`}
            detail={`আপনার আছে ${xp.spendable || 0} XP`}
            enabled={canBuy}
            onClick={() => onResolve("xp")}
          />
          <RestoreOption
            icon={<RotateCcw size={16} />}
            title="আজকে পুষিয়ে দিন"
            detail={`আজ "${log.name}" এ ${catchUpTarget} লগ করলে স্ট্রিক ফিরে আসবে — ফ্রি`}
            enabled={true}
            onClick={() => onResolve("catchup")}
          />
          <RestoreOption
            icon={<Heart size={16} />}
            title="লাইফলাইন"
            detail={canLifeline ? "ফ্রি, প্রতি ৩০ দিনে একবার" : `আবার পাবেন ${dateKey(addDays(lastLifeline, LIFELINE_COOLDOWN_DAYS))} এর পর`}
            enabled={canLifeline}
            onClick={() => onResolve("lifeline")}
          />
        </div>

        <button onClick={onDismiss} className="w-full mt-4 text-xs text-gray-500 hover:text-gray-300 flex items-center justify-center gap-1 py-1">
          <X size={12} /> ছেড়ে দিন, স্ট্রিক ০ থেকে শুরু হোক
        </button>
      </div>
    </div>
  );
}

function RestoreOption({ icon, title, detail, enabled, onClick }) {
  return (
    <button
      onClick={enabled ? onClick : undefined}
      disabled={!enabled}
      className={`w-full flex items-center gap-3 text-left rounded-xl px-3 py-2.5 border ${
        enabled
          ? "border-neutral-700 bg-neutral-800 hover:border-orange-500/60 active:scale-[0.99]"
          : "border-neutral-800 bg-neutral-900/50 opacity-50 cursor-not-allowed"
      }`}
    >
      <span className={enabled ? "text-orange-400" : "text-gray-600"}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-200">{title}</div>
        <div className="text-[11px] text-gray-500">{detail}</div>
      </div>
    </button>
  );
}

function fmtGoalTimes(goalSec) {
  const doubleSec = (goalSec || 0) * 2;
  const h = Math.floor(doubleSec / 3600), m = Math.floor((doubleSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
