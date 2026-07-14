import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getTradeById, getTrades, insertTrade, updateNote } from "./db.js";
import { NormalizeError, normalizeAtasTrade } from "./normalize.js";
import { computeAnalytics, computeMetrics } from "./metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;

const app = express();
app.use(express.json({ limit: "256kb" }));

// --- Live sync: ATAS webhook receiver ---
app.post("/webhook/atas", (req, res) => {
  console.log("[webhook] RAW PAYLOAD >>>", JSON.stringify(req.body));
  try {
    const trade = normalizeAtasTrade(req.body ?? {});
    const id = insertTrade(trade);
    if (id == null) {
      console.log(`[webhook] duplicate ignored (external_id=${trade.external_id})`);
      return res.status(200).json({ status: "duplicate" });
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

// --- Static dashboard UI ---
app.use(express.static(resolve(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`Trading dashboard running at http://localhost:${PORT}`);
  console.log(`ATAS webhook endpoint: http://localhost:${PORT}/webhook/atas`);
});
