import type { Trade } from "./db.js";

export interface Metrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number; // 0..1
  netPnl: number;
  grossProfit: number;
  grossLoss: number; // positive number
  profitFactor: number | null; // null when no losses
  avgWin: number;
  avgLoss: number; // negative
  maxDrawdown: number; // positive number
  equityCurve: { time: string; equity: number }[];
}

export function computeMetrics(trades: Trade[]): Metrics {
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve: { time: string; equity: number }[] = [];

  for (const t of trades) {
    const net = t.pnl - t.commission;
    if (net >= 0) {
      wins++;
      grossProfit += net;
    } else {
      losses++;
      grossLoss += -net;
    }
    equity += net;
    equityCurve.push({ time: t.close_time, equity });
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const total = trades.length;
  return {
    totalTrades: total,
    wins,
    losses,
    winRate: total ? wins / total : 0,
    netPnl: grossProfit - grossLoss,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss,
    avgWin: wins ? grossProfit / wins : 0,
    avgLoss: losses ? -grossLoss / losses : 0,
    maxDrawdown,
    equityCurve,
  };
}

// ---- Breakdown analytics for the dashboard ----

const net = (t: Trade) => t.pnl - t.commission;

export interface DayStat { date: string; pnl: number; trades: number; }
export interface HourStat { hour: number; label: string; pnl: number; trades: number; winRate: number; profitFactor: number | null; }
export interface CalendarDay { date: string; day: number; pnl: number; trades: number; winRate: number; }
export interface CalendarWeek { week: number; days: (CalendarDay | null)[]; pnl: number; trades: number; winRate: number; }
export interface CalendarMonth { year: number; month: number; weeks: CalendarWeek[]; pnl: number; trades: number; winRate: number; }

export interface Analytics {
  donut: { wins: number; losses: number; breakeven: number };
  byDay: DayStat[];
  byHour: HourStat[];
  calendar: CalendarMonth;
}

function winRateOf(trades: Trade[]): number {
  if (!trades.length) return 0;
  return trades.filter((t) => net(t) > 0).length / trades.length;
}

function profitFactorOf(trades: Trade[]): number | null {
  let gp = 0, gl = 0;
  for (const t of trades) {
    const v = net(t);
    if (v >= 0) gp += v; else gl += -v;
  }
  return gl === 0 ? null : gp / gl;
}

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export function computeAnalytics(trades: Trade[]): Analytics {
  const donut = {
    wins: trades.filter((t) => net(t) > 0).length,
    losses: trades.filter((t) => net(t) < 0).length,
    breakeven: trades.filter((t) => net(t) === 0).length,
  };

  // by day
  const dayMap = new Map<string, Trade[]>();
  for (const t of trades) {
    const d = (t.close_time || "").slice(0, 10);
    if (!d) continue;
    (dayMap.get(d) ?? dayMap.set(d, []).get(d)!).push(t);
  }
  const byDay: DayStat[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ts]) => ({ date, pnl: ts.reduce((s, t) => s + net(t), 0), trades: ts.length }));

  // by hour
  const hourMap = new Map<number, Trade[]>();
  for (const t of trades) {
    const h = Number((t.close_time || "").slice(11, 13));
    if (!Number.isFinite(h)) continue;
    (hourMap.get(h) ?? hourMap.set(h, []).get(h)!).push(t);
  }
  const byHour: HourStat[] = [...hourMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, ts]) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}-${String((hour + 1) % 24).padStart(2, "0")}`,
      pnl: ts.reduce((s, t) => s + net(t), 0),
      trades: ts.length,
      winRate: winRateOf(ts),
      profitFactor: profitFactorOf(ts),
    }));

  return { donut, byDay, byHour, calendar: buildCalendar(trades) };
}

function buildCalendar(trades: Trade[]): CalendarMonth {
  // Anchor on the most recent trade's month, else the current month.
  const anchor = trades.length
    ? new Date(trades[trades.length - 1].close_time)
    : new Date();
  const year = anchor.getFullYear();
  const month = anchor.getMonth(); // 0-based

  const dayMap = new Map<string, Trade[]>();
  for (const t of trades) {
    const d = (t.close_time || "").slice(0, 10);
    (dayMap.get(d) ?? dayMap.set(d, []).get(d)!).push(t);
  }
  const statFor = (date: string, day: number): CalendarDay => {
    const ts = dayMap.get(date) ?? [];
    return { date, day, pnl: ts.reduce((s, t) => s + net(t), 0), trades: ts.length, winRate: winRateOf(ts) };
  };

  const first = new Date(year, month, 1);
  const startMon = (first.getDay() + 6) % 7; // days before the 1st within its Mon-week
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weeks: CalendarWeek[] = [];
  let cursor = 1 - startMon; // may be <=0 (previous month days => empty cells)
  while (cursor <= daysInMonth) {
    const days: (CalendarDay | null)[] = [];
    const weekTrades: Trade[] = [];
    let weekPnl = 0;
    let weekNum = 0;
    for (let i = 0; i < 7; i++) {
      const dayNo = cursor + i;
      if (dayNo < 1 || dayNo > daysInMonth) {
        if (i < 5) days.push(null); // Mon-Fri empty cell
        continue;
      }
      const dateObj = new Date(year, month, dayNo);
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNo).padStart(2, "0")}`;
      const stat = statFor(date, dayNo);
      if (i < 5) days.push(stat); // only Mon-Fri shown
      const ts = dayMap.get(date) ?? [];
      weekTrades.push(...ts);
      weekPnl += stat.pnl;
      weekNum = isoWeek(dateObj);
    }
    weeks.push({
      week: weekNum,
      days,
      pnl: weekPnl,
      trades: weekTrades.length,
      winRate: winRateOf(weekTrades),
    });
    cursor += 7;
  }

  const monthTrades = trades.filter((t) => {
    const d = new Date(t.close_time);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  return {
    year,
    month,
    weeks,
    pnl: monthTrades.reduce((s, t) => s + net(t), 0),
    trades: monthTrades.length,
    winRate: winRateOf(monthTrades),
  };
}
