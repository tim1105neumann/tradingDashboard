using System;
using System.ComponentModel;
using System.Globalization;
using System.Net.Http;
using System.Text;
using ATAS.DataFeedsCore;
using ATAS.Indicators;

namespace TradingDashboard
{
    /// <summary>
    /// ATAS indicator that exports completed round-trip trades to the Trading Dashboard.
    ///
    /// Add it to a chart of the instrument you trade. It listens to your fills
    /// (OnNewMyTrade), tracks the net position itself, and when the position returns
    /// to flat it POSTs one completed trade (entry, exit, volume, P&L) to the
    /// dashboard's /webhook/atas endpoint.
    ///
    /// NOTE: This is the first version against ATAS 8.x. It logs every fill and every
    /// emitted trade (see ATAS log window) so we can verify the numbers against your
    /// real trades and adjust if needed.
    /// </summary>
    [DisplayName("Trade Exporter (Dashboard)")]
    public class TradeExporterIndicator : Indicator
    {
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };

        // Configurable in the indicator's settings panel.
        [DisplayName("Webhook URL")]
        public string WebhookUrl { get; set; } = "http://localhost:4000/webhook/atas";

        // --- Position tracking state (self-computed from fills) ---
        private decimal _net;          // signed net position (+long / -short)
        private int _posDir;           // direction of the currently open position (+1 / -1)
        private decimal _entryVol;     // absolute volume that built the open position
        private decimal _entryValue;   // sum(price * vol) of entry fills -> weighted avg entry
        private decimal _exitVol;      // absolute volume closed so far
        private decimal _exitValue;    // sum(price * vol) of exit fills -> weighted avg exit
        private decimal _commission;   // accumulated commission for the round trip
        private DateTime _openTime;    // time of first entry fill
        private decimal _realizedBaseline; // ATAS realized PnL captured at last flat

        public TradeExporterIndicator()
        {
            // This indicator draws nothing; it only reacts to trading events.
            EnableCustomDrawing = false;
        }

        protected override void OnCalculate(int bar, decimal value) { }

        protected override void OnNewMyTrade(MyTrade myTrade)
        {
            try
            {
                var isBuy = myTrade.OrderDirection == OrderDirections.Buy;
                var vol = myTrade.Volume;
                var price = myTrade.Price;
                var time = myTrade.Time;
                var comm = myTrade.Commission ?? 0m;
                var symbol = myTrade.Security?.ToString() ?? "UNKNOWN";

                this.LogWarn($"[export] fill {(isBuy ? "BUY" : "SELL")} {vol} @ {price} net(before)={_net}");

                _commission += comm;
                var dirSign = isBuy ? 1 : -1;
                var remaining = vol;

                while (remaining > 0)
                {
                    if (_net == 0)
                    {
                        // Opening a fresh position.
                        _openTime = time;
                        _posDir = dirSign;
                        _entryVol += remaining;
                        _entryValue += remaining * price;
                        _net += dirSign * remaining;
                        remaining = 0;
                    }
                    else if (Math.Sign(_net) == dirSign)
                    {
                        // Adding to the existing position.
                        _entryVol += remaining;
                        _entryValue += remaining * price;
                        _net += dirSign * remaining;
                        remaining = 0;
                    }
                    else
                    {
                        // Reducing / closing the existing position.
                        var closeQty = Math.Min(remaining, Math.Abs(_net));
                        _exitVol += closeQty;
                        _exitValue += closeQty * price;
                        _net += dirSign * closeQty; // moves toward zero
                        remaining -= closeQty;

                        if (_net == 0)
                        {
                            EmitTrade(symbol, time);
                            ResetRoundTrip();
                            // If remaining > 0 the loop continues and opens a flipped position.
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                this.LogError($"[export] OnNewMyTrade failed: {ex.Message}");
            }
        }

        private void EmitTrade(string symbol, DateTime closeTime)
        {
            var avgEntry = _entryVol > 0 ? _entryValue / _entryVol : 0m;
            var avgExit = _exitVol > 0 ? _exitValue / _exitVol : 0m;

            // Money P&L from ATAS realized PnL (delta since last flat). Falls back to 0
            // if the position object isn't available yet; the log lets us verify.
            var realizedNow = TradingManager?.Position?.RealizedPnL ?? _realizedBaseline;
            var pnl = realizedNow - _realizedBaseline;
            _realizedBaseline = realizedNow;

            var side = _posDir > 0 ? "Buy" : "Sell";

            this.LogWarn($"[export] TRADE {symbol} {side} vol={_exitVol} entry={avgEntry} exit={avgExit} pnl={pnl} comm={_commission}");

            var json = BuildJson(symbol, side, _exitVol, avgEntry, avgExit, _openTime, closeTime, pnl, _commission);
            PostAsync(json);
        }

        private void ResetRoundTrip()
        {
            _posDir = 0;
            _entryVol = 0;
            _entryValue = 0;
            _exitVol = 0;
            _exitValue = 0;
            _commission = 0;
        }

        private static string BuildJson(string symbol, string side, decimal volume,
            decimal openPrice, decimal closePrice, DateTime openTime, DateTime closeTime,
            decimal pnl, decimal commission)
        {
            var ci = CultureInfo.InvariantCulture;
            var sb = new StringBuilder();
            sb.Append('{');
            sb.Append($"\"id\":\"{Guid.NewGuid():N}\",");
            sb.Append($"\"symbol\":\"{Escape(symbol)}\",");
            sb.Append($"\"side\":\"{side}\",");
            sb.Append($"\"volume\":{volume.ToString(ci)},");
            sb.Append($"\"open_price\":{openPrice.ToString(ci)},");
            sb.Append($"\"close_price\":{closePrice.ToString(ci)},");
            sb.Append($"\"open_time\":\"{openTime.ToString("s", ci)}\",");
            sb.Append($"\"close_time\":\"{closeTime.ToString("s", ci)}\",");
            sb.Append($"\"pnl\":{pnl.ToString(ci)},");
            sb.Append($"\"commission\":{commission.ToString(ci)}");
            sb.Append('}');
            return sb.ToString();
        }

        private static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");

        private async void PostAsync(string json)
        {
            try
            {
                using var content = new StringContent(json, Encoding.UTF8, "application/json");
                var res = await Http.PostAsync(WebhookUrl, content).ConfigureAwait(false);
                this.LogWarn($"[export] POST {(int)res.StatusCode} -> {WebhookUrl}");
            }
            catch (Exception ex)
            {
                this.LogError($"[export] POST failed: {ex.Message}");
            }
        }
    }
}
