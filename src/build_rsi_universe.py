"""Build the RSI scanner universe from StockStory leadership, YTD and Favorites."""
from pathlib import Path
import json
import os
import requests
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
STOCK_RS = ROOT / "data" / "stock_rs.csv"
OUT_FILE = ROOT / "rsi" / "My-Stocks.csv"

FAVORITES_API_URL = (
    os.getenv("FAVORITES_API_URL", "").strip()
    or "https://script.google.com/macros/s/AKfycbyrN-apXcuyNRlbEIg2v10UpFGpc-G3t8ftbB54u4amyHps5Ce6xobXoxqeqSst2OV5/exec"
)

PERIODS = ["Weekly", "1M", "3M", "6M"]
OUTPUT_COLUMNS = [
    "Symbol",
    "Source",
    "Period",
    "Sector",
    "Rank",
    "Favorite Reasons",
    "Favorite Notes",
]


def clean_symbol(value):
    value = "" if pd.isna(value) else str(value).strip().upper()
    return value[4:] if value.startswith("NSE:") else value


def load_stock_data():
    df = pd.read_csv(STOCK_RS, dtype=str, keep_default_na=False)
    required = {"Symbol", "Sector", "Weekly", "1M", "3M", "6M", "YTD"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"stock_rs.csv is missing columns: {sorted(missing)}")

    df["Symbol"] = df["Symbol"].map(clean_symbol)
    for col in PERIODS + ["YTD"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["Sector"] = df["Sector"].astype(str).str.strip()
    return df[(df["Symbol"] != "") & (df["Sector"] != "")].copy()


def top_two_sectors(df, period):
    # Mirrors the StockStory leadership logic: average stock return per sector.
    work = df[["Symbol", "Sector", period]].dropna(subset=[period]).copy()
    identity_col = "ISIN Code" if "ISIN Code" in df.columns else None
    if identity_col:
        work["_identity"] = df.loc[work.index, identity_col].replace("", pd.NA).fillna(work["Symbol"])
    else:
        work["_identity"] = work["Symbol"]
    work = work.drop_duplicates(["Sector", "_identity"])
    sector_rank = (
        work.groupby("Sector", as_index=False)[period]
        .mean()
        .sort_values(period, ascending=False)
    )
    return sector_rank.head(2)["Sector"].tolist()


def build_sector_candidates(df, period):
    rows = []
    for sector in top_two_sectors(df, period):
        sector_df = df[df["Sector"] == sector].dropna(subset=[period]).copy()
        # One stock should count once within a sector.
        identity = "ISIN Code" if "ISIN Code" in sector_df.columns else "Symbol"
        sector_df = sector_df.drop_duplicates(identity)
        sector_df = sector_df.sort_values(period, ascending=False).head(5)
        for rank, (_, stock) in enumerate(sector_df.iterrows(), start=1):
            rows.append({
                "Symbol": clean_symbol(stock["Symbol"]),
                "Source": "Sector Top 5",
                "Period": period,
                "Sector": sector,
                "Rank": rank,
                "Favorite Reasons": "",
                "Favorite Notes": "",
            })
    return rows


def build_ytd(df):
    work = df.dropna(subset=["YTD"]).copy()
    identity = "ISIN Code" if "ISIN Code" in work.columns else "Symbol"
    work = work.drop_duplicates(identity).sort_values("YTD", ascending=False).head(50)
    rows = []
    for rank, (_, stock) in enumerate(work.iterrows(), start=1):
        rows.append({
            "Symbol": clean_symbol(stock["Symbol"]),
            "Source": "YTD Top 50",
            "Period": "YTD",
            "Sector": str(stock.get("Sector", "")).strip(),
            "Rank": rank,
            "Favorite Reasons": "",
            "Favorite Notes": "",
        })
    return rows


def load_favorites():
    if not FAVORITES_API_URL:
        return []
    try:
        response = requests.get(
            FAVORITES_API_URL,
            params={"action": "list"},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        favorites = payload.get("favorites", [])
        if not isinstance(favorites, list):
            raise ValueError("Favorites API returned an invalid favorites list")
        return favorites
    except Exception as exc:
        print(f"WARNING: Could not load Favorites from Apps Script: {exc}")
        print("WARNING: Continuing with automated StockStory selections only.")
        return []


def build_favorites(df):
    # Use StockStory's own Favorites API; preserve Reasons and Notes exactly.
    favorites = load_favorites()
    stock_sector = (
        df.drop_duplicates("Symbol")
        .set_index("Symbol")["Sector"]
        .to_dict()
    )
    rows = []
    for fav in favorites:
        symbol = clean_symbol(fav.get("symbol", ""))
        if not symbol:
            continue
        reasons = fav.get("reasons", [])
        if isinstance(reasons, list):
            reasons = " | ".join(str(x).strip() for x in reasons if str(x).strip())
        else:
            reasons = str(reasons or "").strip()
        notes = str(fav.get("notes", "") or "").strip()
        sector = str(stock_sector.get(symbol, "") or "").strip()
        rows.append({
            "Symbol": symbol,
            "Source": "Favorite",
            "Period": "",
            "Sector": sector,
            "Rank": "",
            "Favorite Reasons": reasons,
            "Favorite Notes": notes,
        })
    return rows


def main():
    df = load_stock_data()
    rows = []
    for period in PERIODS:
        rows.extend(build_sector_candidates(df, period))
    rows.extend(build_ytd(df))
    rows.extend(build_favorites(df))

    out = pd.DataFrame(rows, columns=OUTPUT_COLUMNS)
    if out.empty:
        raise RuntimeError("No RSI universe rows were generated")

    # Exact source rows are retained. Remove only exact duplicate rows.
    out = out.drop_duplicates().sort_values(
        ["Symbol", "Source", "Period", "Sector", "Rank"],
        na_position="last",
    )
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT_FILE, index=False, encoding="utf-8-sig")

    unique_symbols = out["Symbol"].nunique()
    print(f"RSI universe rows: {len(out)}")
    print(f"Unique symbols: {unique_symbols}")
    print(f"Output: {OUT_FILE}")
    print("Top sectors by period:")
    for period in PERIODS:
        print(f"  {period}: {', '.join(top_two_sectors(df, period))}")
    print(f"YTD rows: {sum(r['Source'] == 'YTD Top 50' for r in rows)}")
    print(f"Favorite rows: {sum(r['Source'] == 'Favorite' for r in rows)}")


if __name__ == "__main__":
    main()
