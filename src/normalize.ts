import type { NewTrade } from "./db.js";

/**
 * Maps an incoming ATAS webhook payload to our Trade shape.
 *
 * NOTE: ATAS's exact webhook JSON keys are confirmed at setup time (they depend
 * on how the alert/webhook is configured in ATAS 8.x). This mapper accepts the
 * most common field-name variants and is the ONE place to adjust once we see a
 * real payload. Keep it tolerant: unknown extras are preserved in `raw`.
 */

type Json = Record<string, unknown>;

function pick(obj: Json, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

export class NormalizeError extends Error {}

export function normalizeAtasTrade(body: Json): NewTrade {
  const symbol = str(pick(body, ["symbol", "instrument", "security", "Symbol", "Instrument"]));
  if (!symbol) throw new NormalizeError("missing symbol");

  const rawDir = str(pick(body, ["direction", "side", "Direction", "Side"]))?.toLowerCase() ?? "";
  const direction: "long" | "short" =
    rawDir.startsWith("s") || rawDir.startsWith("sell") ? "short" : "long";

  const volume = num(pick(body, ["volume", "quantity", "qty", "size", "Volume", "Quantity"]));
  if (volume == null) throw new NormalizeError("missing volume");

  const closeTime = str(pick(body, ["close_time", "closeTime", "time", "exit_time", "CloseTime", "Time"]));
  if (!closeTime) throw new NormalizeError("missing close_time");

  const pnl = num(pick(body, ["pnl", "profit", "PnL", "realizedPnl", "netPnl", "Profit"]));
  if (pnl == null) throw new NormalizeError("missing pnl");

  return {
    external_id: str(pick(body, ["id", "trade_id", "tradeId", "orderId", "external_id", "Id"])),
    account: str(pick(body, ["account", "Account", "accountId"])),
    symbol,
    direction,
    volume,
    open_time: str(pick(body, ["open_time", "openTime", "entry_time", "OpenTime"])),
    open_price: num(pick(body, ["open_price", "openPrice", "entry_price", "OpenPrice"])),
    close_time: closeTime,
    close_price: num(pick(body, ["close_price", "closePrice", "exit_price", "ClosePrice"])),
    pnl,
    commission: num(pick(body, ["commission", "fee", "fees", "Commission"])) ?? 0,
    comment: str(pick(body, ["comment", "note", "Comment"])),
    raw: JSON.stringify(body),
  };
}
