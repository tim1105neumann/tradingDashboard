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
}

export type NewTrade = Omit<Trade, "id" | "received_at">;

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
  return db
    .prepare("SELECT * FROM trades ORDER BY close_time ASC, id ASC")
    .all() as unknown as Trade[];
}

export function getTradeById(id: number): Trade | undefined {
  return db.prepare("SELECT * FROM trades WHERE id = ?").get(id) as unknown as Trade | undefined;
}

export function updateNote(id: number, note: string): boolean {
  const info = db.prepare("UPDATE trades SET comment = ? WHERE id = ?").run(note, id);
  return info.changes > 0;
}
