"""Merge StockStory RS data with the latest RSI scanner output.

This is intentionally a data-integration layer. It does not modify the existing
StockStory or RSI calculation engines.
"""
from pathlib import Path
import json
import re
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
STOCK_RS = ROOT / "data" / "stock_rs.csv"
RSI_LATEST = ROOT / "data" / "rsi" / "latest_results.csv"
OUT_CSV = ROOT / "data" / "combined_stock_data.csv"
OUT_JSON = ROOT / "data" / "combined_stock_data.json"


def clean_symbol(value):
    value = "" if pd.isna(value) else str(value).strip().upper()
    if value.startswith("NSE:"):
        value = value[4:]
    return value


def isin_from_instrument_key(value):
    value = "" if pd.isna(value) else str(value).strip()
    m = re.search(r"\|(INE[A-Z0-9]+)$", value)
    return m.group(1) if m else ""


def main():
    stock = pd.read_csv(STOCK_RS, dtype=str, keep_default_na=False)
    rsi = pd.read_csv(RSI_LATEST, dtype=str, keep_default_na=False, encoding="utf-8-sig")

    # RSI may contain multiple rows for the same symbol during a scan cycle.
    # Keep the newest Scan Time for each symbol.
    if "Scan Time" in rsi.columns:
        rsi["_scan_time"] = pd.to_datetime(rsi["Scan Time"], errors="coerce")
        rsi = rsi.sort_values("_scan_time").drop_duplicates("Symbol", keep="last")

    stock["_symbol_key"] = stock["Symbol"].map(clean_symbol)
    rsi["_symbol_key"] = rsi["Symbol"].map(clean_symbol)

    stock["_instrument_key"] = stock.get("Upstox Instrument Key", "").astype(str).str.strip()
    rsi["_instrument_key"] = rsi.get("Instrument Key", "").astype(str).str.strip()
    stock["_isin_key"] = stock["_instrument_key"].map(isin_from_instrument_key)
    rsi["_isin_key"] = rsi["_instrument_key"].map(isin_from_instrument_key)

    # Primary match: instrument key / ISIN. Fallback: normalized symbol.
    rsi_by_instrument = rsi[rsi["_instrument_key"] != ""].drop_duplicates("_instrument_key").set_index("_instrument_key")
    rsi_by_isin = rsi[rsi["_isin_key"] != ""].drop_duplicates("_isin_key").set_index("_isin_key")
    rsi_by_symbol = rsi.drop_duplicates("_symbol_key").set_index("_symbol_key")

    rsi_cols = [c for c in rsi.columns if c not in {"_scan_time", "_symbol_key", "_instrument_key", "_isin_key"}]
    for col in rsi_cols:
        stock[f"RSI {col}"] = ""

    matched_instrument = matched_isin = matched_symbol = 0
    for idx, row in stock.iterrows():
        match = None
        key = row["_instrument_key"]
        if key and key in rsi_by_instrument.index:
            match = rsi_by_instrument.loc[key]
            matched_instrument += 1
        else:
            isin = row["_isin_key"]
            if isin and isin in rsi_by_isin.index:
                match = rsi_by_isin.loc[isin]
                matched_isin += 1
            else:
                sym = row["_symbol_key"]
                if sym and sym in rsi_by_symbol.index:
                    match = rsi_by_symbol.loc[sym]
                    matched_symbol += 1
        if match is not None:
            for col in rsi_cols:
                stock.at[idx, f"RSI {col}"] = match.get(col, "")

    stock.drop(columns=["_symbol_key", "_instrument_key", "_isin_key"], inplace=True)
    stock.to_csv(OUT_CSV, index=False)

    records = stock.to_dict(orient="records")
    OUT_JSON.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"StockStory rows: {len(stock)}")
    print(f"RSI rows used: {len(rsi)}")
    print(f"Matched by instrument key: {matched_instrument}")
    print(f"Matched by ISIN: {matched_isin}")
    print(f"Matched by symbol: {matched_symbol}")
    print(f"Unmatched: {len(stock) - matched_instrument - matched_isin - matched_symbol}")
    print(f"Wrote: {OUT_CSV}")
    print(f"Wrote: {OUT_JSON}")


if __name__ == "__main__":
    main()
