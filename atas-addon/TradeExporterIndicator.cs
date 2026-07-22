using System;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
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

        // When on, a screenshot spanning ALL monitors is captured at trade close and
        // sent with the trade so the dashboard can show how the trade played out.
        [DisplayName("Capture Screenshot")]
        public bool CaptureScreenshot { get; set; } = true;

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
        private string _account = "";      // account/portfolio id of the current trade

        // Diagnostics are written to this file (open it and paste lines back to iterate).
        private static readonly string LogPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "ATAS", "trade-exporter.log");
        private static readonly object LogLock = new object();

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
                _account = myTrade.AccountID ?? myTrade.Portfolio?.AccountID ?? "";

                Log($"[export] fill {(isBuy ? "BUY" : "SELL")} {vol} @ {price} net(before)={_net} acct={_account}");

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
                Log($"[export] OnNewMyTrade failed: {ex.Message}");
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

            Log($"[export] TRADE {symbol} {side} vol={_exitVol} entry={avgEntry} exit={avgExit} pnl={pnl} comm={_commission}");

            var screenshot = CaptureScreenshot ? CaptureAllScreensJpegBase64() : null;
            var json = BuildJson(symbol, side, _exitVol, avgEntry, avgExit, _openTime, closeTime, pnl, _commission, _account, screenshot);
            PostAsync(json);
        }

        // --- Screenshot capture (all monitors) ---
        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int index);
        private const int SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77,
                          SM_CXVIRTUALSCREEN = 78, SM_CYVIRTUALSCREEN = 79;

        /// <summary>
        /// Grabs the entire virtual desktop (all monitors) as a JPEG and returns it
        /// base64-encoded, or null on any failure — a screenshot must never break the
        /// trade export.
        /// </summary>
        private string? CaptureAllScreensJpegBase64()
        {
            try
            {
                int x = GetSystemMetrics(SM_XVIRTUALSCREEN);
                int y = GetSystemMetrics(SM_YVIRTUALSCREEN);
                int w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
                int h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
                if (w <= 0 || h <= 0) { Log("[export] screenshot skipped: virtual screen size unknown"); return null; }

                using var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb);
                using (var g = Graphics.FromImage(bmp))
                    g.CopyFromScreen(x, y, 0, 0, new Size(w, h));

                var jpeg = ImageCodecInfo.GetImageEncoders()[0];
                foreach (var c in ImageCodecInfo.GetImageEncoders())
                    if (c.FormatID == ImageFormat.Jpeg.Guid) { jpeg = c; break; }
                using var p = new EncoderParameters(1);
                // Fully qualified: System.Text.Encoder would otherwise make `Encoder` ambiguous.
                p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 80L);

                using var ms = new MemoryStream();
                bmp.Save(ms, jpeg, p);
                var bytes = ms.ToArray();
                Log($"[export] screenshot {w}x{h} {bytes.Length / 1024} KB");
                return Convert.ToBase64String(bytes);
            }
            catch (Exception ex)
            {
                Log($"[export] screenshot failed: {ex.Message}");
                return null;
            }
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
            decimal pnl, decimal commission, string account, string? screenshot)
        {
            var ci = CultureInfo.InvariantCulture;
            var sb = new StringBuilder();
            sb.Append('{');
            sb.Append($"\"id\":\"{Guid.NewGuid():N}\",");
            sb.Append($"\"account\":\"{Escape(account)}\",");
            sb.Append($"\"symbol\":\"{Escape(symbol)}\",");
            sb.Append($"\"side\":\"{side}\",");
            sb.Append($"\"volume\":{volume.ToString(ci)},");
            sb.Append($"\"open_price\":{openPrice.ToString(ci)},");
            sb.Append($"\"close_price\":{closePrice.ToString(ci)},");
            sb.Append($"\"open_time\":\"{openTime.ToString("s", ci)}\",");
            sb.Append($"\"close_time\":\"{closeTime.ToString("s", ci)}\",");
            sb.Append($"\"pnl\":{pnl.ToString(ci)},");
            sb.Append($"\"commission\":{commission.ToString(ci)}");
            // base64 is JSON-safe (only [A-Za-z0-9+/=]), so no escaping needed.
            if (!string.IsNullOrEmpty(screenshot))
                sb.Append($",\"screenshot\":\"{screenshot}\"");
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
                Log($"[export] POST {(int)res.StatusCode} -> {WebhookUrl}");
            }
            catch (Exception ex)
            {
                Log($"[export] POST failed: {ex.Message}");
            }
        }

        private static void Log(string message)
        {
            try
            {
                var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{Environment.NewLine}";
                lock (LogLock)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                    File.AppendAllText(LogPath, line);
                }
            }
            catch
            {
                // Never let logging break the indicator.
            }
        }
    }
}
