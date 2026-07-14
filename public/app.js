renderSidebar("dashboard");

Chart.defaults.color = "#7d8898";
Chart.defaults.font.family = "-apple-system, Segoe UI, Roboto, sans-serif";
Chart.defaults.font.size = 10;
Chart.defaults.borderColor = "#1c2534";
Chart.defaults.animation = false;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.plugins.legend.display = false;

const charts = {};
function mk(id, config) {
  const el = document.getElementById(id);
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el.getContext("2d"), config);
  return charts[id];
}

async function refresh() {
  const status = document.getElementById("status");
  try {
    const d = await fetch("/api/analytics").then((r) => r.json());
    render(d);
    status.textContent = "live · " + new Date().toLocaleTimeString();
    status.className = "status live";
  } catch (e) {
    status.textContent = "connection error";
    status.className = "status error";
  }
}

function render(d) {
  const m = d.metrics;

  // Top summary numbers
  const bp = document.getElementById("bigPnl");
  bp.textContent = money(m.netPnl);
  bp.className = "big-pnl " + cls(m.netPnl);
  document.getElementById("bigWinRate").textContent = pct(m.winRate);
  document.getElementById("donutCount").textContent = m.totalTrades;
  document.getElementById("gaugeValue").textContent = m.profitFactor == null ? "∞" : m.profitFactor.toFixed(2);

  renderEquity(m.equityCurve);
  renderDonut(d.donut);
  renderGauge(m.profitFactor);
  renderByDay(d.byDay);
  renderHourBars(d.byHour);
  renderCalendar(d.calendar);

  const now = new Date();
  document.getElementById("topDate").textContent = now.toLocaleDateString("de-DE");
}

function renderEquity(curve) {
  const labels = curve.map((_, i) => i);
  const data = curve.map((p) => p.equity);
  const up = (data[data.length - 1] ?? 0) >= 0;
  mk("equityChart", {
    type: "line",
    data: {
      labels,
      datasets: [{
        data,
        borderColor: CYAN,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
        fill: true,
        backgroundColor: (ctx) => {
          const { ctx: c, chartArea } = ctx.chart;
          if (!chartArea) return "transparent";
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, up ? "rgba(34,197,94,0.35)" : "rgba(244,63,94,0.30)");
          g.addColorStop(1, "rgba(34,197,94,0)");
          return g;
        },
      }],
    },
    options: {
      plugins: { tooltip: { callbacks: { title: (i) => "Trade " + (i[0].dataIndex + 1), label: (c) => money(c.parsed.y) } } },
      scales: {
        x: { display: false },
        y: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { maxTicksLimit: 4, callback: (v) => "$" + v } },
      },
    },
  });
}

function renderDonut(donut) {
  const { wins, losses, breakeven } = donut;
  const empty = wins + losses + breakeven === 0;
  mk("donutChart", {
    type: "doughnut",
    data: {
      labels: ["Gewinne", "Verluste", "Breakeven"],
      datasets: [{
        data: empty ? [1] : [wins, losses, breakeven],
        backgroundColor: empty ? ["#1c2534"] : [GREEN, RED, GRAY],
        borderWidth: 0,
      }],
    },
    options: { cutout: "72%", plugins: { tooltip: { enabled: !empty } } },
  });
}

function renderGauge(pf) {
  const max = 3;
  const val = pf == null ? max : Math.max(0, Math.min(max, pf));
  mk("gaugeChart", {
    type: "doughnut",
    data: {
      datasets: [{
        data: [val, max - val],
        backgroundColor: [pf != null && pf >= 1 ? GREEN : CYAN, "#1c2534"],
        borderWidth: 0,
      }],
    },
    options: { rotation: -90, circumference: 180, cutout: "70%", plugins: { tooltip: { enabled: false } } },
  });
}

function renderByDay(byDay) {
  mk("byDayChart", {
    type: "bar",
    data: {
      labels: byDay.map((d) => d.date.slice(5)),
      datasets: [{
        data: byDay.map((d) => d.pnl),
        backgroundColor: byDay.map((d) => (d.pnl >= 0 ? "rgba(34,197,94,.8)" : "rgba(244,63,94,.8)")),
        borderRadius: 3,
      }],
    },
    options: {
      plugins: { tooltip: { callbacks: { label: (c) => money(c.parsed.y) } } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { maxTicksLimit: 5 } },
      },
    },
  });
}

function hbar(id, byHour, valueFn, colorFn, xFmt, xMax) {
  mk(id, {
    type: "bar",
    data: {
      labels: byHour.map((h) => h.label),
      datasets: [{
        data: byHour.map(valueFn),
        backgroundColor: byHour.map(colorFn),
        borderRadius: 3,
        barThickness: 16,
      }],
    },
    options: {
      indexAxis: "y",
      plugins: { tooltip: { callbacks: { label: (c) => xFmt(c.parsed.x) } } },
      scales: {
        x: { grid: { color: "rgba(255,255,255,0.04)" }, ticks: { callback: xFmt }, ...(xMax != null ? { max: xMax, min: 0 } : {}) },
        y: { grid: { display: false } },
      },
    },
  });
}

function renderHourBars(byHour) {
  hbar("pnlHourChart", byHour, (h) => h.pnl, (h) => (h.pnl >= 0 ? GREEN : RED), (v) => money(v));
  hbar("pfHourChart", byHour, (h) => (h.profitFactor == null ? 10 : Math.min(h.profitFactor, 10)),
    (h) => (h.profitFactor != null && h.profitFactor >= 1 ? GREEN : CYAN), (v) => v.toFixed(2), 10);
  hbar("wrHourChart", byHour, (h) => h.winRate * 100,
    (h) => (h.winRate >= 0.5 ? GREEN : GOLD), (v) => v.toFixed(0) + "%", 100);
}

function calCell(stat) {
  if (!stat) return `<div class="cal-cell empty"></div>`;
  const has = stat.trades > 0;
  return `<div class="cal-cell">
    <div class="cal-day">${stat.day}</div>
    ${has ? `<div class="cal-pnl ${cls(stat.pnl)}">${money(stat.pnl)}</div>
      <div class="cal-meta">${pct(stat.winRate)}</div>
      <div class="cal-meta">${stat.trades} trades</div>` : ""}
  </div>`;
}

function weekCell(w) {
  const has = w.trades > 0;
  return `<div class="cal-cell week">
    <div class="cal-week-label">KW ${w.week}</div>
    <span class="cal-sigma">Σ</span>
    ${has ? `<div class="cal-pnl ${cls(w.pnl)}">${money(w.pnl)}</div>
      <div class="cal-meta">${pct(w.winRate)}</div>
      <div class="cal-meta">${w.trades} trades</div>` : ""}
  </div>`;
}

function renderCalendar(cal) {
  document.getElementById("calMonth").textContent = (MONTHS[cal.month] + " " + cal.year).toUpperCase();
  const heads = ["MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "WOCHE"];
  let html = `<div class="cal-row cal-head">${heads.map((h) => `<div class="cal-cell">${h}</div>`).join("")}</div>`;
  for (const w of cal.weeks) {
    html += `<div class="cal-row">${w.days.map(calCell).join("")}${weekCell(w)}</div>`;
  }
  html += `<div class="cal-row">${Array(5).fill(`<div class="cal-cell empty"></div>`).join("")}
    <div class="cal-cell month">
      <div class="cal-week-label">Monat</div><span class="cal-sigma">Σ</span>
      <div class="cal-pnl ${cls(cal.pnl)}">${money(cal.pnl)}</div>
      <div class="cal-meta">${pct(cal.winRate)}</div>
      <div class="cal-meta">${cal.trades} trades</div>
    </div></div>`;
  document.getElementById("calendar").innerHTML = html;
}

refresh();
setInterval(refresh, 3000);
