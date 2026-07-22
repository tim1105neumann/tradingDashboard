# ATAS Trade Exporter add-on

A custom ATAS indicator that sends your **completed round-trip trades** (entry, exit,
volume, P&L) to the Trading Dashboard's `/webhook/atas` endpoint in real time.

This exists because ATAS's built-in **webhook alerts only carry text messages**, not
trade P&L. This add-on reads the real trade data from inside ATAS instead.

## What it does

- Runs as an indicator on a chart of the instrument you trade.
- Listens to your fills via `OnNewMyTrade`.
- Tracks your net position; when it returns to **flat**, it POSTs one completed trade.
- At trade close it also captures a **screenshot spanning all monitors** and sends it
  with the trade, so the dashboard shows how the trade played out. Toggle this off with
  the **Capture Screenshot** setting on the indicator.
- Logs every fill and every emitted trade to the ATAS log window so we can verify numbers.

## Prerequisites (Windows, one time)

1. **.NET 10 SDK** — https://dotnet.microsoft.com/download/dotnet/10.0
   (ATAS 8.0.14 is built on .NET 10, so the add-on must target it too.)
   Verify: `dotnet --version` (should print 10.x).
2. **ATAS installed** (you have 8.0.14).

## Build

1. Open `TradeExporter.csproj` and check the `<AtasDir>` path points at your ATAS
   install folder — the one containing `ATAS.Indicators.dll`. Common locations:
   - `C:\Program Files (x86)\ATAS Platform`
   - `%LOCALAPPDATA%\ATAS Platform`
   Right-click `ATAS.Indicators.dll` → Properties to confirm the exact folder.

2. In a terminal, from this `atas-addon` folder:
   ```
   dotnet build -c Release
   ```
   Output DLL: `bin\Release\net10.0-windows\TradingDashboard.TradeExporter.dll`

   > If the build complains about a missing assembly (e.g. the `LogWarn` logger lives
   > in a different DLL on your version), tell me the exact error — reference names vary
   > slightly between ATAS builds and I'll adjust the `.csproj`.

## Install into ATAS

1. Close ATAS.
2. Copy `TradingDashboard.TradeExporter.dll` into ATAS's user indicators folder:
   ```
   %USERPROFILE%\Documents\ATAS\Indicators
   ```
   (Create the `Indicators` folder if it doesn't exist. Some builds use
   `%APPDATA%\ATAS\Indicators` — use whichever your ATAS reads.)
3. Start ATAS, open a chart of the instrument you trade.
4. Add indicator → find **"Trade Exporter (Dashboard)"** → add it.
5. In its settings, confirm **Webhook URL** = `http://localhost:4000/webhook/atas`.

## Verify

1. Start the dashboard (`npm start` in the project root) — keep the terminal visible.
2. Do a small round-trip trade (open then close a position).
3. The add-on writes diagnostics to a log file:
   ```
   %USERPROFILE%\Documents\ATAS\trade-exporter.log
   ```
   Open it — you should see `[export] fill ...`, then `[export] TRADE ...`, then
   `[export] POST 201 ...`
4. In the dashboard terminal you should see `[webhook] stored trade #N ...`, and the
   trade appears at http://localhost:4000

## Known first-version caveats (we'll tune against real output)

- **P&L** uses ATAS's `Position.RealizedPnL` delta. If the logged `pnl` doesn't match
  ATAS's own P&L for the trade, send me the `[export] TRADE ...` log line and I'll fix
  the calculation.
- **Position flips** (e.g. long → straight to short in one order) attribute all
  accumulated commission to the closing trade. Fine for normal open/close; tell me if
  you flip often and I'll split it precisely.
- If `OnNewMyTrade` doesn't fire at all, ATAS may require a **strategy** rather than an
  indicator for trade events on your build — I'll switch the base class to
  `ChartStrategy` if so.
