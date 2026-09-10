import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  AreaChart, Area, Scatter, ScatterChart, ReferenceLine
} from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  fmtClock, fmtHM, fmtHMS, dateKey, rootLogId, pad, addDays, startOfWeek,
  todayKey, weekdayIdx, logicalMinutes, minutesToClock, WEEKDAYS, MONTHS,
} from "./helpers.js";
import { GroupedSessionList } from "./SessionViews.jsx";

function tooltipMin(v) { return `${Math.round(v)} min`; }

export default function StatisticsPanel({ data, activeTimer, now, statsTab, setStatsTab, periodRange, setPeriodRange, customFrom, setCustomFrom, customTo, setCustomTo, scheduleSave }) {
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
        <GroupedSessionList sessions={selSessions} data={data} scheduleSave={scheduleSave} selected={selected} />
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
