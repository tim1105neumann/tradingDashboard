renderSidebar("journal");

Chart.defaults.color = "#7d8898";
Chart.defaults.animation = false;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.plugins.legend.display = false;

const id = new URLSearchParams(location.search).get("id");
let tagCats = [];
const net = (t) => t.pnl - t.commission;
const priceDe = (n) => (n == null ? "–" : n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function fullTime(iso) {
  if (!iso) return "–";
  const d = iso.slice(8, 10), mo = iso.slice(5, 7), y = iso.slice(0, 4);
  return `${d}.${mo}.${y} ${iso.slice(11, 19) || iso.slice(11, 16)}`;
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
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m ${sec % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function load() {
  let t;
  try {
    const r = await fetch(`/api/trades/${id}`);
    if (!r.ok) throw new Error();
    t = await r.json();
  } catch {
    document.getElementById("summary").innerHTML = `<div class="empty">Trade nicht gefunden.</div>`;
    return;
  }
  tagCats = await fetchTagCategories();
  renderSummary(t);
  renderStars(t);
  renderLabels(t);
  const chartData = await loadChart(t);
  renderStats(t, chartData);
  renderChart(t, chartData);
  renderScreenshot(t);
  renderFillsOrders(t);
  renderUpl(t);
  setupNotes(t);
}

// ATAS screenshot lives in its own card (revealed only when one exists).
function renderScreenshot(t) {
  const wrap = document.getElementById("shotWrap");
  const card = document.getElementById("shotCard");
  if (!wrap || !card || !t.screenshot) return;
  const src = `/screenshots/${t.id}.jpg?v=${encodeURIComponent(t.received_at || "")}`;
  card.innerHTML = `<a href="${src}" target="_blank" rel="noopener">
    <img class="trade-shot" src="${src}" alt="ATAS Screenshot bei Trade-Abschluss" /></a>`;
  wrap.style.display = "";
}

// Fetch the trade's candle window once (shared by the chart AND the statistics card).
async function loadChart(t) {
  if (!t.chart) return null;
  try {
    const r = await fetch(`/api/trades/${t.id}/chart`);
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d.candles) && d.candles.length ? d : null;
  } catch { return null; }
}

// Chart card: interactive candlestick chart when candle data exists, else placeholder.
function renderChart(t, data) {
  const card = document.getElementById("chartShot");
  if (!card || !data) return; // leaves the "Chart Data Not Available Yet" placeholder
  drawTradeChart(card, t, data);
}

function drawTradeChart(card, t, data) {
  card.classList.remove("chart-placeholder");
  card.innerHTML = `<div class="tv-chart" id="tvChart"></div><div class="chart-overlay" id="chartOverlay"></div>`;
  const host = document.getElementById("tvChart");
  const overlay = document.getElementById("chartOverlay");

  const chart = LightweightCharts.createChart(host, {
    layout: { background: { color: "transparent" }, textColor: "#7d8898", fontSize: 11 },
    grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
    rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
    timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    autoSize: true,
  });

  const candles = data.candles.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c }));
  // Keep TP/SL (and entry/exit) inside the price scale even when price never reached them.
  const extras = [data.tp, data.sl, data.entry_price, data.exit_price].filter((v) => v != null);
  const series = chart.addCandlestickSeries({
    upColor: "#26a69a", downColor: "#ef5350", borderVisible: false,
    wickUpColor: "#26a69a", wickDownColor: "#ef5350",
    autoscaleInfoProvider: (orig) => {
      const res = orig();
      if (!res || !extras.length) return res;
      let { minValue, maxValue } = res.priceRange;
      for (const v of extras) { minValue = Math.min(minValue, v); maxValue = Math.max(maxValue, v); }
      return { priceRange: { minValue, maxValue } };
    },
  });
  series.setData(candles);

  // Entry (Buy/Sell) price line + TP/SL lines.
  const isBuy = (data.direction || "").toLowerCase().startsWith("b") || t.direction === "long";
  const priceLine = (price, color, title) => {
    if (price == null) return;
    series.createPriceLine({ price, color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title });
  };
  priceLine(data.entry_price, isBuy ? "#3b9eff" : "#ec4899", `${isBuy ? "Buy" : "Sell"} x${data.volume ?? t.volume}`);
  priceLine(data.tp, "#22c55e", "TP");
  priceLine(data.sl, "#ef4444", "SL");

  // Entry/exit arrow markers.
  series.setMarkers([
    { time: data.entry_time, position: isBuy ? "belowBar" : "aboveBar", color: GOLD, shape: isBuy ? "arrowUp" : "arrowDown" },
    { time: data.exit_time, position: isBuy ? "aboveBar" : "belowBar", color: GOLD, shape: isBuy ? "arrowDown" : "arrowUp" },
  ]);

  // Yellow dashed entry -> exit diagonal as a 2-point line series.
  const diag = chart.addLineSeries({ color: GOLD, lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
  diag.setData([
    { time: data.entry_time, value: data.entry_price },
    { time: data.exit_time, value: data.exit_price },
  ]);

  chart.timeScale().fitContent();

  // Coordinate-synced overlay: green reward zone, red risk zone, "+X ticks" badge.
  const ticks = tradeTicks(t);
  const sync = () => positionOverlay(overlay, chart, series, data, ticks);
  chart.timeScale().subscribeVisibleTimeRangeChange(sync);
  new ResizeObserver(sync).observe(host);
  sync();
}

// Places the zone rectangles + tick badge over the chart using data->pixel conversion.
function positionOverlay(overlay, chart, series, data, ticks) {
  overlay.innerHTML = "";
  const ts = chart.timeScale();
  const x1 = ts.timeToCoordinate(data.entry_time);
  const x2 = ts.timeToCoordinate(data.exit_time);
  const yEntry = series.priceToCoordinate(data.entry_price);
  if (x1 == null || x2 == null || yEntry == null) return;
  const left = Math.min(x1, x2), width = Math.abs(x2 - x1);

  const box = (top, height, cls) => {
    const d = document.createElement("div");
    d.className = cls;
    d.style.cssText = `left:${left}px;width:${width}px;top:${top}px;height:${height}px`;
    overlay.appendChild(d);
  };
  if (data.tp != null) {
    const yTp = series.priceToCoordinate(data.tp);
    if (yTp != null) box(Math.min(yTp, yEntry), Math.abs(yEntry - yTp), "zone-green");
  }
  if (data.sl != null) {
    const ySl = series.priceToCoordinate(data.sl);
    if (ySl != null) box(Math.min(ySl, yEntry), Math.abs(ySl - yEntry), "zone-red");
  }
  if (ticks != null) {
    const yExit = series.priceToCoordinate(data.exit_price);
    const badge = document.createElement("div");
    badge.className = "ticks-badge";
    badge.textContent = `${ticks > 0 ? "+" : ""}${ticks} Ticks`;
    badge.style.cssText = `left:${(x1 + x2) / 2}px;top:${(yEntry + (yExit ?? yEntry)) / 2}px`;
    overlay.appendChild(badge);
  }
}

let current = null;

async function save(path, body) {
  await fetch(`/api/trades/${id}/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function renderStars(t) {
  current = t;
  const bar = document.getElementById("starBar");
  bar.innerHTML = [1, 2, 3, 4, 5]
    .map((i) => `<span class="star ${i <= t.rating ? "on" : ""}" data-v="${i}">${i <= t.rating ? "★" : "☆"}</span>`)
    .join("");
  bar.querySelectorAll(".star").forEach((el) => {
    el.onclick = async () => {
      const v = Number(el.dataset.v);
      t.rating = v === t.rating ? 0 : v; // click active star again clears it
      renderStars(t);
      await save("rating", { rating: t.rating });
    };
  });
}

function renderLabels(t) {
  const bar = document.getElementById("labelBar");
  if (!bar) return;
  const cm = tagColorMap(tagCats);
  const chips = t.labels
    .map((l, i) => {
      const color = cm[l];
      let style = "";
      if (color) { const { bg, fg, bd } = chipColors(color); style = ` style="background:${bg};color:${fg};border:1px solid ${bd}"`; }
      return `<span class="label-chip${color ? " colored" : ""}"${style}>${escapeHtml(l)}<i class="x" data-i="${i}">✕</i></span>`;
    })
    .join("");
  bar.innerHTML = chips +
    `<span class="label-add"><input id="labelInput" placeholder="" /><i class="plus" id="labelPlus">＋</i></span>`;

  bar.querySelectorAll(".x").forEach((el) => {
    el.onclick = async () => {
      t.labels.splice(Number(el.dataset.i), 1);
      renderLabels(t);
      await save("labels", { labels: t.labels });
    };
  });
  const input = document.getElementById("labelInput");
  const add = async () => {
    const v = input.value.trim();
    if (!v || t.labels.includes(v)) { input.value = ""; return; }
    t.labels.push(v);
    renderLabels(t);
    document.getElementById("labelInput").focus();
    await save("labels", { labels: t.labels });
  };
  document.getElementById("labelPlus").onclick = add;
  input.onkeydown = (e) => { if (e.key === "Enter") add(); };

  renderTagPicker(t);
}

function renderTagPicker(t) {
  const picker = document.getElementById("tagPicker");
  if (!picker) return;
  const groups = tagCats
    .filter((c) => (c.tags || []).length)
    .map((c) => {
      const { fg, bd } = chipColors(c.color || "#e9b308");
      const avail = c.tags.filter((tag) => !t.labels.includes(tag));
      const chips = avail.length
        ? avail.map((tag) => `<span class="pick-tag" data-tag="${escapeHtml(tag)}" style="color:${fg};border:1px dashed ${bd}">＋ ${escapeHtml(tag)}</span>`).join("")
        : `<span class="picker-empty">alle hinzugefügt</span>`;
      return `<div class="picker-cat"><span class="picker-cat-name" style="color:${fg}">${escapeHtml(c.name)}</span>${chips}</div>`;
    })
    .join("");
  picker.innerHTML = groups
    ? `<div class="picker-title">Tags hinzufügen</div>${groups}`
    : `<div class="picker-hint">Noch keine Tags definiert — lege welche unter <a href="settings.html">Einstellungen</a> an.</div>`;
  picker.querySelectorAll(".pick-tag").forEach((el) => {
    el.onclick = async () => {
      const tag = el.dataset.tag;
      if (!t.labels.includes(tag)) {
        t.labels.push(tag);
        renderLabels(t);
        await save("labels", { labels: t.labels });
      }
    };
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderSummary(t) {
  const n = net(t);
  const tk = tradeTicks(t);
  document.getElementById("summary").innerHTML = `
    <div class="sum-head">
      <div class="sum-sym"><span class="tsym">${t.symbol}</span><span class="pill ${t.direction}">${t.direction}</span></div>
      <div class="sum-meta">
        <div><span class="tlabel">SIZE</span><div>${t.volume} Contracts</div></div>
        <div><span class="tlabel">DAUER</span><div>${fmtDur(durSec(t))}</div></div>
        <div><span class="tlabel">GEBÜHREN</span><div>${moneyEur(t.commission)}</div></div>
        <div><span class="tlabel">KONTO</span><div>${t.account || "–"}</div></div>
      </div>
    </div>
    <div class="sum-body">
      <div class="sum-pnl">
        <div class="big-pnl ${cls(n)}">${moneyEur(n)}</div>
        <div class="sum-ticks"><span class="tlabel">DURCHSCHN. TICKS</span> <b>${tk ?? "–"}</b> &nbsp; <span class="tlabel">TICKS</span> <b>${tk ?? "–"}</b></div>
      </div>
      <div class="sum-times">
        <div><span class="tlabel">ERÖFFNUNG</span><div class="gold">${fullTime(t.open_time)}</div><div class="tprice">${priceDe(t.open_price)}</div></div>
        <div><span class="tlabel">SCHLIESSUNG</span><div class="gold">${fullTime(t.close_time)}</div><div class="tprice">${priceDe(t.close_price)}</div></div>
      </div>
    </div>
    <div class="label-bar" id="labelBar"></div>
    <div class="tag-picker" id="tagPicker"></div>`;
}

function statBox(label, value, cl) {
  return `<div class="stat-box"><span class="tlabel">${label}</span><div class="${cl || ""}">${value}</div></div>`;
}

// Max favorable / adverse excursion (ticks) over the trade's holding window, from candles.
function excursions(t, data, ts) {
  if (!data || !Array.isArray(data.candles) || !ts || data.entry_price == null) return null;
  const e = data.entry_price;
  const dir = t.direction === "short" ? -1 : 1;
  const win = data.candles.filter((c) => c.t >= data.entry_time && c.t <= data.exit_time);
  const bars = win.length ? win : data.candles;
  let hi = -Infinity, lo = Infinity;
  for (const c of bars) { if (c.h > hi) hi = c.h; if (c.l < lo) lo = c.l; }
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  const favPrice = dir > 0 ? hi : lo; // best move in your favour
  const advPrice = dir > 0 ? lo : hi; // worst move against you
  return {
    mfe: Math.max(0, Math.round((dir * (favPrice - e)) / ts)),
    mae: Math.max(0, Math.round((dir * (e - advPrice)) / ts)),
  };
}

// Fills the statistics card from the trade + (when present) its chart bracket/candle data.
// TP/SL-derived boxes need the add-on's bracket data; excursion boxes need candles.
// Anything we can't compute stays "–".
function renderStats(t, data) {
  const dash = "–";
  const ts = TICK_SIZE[t.symbol], tv = TICK_VALUE[t.symbol];
  const dir = t.direction === "short" ? -1 : 1;
  const n = net(t);
  const e = data?.entry_price ?? t.open_price;
  const tp = data?.tp ?? null, sl = data?.sl ?? null;

  // Planned bracket distances (ticks): TP above/below entry, SL as a positive risk distance.
  const tpTicks = (tp != null && e != null && ts) ? Math.round((dir * (tp - e)) / ts) : null;
  const slTicks = (sl != null && e != null && ts) ? Math.round((dir * (e - sl)) / ts) : null;
  const toMoney = (ticks) => (ticks != null && tv != null) ? ticks * tv * t.volume : null;
  const tpDollar = toMoney(tpTicks);
  const slDollar = toMoney(slTicks);

  // Excursions from the candle path.
  const ex = excursions(t, data, ts);
  const potDollar = ex ? toMoney(ex.mfe) : null;

  // Ratios.
  const crv = (tpTicks != null && slTicks) ? tpTicks / slTicks : null; // planned reward : risk
  const realCrv = (ex && ex.mae) ? ex.mfe / ex.mae : null;            // actual MFE : MAE from price
  const roi = slDollar ? n / Math.abs(slDollar) : null;              // R-multiple on planned risk

  const money = (v) => v == null ? dash : moneyEur(v);
  const ticks = (v) => v == null ? dash : `${v} T`;
  const ratio = (v) => v == null ? dash : `1 : ${v.toFixed(2)}`;
  const rMult = (v) => v == null ? dash : `${v >= 0 ? "+" : ""}${v.toFixed(2)} R`;

  document.getElementById("stats").innerHTML = `
    <div class="stat-section">MANAGEMENT</div>
    <div class="stat-grid">
      ${statBox("TAKE PROFIT", money(tpDollar), "pos")}
      ${statBox("STOP LOSS", slDollar == null ? dash : moneyEur(-Math.abs(slDollar)), "neg")}
      ${statBox("TP TICKS", ticks(tpTicks), "pos")}
      ${statBox("SL TICKS", ticks(slTicks), "neg")}
      ${statBox("POTENTIAL", money(potDollar), "pos")}
      ${statBox("SL BENÖTIGT", ex ? ticks(ex.mae) : dash, "neg")}
    </div>
    <div class="stat-section">PERFORMANCE</div>
    <div class="stat-grid">
      ${statBox("CRV", ratio(crv))}
      ${statBox("REAL CRV", ratio(realCrv))}
      ${statBox("ROI", rMult(roi), roi == null ? "" : roi >= 0 ? "pos" : "neg")}
    </div>`;
}

function renderFillsOrders(t) {
  // Reconstruct the two fills (entry + exit) from the aggregated trade.
  const entrySide = t.direction === "short" ? "SELL" : "BUY";
  const exitSide = t.direction === "short" ? "BUY" : "SELL";
  const sideCls = (s) => (s === "BUY" ? "pos" : "neg");
  document.getElementById("fills").innerHTML = `
    <tr class="mt-head"><th>RICHTUNG</th><th>QTY</th><th>ZEIT</th><th class="num">PREIS</th></tr>
    <tr><td class="${sideCls(entrySide)}">${entrySide}</td><td>${t.volume}</td><td>${fullTime(t.open_time)}</td><td class="num">${priceDe(t.open_price)}</td></tr>
    <tr><td class="${sideCls(exitSide)}">${exitSide}</td><td>${t.volume}</td><td>${fullTime(t.close_time)}</td><td class="num">${priceDe(t.close_price)}</td></tr>`;
  document.getElementById("orders").innerHTML = `
    <tr class="mt-head"><th>AUSGEFÜHRT</th><th>TYP</th><th>ZEIT</th><th>RICHTUNG</th><th class="num">PREIS</th></tr>
    <tr><td class="dot-cell"><i class="dot green"></i></td><td>MARKET</td><td>${fullTime(t.open_time)}</td><td class="${sideCls(entrySide)}">${entrySide}</td><td class="num">${priceDe(t.open_price)}</td></tr>
    <tr><td class="dot-cell"><i class="dot green"></i></td><td>MARKET</td><td>${fullTime(t.close_time)}</td><td class="${sideCls(exitSide)}">${exitSide}</td><td class="num">${priceDe(t.close_price)}</td></tr>`;
}

function renderUpl(t) {
  // We only have the final realized P&L, not the intra-trade path, so we draw a
  // simple 0 -> final line and say so.
  const n = net(t);
  document.getElementById("uplNote").textContent =
    "Nur Start/Ende bekannt — der ATAS-Export liefert keinen Intra-Trade-Verlauf.";
  new Chart(document.getElementById("uplChart").getContext("2d"), {
    type: "line",
    data: {
      labels: ["Open", "Close"],
      datasets: [{ data: [0, n], borderColor: GOLD, borderWidth: 2, pointRadius: 3, tension: 0 }],
    },
    options: {
      plugins: { tooltip: { callbacks: { label: (c) => moneyEur(c.parsed.y) } } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: "rgba(255,255,255,0.04)" } } },
    },
  });
}

function setupNotes(t) {
  const ta = document.getElementById("notes");
  const st = document.getElementById("noteStatus");
  ta.value = t.comment || "";
  let timer;
  const save = async () => {
    st.textContent = "speichert…";
    try {
      await fetch(`/api/trades/${id}/note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: ta.value }),
      });
      st.textContent = "gespeichert ✓";
    } catch {
      st.textContent = "Fehler beim Speichern";
    }
  };
  ta.addEventListener("input", () => {
    clearTimeout(timer);
    st.textContent = "";
    timer = setTimeout(save, 700);
  });
  ta.addEventListener("blur", save);
}

load();
