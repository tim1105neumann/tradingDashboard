// Shared helpers + sidebar for all pages.
// Colorblind-safe: blue = gain, orange = loss (distinguishable for red-green colorblindness).
const GREEN = "#3b9eff", RED = "#ff8038", CYAN = "#22d3ee", GOLD = "#f2b30a", GRAY = "#556072";
const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

const money = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyEur = (n) => (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
const pct = (n) => (n * 100).toFixed(1) + "%";
const cls = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
const signColor = (n) => (n >= 0 ? GREEN : RED);
const fmtTime = (t) => (t || "").replace("T", " ").slice(0, 16);

// Tick sizes per ticker (symbol is already mapped to a clean ticker server-side).
const TICK_SIZE = { MNQ: 0.25, MES: 0.25, NQ: 0.25, ES: 0.25 };
function tradeTicks(t) {
  const ts = TICK_SIZE[t.symbol];
  if (ts == null || t.open_price == null || t.close_price == null) return null;
  const d = t.direction === "short" ? t.open_price - t.close_price : t.close_price - t.open_price;
  return Math.round(d / ts);
}

const NAV = [
  { key: "dashboard", label: "Dashboard", ico: "▦", href: "index.html" },
  { key: "journal", label: "Journal", ico: "▤", href: "journal.html" },
  { key: "einblicke", label: "Einblicke", ico: "◔", href: "#" },
  { key: "analyse", label: "Tägliche Analyse", ico: "▧", href: "#" },
  { key: "strategien", label: "Strategien", ico: "⟐", href: "#" },
  { key: "plan", label: "Trading-Plan", ico: "▢", href: "#" },
  { key: "community", label: "Community", ico: "◍", href: "#" },
  { key: "import", label: "Import", ico: "⇩", href: "#" },
  { key: "konten", label: "Konten", ico: "▥", href: "#" },
  { key: "settings", label: "Einstellungen", ico: "⚙", href: "settings.html" },
];

async function fetchTagCategories() {
  try { return await fetch("/api/settings/tags").then((r) => r.json()); }
  catch { return []; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Map each predefined tag -> its category color.
function tagColorMap(cats) {
  const m = {};
  (cats || []).forEach((c) => (c.tags || []).forEach((t) => { m[t] = c.color || "#e9b308"; }));
  return m;
}

// Derive a readable chip palette from a category color: a dark background tint and
// a light-tinted text of the same hue (high contrast, like the default chips).
function hexToRgb(h) {
  h = String(h).replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}
function mixRgb(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
function chipColors(hex) {
  const c = hexToRgb(hex);
  return {
    bg: `rgb(${mixRgb(c, [20, 24, 31], 0.8).join(",")})`,   // dark tinted background
    fg: `rgb(${mixRgb(c, [255, 255, 255], 0.62).join(",")})`, // light readable text
    bd: `rgb(${mixRgb(c, [20, 24, 31], 0.5).join(",")})`,   // visible border
  };
}

// A tag chip; predefined tags get their category color, custom tags stay default.
function tagChipHtml(label, colorMap, cls) {
  const color = colorMap && colorMap[label];
  if (!color) return `<span class="label-chip ${cls || ""}">${escapeHtml(label)}</span>`;
  const { bg, fg, bd } = chipColors(color);
  return `<span class="label-chip ${cls || ""} colored" style="background:${bg};color:${fg};border:1px solid ${bd}">${escapeHtml(label)}</span>`;
}

function renderSidebar(active) {
  const items = NAV.map(
    (n) =>
      `<a class="nav-item ${n.key === active ? "active" : ""}" href="${n.href}"><span class="ico">${n.ico}</span>${n.label}</a>`
  ).join("");
  document.getElementById("sidebar").innerHTML =
    `<div class="brand"><span class="logo">🔥</span><span class="wordmark"><span>EMBER</span><small>TRADING&nbsp;TERMINAL</small></span></div><nav class="nav">${items}</nav>`;
}
