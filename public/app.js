const money = (n) =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyShort = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (n) => (n * 100).toFixed(1) + "%";
const cls = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
const fmtTime = (t) => (t || "").replace("T", " ").slice(0, 16);

let lastCurve = [];
let curveGeom = null;

async function refresh() {
  const status = document.getElementById("status");
  try {
    const [metrics, trades] = await Promise.all([
      fetch("/api/metrics").then((r) => r.json()),
      fetch("/api/trades").then((r) => r.json()),
    ]);
    renderCards(metrics);
    lastCurve = metrics.equityCurve;
    renderEquity(lastCurve);
    renderTrades(trades);
    status.textContent = "live · " + new Date().toLocaleTimeString();
    status.className = "status live";
  } catch {
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

  // Use the CSS layout size as the source of truth — never the backing store,
  // so the canvas can't grow on repeated renders.
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (curve.length === 0) {
    ctx.fillStyle = "#8a94a3";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No trades yet", w / 2, h / 2);
    curveGeom = null;
    return;
  }

  const padL = 56;
  const padR = 12;
  const padT = 12;
  const padB = 22;

  // Include the starting baseline (0) so a single trade still renders sensibly.
  const eqs = [0, ...curve.map((p) => p.equity)];
  let min = Math.min(...eqs);
  let max = Math.max(...eqs);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;
  const range = max - min;

  const n = curve.length;
  const x = (i) => padL + (n === 1 ? 0.5 : i / (n - 1)) * (w - padL - padR);
  const y = (v) => padT + (1 - (v - min) / range) * (h - padT - padB);

  // Horizontal gridlines + y labels
  ctx.font = "11px sans-serif";
  ctx.textBaseline = "middle";
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = min + (range * t) / ticks;
    const gy = y(v);
    ctx.strokeStyle = "#20262e";
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(w - padR, gy);
    ctx.stroke();
    ctx.fillStyle = "#6b7480";
    ctx.textAlign = "right";
    ctx.fillText(moneyShort(v), padL - 8, gy);
  }

  // Zero baseline (emphasised)
  if (min < 0 && max > 0) {
    ctx.strokeStyle = "#3a424c";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, y(0));
    ctx.lineTo(w - padR, y(0));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const last = curve[n - 1].equity;
  const color = last >= 0 ? "#26a269" : "#e0523b";

  // Area fill under the line
  const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
  grad.addColorStop(0, last >= 0 ? "rgba(38,162,105,0.28)" : "rgba(224,82,59,0.28)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  ctx.moveTo(x(0), y(Math.max(min, Math.min(max, 0))));
  curve.forEach((p, i) => ctx.lineTo(x(i), y(p.equity)));
  ctx.lineTo(x(n - 1), y(Math.max(min, Math.min(max, 0))));
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Equity line
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  curve.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p.equity)) : ctx.lineTo(x(i), y(p.equity))));
  ctx.stroke();

  // x-axis first/last labels
  ctx.fillStyle = "#6b7480";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(fmtTime(curve[0].time), padL, h - 6);
  ctx.textAlign = "right";
  ctx.fillText(fmtTime(curve[n - 1].time), w - padR, h - 6);

  curveGeom = { curve, x, y, w, h, padL, padR, padT, padB, color };
}

// Hover tooltip on the equity curve
function setupTooltip() {
  const canvas = document.getElementById("equity");
  const tip = document.getElementById("tip");
  canvas.addEventListener("mousemove", (e) => {
    if (!curveGeom) return (tip.style.display = "none");
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { curve, x, y, color } = curveGeom;
    let best = 0;
    let bestD = Infinity;
    curve.forEach((_, i) => {
      const d = Math.abs(x(i) - mx);
      if (d < bestD) { bestD = d; best = i; }
    });
    const p = curve[best];
    redrawWithMarker(best);
    tip.style.display = "block";
    tip.style.left = Math.min(x(best) + 12, rect.width - 140) + "px";
    tip.style.top = y(p.equity) - 8 + "px";
    tip.innerHTML = `<span style="color:${color}">${money(p.equity)}</span><br><span class="tip-sub">${fmtTime(p.time)}</span>`;
  });
  canvas.addEventListener("mouseleave", () => {
    tip.style.display = "none";
    renderEquity(lastCurve);
  });
}

function redrawWithMarker(idx) {
  renderEquity(lastCurve);
  if (!curveGeom) return;
  const { curve, x, y, color, padT, h, padB } = curveGeom;
  const ctx = document.getElementById("equity").getContext("2d");
  const px = x(idx);
  const py = y(curve[idx].equity);
  ctx.strokeStyle = "#3a424c";
  ctx.beginPath();
  ctx.moveTo(px, padT);
  ctx.lineTo(px, h - padB);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0f1216";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function renderTrades(trades) {
  const tbody = document.querySelector("#trades tbody");
  if (trades.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No trades yet — waiting for ATAS…</td></tr>`;
    return;
  }
  tbody.innerHTML = trades
    .slice()
    .reverse()
    .map((t) => {
      const net = t.pnl - t.commission;
      return `<tr>
        <td>${fmtTime(t.close_time)}</td>
        <td class="sym">${t.symbol}</td>
        <td><span class="pill ${t.direction}">${t.direction}</span></td>
        <td class="num">${t.volume}</td>
        <td class="num">${t.open_price ?? "–"}</td>
        <td class="num">${t.close_price ?? "–"}</td>
        <td class="num ${cls(net)}">${money(net)}</td>
      </tr>`;
    })
    .join("");
}

setupTooltip();
refresh();
setInterval(refresh, 3000);
