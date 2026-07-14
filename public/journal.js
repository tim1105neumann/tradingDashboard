renderSidebar("journal");

Chart.defaults.color = "#7d8898";
Chart.defaults.font.family = "-apple-system, Segoe UI, Roboto, sans-serif";
Chart.defaults.font.size = 10;
Chart.defaults.borderColor = "#1c2534";
Chart.defaults.animation = false;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.plugins.legend.display = false;

let pnlChart = null;
let allTrades = [];
let page = 0;
const PER_PAGE = 10;

const net = (t) => t.pnl - t.commission;
const priceDe = (n) => n == null ? "–" : n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function tradeTime(iso) {
  if (!iso) return "–";
  const y = iso.slice(2, 4), mo = iso.slice(5, 7), d = iso.slice(8, 10);
  const t = iso.slice(11, 19) || iso.slice(11, 16);
  return `${d}.${mo}.${y} ${t}`;
}
function durSec(t) {
  if (!t.open_time || !t.close_time) return null;
  const s = (new Date(t.close_time) - new Date(t.open_time)) / 1000;
  return Number.isFinite(s) && s >= 0 ? s : null;
}
function fmtDur(sec) {
  if (sec == null) return "–";
  sec = Math.round(sec);
  if (sec < 60) return sec + "s";
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
const avgTicks = (arr) => {
  const xs = arr.map(tradeTicks).filter((x) => x != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};

async function refresh() {
  const status = document.getElementById("status");
  try {
    const [d, trades] = await Promise.all([
      fetch("/api/analytics").then((r) => r.json()),
      fetch("/api/trades").then((r) => r.json()),
    ]);
    allTrades = trades.slice().sort((a, b) => (a.close_time < b.close_time ? 1 : -1));
    renderStats(d, trades);
    renderPnlChart(d.byDay);
    renderTrades();
    document.getElementById("fromDate").textContent = trades.length
      ? tradeTime(trades[0].close_time).slice(0, 8) : "–";
    status.textContent = "live · " + new Date().toLocaleTimeString();
    status.className = "status live";
  } catch {
    status.textContent = "connection error";
    status.className = "status error";
  }
}

function statRows(id, arr) {
  document.getElementById(id).innerHTML = arr
    .map((r) => `<div class="stat-row"><span>${r[0]}</span><span class="${r[2] || ""}">${r[1]}</span></div>`)
    .join("");
}

function renderStats(d, trades) {
  const m = d.metrics;
  const total = trades.length;
  const sumPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const fees = trades.reduce((s, t) => s + t.commission, 0);
  const days = new Set(trades.map((t) => (t.close_time || "").slice(0, 10))).size;
  const vols = trades.map((t) => t.volume);
  const durs = trades.map(durSec).filter((x) => x != null);
  const nets = trades.map(net);
  const maxWin = nets.length ? Math.max(...nets) : 0;
  const maxLoss = nets.length ? Math.min(...nets) : 0;
  const avgNet = total ? m.netPnl / total : 0;
  // ticks
  const netTicks = trades.reduce((s, t) => s + (tradeTicks(t) ?? 0), 0);
  const winTrades = trades.filter((t) => net(t) > 0);
  const lossTrades = trades.filter((t) => net(t) < 0);
  let maxWinT = null, maxLossT = null;
  for (const t of trades) {
    if (maxWinT == null || net(t) > net(maxWinT)) maxWinT = t;
    if (maxLossT == null || net(t) < net(maxLossT)) maxLossT = t;
  }
  const tk = (t) => (t && tradeTicks(t) != null ? tradeTicks(t) : "–");
  const avgTk = (arr) => { const v = avgTicks(arr); return v == null ? "–" : v.toFixed(1); };
  let peak = 0, eq = 0;
  for (const p of m.equityCurve) { eq = p.equity; if (eq > peak) peak = eq; }
  const curDD = peak - (m.equityCurve.length ? m.equityCurve[m.equityCurve.length - 1].equity : 0);
  const dur3 = durs.length ? `${fmtDur(Math.min(...durs))} / ${fmtDur(Math.max(...durs))} / ${fmtDur(durs.reduce((a, b) => a + b, 0) / durs.length)}` : "–";

  statRows("statPerf", [
    ["Netto-P&L", moneyEur(m.netPnl), cls(m.netPnl)],
    ["P&L", moneyEur(sumPnl), cls(sumPnl)],
    ["Net Ticks", netTicks, cls(netTicks)],
    ["Ticks", netTicks, cls(netTicks)],
    ["Gewinnfaktor", m.profitFactor == null ? "∞" : m.profitFactor.toFixed(2), ""],
    ["Gewinnrate", pct(m.winRate), "gold"],
    ["ROI%", "–", ""],
    ["Gesamtertrag", moneyEur(m.grossProfit), "pos"],
    ["Gesamtverlust", moneyEur(-m.grossLoss), "neg"],
    ["Gebühren", moneyEur(fees), ""],
  ]);
  statRows("statAnalyse", [
    ["Gewinn-Trades", d.donut.wins, "pos"],
    ["Verlust-Trades", d.donut.losses, "neg"],
    ["Breakeven-Trades", d.donut.breakeven, ""],
    ["Tage", days, ""],
    ["Durchschn. Trades pro Tag", days ? Math.round(total / days) : 0, ""],
    ["Lots min/max/avg", vols.length ? `${Math.min(...vols)} / ${Math.max(...vols)} / ${Math.round(vols.reduce((a, b) => a + b, 0) / vols.length)}` : "–", ""],
    ["Min/Max/Avg Dauer", dur3, ""],
  ]);
  statRows("statRisk", [
    ["Max Drawdown $/Ticks", `${moneyEur(-m.maxDrawdown)} / –`, "neg"],
    ["Drawdown $/Ticks", `${moneyEur(-curDD)} / –`, "neg"],
    ["Peak PnL $/Ticks", `${moneyEur(peak)} / –`, "pos"],
    ["Ø CRV", "–", ""],
    ["Ø RealCRV", "–", ""],
    ["Ø SL diff Ticks", "–", ""],
    ["Ø Potential diff Ticks", "–", ""],
  ]);
  statRows("statDetails", [
    ["Ø Ticks win", avgTk(winTrades), "pos"],
    ["Ø Ticks loss", avgTk(lossTrades), "neg"],
    ["Max Win $/Ticks", `${moneyEur(maxWin)} / ${tk(maxWinT)}`, "pos"],
    ["Max Loss $/Ticks", `${moneyEur(maxLoss)} / ${tk(maxLossT)}`, "neg"],
    ["Ø PnL $/Ticks", `${moneyEur(avgNet)} / ${avgTk(trades)}`, cls(avgNet)],
  ]);
}

function renderPnlChart(byDay) {
  const cfg = {
    type: "bar",
    data: {
      labels: byDay.map((d) => d.date),
      datasets: [{
        data: byDay.map((d) => d.pnl),
        backgroundColor: byDay.map((d) => (d.pnl >= 0 ? "rgba(59,158,255,.85)" : "rgba(255,128,56,.85)")),
        borderRadius: 3,
      }],
    },
    options: {
      plugins: { tooltip: { callbacks: { label: (c) => moneyEur(c.parsed.y) } } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { maxTicksLimit: 6 } },
      },
    },
  };
  if (pnlChart) pnlChart.destroy();
  pnlChart = new Chart(document.getElementById("pnlChart").getContext("2d"), cfg);
}

function stars(rating) {
  return `<span class="stars">${[1, 2, 3, 4, 5].map((i) => (i <= rating ? "★" : "☆")).join("")}</span>`;
}
function labelChips(labels) {
  if (!labels || !labels.length) return "";
  return `<div class="row-labels">${labels.map((l) => `<span class="label-chip sm">${l}</span>`).join("")}</div>`;
}

function tradeRow(t) {
  const n = net(t);
  const tk = tradeTicks(t);
  return `<div class="trade-row ${n >= 0 ? "win" : "loss"}" onclick="location.href='trade.html?id=${t.id}'">
    <input type="checkbox" class="tcheck" onclick="event.stopPropagation()" />
    <div class="tcol rating">${stars(t.rating)}
      <div class="tsym">${t.symbol}</div>
      <span class="pill ${t.direction}">${t.direction}</span>
      ${labelChips(t.labels)}
    </div>
    <div class="tcol tpnl">
      <div class="${cls(n)}">${moneyEur(n)}</div>
      <div class="tsub ${cls(tk ?? 0)}">${tk == null ? "–" : tk + " Ticks"}</div>
    </div>
    <div class="tcol"><div class="tlabel">OPEN</div><div class="tval">${tradeTime(t.open_time)}</div><div class="tprice">${priceDe(t.open_price)}</div></div>
    <div class="tcol"><div class="tlabel">CLOSE</div><div class="tval">${tradeTime(t.close_time)}</div><div class="tprice">${priceDe(t.close_price)}</div></div>
    <div class="tcol"><div class="tlabel">SIZE</div><div class="tval">${t.volume} Contracts</div></div>
    <div class="tcol"><div class="tlabel">DURATION</div><div class="tval">${fmtDur(durSec(t))}</div></div>
    <div class="tcol"><div class="tlabel">ACCOUNT</div><div class="tval">${t.account || "–"}</div></div>
    <div class="tcol tshot">🖼</div>
  </div>`;
}

function renderTrades() {
  const totalPages = Math.max(1, Math.ceil(allTrades.length / PER_PAGE));
  if (page >= totalPages) page = totalPages - 1;
  const start = page * PER_PAGE;
  const slice = allTrades.slice(start, start + PER_PAGE);
  document.getElementById("tradeList").innerHTML = slice.length
    ? slice.map(tradeRow).join("")
    : `<div class="empty">Noch keine Trades — warte auf ATAS…</div>`;
  const end = Math.min(start + PER_PAGE, allTrades.length);
  document.getElementById("pageInfo").textContent =
    allTrades.length ? `${start + 1} – ${end} von ${allTrades.length}` : "0 von 0";
}

document.getElementById("prevPage").onclick = () => { if (page > 0) { page--; renderTrades(); } };
document.getElementById("nextPage").onclick = () => {
  if ((page + 1) * PER_PAGE < allTrades.length) { page++; renderTrades(); }
};

refresh();
setInterval(refresh, 5000);
