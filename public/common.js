// Shared helpers + sidebar for all pages.
const GREEN = "#22c55e", RED = "#f43f5e", CYAN = "#22d3ee", GOLD = "#e9b308", GRAY = "#6b7280";
const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

const money = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyEur = (n) => (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
const pct = (n) => (n * 100).toFixed(1) + "%";
const cls = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
const signColor = (n) => (n >= 0 ? GREEN : RED);
const fmtTime = (t) => (t || "").replace("T", " ").slice(0, 16);

const NAV = [
  { key: "dashboard", label: "Dashboard", ico: "▦", href: "index.html" },
  { key: "journal", label: "Journal", ico: "▤", href: "journal.html" },
  { key: "einblicke", label: "Einblicke", ico: "◔", href: "#" },
  { key: "analyse", label: "Tägliche Analyse", ico: "▧", href: "#" },
  { key: "strategien", label: "Strategien", ico: "⟐", href: "#" },
  { key: "plan", label: "Trading-Plan", ico: "▢", href: "#" },
  { key: "community", label: "Community", ico: "◍", href: "#" },
  { key: "import", label: "Import", ico: "⇩", href: "#" },
  { key: "werkzeuge", label: "Werkzeuge", ico: "▣", href: "#" },
  { key: "konten", label: "Konten", ico: "▥", href: "#" },
  { key: "hilfe", label: "Hilfe", ico: "?", href: "#" },
  { key: "profil", label: "Benutzerprofil", ico: "◑", href: "#" },
  { key: "abmelden", label: "Abmelden", ico: "⏻", href: "#" },
];

function renderSidebar(active) {
  const items = NAV.map(
    (n) =>
      `<a class="nav-item ${n.key === active ? "active" : ""}" href="${n.href}"><span class="ico">${n.ico}</span>${n.label}</a>`
  ).join("");
  document.getElementById("sidebar").innerHTML =
    `<div class="brand"><div class="logo">🔥</div></div><nav class="nav">${items}</nav>`;
}
