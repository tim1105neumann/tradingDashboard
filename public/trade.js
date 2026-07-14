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
  renderStats(t);
  renderFillsOrders(t);
  renderUpl(t);
  setupNotes(t);
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
      const style = color ? ` style="background:${color}22;color:${color};border:1px solid ${color}66"` : "";
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
      const col = c.color || "#e9b308";
      const avail = c.tags.filter((tag) => !t.labels.includes(tag));
      const chips = avail.length
        ? avail.map((tag) => `<span class="pick-tag" data-tag="${escapeHtml(tag)}" style="color:${col};border:1px dashed ${col}88">＋ ${escapeHtml(tag)}</span>`).join("")
        : `<span class="picker-empty">alle hinzugefügt</span>`;
      return `<div class="picker-cat"><span class="picker-cat-name" style="color:${col}">${escapeHtml(c.name)}</span>${chips}</div>`;
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

function renderStats(t) {
  const n = net(t);
  const tk = tradeTicks(t);
  document.getElementById("stats").innerHTML = `
    <div class="stat-section">MANAGEMENT</div>
    <div class="stat-grid">
      ${statBox("TAKE PROFIT", n > 0 ? moneyEur(n) : "–", "pos")}
      ${statBox("STOP LOSS", n < 0 ? moneyEur(n) : "–", "neg")}
      ${statBox("TP TICKS", tk != null && tk > 0 ? tk : "–")}
      ${statBox("SL TICKS", tk != null && tk < 0 ? tk : "–")}
      ${statBox("POTENTIAL", "–")}
      ${statBox("SL BENÖTIGT", "–")}
    </div>
    <div class="stat-section">PERFORMANCE</div>
    <div class="stat-grid">
      ${statBox("CRV", "–")}
      ${statBox("REAL CRV", "–")}
      ${statBox("ROI", "–")}
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
