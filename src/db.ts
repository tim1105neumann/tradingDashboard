import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveSymbol } from "./instruments.js";

const DB_PATH = resolve(process.cwd(), "data", "trades.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

/** Where per-trade ATAS screenshots (<id>.jpg) are stored. */
export const SCREENSHOTS_DIR = resolve(process.cwd(), "data", "screenshots");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE,
    account     TEXT,
    symbol      TEXT NOT NULL,
    direction   TEXT NOT NULL CHECK (direction IN ('long', 'short')),
    volume      REAL NOT NULL,
    open_time   TEXT,
    open_price  REAL,
    close_time  TEXT NOT NULL,
    close_price REAL,
    pnl         REAL NOT NULL,
    commission  REAL NOT NULL DEFAULT 0,
    comment     TEXT,
    raw         TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_trades_close_time ON trades(close_time);
  CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
`);

db.exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);

// Migration: add columns that older databases don't have yet.
const cols = new Set((db.prepare("PRAGMA table_info(trades)").all() as { name: string }[]).map((c) => c.name));
if (!cols.has("rating")) db.exec("ALTER TABLE trades ADD COLUMN rating INTEGER NOT NULL DEFAULT 0");
if (!cols.has("labels")) db.exec("ALTER TABLE trades ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'");

export interface Trade {
  id: number;
  external_id: string | null;
  account: string | null;
  symbol: string;
  direction: "long" | "short";
  volume: number;
  open_time: string | null;
  open_price: number | null;
  close_time: string;
  close_price: number | null;
  pnl: number;
  commission: number;
  comment: string | null;
  raw: string | null;
  received_at: string;
  rating: number;
  labels: string[];
  screenshot?: boolean; // set by getTradeById: true if an <id>.jpg exists on disk
}

export type NewTrade = Omit<Trade, "id" | "received_at" | "rating" | "labels" | "screenshot">;

// ATAS sends timestamps in UTC; this user is UTC+2 (Central European summer time),
// so shift on read. All views (hour buckets, detail page, calendar) then show local
// time. Change the default (or set TZ_OFFSET_HOURS env var) if your offset differs.
const TZ_OFFSET_HOURS = Number(process.env.TZ_OFFSET_HOURS ?? 2);

function shiftIso(iso: string | null, hours: number): string | null {
  if (!iso || hours === 0) return iso;
  const d = new Date(iso + "Z"); // treat the naive timestamp as a wall clock
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString().slice(0, 19); // back to "YYYY-MM-DDTHH:MM:SS"
}

// DB rows store `labels` as a JSON string; convert to the typed Trade shape.
function hydrate(row: Record<string, unknown>): Trade {
  let labels: string[] = [];
  try { labels = JSON.parse((row.labels as string) || "[]"); } catch { labels = []; }
  const trade = { ...(row as unknown as Trade), rating: Number(row.rating ?? 0), labels };
  const spec = resolveSymbol(trade.symbol);
  trade.symbol = spec.ticker; // long ATAS name -> clean ticker

  trade.open_time = shiftIso(trade.open_time, TZ_OFFSET_HOURS);
  trade.close_time = shiftIso(trade.close_time, TZ_OFFSET_HOURS) as string;

  // For known instruments, derive P&L deterministically from price x contract spec.
  // ATAS's reported RealizedPnL is unreliable across accounts/positions, so we override it.
  if (spec.tickSize && spec.tickValue && trade.open_price != null && trade.close_price != null) {
    const dir = trade.direction === "short" ? -1 : 1;
    const ticks = Math.round(((trade.close_price - trade.open_price) * dir) / spec.tickSize);
    trade.pnl = Math.round(ticks * spec.tickValue * trade.volume * 100) / 100;
  }
  return trade;
}

const insertStmt = db.prepare(`
  INSERT INTO trades
    (external_id, account, symbol, direction, volume, open_time, open_price,
     close_time, close_price, pnl, commission, comment, raw)
  VALUES
    (@external_id, @account, @symbol, @direction, @volume, @open_time, @open_price,
     @close_time, @close_price, @pnl, @commission, @comment, @raw)
  ON CONFLICT(external_id) DO NOTHING
`);

/** Returns the inserted row id, or null if it was a duplicate (external_id conflict). */
export function insertTrade(trade: NewTrade): number | null {
  const info = insertStmt.run(trade);
  return info.changes > 0 ? Number(info.lastInsertRowid) : null;
}

export function getTrades(): Trade[] {
  return (db.prepare("SELECT * FROM trades ORDER BY close_time ASC, id ASC").all() as Record<string, unknown>[]).map(hydrate);
}

export function getTradeById(id: number): Trade | undefined {
  const row = db.prepare("SELECT * FROM trades WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const trade = hydrate(row);
  trade.screenshot = existsSync(resolve(SCREENSHOTS_DIR, `${trade.id}.jpg`));
  return trade;
}

export function updateNote(id: number, note: string): boolean {
  const info = db.prepare("UPDATE trades SET comment = ? WHERE id = ?").run(note, id);
  return info.changes > 0;
}

export function updateRating(id: number, rating: number): boolean {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  const info = db.prepare("UPDATE trades SET rating = ? WHERE id = ?").run(r, id);
  return info.changes > 0;
}

export function updateLabels(id: number, labels: string[]): boolean {
  const clean = labels.map((l) => String(l).trim()).filter(Boolean).slice(0, 20);
  const info = db.prepare("UPDATE trades SET labels = ? WHERE id = ?").run(JSON.stringify(clean), id);
  return info.changes > 0;
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
