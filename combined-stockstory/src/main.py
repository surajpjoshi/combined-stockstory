import os
import json
import time
import gzip
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo

import pandas as pd
import requests


ACCESS_TOKEN = os.environ["UPSTOX_ANALYTICS_TOKEN"]

BASE_URL = "https://api.upstox.com/v3/historical-candle"
LTP_URL = "https://api.upstox.com/v3/market-quote/ltp"
IST = ZoneInfo("Asia/Kolkata")

# Upstox official NSE BOD instrument file.
INSTRUMENT_MASTER_URL = (
    "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz"
)

STOCK_FILE = "data/stocks.csv"
OUTPUT_JSON = "data/stock_rs.json"
OUTPUT_CSV = "data/stock_rs.csv"
MAPPING_CSV = "data/instrument_mapping.csv"

NIFTY_INSTRUMENT = "NSE_INDEX|Nifty 50"

REQUEST_TIMEOUT = 60
REQUEST_DELAY = 0.15


def get_headers():
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {ACCESS_TOKEN}",
    }


def download_instrument_master():
    print()
    print("Downloading Upstox instrument master...")

    response = requests.get(
        INSTRUMENT_MASTER_URL,
        timeout=REQUEST_TIMEOUT,
    )

    response.raise_for_status()

    print(
        "Instrument master downloaded:",
        len(response.content),
        "bytes",
    )

    try:
        raw = gzip.decompress(response.content)
    except OSError:
        raw = response.content

    instruments = json.loads(raw.decode("utf-8"))

    print(
        "Total instruments in master:",
        len(instruments),
    )

    return instruments


def build_nse_equity_mapping(instruments):
    mapping = {}

    for instrument in instruments:

        if instrument.get("segment") != "NSE_EQ":
            continue

        instrument_type = str(
            instrument.get("instrument_type", "")
        ).upper()

        if instrument_type not in ("EQ", "BE"):
            continue

        isin = str(
            instrument.get("isin", "")
        ).strip().upper()

        if not isin:
            continue

        instrument_key = str(
            instrument.get("instrument_key", "")
        ).strip()

        if not instrument_key:
            continue

        trading_symbol = str(
            instrument.get("trading_symbol", "")
        ).strip()

        mapping[isin] = {
            "instrument_key": instrument_key,
            "trading_symbol": trading_symbol,
            "instrument_type": instrument_type,
            "name": instrument.get("name", ""),
        }

    print(
        "NSE equity ISIN mappings:",
        len(mapping),
    )

    return mapping


def get_daily_candles(
    instrument_key,
    from_date,
    to_date,
):
    encoded_key = instrument_key.replace(
        "|",
        "%7C",
    )

    url = (
        f"{BASE_URL}/"
        f"{encoded_key}/"
        f"days/1/"
        f"{to_date}/"
        f"{from_date}"
    )

    response = requests.get(
        url,
        headers=get_headers(),
        timeout=REQUEST_TIMEOUT,
    )

    if response.status_code != 200:
        raise RuntimeError(
            f"Upstox API error "
            f"{response.status_code}: "
            f"{response.text}"
        )

    data = response.json()

    candles = data.get(
        "data",
        {},
    ).get(
        "candles",
        [],
    )

    if not candles:
        return pd.DataFrame(
            columns=[
                "date",
                "open",
                "high",
                "low",
                "close",
                "volume",
            ]
        )

    rows = []

    for candle in candles:
        rows.append(
            {
                "date": pd.to_datetime(
                    candle[0]
                ).date(),

                "open": float(candle[1]),
                "high": float(candle[2]),
                "low": float(candle[3]),
                "close": float(candle[4]),
                "volume": float(candle[5]),
            }
        )

    df = pd.DataFrame(rows)

    df = df.drop_duplicates(
        subset=["date"]
    )

    df = df.sort_values(
        "date"
    ).reset_index(
        drop=True
    )

    return df


def fetch_ltp_quotes(instrument_mapping):
    """
    Fetch live LTP / previous close for mapped NSE equity instruments.

    Important:
    The response can contain more quote objects than our requested
    equity universe. We therefore only accept quotes whose instrument
    key was explicitly requested and keep exactly one quote per ISIN.
    """
    quotes = {}

    instrument_items = []

    for isin, mapped in instrument_mapping.items():
        instrument_key = str(
            mapped.get("instrument_key", "")
        ).strip()

        if instrument_key:
            instrument_items.append(
                (
                    str(isin).strip().upper(),
                    instrument_key,
                )
            )

    # Keep one requested instrument per ISIN.
    unique_items = {}
    for isin, instrument_key in instrument_items:
        unique_items[isin] = instrument_key

    instrument_items = list(
        unique_items.items()
    )

    # Upstox supports up to 500 instruments per request.
    batch_size = 500

    print()
    print("=" * 70)
    print("FETCHING LIVE LTP")
    print("=" * 70)
    print(
        "Requested instruments:",
        len(instrument_items),
    )

    fetched_at = datetime.now(
        IST
    ).isoformat(
        timespec="seconds"
    )

    for start in range(
        0,
        len(instrument_items),
        batch_size,
    ):

        batch = instrument_items[
            start:start + batch_size
        ]

        requested_keys = {
            instrument_key
            for _, instrument_key in batch
        }

        print(
            f"LTP batch "
            f"{start + 1}-"
            f"{start + len(batch)}"
        )

        try:

            response = requests.get(
                LTP_URL,
                headers=get_headers(),
                params={
                    "instrument_key": ",".join(
                        requested_keys
                    )
                },
                timeout=REQUEST_TIMEOUT,
            )

            if response.status_code != 200:

                print(
                    "  LTP API error:",
                    response.status_code,
                    response.text[:500],
                )

                continue

            data = response.json().get(
                "data",
                {}
            )

            # Build an exact normalized instrument-key lookup.
            requested_lookup = {}

            for isin, instrument_key in batch:

                normalized_key = (
                    instrument_key
                    .strip()
                    .replace(":", "|")
                )

                requested_lookup[
                    normalized_key
                ] = isin

            batch_quotes = 0

            for response_key, quote in data.items():

                response_key = str(
                    response_key
                ).strip()

                instrument_token = str(
                    quote.get(
                        "instrument_token",
                        response_key,
                    )
                ).strip()

                # Prefer the actual instrument_token returned
                # by Upstox, then fall back to the response key.
                candidates = [
                    instrument_token,
                    response_key,
                    instrument_token.replace(
                        ":",
                        "|",
                    ),
                    response_key.replace(
                        ":",
                        "|",
                    ),
                ]

                isin = None

                for candidate in candidates:

                    normalized = candidate.replace(
                        ":",
                        "|",
                    )

                    if normalized in requested_lookup:

                        isin = requested_lookup[
                            normalized
                        ]

                        break

                # CRITICAL:
                # Ignore any quote not belonging to the requested
                # 500-instrument batch.
                if not isin:
                    continue

                # Never allow duplicate quote records for an ISIN.
                if isin in quotes:
                    continue

                last_price = quote.get(
                    "last_price"
                )

                previous_close = quote.get(
                    "cp"
                )

                change_pct = None

                if (
                    last_price is not None
                    and previous_close is not None
                ):

                    try:

                        previous_close_float = float(
                            previous_close
                        )

                        if (
                            previous_close_float
                            != 0
                        ):

                            change_pct = (
                                (
                                    float(
                                        last_price
                                    )
                                    /
                                    previous_close_float
                                ) - 1
                            ) * 100

                    except (
                        TypeError,
                        ValueError,
                    ):
                        change_pct = None

                quotes[isin] = {

                    "LTP":
                        clean_number(
                            last_price
                        ),

                    "Previous Close":
                        clean_number(
                            previous_close
                        ),

                    "LTP Change %":
                        clean_number(
                            change_pct
                        ),

                    "LTP Volume":
                        quote.get(
                            "volume"
                        ),

                    "LTP Last Traded Qty":
                        quote.get(
                            "ltq"
                        ),

                    "LTP Fetch Time":
                        fetched_at,
                }

                batch_quotes += 1

            print(
                "  Quotes matched:",
                batch_quotes,
            )

        except Exception as error:

            print(
                "  LTP batch ERROR:",
                error,
            )

        time.sleep(
            REQUEST_DELAY
        )

    print()
    print(
        "LTP quotes received:",
        len(quotes),
    )

    print(
        "LTP instruments missing:",
        max(
            0,
            len(instrument_items)
            - len(quotes),
        ),
    )

    print("=" * 70)

    return quotes, fetched_at



def calculate_returns(df, current_price=None):
    """
    Calculate returns using the current/live price when supplied.

    During market hours Upstox daily candles generally represent the last
    completed daily candle, not the current intraday price. Therefore:
      - current_price = LIVE LTP -> today's return calculations use LTP
      - current_price = None -> fall back to the latest completed daily close

    Historical anchors remain the completed daily closes:
      daily  = current / previous session close
      weekly = current / close 5 sessions ago
      1M     = current / close 21 sessions ago
      3M     = current / close 63 sessions ago
      6M     = current / close 126 sessions ago
      YTD    = current / last prior-year close
    """

    if df.empty:
        return {
            "daily": None,
            "weekly": None,
            "1m": None,
            "3m": None,
            "6m": None,
            "ytd": None,
        }

    data = df.sort_values("date").reset_index(drop=True)

    latest_close = float(data.iloc[-1]["close"])

    if current_price is None:
        current = latest_close
    else:
        try:
            current = float(current_price)
            if pd.isna(current) or current <= 0:
                current = latest_close
        except (TypeError, ValueError):
            current = latest_close

    def return_from_anchor(periods):
        # When current_price is LIVE LTP, the latest completed daily
        # close is the zero-period anchor. Therefore:
        #   daily -> yesterday close
        #   weekly -> 5 completed sessions before yesterday
        #   1M -> 21 completed sessions before yesterday
        #   3M -> 63 completed sessions before yesterday
        #   6M -> 126 completed sessions before yesterday
        #
        # When there is no live price, preserve the original daily-candle
        # calculation where the latest completed close is the current value.
        if current_price is not None:
            anchor_index = periods
        else:
            anchor_index = periods + 1

        if len(data) <= anchor_index:
            return None

        anchor = float(data.iloc[-1 - anchor_index]["close"])
        if anchor == 0:
            return None

        return ((current / anchor) - 1) * 100

    current_date = data.iloc[-1]["date"]
    current_year = current_date.year

    previous_year_data = data[
        data["date"].apply(lambda x: x.year < current_year)
    ]

    if previous_year_data.empty:
        ytd = None
    else:
        anchor = float(previous_year_data.iloc[-1]["close"])
        ytd = ((current / anchor) - 1) * 100 if anchor != 0 else None

    return {
        "daily": return_from_anchor(1),
        "weekly": return_from_anchor(5),
        "1m": return_from_anchor(21),
        "3m": return_from_anchor(63),
        "6m": return_from_anchor(126),
        "ytd": ytd,
    }



def calculate_rs_history(
    stock_df,
    nifty_df,
    days=10,
    current_stock_price=None,
    current_nifty_price=None,
    current_volume=None,
    current_date=None,
):
    """
    Calculate daily 3M Relative Strength for the last `days` observations.

    Historical observations use completed daily candles.

    The final/current observation uses:
        current_stock_price = live stock LTP
        current_nifty_price = live NIFTY LTP
        current_volume      = live stock volume

    This is important because the daily candle API can still contain the
    previous completed session while the market is currently trading.

    RS = Stock 3M return - NIFTY 3M return
    """

    if stock_df.empty or nifty_df.empty:
        return []

    stock = stock_df.copy()
    nifty = nifty_df.copy()

    stock["date"] = pd.to_datetime(stock["date"])
    nifty["date"] = pd.to_datetime(nifty["date"])

    stock = (
        stock.sort_values("date")
        .drop_duplicates("date")
        .reset_index(drop=True)
    )

    nifty = (
        nifty.sort_values("date")
        .drop_duplicates("date")
        .reset_index(drop=True)
    )

    merged = pd.merge(
        stock[["date", "close", "volume"]],
        nifty[["date", "close"]],
        on="date",
        how="inner",
        suffixes=("_stock", "_nifty"),
    )

    if merged.empty:
        return []

    merged = (
        merged.sort_values("date")
        .reset_index(drop=True)
    )

    LOOKBACK_SESSIONS = 63

    if len(merged) <= LOOKBACK_SESSIONS:
        return []

    # Historical 3M bases.
    merged["stock_base"] = merged["close_stock"].shift(LOOKBACK_SESSIONS)
    merged["nifty_base"] = merged["close_nifty"].shift(LOOKBACK_SESSIONS)

    merged["stock_3m_return"] = (
        (merged["close_stock"] / merged["stock_base"]) - 1
    ) * 100

    merged["nifty_3m_return"] = (
        (merged["close_nifty"] / merged["nifty_base"]) - 1
    ) * 100

    merged["rs"] = (
        merged["stock_3m_return"] - merged["nifty_3m_return"]
    )

    valid = merged[
        merged["stock_base"].notna()
        & merged["nifty_base"].notna()
        & merged["rs"].notna()
    ].copy()

    if valid.empty:
        return []

    # Historical observations first.
    recent = valid.tail(max(days, 10)).copy()

    history = []

    for _, item in recent.iterrows():
        volume = item["volume"]

        history.append(
            {
                "date": item["date"].strftime("%Y-%m-%d"),
                "rs": clean_number(item["rs"]),
                "volume": (
                    int(volume)
                    if pd.notna(volume) and float(volume) >= 0
                    else None
                ),
            }
        )

    # ---------------------------------------------------------
    # ADD / REPLACE TODAY'S LIVE OBSERVATION
    # ---------------------------------------------------------
    # This makes RS Momentum and Volume Gainers use today's LTP
    # and today's live volume instead of yesterday's close.
    if (
        current_stock_price is not None
        and current_nifty_price is not None
    ):
        try:
            live_stock = float(current_stock_price)
            live_nifty = float(current_nifty_price)

            if live_stock > 0 and live_nifty > 0:
                if current_date is None:
                    live_date = datetime.now(IST).date()
                else:
                    live_date = (
                        pd.to_datetime(current_date).date()
                        if not isinstance(current_date, date)
                        else current_date
                    )

                # Use the correct 63-session completed-close anchor.
                #
                # If today's live session is NOT in the daily candle data,
                # yesterday is the last completed row, so today's 63-session
                # anchor is 63 rows back from yesterday.
                #
                # If today's row IS already present, use its existing 63-session
                # shifted base.
                if pd.to_datetime(current_date).date() > merged.iloc[-1]["date"].date():
                    if len(merged) <= LOOKBACK_SESSIONS:
                        return history[-days:]

                    live_base_row = merged.iloc[-LOOKBACK_SESSIONS]
                    live_stock_base = float(live_base_row["close_stock"])
                    live_nifty_base = float(live_base_row["close_nifty"])
                else:
                    base_row = valid.iloc[-1]
                    live_stock_base = float(base_row["stock_base"])
                    live_nifty_base = float(base_row["nifty_base"])

                if (
                    live_stock_base > 0
                    and live_nifty_base > 0
                ):
                    live_stock_3m = (
                        (live_stock / live_stock_base) - 1
                    ) * 100

                    live_nifty_3m = (
                        (live_nifty / live_nifty_base) - 1
                    ) * 100

                    live_rs = (
                        live_stock_3m - live_nifty_3m
                    )

                    live_volume = None
                    if current_volume is not None:
                        try:
                            live_volume = int(float(current_volume))
                        except (TypeError, ValueError):
                            live_volume = None

                    live_item = {
                        "date": live_date.strftime("%Y-%m-%d"),
                        "rs": clean_number(live_rs),
                        "volume": live_volume,
                        "source": "LIVE LTP",
                    }

                    # Replace an existing same-date observation, otherwise append.
                    history = [
                        item
                        for item in history
                        if item.get("date") != live_item["date"]
                    ]
                    history.append(live_item)

        except (TypeError, ValueError, IndexError):
            pass

    return history[-days:]


def calculate_rs_momentum_metrics(
    rs_history,
):
    """
    Calculate RS momentum statistics from the
    last 10 available RS observations.
    """

    valid = [
        item
        for item in rs_history
        if item.get("rs") is not None
    ]

    if not valid:
        return {
            "10D RS Change": None,
            "Highest RS": None,
            "Lowest RS": None,
            "Average RS": None,
            "RS Momentum Score": None,
            "Consistency": None,
            "RS Data Days": 0,
        }

    rs_values = [
        float(item["rs"])
        for item in valid
    ]

    current_rs = rs_values[-1]

    if len(rs_values) >= 2:

        first_rs = rs_values[0]

        rs_change = (
            current_rs - first_rs
        )

        previous_values = rs_values[:-1]

        previous_average = (
            sum(previous_values)
            / len(previous_values)
        )

        momentum_score = (
            current_rs
            - previous_average
        )

    else:

        rs_change = None
        momentum_score = None

    # Count sessions where RS increased
    positive_days = 0

    for i in range(1, len(rs_values)):

        if rs_values[i] > rs_values[i - 1]:
            positive_days += 1

    consistency = (
        positive_days
        if len(rs_values) <= 1
        else positive_days
    )

    return {
        "10D RS Change": clean_number(
            rs_change
        ),

        "Highest RS": clean_number(
            max(rs_values)
        ),

        "Lowest RS": clean_number(
            min(rs_values)
        ),

        "Average RS": clean_number(
            sum(rs_values)
            / len(rs_values)
        ),

        "RS Momentum Score": clean_number(
            momentum_score
        ),

        "Consistency": consistency,

        "RS Data Days": len(rs_values),
    }


def calculate_volume_metrics(
    rs_history,
):
    """
    Calculate volume statistics using the last 10
    available trading sessions.

    Volume Ratio compares the latest session against
    the average of the preceding sessions.
    """

    valid = [
        item
        for item in rs_history
        if item.get("volume") is not None
    ]

    if not valid:
        return {
            "Today Volume": None,
            "10D Average Volume": None,
            "Volume Ratio": None,
            "Volume Change %": None,
        }

    volumes = [
        float(item["volume"])
        for item in valid
    ]

    today_volume = volumes[-1]

    previous_volumes = volumes[:-1]

    if previous_volumes:

        average_volume = (
            sum(previous_volumes)
            / len(previous_volumes)
        )

    else:

        average_volume = None

    if (
        average_volume is not None
        and average_volume > 0
    ):

        volume_ratio = (
            today_volume
            / average_volume
        )

        volume_change = (
            volume_ratio - 1
        ) * 100

    else:

        volume_ratio = None
        volume_change = None

    return {
        "Today Volume": int(
            today_volume
        ),

        "10D Average Volume": (
            clean_number(
                average_volume
            )
            if average_volume is not None
            else None
        ),

        "Volume Ratio": clean_number(
            volume_ratio
        ),

        "Volume Change %": clean_number(
            volume_change
        ),
    }


def clean_number(value):

    if value is None:
        return None

    return round(
        float(value),
        6,
    )



def fetch_single_ltp(instrument_key):
    """
    Fetch a single live LTP from Upstox.

    Used for NIFTY 50 because the normal equity LTP mapping is keyed
    by ISIN, while NIFTY is an index instrument.
    """
    try:
        response = requests.get(
            LTP_URL,
            headers=get_headers(),
            params={"instrument_key": instrument_key},
            timeout=REQUEST_TIMEOUT,
        )

        response.raise_for_status()

        data = response.json().get("data", {})

        if not data:
            return None

        # Upstox may return the exact instrument key or a normalized key.
        quote = None

        for key, item in data.items():
            if str(key).strip() == instrument_key:
                quote = item
                break

        if quote is None:
            quote = next(iter(data.values()))

        ltp = quote.get("last_price")

        if ltp is None:
            return None

        return clean_number(ltp)

    except Exception as error:
        print("NIFTY live LTP ERROR:", error)
        return None


def fetch_nifty_return(
    from_date,
    to_date,
):

    print()
    print("Fetching NIFTY 50...")

    nifty_df = get_daily_candles(
        NIFTY_INSTRUMENT,
        from_date,
        to_date,
    )

    print(
        "NIFTY candles:",
        len(nifty_df),
    )

    if nifty_df.empty:
        raise RuntimeError(
            "No NIFTY 50 data returned."
        )

    nifty_returns = calculate_returns(
        nifty_df
    )

    print(
        "NIFTY returns:",
        {
            key: clean_number(value)
            for key, value
            in nifty_returns.items()
        },
    )

    live_nifty_ltp = fetch_single_ltp(NIFTY_INSTRUMENT)

    print(
        "Live NIFTY 50 LTP:",
        live_nifty_ltp,
    )

    return nifty_returns, nifty_df, live_nifty_ltp


def load_stocks():

    df = pd.read_csv(
        STOCK_FILE,
        dtype=str,
    )

    required_columns = [
        "Sector",
        "Company Name",
        "Industry",
        "Symbol",
        "Series",
        "ISIN Code",
    ]

    missing = [
        column
        for column in required_columns
        if column not in df.columns
    ]

    if missing:
        raise RuntimeError(
            "Missing columns in stocks.csv: "
            + ", ".join(missing)
        )

    df = df.fillna("")

    return df


def create_unique_stock_list(stocks):

    unique = (
        stocks[
            [
                "Symbol",
                "ISIN Code",
            ]
        ]
        .drop_duplicates(
            subset=["ISIN Code"]
        )
    )

    unique = unique[
        unique["ISIN Code"].str.strip() != ""
    ]

    return unique


def save_mapping_report(
    stocks,
    instrument_mapping,
):

    rows = []

    unique_stocks = create_unique_stock_list(
        stocks
    )

    for _, row in unique_stocks.iterrows():

        isin = str(
            row["ISIN Code"]
        ).strip().upper()

        mapped = instrument_mapping.get(
            isin
        )

        rows.append(
            {
                "Symbol": row["Symbol"],
                "ISIN Code": isin,
                "Upstox Instrument Key": (
                    mapped["instrument_key"]
                    if mapped
                    else ""
                ),
                "Upstox Trading Symbol": (
                    mapped["trading_symbol"]
                    if mapped
                    else ""
                ),
                "Instrument Type": (
                    mapped["instrument_type"]
                    if mapped
                    else ""
                ),
                "Mapping Status": (
                    "FOUND"
                    if mapped
                    else "NOT_FOUND"
                ),
            }
        )

    pd.DataFrame(rows).to_csv(
        MAPPING_CSV,
        index=False,
    )

    print()
    print(
        "Saved:",
        MAPPING_CSV,
    )


def process_stock(
    row,
    from_date,
    to_date,
    nifty_returns,
    nifty_df,
    instrument_mapping,
    ltp_quotes,
    live_nifty_ltp=None,
):

    symbol = str(
        row["Symbol"]
    ).strip()

    isin = str(
        row["ISIN Code"]
    ).strip().upper()

    mapped = instrument_mapping.get(
        isin
    )

    if not mapped:

        print(
            f"  ERROR: No Upstox NSE instrument "
            f"mapping for {symbol} / {isin}"
        )

        return {
            "status": "MAPPING_NOT_FOUND",
            "symbol": symbol,
            "isin": isin,
        }

    instrument_key = mapped[
        "instrument_key"
    ]

    print(
        f"Fetching {symbol} "
        f"({instrument_key})..."
    )

    df = get_daily_candles(
        instrument_key,
        from_date,
        to_date,
    )

    if df.empty:

        print(
            f"  WARNING: No data for {symbol}"
        )

        return {
            "status": "NO_DATA",
            "symbol": symbol,
            "isin": isin,
        }

    # ---------------------------------------------------------
    # 10-DAY RS HISTORY + VOLUME HISTORY
    # ---------------------------------------------------------

    # ---------------------------------------------------------
    # LIVE PRICE OVERRIDE
    # ---------------------------------------------------------
    # During market hours, LTP is the current price. The daily candle
    # may still represent the previous completed session, so all
    # current-period calculations must use LTP when available.
    ltp_data = ltp_quotes.get(isin, {})

    live_stock_ltp = ltp_data.get("LTP")
    live_stock_volume = ltp_data.get("LTP Volume")

    return_price = live_stock_ltp

    if return_price is None:
        return_price = (
            float(df.iloc[-1]["close"])
            if not df.empty
            else None
        )

    price_source = (
        "LIVE LTP"
        if live_stock_ltp is not None
        else "LAST COMPLETED CLOSE"
    )

    rs_history = calculate_rs_history(
        df,
        nifty_df,
        days=10,
        current_stock_price=live_stock_ltp,
        current_nifty_price=live_nifty_ltp,
        current_volume=live_stock_volume,
        current_date=datetime.now(IST).date(),
    )

    rs_metrics = calculate_rs_momentum_metrics(
        rs_history
    )

    volume_metrics = calculate_volume_metrics(
        rs_history
    )

    returns = calculate_returns(
        df,
        current_price=return_price,
    )

    stock_3m = returns.get("3m")

    # Use live NIFTY LTP as the current price for NIFTY's 3M return.
    nifty_live_price = live_nifty_ltp
    if nifty_live_price is None and not nifty_df.empty:
        nifty_live_price = float(nifty_df.iloc[-1]["close"])

    nifty_live_returns = calculate_returns(
        nifty_df,
        current_price=nifty_live_price,
    )

    nifty_3m = nifty_live_returns.get("3m")

    if (
        stock_3m is not None
        and nifty_3m is not None
    ):
        relative_strength = (
            stock_3m
            - nifty_3m
        )
    else:
        relative_strength = None

    result = {
        "Sector": row["Sector"],
        "Company Name": row["Company Name"],
        "Industry": row["Industry"],
        "Symbol": symbol,
        "Series": row["Series"],
        "ISIN Code": isin,
        "NSE Symbol": (
            row.get("NSE Symbol", "")
        ),

        "Daily": clean_number(
            returns.get("daily")
        ),

        "Weekly": clean_number(
            returns.get("weekly")
        ),

        "1M": clean_number(
            returns.get("1m")
        ),

        "3M": clean_number(
            returns.get("3m")
        ),

        "6M": clean_number(
            returns.get("6m")
        ),

        "YTD": clean_number(
            returns.get("ytd")
        ),

        "Nifty Index 3M % Change":
            clean_number(
                nifty_3m
            ),

        "Stock Relative Strength vs Nifty":
            clean_number(
                relative_strength
            ),

        "RS History":
            rs_history,

        "10D RS Change":
            rs_metrics[
                "10D RS Change"
            ],

        "Highest RS":
            rs_metrics[
                "Highest RS"
            ],

        "Lowest RS":
            rs_metrics[
                "Lowest RS"
            ],

        "Average RS":
            rs_metrics[
                "Average RS"
            ],

        "RS Momentum Score":
            rs_metrics[
                "RS Momentum Score"
            ],

        "Consistency":
            rs_metrics[
                "Consistency"
            ],

        "RS Data Days":
            rs_metrics[
                "RS Data Days"
            ],

        "Volume History":
            rs_history,

        "Today Volume":
            volume_metrics[
                "Today Volume"
            ],

        "10D Average Volume":
            volume_metrics[
                "10D Average Volume"
            ],

        "Volume Ratio":
            volume_metrics[
                "Volume Ratio"
            ],

        "Volume Change %":
            volume_metrics[
                "Volume Change %"
            ],

        "Upstox Instrument Key":
            instrument_key,

        "Data Date": (
            str(df.iloc[-1]["date"])
            if not df.empty
            else ""
        ),

        "LTP": (
            ltp_data.get("LTP")
        ),

        "Return Calculation Price": price_source,

        "Previous Close": (
            ltp_quotes.get(isin, {}).get(
                "Previous Close"
            )
        ),

        "LTP Change %": (
            ltp_quotes.get(isin, {}).get(
                "LTP Change %"
            )
        ),

        "LTP Volume": (
            ltp_quotes.get(isin, {}).get(
                "LTP Volume"
            )
        ),

        "LTP Last Traded Qty": (
            ltp_quotes.get(isin, {}).get(
                "LTP Last Traded Qty"
            )
        ),

        "LTP Fetch Time": (
            ltp_quotes.get(isin, {}).get(
                "LTP Fetch Time"
            )
        ),

        "Status": "OK",
    }

    print(
        f"  3M={result['3M']}% | "
        f"Nifty 3M="
        f"{result['Nifty Index 3M % Change']}% | "
        f"RS 3M="
        f"{result['Stock Relative Strength vs Nifty']}%"
    )

    return result


def save_results(results):

    os.makedirs(
        "data",
        exist_ok=True,
    )

    df = pd.DataFrame(
        results
    )

    if (
        "Stock Relative Strength vs Nifty"
        in df.columns
    ):

        df = df.sort_values(
            by=(
                "Stock Relative Strength "
                "vs Nifty"
            ),
            ascending=False,
            na_position="last",
        )

    df.to_csv(
        OUTPUT_CSV,
        index=False,
    )

    with open(
        OUTPUT_JSON,
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            results,
            file,
            indent=2,
            ensure_ascii=False,
        )

    print()
    print(
        "Saved:",
        OUTPUT_CSV,
    )

    print(
        "Saved:",
        OUTPUT_JSON,
    )


def main():

    print("=" * 70)
    print(
        "NIFTY SECTOR "
        "RELATIVE STRENGTH"
    )
    print("=" * 70)

    now_ist = datetime.now(IST)
    today = now_ist.date()

    print(
        "Workflow fetch time (IST):",
        now_ist.isoformat(timespec="seconds"),
    )

    from_date = (
        today
        - timedelta(days=250)
    )

    from_date_str = (
        from_date.isoformat()
    )

    to_date_str = (
        today.isoformat()
    )

    print(
        "Date range:"
    )

    print(
        "From:",
        from_date_str,
    )

    print(
        "To  :",
        to_date_str,
    )

    stocks = load_stocks()

    print(
        "Master rows:",
        len(stocks),
    )

    unique_stocks = (
        create_unique_stock_list(
            stocks
        )
    )

    print(
        "Unique ISINs:",
        len(unique_stocks),
    )

    instruments = (
        download_instrument_master()
    )

    instrument_mapping = (
        build_nse_equity_mapping(
            instruments
        )
    )

    save_mapping_report(
        stocks,
        instrument_mapping,
    )

    # Only fetch LTP for instruments that actually exist
    # in our master stock list.
    # Restrict live LTP requests to the 536 ISINs in our stock master.
    # instrument_mapping contains the full NSE universe (~2872 instruments).
    master_isins = set(
        unique_stocks["ISIN Code"]
        .astype(str)
        .str.strip()
        .str.upper()
    )

    ltp_instrument_mapping = {
        isin: instrument_mapping[isin]
        for isin in master_isins
        if isin in instrument_mapping
    }

    print(
        "LTP instrument universe:",
        len(ltp_instrument_mapping)
    )

    ltp_quotes, ltp_fetch_time = fetch_ltp_quotes(
        ltp_instrument_mapping
    )

    # Safety check: LTP data must never exceed the unique
    # instrument universe we requested.
    if len(ltp_quotes) > len(ltp_instrument_mapping):
        raise RuntimeError(
            "LTP mapping error: received more unique "
            "quotes than unique ISINs. "
            f"ISINs={len(ltp_instrument_mapping)}, "
            f"LTP quotes={len(ltp_quotes)}"
        )

    nifty_returns, nifty_df, live_nifty_ltp = (
        fetch_nifty_return(
            from_date_str,
            to_date_str,
        )
    )

    results_by_isin = {}

    errors = []

    total_unique = len(
        unique_stocks
    )

    for index, (_, stock) in enumerate(
        unique_stocks.iterrows(),
        start=1,
    ):

        symbol = str(
            stock["Symbol"]
        ).strip()

        isin = str(
            stock["ISIN Code"]
        ).strip().upper()

        print()
        print(
            f"[{index}/{total_unique}]"
        )

        try:

            result = process_stock(
                {
                    "Sector": "",
                    "Company Name": "",
                    "Industry": "",
                    "Symbol": symbol,
                    "Series": "",
                    "ISIN Code": isin,
                    "NSE Symbol": "",
                },
                from_date_str,
                to_date_str,
                nifty_returns,
                nifty_df,
                instrument_mapping,
                ltp_quotes,
                live_nifty_ltp,
            )

            if result.get(
                "Status"
            ) == "OK":

                results_by_isin[
                    isin
                ] = result

            else:

                errors.append(
                    {
                        "Symbol": symbol,
                        "ISIN": isin,
                        "Error": result.get(
                            "status"
                        ),
                    }
                )

        except Exception as error:

            print(
                f"  ERROR: {error}"
            )

            errors.append(
                {
                    "Symbol": symbol,
                    "ISIN": isin,
                    "Error": str(error),
                }
            )

        time.sleep(
            REQUEST_DELAY
        )

    final_results = []

    # Common dashboard metadata. LTP fetch time is the exact time the
    # live quote request completed in India Standard Time.
    dashboard_metadata = {
        "Last Fetch": ltp_fetch_time,
        "Live NIFTY LTP": live_nifty_ltp,
    }

    for _, row in stocks.iterrows():

        isin = str(
            row["ISIN Code"]
        ).strip().upper()

        base = {
            "Sector": row["Sector"],
            "Company Name":
                row["Company Name"],
            "Industry": row["Industry"],
            "Symbol": row["Symbol"],
            "Series": row["Series"],
            "ISIN Code": isin,
            "NSE Symbol":
                row.get(
                    "NSE Symbol",
                    "",
                ),

            "Last Fetch":
                dashboard_metadata["Last Fetch"],

            "Live NIFTY LTP":
                dashboard_metadata["Live NIFTY LTP"],
        }

        stock_result = (
            results_by_isin.get(
                isin
            )
        )

        if stock_result:

            result = {
                **base,
                "Daily":
                    stock_result.get(
                        "Daily"
                    ),
                "Weekly":
                    stock_result.get(
                        "Weekly"
                    ),
                "1M":
                    stock_result.get(
                        "1M"
                    ),
                "3M":
                    stock_result.get(
                        "3M"
                    ),
                "6M":
                    stock_result.get(
                        "6M"
                    ),
                "YTD":
                    stock_result.get(
                        "YTD"
                    ),
                "Nifty Index 3M % Change":
                    stock_result.get(
                        "Nifty Index 3M % Change"
                    ),
                "Stock Relative Strength vs Nifty":
                    stock_result.get(
                        "Stock Relative Strength vs Nifty"
                    ),
                "RS History":
                    stock_result.get(
                        "RS History"
                    ),
                "10D RS Change":
                    stock_result.get(
                        "10D RS Change"
                    ),
                "Highest RS":
                    stock_result.get(
                        "Highest RS"
                    ),
                "Lowest RS":
                    stock_result.get(
                        "Lowest RS"
                    ),
                "Average RS":
                    stock_result.get(
                        "Average RS"
                    ),
                "RS Momentum Score":
                    stock_result.get(
                        "RS Momentum Score"
                    ),
                "Consistency":
                    stock_result.get(
                        "Consistency"
                    ),
                "RS Data Days":
                    stock_result.get(
                        "RS Data Days"
                    ),
                "Volume History":
                    stock_result.get(
                        "Volume History"
                    ),
                "Today Volume":
                    stock_result.get(
                        "Today Volume"
                    ),
                "10D Average Volume":
                    stock_result.get(
                        "10D Average Volume"
                    ),
                "Volume Ratio":
                    stock_result.get(
                        "Volume Ratio"
                    ),
                "Volume Change %":
                    stock_result.get(
                        "Volume Change %"
                    ),
                "Upstox Instrument Key":
                    stock_result.get(
                        "Upstox Instrument Key"
                    ),

                "Data Date":
                    stock_result.get(
                        "Data Date"
                    ),

                "LTP":
                    stock_result.get(
                        "LTP"
                    ),

                "Return Calculation Price":
                    stock_result.get(
                        "Return Calculation Price"
                    ),

                "Previous Close":
                    stock_result.get(
                        "Previous Close"
                    ),

                "LTP Change %":
                    stock_result.get(
                        "LTP Change %"
                    ),

                "LTP Volume":
                    stock_result.get(
                        "LTP Volume"
                    ),

                "LTP Last Traded Qty":
                    stock_result.get(
                        "LTP Last Traded Qty"
                    ),

                "LTP Fetch Time":
                    stock_result.get(
                        "LTP Fetch Time"
                    ),

                "Status": "OK",
            }

        else:

            error_info = next(
                (
                    item
                    for item in errors
                    if item["ISIN"]
                    == isin
                ),
                None,
            )

            result = {
                **base,
                "Daily": None,
                "Weekly": None,
                "1M": None,
                "3M": None,
                "6M": None,
                "YTD": None,
                "Nifty Index 3M % Change":
                    clean_number(
                        nifty_returns.get(
                            "3m"
                        )
                    ),
                "Stock Relative Strength vs Nifty":
                    None,
                "RS History": None,
                "10D RS Change": None,
                "Highest RS": None,
                "Lowest RS": None,
                "Average RS": None,
                "RS Momentum Score": None,
                "Consistency": None,
                "RS Data Days": None,
                "Volume History": None,
                "Today Volume": None,
                "10D Average Volume": None,
                "Volume Ratio": None,
                "Volume Change %": None,
                "Upstox Instrument Key":
                    "",

                "Data Date":
                    "",

                "LTP":
                    None,

                "Return Calculation Price":
                    "ERROR",

                "Previous Close":
                    None,

                "LTP Change %":
                    None,

                "LTP Volume":
                    None,

                "LTP Last Traded Qty":
                    None,

                "LTP Fetch Time":
                    ltp_fetch_time,

                "Status":
                    (
                        error_info["Error"]
                        if error_info
                        else "ERROR"
                    ),
            }

        final_results.append(
            result
        )

    save_results(
        final_results
    )

    successful = sum(
        1
        for item
        in final_results
        if item.get(
            "Status"
        ) == "OK"
    )

    failed = (
        len(final_results)
        - successful
    )

    print()
    print("=" * 70)
    print("COMPLETED")
    print("=" * 70)
    print(
        "Master rows     :",
        len(stocks),
    )
    print(
        "Unique ISINs    :",
        len(unique_stocks),
    )
    print(
        "Successful      :",
        successful,
    )
    print(
        "Errors          :",
        failed,
    )
    print(
        "LTP Quotes      :",
        len(ltp_quotes),
    )
    print(
        "Last Fetch (IST):",
        ltp_fetch_time,
    )
    print("=" * 70)


if __name__ == "__main__":
    main()