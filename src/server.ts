import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { getSetting, getTradeById, getTradeByExternalId, getTrades, insertTrade, setSetting, updateLabels, updateNote, updateRating, SCREENSHOTS_DIR, CHARTS_DIR } from "./db.js";
import { NormalizeError, normalizeAtasTrade } from "./normalize.js";
import { computeAnalytics, computeMetrics } from "./metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;

mkdirSync(SCREENSHOTS_DIR, { recursive: true });
mkdirSync(CHARTS_DIR, { recursive: true });

const app = express();
// Limit is generous because trades can carry a base64 screenshot spanning all monitors.
app.use(express.json({ limit: "20mb" }));

// --- Live sync: ATAS webhook receiver ---
app.post("/webhook/atas", (req, res) => {
  // Strip the (potentially large) screenshot before logging/normalizing so it never
  // bloats the console log or the `raw` column; it's stored as a file after insert.
  const screenshot = typeof req.body?.screenshot === "string" ? (req.body.screenshot as string) : null;
  if (req.body && "screenshot" in req.body) delete req.body.screenshot;
  console.log("[webhook] RAW PAYLOAD >>>", JSON.stringify(req.body));
  try {
    const trade = normalizeAtasTrade(req.body ?? {});
    const id = insertTrade(trade);
    if (id == null) {
      console.log(`[webhook] duplicate ignored (external_id=${trade.external_id})`);
      return res.status(200).json({ status: "duplicate" });
    }
    if (screenshot) {
      try {
        writeFileSync(resolve(SCREENSHOTS_DIR, `${id}.jpg`), Buffer.from(screenshot, "base64"));
        console.log(`[webhook] saved screenshot for trade #${id} (${Math.round(screenshot.length / 1024)} KB base64)`);
      } catch (e) {
        console.error(`[webhook] failed to save screenshot for trade #${id}`, e);
      }
    }
    console.log(`[webhook] stored trade #${id}: ${trade.symbol} ${trade.direction} pnl=${trade.pnl}`);
    res.status(201).json({ status: "stored", id });
  } catch (err) {
    if (err instanceof NormalizeError) {
      console.warn(`[webhook] rejected: ${err.message}`, req.body);
      return res.status(422).json({ status: "error", message: err.message });
    }
    console.error("[webhook] unexpected error", err);
    res.status(500).json({ status: "error" });
  }
});

// --- Live sync: delayed candle window for a trade's chart ---
// The add-on sends this minutes after the trade closes, once post-exit ("future")
// bars have formed. Correlated to the trade by external_id, stored as data/charts/<id>.json.
app.post("/webhook/atas/chart", (req, res) => {
  const externalId = typeof req.body?.external_id === "string" ? (req.body.external_id as string) : null;
  const candles = Array.isArray(req.body?.candles) ? req.body.candles : null;
  if (!externalId || !candles || candles.length === 0) {
    return res.status(422).json({ status: "error", message: "external_id and non-empty candles required" });
  }
  const trade = getTradeByExternalId(externalId);
  if (!trade) {
    console.warn(`[chart] no trade for external_id=${externalId} (yet?)`);
    return res.status(404).json({ status: "error", message: "trade not found" });
  }
  try {
    writeFileSync(resolve(CHARTS_DIR, `${trade.id}.json`), JSON.stringify(req.body));
    console.log(`[chart] stored chart for trade #${trade.id}: ${candles.length} candles, tp=${req.body?.tp} sl=${req.body?.sl}`);
    res.status(201).json({ status: "stored", id: trade.id });
  } catch (e) {
    console.error(`[chart] failed to store chart for trade #${trade.id}`, e);
    res.status(500).json({ status: "error" });
  }
});

app.get("/api/trades/:id/chart", (req, res) => {
  const file = resolve(CHARTS_DIR, `${Number(req.params.id)}.json`);
  if (!existsSync(file)) return res.status(404).json({ error: "no chart" });
  res.type("application/json");
  createReadStream(file).pipe(res);
});

// --- Tag settings (categories + predefined tags) ---
app.get("/api/settings/tags", (_req, res) => {
  const v = getSetting("tagCategories");
  res.json(v ? JSON.parse(v) : []);
});

app.put("/api/settings/tags", (req, res) => {
  const input = Array.isArray(req.body?.categories) ? req.body.categories : [];
  const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);
  const clean = input
    .map((c: { name?: unknown; color?: unknown; tags?: unknown }) => ({
      name: String(c?.name ?? "").trim(),
      color: isHex(String(c?.color ?? "")) ? String(c.color) : "#e9b308",
      tags: Array.isArray(c?.tags) ? [...new Set(c.tags.map((t) => String(t).trim()).filter(Boolean))] : [],
    }))
    .filter((c: { name: string }) => c.name);
  setSetting("tagCategories", JSON.stringify(clean));
  res.json({ status: "saved" });
});

// --- Dashboard data API ---
app.get("/api/trades", (_req, res) => {
  res.json(getTrades());
});

app.get("/api/metrics", (_req, res) => {
  res.json(computeMetrics(getTrades()));
});

app.get("/api/analytics", (_req, res) => {
  const trades = getTrades();
  res.json({ metrics: computeMetrics(trades), ...computeAnalytics(trades) });
});

app.get("/api/trades/:id", (req, res) => {
  const trade = getTradeById(Number(req.params.id));
  if (!trade) return res.status(404).json({ error: "not found" });
  res.json(trade);
});

app.put("/api/trades/:id/note", (req, res) => {
  const ok = updateNote(Number(req.params.id), String(req.body?.note ?? ""));
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json({ status: "saved" });
});

app.put("/api/trades/:id/rating", (req, res) => {
  const ok = updateRating(Number(req.params.id), Number(req.body?.rating ?? 0));
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json({ status: "saved" });
});

app.put("/api/trades/:id/labels", (req, res) => {
  const labels = Array.isArray(req.body?.labels) ? req.body.labels : [];
  const ok = updateLabels(Number(req.params.id), labels);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json({ status: "saved" });
});

// --- Trade screenshots (saved from the ATAS add-on) ---
app.use("/screenshots", express.static(SCREENSHOTS_DIR));

// --- Static dashboard UI ---
app.use(express.static(resolve(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`Trading dashboard running at http://localhost:${PORT}`);
  console.log(`ATAS webhook endpoint: http://localhost:${PORT}/webhook/atas`);
});
