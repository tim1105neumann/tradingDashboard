import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = resolve(process.cwd(), "data", "trades.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

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
}

export type NewTrade = Omit<Trade, "id" | "received_at" | "rating" | "labels">;

// DB rows store `labels` as a JSON string; convert to the typed Trade shape.
function hydrate(row: Record<string, unknown>): Trade {
  let labels: string[] = [];
  try { labels = JSON.parse((row.labels as string) || "[]"); } catch { labels = []; }
  return { ...(row as unknown as Trade), rating: Number(row.rating ?? 0), labels };
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
  return row ? hydrate(row) : undefined;
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
