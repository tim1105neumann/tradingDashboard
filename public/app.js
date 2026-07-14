const money = (n) =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n * 100).toFixed(1) + "%";
const cls = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");

async function refresh() {
  const status = document.getElementById("status");
  try {
    const [metrics, trades] = await Promise.all([
      fetch("/api/metrics").then((r) => r.json()),
      fetch("/api/trades").then((r) => r.json()),
    ]);
    renderCards(metrics);
    renderEquity(metrics.equityCurve);
    renderTrades(trades);
    status.textContent = "live · updated " + new Date().toLocaleTimeString();
    status.className = "status live";
  } catch (err) {
    status.textContent = "connection error";
    status.className = "status error";
  }
}

function renderCards(m) {
  const cards = [
    { label: "Net P&L", value: money(m.netPnl), cls: cls(m.netPnl) },
    { label: "Trades", value: String(m.totalTrades) },
    { label: "Win Rate", value: pct(m.winRate) },
    { label: "Profit Factor", value: m.profitFactor == null ? "∞" : m.profitFactor.toFixed(2) },
    { label: "Avg Win", value: money(m.avgWin), cls: "pos" },
    { label: "Avg Loss", value: money(m.avgLoss), cls: "neg" },
    { label: "Max Drawdown", value: money(-m.maxDrawdown), cls: "neg" },
  ];
  document.getElementById("cards").innerHTML = cards
    .map(
      (c) =>
        `<div class="card"><div class="label">${c.label}</div><div class="value ${c.cls || ""}">${c.value}</div></div>`
    )
    .join("");
}

function renderEquity(curve) {
  const canvas = document.getElementById("equity");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (curve.length === 0) {
    ctx.fillStyle = "#8a94a3";
    ctx.font = "13px sans-serif";
    ctx.fillText("No trades yet", 12, 24);
    return;
  }

  const pad = 8;
  const eqs = curve.map((p) => p.equity).concat([0]);
  const min = Math.min(...eqs);
  const max = Math.max(...eqs);
  const range = max - min || 1;
  const x = (i) => pad + (i / Math.max(curve.length - 1, 1)) * (w - 2 * pad);
  const y = (v) => h - pad - ((v - min) / range) * (h - 2 * pad);

  // zero line
  ctx.strokeStyle = "#262c34";
  ctx.beginPath();
  ctx.moveTo(pad, y(0));
  ctx.lineTo(w - pad, y(0));
  ctx.stroke();

  // equity line
  const last = curve[curve.length - 1].equity;
  ctx.strokeStyle = last >= 0 ? "#26a269" : "#e0523b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  curve.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p.equity)) : ctx.lineTo(x(i), y(p.equity))));
  ctx.stroke();
}

function renderTrades(trades) {
  const tbody = document.querySelector("#trades tbody");
  if (trades.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No trades yet — waiting for ATAS webhook…</td></tr>`;
    return;
  }
  tbody.innerHTML = trades
    .slice()
    .reverse()
    .map((t) => {
      const net = t.pnl - t.commission;
      return `<tr>
        <td>${(t.close_time || "").replace("T", " ")}</td>
        <td>${t.symbol}</td>
        <td class="${t.direction === "long" ? "pos" : "neg"}">${t.direction}</td>
        <td class="num">${t.volume}</td>
        <td class="num">${t.open_price ?? "–"}</td>
        <td class="num">${t.close_price ?? "–"}</td>
        <td class="num ${cls(net)}">${money(net)}</td>
      </tr>`;
    })
    .join("");
}

refresh();
setInterval(refresh, 3000);
