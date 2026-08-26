"""Send one Telegram alert for each newly recorded RSI setup."""
from pathlib import Path
from html import escape
import os
import pandas as pd
import requests
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
SETUP_HISTORY = ROOT / "rsi" / "Setup_History.csv"
ALERT_HISTORY = ROOT / "rsi" / "Telegram_Alert_History.csv"

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "").strip()


def chartink_url(symbol):
    symbol = str(symbol).strip().upper().replace("NSE:", "")
    return f"https://chartink.com/stocks/{quote(symbol, safe='')}.html"


def load_alert_history():
    if not ALERT_HISTORY.exists():
        return set()
    try:
        df = pd.read_csv(ALERT_HISTORY, dtype=str, keep_default_na=False)
        return set(df.get("Setup ID", pd.Series(dtype=str)).astype(str))
    except Exception:
        return set()


def append_alert_history(rows):
    new = pd.DataFrame(rows, columns=["Setup ID", "Sent At", "Symbol"])
    if ALERT_HISTORY.exists():
        try:
            old = pd.read_csv(ALERT_HISTORY, dtype=str, keep_default_na=False)
            new = pd.concat([old, new], ignore_index=True)
        except Exception:
            pass
    new.drop_duplicates("Setup ID", keep="last").to_csv(
        ALERT_HISTORY, index=False, encoding="utf-8-sig"
    )


def format_reasons(value):
    text = str(value or "").strip()
    if not text:
        return ""
    return text.replace(" | ", "\n• ")


def build_message(row):
    symbol = str(row.get("Symbol", "")).strip().upper()
    link = chartink_url(symbol)
    sources = str(row.get("Universe Sources", "")).strip()
    periods = str(row.get("Universe Periods", "")).strip()
    sectors = str(row.get("Universe Sectors", "")).strip()
    reasons = format_reasons(row.get("Favorite Reasons", ""))
    notes = str(row.get("Favorite Notes", "")).strip()

    lines = [
        "🚨 <b>RSI SETUP DETECTED</b>",
        "",
        f"<a href=\"{escape(link, quote=True)}\"><b>{escape(symbol)}</b></a>",
        "━━━━━━━━━━━━━━━━",
        f"<b>Setup:</b> {escape(str(row.get('Reason', '')))}",
        f"<b>Weekly RSI:</b> {escape(str(row.get('Current Week RSI', '')))}",
        f"<b>Hourly RSI:</b> {escape(str(row.get('Current Hourly RSI', '')))}",
        f"<b>15m Close:</b> {escape(str(row.get('Completed 15m Close', '')))}",
        "",
        f"<b>Universe:</b> {escape(sources)}",
        f"<b>Periods:</b> {escape(periods)}",
    ]
    if sectors:
        lines.append(f"<b>Sectors:</b> {escape(sectors)}")
    if reasons:
        lines.extend(["", f"<b>⭐ Favorite Reason(s):</b>\n• {escape(reasons)}"])
    if notes:
        lines.extend(["", f"<b>📝 Favorite Note:</b> {escape(notes)}"])
    lines.extend(["", f"<b>Scan:</b> {escape(str(row.get('Scan Time', '')))}"])
    return "\n".join(lines)


def send_message(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    response = requests.post(
        url,
        json={
            "chat_id": CHAT_ID,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": False,
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    if not payload.get("ok"):
        raise RuntimeError(payload)


def main():
    if not BOT_TOKEN or not CHAT_ID:
        print("Telegram secrets are not configured; skipping alerts.")
        return 0
    if not SETUP_HISTORY.exists():
        print("No Setup_History.csv found; nothing to alert.")
        return 0

    setups = pd.read_csv(SETUP_HISTORY, dtype=str, keep_default_na=False)
    if setups.empty or "Setup ID" not in setups.columns:
        print("No setup records found. Nothing to send.")
        raise SystemExit(0)
        return 0

    sent = load_alert_history()
    pending = setups[~setups["Setup ID"].astype(str).isin(sent)]
    pending = pending[pending["Status"].astype(str).str.upper().eq("ACTIVE")]

    if pending.empty:
        print("No new Telegram alerts.")
        return 0

    sent_rows = []
    # Setup_History does not contain every latest RSI field, so enrich from latest results.
    latest = ROOT / "rsi" / "latest_results.csv"
    latest_df = pd.read_csv(latest, dtype=str, keep_default_na=False) if latest.exists() else pd.DataFrame()
    latest_map = {str(r.get("Symbol", "")).strip().upper(): r for _, r in latest_df.iterrows()}

    for _, setup in pending.iterrows():
        symbol = str(setup.get("Symbol", "")).strip().upper()
        row = dict(latest_map.get(symbol, {}))
        row.update(setup.to_dict())
        row["Symbol"] = symbol
        # Keep latest-result values where Setup_History intentionally lacks them.
        if symbol in latest_map:
            for key, value in latest_map[symbol].items():
                if key not in row or not str(row[key]).strip():
                    row[key] = value
        message = build_message(row)
        try:
            send_message(message)
            sent_rows.append({
                "Setup ID": setup["Setup ID"],
                "Sent At": pd.Timestamp.now(tz="Asia/Kolkata").strftime("%Y-%m-%d %H:%M:%S"),
                "Symbol": symbol,
            })
            print(f"Telegram alert sent: {symbol}")
        except Exception as exc:
            print(f"ERROR sending Telegram alert for {symbol}: {exc}")

    if sent_rows:
        append_alert_history(sent_rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
