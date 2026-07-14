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
