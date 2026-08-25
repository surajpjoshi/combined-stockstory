import json
import os

import pandas as pd


STOCK_RS_FILE = "data/stock_rs.csv"

OUTPUT_CSV = "data/sector_summary.csv"
OUTPUT_JSON = "data/sector_summary.json"
ERRORS_CSV = "data/errors.csv"

# Dummy/test rows should never be included in the analysis.
EXCLUDED_SYMBOLS = {
    "DUMMYHDLVR",
}


def clean_number(value):
    if pd.isna(value):
        return None

    return round(float(value), 6)


def main():

    print("=" * 70)
    print("BUILDING INDEX / SECTOR SUMMARY")
    print("=" * 70)

    if not os.path.exists(STOCK_RS_FILE):
        raise FileNotFoundError(
            f"Missing file: {STOCK_RS_FILE}"
        )

    df = pd.read_csv(
        STOCK_RS_FILE,
        dtype=str,
    )

    print(
        "Stock rows loaded:",
        len(df),
    )

    # ---------------------------------------------------------
    # REMOVE DUMMY / TEST STOCKS
    # ---------------------------------------------------------

    before_count = len(df)

    df = df[
        ~df["Symbol"]
        .astype(str)
        .str.upper()
        .isin(EXCLUDED_SYMBOLS)
    ].copy()

    removed_count = before_count - len(df)

    print(
        "Excluded dummy/test rows:",
        removed_count,
    )

    # ---------------------------------------------------------
    # NUMERIC COLUMNS
    # ---------------------------------------------------------

    numeric_columns = [
        "Daily",
        "Weekly",
        "1M",
        "3M",
        "6M",
        "YTD",
        "Nifty Index 3M % Change",
        "Stock Relative Strength vs Nifty",
    ]

    for column in numeric_columns:

        if column in df.columns:

            df[column] = pd.to_numeric(
                df[column],
                errors="coerce",
            )

    # ---------------------------------------------------------
    # ERROR REPORT
    # ---------------------------------------------------------

    error_mask = (
        ~df["Status"]
        .astype(str)
        .str.upper()
        .eq("OK")
    )

    errors = df.loc[
        error_mask
    ].copy()

    error_columns = [
        "Sector",
        "Company Name",
        "Industry",
        "Symbol",
        "Series",
        "ISIN Code",
        "Status",
    ]

    error_columns = [
        column
        for column in error_columns
        if column in errors.columns
    ]

    errors = errors[
        error_columns
    ]

    errors.to_csv(
        ERRORS_CSV,
        index=False,
    )

    print(
        "Error rows:",
        len(errors),
    )

    print(
        "Saved:",
        ERRORS_CSV,
    )

    # ---------------------------------------------------------
    # SUCCESSFUL STOCK DATA
    # ---------------------------------------------------------

    df_ok = df[
        df["Status"]
        .astype(str)
        .str.upper()
        .eq("OK")
    ].copy()

    # ---------------------------------------------------------
    # INDEX / SECTOR SUMMARY
    # ---------------------------------------------------------

    required_columns = [
        "Sector",
        "Symbol",
        "ISIN Code",
        "3M",
        "Stock Relative Strength vs Nifty",
    ]

    missing = [
        column
        for column in required_columns
        if column not in df_ok.columns
    ]

    if missing:

        raise RuntimeError(
            "Missing columns: "
            + ", ".join(missing)
        )

    df_ok["Sector"] = (
        df_ok["Sector"]
        .astype(str)
        .str.strip()
    )

    df_ok = df_ok[
        df_ok["Sector"].ne("")
    ].copy()

    summary_rows = []

    # ---------------------------------------------------------
    # IMPORTANT:
    # Each stock is counted only once inside each
    # Index / Sector.
    # ---------------------------------------------------------

    for sector, group in df_ok.groupby(
        "Sector",
        dropna=False,
    ):

        # Deduplicate stock membership using ISIN.
        # If ISIN is missing, fall back to Symbol.
        group = group.copy()

        group["_unique_stock"] = (
            group["ISIN Code"]
            .astype(str)
            .str.strip()
        )

        group.loc[
            group["_unique_stock"].eq(""),
            "_unique_stock",
        ] = (
            group.loc[
                group["_unique_stock"].eq(""),
                "Symbol",
            ]
            .astype(str)
            .str.strip()
        )

        group = group.drop_duplicates(
            subset="_unique_stock"
        )

        rs = group[
            "Stock Relative Strength vs Nifty"
        ].dropna()

        returns_3m = group[
            "3M"
        ].dropna()

        stock_count = len(group)

        successful_count = (
            rs.notna().sum()
        )

        if len(rs) > 0:

            average_rs = rs.mean()

            median_rs = rs.median()

            positive_rs_pct = (
                (rs > 0).sum()
                / len(rs)
                * 100
            )

            rs_above_5_pct = (
                (rs > 5).sum()
                / len(rs)
                * 100
            )

            rs_above_10_pct = (
                (rs > 10).sum()
                / len(rs)
                * 100
            )

        else:

            average_rs = None
            median_rs = None
            positive_rs_pct = None
            rs_above_5_pct = None
            rs_above_10_pct = None

        average_3m = (
            returns_3m.mean()
            if len(returns_3m) > 0
            else None
        )

        # -----------------------------------------------------
        # STRONGEST STOCK
        # -----------------------------------------------------

        sector_with_rs = group.dropna(
            subset=[
                "Stock Relative Strength vs Nifty"
            ]
        )

        if not sector_with_rs.empty:

            top_stock_row = (
                sector_with_rs
                .sort_values(
                    "Stock Relative Strength vs Nifty",
                    ascending=False,
                )
                .iloc[0]
            )

            top_stock = str(
                top_stock_row["Symbol"]
            )

            top_stock_rs = (
                top_stock_row[
                    "Stock Relative Strength vs Nifty"
                ]
            )

        else:

            top_stock = ""
            top_stock_rs = None

        summary_rows.append(
            {
                "Index / Sector": sector,

                "Stocks":
                    stock_count,

                "Successful":
                    successful_count,

                "Average 3M Return":
                    clean_number(
                        average_3m
                    ),

                "Average RS 3M":
                    clean_number(
                        average_rs
                    ),

                "Median RS 3M":
                    clean_number(
                        median_rs
                    ),

                "Positive RS %":
                    clean_number(
                        positive_rs_pct
                    ),

                "RS > +5 %":
                    clean_number(
                        rs_above_5_pct
                    ),

                "RS > +10 %":
                    clean_number(
                        rs_above_10_pct
                    ),

                "Top Stock":
                    top_stock,

                "Top Stock RS":
                    clean_number(
                        top_stock_rs
                    ),
            }
        )

    summary = pd.DataFrame(
        summary_rows
    )

    # Strongest first
    summary = summary.sort_values(
        by="Average RS 3M",
        ascending=False,
        na_position="last",
    ).reset_index(
        drop=True
    )

    # ---------------------------------------------------------
    # SAVE CSV
    # ---------------------------------------------------------

    summary.to_csv(
        OUTPUT_CSV,
        index=False,
    )

    # ---------------------------------------------------------
    # SAVE JSON
    # ---------------------------------------------------------

    records = summary.to_dict(
        orient="records"
    )

    with open(
        OUTPUT_JSON,
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            records,
            file,
            indent=2,
            ensure_ascii=False,
        )

    print()
    print(
        "Index / Sector count:",
        len(summary),
    )

    print(
        "Saved:",
        OUTPUT_CSV,
    )

    print(
        "Saved:",
        OUTPUT_JSON,
    )

    # ---------------------------------------------------------
    # DISPLAY TOP 10
    # ---------------------------------------------------------

    print()
    print("Top 10 Index / Sectors:")

    display_columns = [
        "Index / Sector",
        "Stocks",
        "Average RS 3M",
        "Positive RS %",
        "Top Stock",
        "Top Stock RS",
    ]

    print(
        summary[
            display_columns
        ]
        .head(10)
        .to_string(
            index=False
        )
    )

    print()
    print("=" * 70)
    print("INDEX / SECTOR SUMMARY COMPLETED")
    print("=" * 70)


if __name__ == "__main__":
    main()