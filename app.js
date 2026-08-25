const STOCK_URL = "data/stock_rs.json";
const SECTOR_URL = "data/sector_summary.json";

// Favorites are stored centrally in Google Sheets through a Google Apps Script web app.
// Replace this placeholder with your deployed Apps Script /exec URL.
const FAVORITES_API_URL = "https://script.google.com/macros/s/AKfycbyrN-apXcuyNRlbEIg2v10UpFGpc-G3t8ftbB54u4amyHps5Ce6xobXoxqeqSst2OV5/exec";

const FAVORITE_REASONS = [
    "Trend Breakout",
    "Volume Shocker",
    "52 Week High",
    "All Time High",
    "RS Improving",
    "Strong Momentum",
    "RS + Volume",
    "Breakout Setup",
    "Pullback Entry",
    "Watch for Entry",
    "My RSI Setup — Weekly / Hourly RSI",
    "Other"
];

let favorites = new Map();
let favoriteEditingSymbol = "";

let stocks = [];
let sectors = [];

let filteredStocks = [];

let sortColumn = "RS";
let sortDirection = "desc";

const stockCount = document.getElementById("stockCount");
const sectorCount = document.getElementById("sectorCount");
const dataStatus = document.getElementById("dataStatus");

const sectorCards =
    document.getElementById("sectorCards");

const stockTableBody =
    document.getElementById("stockTableBody");

const sectorFilter =
    document.getElementById("sectorFilter");

const periodFilter =
    document.getElementById("periodFilter");

const searchInput =
    document.getElementById("searchInput");

const resultCount =
    document.getElementById("resultCount");

const lastUpdated =
    document.getElementById("lastUpdated");

const fetchInfo =
    document.getElementById("fetchInfo");

const ltpCoverage =
    document.getElementById("ltpCoverage");


async function loadData() {

    try {

        const cacheBust =
            "?v=" + Date.now();

        const [
            stockResponse,
            sectorResponse
        ] = await Promise.all([
            fetch(
                STOCK_URL + cacheBust
            ),
            fetch(
                SECTOR_URL + cacheBust
            )
        ]);

        if (!stockResponse.ok) {
            throw new Error(
                "Unable to load stock data"
            );
        }

        if (!sectorResponse.ok) {
            throw new Error(
                "Unable to load sector data"
            );
        }

        stocks =
            await stockResponse.json();

        sectors =
            await sectorResponse.json();

        const uniqueStockCount =
          new Set(
           stocks.map(stock =>
            stock["ISIN Code"] ||
            stock.Symbol
           )
        ).size;

        stockCount.textContent =
          uniqueStockCount.toLocaleString();

        sectorCount.textContent =
            sectors.length;

        dataStatus.textContent =
            "Live";

        dataStatus.classList.add(
            "positive"
        );

        updateDate();

        buildSectorFilter();

        renderSectorCards();

        renderTopSectorStocks();

        applyFilters();

    } catch (error) {

        console.error(error);

        dataStatus.textContent =
            "Error";

        dataStatus.classList.add(
            "negative"
        );

        sectorCards.innerHTML = `
            <div class="loading">
                Unable to load dashboard data.
                <br>
                ${escapeHtml(error.message)}
            </div>
        `;

        stockTableBody.innerHTML = `
            <tr>
                <td
                    colspan="12"
                    class="loading"
                >
                    Unable to load stock data.
                </td>
            </tr>
        `;
    }
}


function findFirstValue(objects, keys) {
    for (const obj of objects) {
        if (!obj || typeof obj !== "object") continue;

        for (const key of keys) {
            if (
                Object.prototype.hasOwnProperty.call(obj, key) &&
                obj[key] !== null &&
                obj[key] !== undefined &&
                String(obj[key]).trim() !== ""
            ) {
                return obj[key];
            }
        }
    }

    return null;
}


function getFetchTimestamp() {
    return findFirstValue(stocks, [
        "Last Fetch",
        "Last Fetch (IST)",
        "Last Fetch IST",
        "LTP Fetch Time",
        "LTP Fetch Time (IST)",
        "Fetch Time",
        "Fetched At",
        "Fetched At (IST)",
        "last_fetch",
        "last_fetch_ist",
        "fetch_time"
    ]);
}


function getLtp(stock) {
    const keys = [
        "LTP",
        "ltp",
        "Last Traded Price",
        "Last Price",
        "last_price"
    ];

    for (const key of keys) {
        if (
            Object.prototype.hasOwnProperty.call(stock, key) &&
            stock[key] !== null &&
            stock[key] !== undefined &&
            String(stock[key]).trim() !== ""
        ) {
            const value = Number(stock[key]);

            if (Number.isFinite(value)) {
                return value;
            }
        }
    }

    return null;
}


function formatLtp(value) {
    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(Number(value))
    ) {
        return "—";
    }

    return Number(value).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}


function formatFetchTime(value) {
    if (!value) return null;

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
        return String(value);
    }

    return parsed.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short"
    }) + " IST";
}


function updateDate() {

    const fetchTimestamp =
        getFetchTimestamp();

    if (fetchTimestamp) {

        const formatted =
            formatFetchTime(fetchTimestamp);

        lastUpdated.textContent =
            "Last fetch • " + formatted;

        if (fetchInfo) {
            fetchInfo.textContent =
                "LTP fetched • " + formatted;
        }

    } else {

        lastUpdated.textContent =
            "Fetch timestamp unavailable";

        if (fetchInfo) {
            fetchInfo.textContent =
                "LTP timestamp unavailable";
        }
    }


    /*
     * Calculate LTP coverage.
     *
     * We count unique ISINs/stocks so repeated
     * sector memberships don't inflate the number.
     */

    if (ltpCoverage) {

        const uniqueStocks =
            new Map();

        stocks.forEach(stock => {

            const identity =
                stock["ISIN Code"] ||
                stock.Symbol ||
                stock["Symbol"];

            if (!identity) return;

            if (!uniqueStocks.has(identity)) {
                uniqueStocks.set(
                    identity,
                    stock
                );
            }
        });


        let available = 0;

        uniqueStocks.forEach(stock => {

            if (
                getLtp(stock) !== null
            ) {
                available++;
            }

        });


        ltpCoverage.textContent =
            `${available.toLocaleString()} / ${uniqueStocks.size.toLocaleString()}`;
    }
}


function buildSectorFilter() {

    sectorFilter.innerHTML = `
        <option value="ALL">
            All Index / Sectors
        </option>
    `;

    sectors.forEach(
        sector => {

            const name =
                sector["Index / Sector"];

            if (!name) {
                return;
            }

            const option =
                document.createElement(
                    "option"
                );

            option.value = name;

            option.textContent = name;

            sectorFilter.appendChild(
                option
            );
        }
    );
}


function renderSectorCards() {

    sectorCards.innerHTML = "";

    sectors
        .slice(0, 10)
        .forEach(
            (sector, index) => {

                const rs =
                    Number(
                        sector[
                            "Average RS 3M"
                        ]
                    );

                const positive =
                    Number(
                        sector[
                            "Positive RS %"
                        ]
                    );

                const card =
                    document.createElement(
                        "div"
                    );

                card.className =
                    "sector-card";

                card.innerHTML = `
                    <div class="sector-rank">
                        #${index + 1}
                    </div>

                    <div class="sector-name">
                        ${escapeHtml(
                            sector[
                                "Index / Sector"
                            ]
                        )}
                    </div>

                    <div class="
                        sector-rs
                        ${valueClass(rs)}
                    ">
                        ${formatPercent(rs)}
                    </div>

                    <div class="sector-meta">
                        <span>
                            ${sector.Stocks}
                            stocks
                        </span>

                        <span>
                            ${formatPercent(
                                positive
                            )} positive
                        </span>
                    </div>

                    <div class="sector-meta">
                        <span>
                            Top:
                            ${escapeHtml(
                                sector[
                                    "Top Stock"
                                ] || "—"
                            )}
                        </span>

                        <span class="
                            ${valueClass(
                                Number(
                                    sector[
                                        "Top Stock RS"
                                    ]
                                )
                            )}
                        ">
                            ${formatPercent(
                                Number(
                                    sector[
                                        "Top Stock RS"
                                    ]
                                )
                            )}
                        </span>
                    </div>
                `;

                card.addEventListener(
                    "click",
                    () => {

                        sectorFilter.value =
                            sector[
                                "Index / Sector"
                            ];

                        applyFilters();

                        window.scrollTo({
                            top:
                                document
                                .querySelector(
                                    ".filters"
                                )
                                .offsetTop - 20,

                            behavior: "smooth"
                        });
                    }
                );

                sectorCards.appendChild(
                    card
                );
            }
        );
}


function getAllStockSectors(stock) {

    const isin =
        stock["ISIN Code"];

    const symbol =
        stock.Symbol;


    const memberships =
        stocks
            .filter(row => {

                if (
                    isin &&
                    row["ISIN Code"]
                ) {

                    return (
                        row["ISIN Code"] ===
                        isin
                    );

                }

                return (
                    row.Symbol ===
                    symbol
                );

            })
            .map(
                row => row.Sector
            )
            .filter(Boolean);


    return [
        ...new Set(memberships)
    ];
}



/* =========================================================
   TOP 2 SECTORS + TOP 10 STOCKS
   ========================================================= */

const TOP_SECTOR_PERIODS = [
    { key: "Daily", label: "Daily" },
    { key: "Weekly", label: "Weekly" },
    { key: "1M", label: "1M" },
    { key: "3M", label: "3M" },
    { key: "6M", label: "6M" },
    { key: "YTD", label: "YTD" }
];

let topSectorPeriod = "Daily";


function renderTopSectorStocks() {

    const existing =
        document.getElementById(
            "topSectorStocksSection"
        );

    if (existing) {
        existing.remove();
    }

    const leadershipSection =
        document.getElementById(
            "leadershipPanel"
        );

    if (!leadershipSection) {
        return;
    }

    const section =
        document.createElement("section");

    section.id =
        "topSectorStocksSection";

    section.className =
        "section top-sector-stocks-section";

    section.innerHTML = `
        <div class="section-heading">
            <div>
                <div class="section-label">
                    LEADERSHIP
                </div>

                <h2>
                    Top 2 Sectors & Top 10 Stocks
                </h2>
            </div>

            <div class="section-note">
                Ranked by average stock return
            </div>
        </div>

        <div class="top-sector-tabs">
            ${TOP_SECTOR_PERIODS
                .map(
                    period => `
                        <button
                            type="button"
                            class="top-sector-tab ${(
                                period.key ===
                                topSectorPeriod
                                    ? "active"
                                    : ""
                            )}"
                            data-top-period="${period.key}"
                        >
                            ${period.label}
                        </button>
                    `
                )
                .join("")}
        </div>

        <div
            id="topSectorPanels"
            class="top-sector-panels"
        ></div>
    `;

    leadershipSection.appendChild(
        section
    );

    section
        .querySelectorAll(
            ".top-sector-tab"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    topSectorPeriod =
                        button.dataset.topPeriod;

                    section
                        .querySelectorAll(
                            ".top-sector-tab"
                        )
                        .forEach(tab =>
                            tab.classList.toggle(
                                "active",
                                tab === button
                            )
                        );

                    renderTopSectorPanels();
                }
            );
        });

    injectTopSectorStyles();

    renderTopSectorPanels();
}


function getTopSectorData(periodKey) {

    const sectorMap =
        new Map();

    stocks.forEach(stock => {

        const sector =
            String(
                stock.Sector || ""
            ).trim();

        if (!sector) {
            return;
        }

        const symbol =
            String(
                stock.Symbol || ""
            ).trim();

        if (!symbol) {
            return;
        }

        const value =
            Number(
                stock[periodKey]
            );

        if (
            !Number.isFinite(value)
        ) {
            return;
        }

        const identity =
            String(
                stock["ISIN Code"] ||
                symbol
            ).trim();

        if (!sectorMap.has(sector)) {
            sectorMap.set(
                sector,
                new Map()
            );
        }

        const stockMap =
            sectorMap.get(sector);

        /*
         * One stock must count only once inside a sector.
         * If the source contains duplicate rows for the
         * same stock/index membership, keep the first valid
         * observation.
         */
        if (!stockMap.has(identity)) {
            stockMap.set(
                identity,
                {
                    ...stock,
                    _return: value
                }
            );
        }
    });

    const sectorResults =
        Array.from(
            sectorMap.entries()
        )
        .map(
            ([sector, stockMap]) => {

                const sectorStocks =
                    Array.from(
                        stockMap.values()
                    );

                if (
                    !sectorStocks.length
                ) {
                    return null;
                }

                const average =
                    sectorStocks.reduce(
                        (sum, stock) =>
                            sum +
                            stock._return,
                        0
                    ) /
                    sectorStocks.length;

                const positiveCount =
                    sectorStocks.filter(
                        stock =>
                            stock._return > 0
                    ).length;

                sectorStocks.sort(
                    (a, b) =>
                        b._return -
                        a._return
                );

                return {
                    sector,
                    stocks: sectorStocks,
                    average,
                    positivePct:
                        (
                            positiveCount /
                            sectorStocks.length
                        ) *
                        100
                };
            }
        )
        .filter(Boolean)
        .sort(
            (a, b) =>
                b.average -
                a.average
        );

    return sectorResults.slice(0, 2);
}


function renderTopSectorPanels() {

    const container =
        document.getElementById(
            "topSectorPanels"
        );

    if (!container) {
        return;
    }

    const topSectors =
        getTopSectorData(
            topSectorPeriod
        );

    if (!topSectors.length) {

        container.innerHTML = `
            <div class="top-sector-empty">
                No sector data available.
            </div>
        `;

        return;
    }

    container.innerHTML =
        topSectors
            .map(
                (sector, sectorIndex) =>
                    renderTopSectorPanel(
                        sector,
                        sectorIndex
                    )
            )
            .join("");
}


function renderTopSectorPanel(
    sector,
    sectorIndex
) {

    const medals = [
        "🥇",
        "🥈"
    ];

    const rows =
        sector.stocks
            .slice(0, 10)
            .map(
                (stock, index) => {

                    const value =
                        stock._return;

                    const chartUrl =
                        "https://chartink.com/stocks/" +
                        encodeURIComponent(
                            stock.Symbol
                        ) +
                        ".html";

                    const symbolUpper =
                        String(stock.Symbol || "")
                            .trim()
                            .toUpperCase();

                    const isFav =
                        favorites.has(symbolUpper);

                    return `
                        <tr>
                            <td class="top-rank">
                                ${index + 1}
                            </td>

                            <td>
                                <span class="stock-link-with-favorite">
                                    <button
                                        type="button"
                                        class="favorite-star-button ${isFav ? "is-favorite" : ""}"
                                        data-favorite-symbol="${escapeHtml(symbolUpper)}"
                                        title="${isFav ? "Edit favorite" : "Add to favorites"}"
                                        aria-label="${isFav ? "Edit favorite" : "Add to favorites"} ${escapeHtml(symbolUpper)}"
                                    >${isFav ? "★" : "☆"}</button>
                                    <a
                                        class="top-stock-symbol"
                                    href="${chartUrl}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    ${escapeHtml(
                                        stock.Symbol
                                    )}
                                    </a>
                                </span>
                            </td>

                            <td
                                class="
                                    numeric
                                    ${(
                                        value >= 0
                                            ? "positive"
                                            : "negative"
                                    )}
                                "
                            >
                                ${formatPercent(
                                    value
                                )}
                            </td>

                            <td>
                                <a
                                    class="top-chart-link"
                                    href="${chartUrl}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label="Open Chartink chart for ${escapeHtml(
                                        stock.Symbol
                                    )}"
                                >
                                    Chart
                                </a>
                            </td>
                        </tr>
                    `;
                }
            )
            .join("");

    return `
        <div class="top-sector-panel">

            <div class="top-sector-panel-header">

                <div class="top-sector-title-wrap">

                    <div class="top-sector-rank">
                        ${medals[sectorIndex]}
                        #${sectorIndex + 1}
                    </div>

                    <div class="top-sector-name">
                        ${escapeHtml(
                            sector.sector
                        )}
                    </div>

                </div>

                <div class="top-sector-average ${(
                    sector.average >= 0
                        ? "positive"
                        : "negative"
                )}">
                    ${formatPercent(
                        sector.average
                    )}
                    <span>
                        avg
                    </span>
                </div>

            </div>

            <div class="top-sector-meta">
                <span>
                    ${sector.stocks.length}
                    stocks
                </span>

                <span>
                    ${formatPercent(
                        sector.positivePct
                    )} positive
                </span>
            </div>

            <div class="top-sector-table-wrap">

                <table
                    class="top-sector-table"
                >
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Stock</th>
                            <th class="numeric">
                                ${escapeHtml(
                                    topSectorPeriod
                                )}
                            </th>
                            <th></th>
                        </tr>
                    </thead>

                    <tbody>
                        ${rows}
                    </tbody>
                </table>

            </div>

        </div>
    `;
}


function injectTopSectorStyles() {

    if (
        document.getElementById(
            "topSectorStocksStyles"
        )
    ) {
        return;
    }

    const style =
        document.createElement("style");

    style.id =
        "topSectorStocksStyles";

    style.textContent = `
        .top-sector-stocks-section {
            margin-top: 34px;
        }

        .top-sector-tabs {
            display: flex;
            gap: 7px;
            flex-wrap: wrap;
            margin-bottom: 13px;
        }

        .top-sector-tab {
            height: 36px;
            padding: 0 15px;

            border: 1px solid rgba(255,255,255,.1);
            border-radius: 999px;

            background: rgba(255,255,255,.045);
            color: #8890a8;

            font-size: 12px;
            font-weight: 700;

            transition:
                background .15s ease,
                color .15s ease,
                border-color .15s ease,
                transform .15s ease;
        }

        .top-sector-tab:hover {
            border-color: rgba(69,230,209,.4);
            color: #45e6d1;
            transform: translateY(-1px);
        }

        .top-sector-tab.active {
            background: linear-gradient(120deg,#45e6d1,#b6ff4d);
            border-color: transparent;
            color: #04120f;
        }

        .top-sector-panels {
            display: grid;
            grid-template-columns:
                repeat(2, minmax(0, 1fr));
            gap: 14px;
        }

        .top-sector-panel {
            background: linear-gradient(165deg,rgba(255,255,255,.055),rgba(255,255,255,.015));
            backdrop-filter: blur(22px);
            -webkit-backdrop-filter: blur(22px);
            border: 1px solid rgba(255,255,255,.08);
            border-radius: 16px;
            overflow: hidden;
            box-shadow:
                0 10px 34px
                rgba(0,0,0,.45);
        }

        .top-sector-panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 15px;

            padding: 17px 18px 9px;
        }

        .top-sector-title-wrap {
            min-width: 0;
        }

        .top-sector-rank {
            color: #8890a8;
            font-size: 10px;
            font-weight: 800;
            margin-bottom: 5px;
        }

        .top-sector-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;

            color: #f3f6fc;
            font-size: 17px;
            font-weight: 850;
            letter-spacing: -.02em;
        }

        .top-sector-average {
            flex-shrink: 0;

            font-size: 22px;
            font-weight: 850;
            letter-spacing: -.03em;
        }

        .top-sector-average span {
            color: #7c85a0;
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0;
        }

        .top-sector-meta {
            display: flex;
            justify-content: space-between;

            padding: 0 18px 12px;

            color: #8890a8;
            font-size: 11px;
        }

        .top-sector-table-wrap {
            overflow-x: auto;
            border-top: 1px solid rgba(255,255,255,.07);
        }

        .top-sector-table {
            width: 100%;
            min-width: 380px;

            border-collapse: collapse;
            table-layout: fixed;
        }

        .top-sector-table th {
            position: static;

            padding: 8px 10px;

            background: rgba(255,255,255,.035);
            border-bottom: 1px solid rgba(255,255,255,.08);

            color: #8890a8;
            font-size: 9px;
            font-weight: 800;
            text-align: left;
        }

        .top-sector-table td {
            padding: 8px 10px;

            border-bottom: 1px solid rgba(255,255,255,.07);

            color: #c3cbdd;
            font-size: 11px;
            vertical-align: middle;
        }

        .top-sector-table tbody tr:last-child td {
            border-bottom: 0;
        }

        .top-sector-table tbody tr:hover {
            background: rgba(69,230,209,.06);
        }

        .top-sector-table th:first-child,
        .top-sector-table td:first-child {
            width: 30px;
            color: #7c85a0;
            text-align: center;
        }

        .top-sector-table th:nth-child(2),
        .top-sector-table td:nth-child(2) {
            width: auto;
        }

        .top-sector-table th:nth-child(3),
        .top-sector-table td:nth-child(3) {
            width: 90px;
            text-align: right;
        }

        .top-sector-table th:nth-child(4),
        .top-sector-table td:nth-child(4) {
            width: 66px;
            text-align: center;
        }

        .top-sector-table .stock-link-with-favorite {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            min-width: 0;
        }

        .top-sector-table .favorite-star-button {
            flex: 0 0 auto;
        }

        .top-stock-symbol {
            display: inline-block;
            flex: 1 1 auto;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #b6ff4d;
            text-decoration: none;
            font-weight: 850;
        }

        .top-stock-symbol:hover {
            text-decoration: underline;
        }

        .top-company {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .top-chart-link {
            display: inline-flex;
            align-items: center;
            justify-content: center;

            height: 25px;
            padding: 0 8px;

            border: 1px solid rgba(255,255,255,.1);
            border-radius: 7px;

            color: #45e6d1;
            background: rgba(255,255,255,.045);

            text-decoration: none;

            font-size: 9px;
            font-weight: 700;
        }

        .top-chart-link:hover {
            background: rgba(69,230,209,.12);
            border-color: rgba(69,230,209,.4);
        }

        .top-sector-empty {
            padding: 30px;
            background: rgba(255,255,255,.045);
            border: 1px solid rgba(255,255,255,.08);
            border-radius: 14px;
            color: #8890a8;
            text-align: center;
        }

        @media (max-width: 900px) {
            .top-sector-panels {
                grid-template-columns: 1fr;
            }
        }

        @media (max-width: 560px) {
            .top-sector-tabs {
                overflow-x: auto;
                flex-wrap: nowrap;
                padding-bottom: 3px;
            }

            .top-sector-tab {
                flex-shrink: 0;
            }

            .top-sector-panel-header {
                align-items: flex-start;
            }

            .top-sector-average {
                font-size: 18px;
            }
        }
    `;

    document.head.appendChild(style);
}


function applyFilters() {

    const search =
        searchInput.value
            .trim()
            .toLowerCase();

    const selectedSector =
        sectorFilter.value;


    // --------------------------------------------------
    // STEP 1
    // Apply sector + search filters to original rows
    // --------------------------------------------------

    let matchingRows =
        stocks.filter(stock => {

            const symbol =
                String(
                    stock.Symbol || ""
                ).toLowerCase();

            const company =
                String(
                    stock["Company Name"] || ""
                ).toLowerCase();

            const sector =
                String(
                    stock.Sector || ""
                );

            const matchesSearch =
                !search ||
                symbol.includes(search) ||
                company.includes(search);

            const matchesSector =
                selectedSector === "ALL" ||
                sector === selectedSector;

            return (
                matchesSearch &&
                matchesSector
            );
        });


    // --------------------------------------------------
    // STEP 2
    // Combine duplicate stock memberships
    //
    // Example:
    // AEGISLOG niftyenergy
    // AEGISLOG niftyoilgas
    // AEGISLOG nifty500
    //
    // becomes ONE stock row.
    // --------------------------------------------------

    const stockMap = new Map();


    matchingRows.forEach(stock => {

        const key =
            stock["ISIN Code"] ||
            stock.Symbol;

        if (!key) {
            return;
        }


        if (!stockMap.has(key)) {

            stockMap.set(
                key,
                {
                    ...stock,

                    _sectors: new Set(
                        getAllStockSectors(stock)
                   )
                }
            );

        } else {

            const existing =
                stockMap.get(key);

            if (stock.Sector) {

                existing._sectors.add(
                    stock.Sector
                );

            }

        }

    });


    filteredStocks =
        Array.from(
            stockMap.values()
        ).map(stock => {

            return {
                ...stock,

                Sector:
                    Array.from(
                        stock._sectors
                    ).join(" • ")
            };

        });


    sortStocks();

    renderStockTable();
}


function sortStocks() {

    filteredStocks.sort(
        (a, b) => {

            let aValue;
            let bValue;

            if (sortColumn === "RS") {

                aValue =
                    Number(
                        a[
                            "Stock Relative Strength vs Nifty"
                        ]
                    );

                bValue =
                    Number(
                        b[
                            "Stock Relative Strength vs Nifty"
                        ]
                    );

            } else {

                aValue =
                    Number(
                        a[sortColumn]
                    );

                bValue =
                    Number(
                        b[sortColumn]
                    );
            }

            if (
                Number.isNaN(aValue)
            ) {
                aValue = -Infinity;
            }

            if (
                Number.isNaN(bValue)
            ) {
                bValue = -Infinity;
            }

            if (
                aValue === bValue
            ) {
                return 0;
            }

            const result =
                aValue > bValue
                    ? 1
                    : -1;

            return sortDirection === "asc"
                ? result
                : -result;
        }
    );
}


function renderStockTable() {

    const limit = filteredStocks.length;

    const rows =
        filteredStocks.slice(
            0,
            limit
        );

    if (!rows.length) {

        stockTableBody.innerHTML = `
            <tr>
                <td
                    colspan="12"
                    class="loading"
                >
                    No stocks match
                    your filters.
                </td>
            </tr>
        `;

        resultCount.textContent =
            "0 stocks";

        return;
    }

    stockTableBody.innerHTML =
        rows
            .map(
                (stock, index) => {

                    const rs =
                        Number(
                            stock[
                                "Stock Relative Strength vs Nifty"
                            ]
                        );

                    const chartUrl =
                        "https://chartink.com/stocks/" +
                        encodeURIComponent(
                            stock.Symbol
                        ) +
                        ".html";

                    // Get LTP and LTP change
                    const ltp = getLtp(stock);
                    const ltpChange = Number(stock["LTP Change %"]);

                    return `
                        <tr>

                            <td>
                                ${index + 1}
                            </td>

                            <td>
                                ${scannerStockLink(stock)}
                            </td>

                            <td
                                class="company-name"
                                title="${escapeHtml(
                                    stock[
                                        "Company Name"
                                    ] || ""
                                )}"
                            >
                                ${escapeHtml(
                                    stock[
                                        "Company Name"
                                    ] || "—"
                                )}
                            </td>

                            <td>
                                <span class="
                                    sector-tag
                                ">
                                    ${escapeHtml(
                                        stock.Sector
                                    )}
                                </span>
                            </td>

                            <td class="numeric">
                                ${formatPercent(
                                    Number(
                                        stock.Daily
                                    )
                                )}
                            </td>

                            <td class="numeric">
                                ${formatPercent(
                                    Number(
                                        stock.Weekly
                                    )
                                )}
                            </td>

                            <td class="numeric">
                                ${formatPercent(
                                    Number(
                                        stock["1M"]
                                    )
                                )}
                            </td>

                            <td class="numeric">
                                ${formatPercent(
                                    Number(
                                        stock["3M"]
                                    )
                                )}
                            </td>

                            <td class="numeric">
                                ${formatPercent(
                                    Number(
                                        stock["6M"]
                                    )
                                )}
                            </td>

                            <td class="numeric">
                                ${formatPercent(
                                    Number(
                                        stock.YTD
                                    )
                                )}
                            </td>

                            <td class="
                                numeric
                                ${valueClass(rs)}
                            ">
                                <strong>
                                    ${formatPercent(
                                        rs
                                    )}
                                </strong>
                            </td>

                            <td class="numeric ltp-cell">
                                <div class="ltp-price">
                                    ₹${formatLtp(ltp)}
                                </div>

                                ${
                                    Number.isFinite(ltpChange)
                                        ? `
                                            <div class="ltp-change ${(
                                                ltpChange >= 0
                                                    ? "positive"
                                                    : "negative"
                                            )}">
                                                ${
                                                    ltpChange >= 0
                                                        ? "+"
                                                        : ""
                                                }${ltpChange.toFixed(2)}%
                                            </div>
                                          `
                                        : ""
                                }
                            </td>

                            <td>
                                <a
                                    class="chart-link"
                                    href="${chartUrl}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Chart
                                </a>
                            </td>

                        </tr>
                    `;
                }
            )
            .join("");

    if (
        filteredStocks.length > limit
    ) {

        resultCount.textContent =
            `Showing ${limit.toLocaleString()} of ` +
            `${filteredStocks.length.toLocaleString()} stocks`;

    } else {

        resultCount.textContent =
            `${filteredStocks.length.toLocaleString()} stocks`;
    }
}


function formatPercent(value) {

    if (
        value === null ||
        value === undefined ||
        Number.isNaN(value) ||
        !Number.isFinite(value)
    ) {
        return "—";
    }

    const sign =
        value > 0
            ? "+"
            : "";

    return (
        sign +
        value.toFixed(2) +
        "%"
    );
}


function valueClass(value) {

    if (
        value === null ||
        value === undefined ||
        Number.isNaN(value) ||
        !Number.isFinite(value)
    ) {
        return "";
    }

    if (value > 0) {
        return "positive";
    }

    if (value < 0) {
        return "negative";
    }

    return "";
}


function escapeHtml(value) {

    return String(value)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


document
    .querySelectorAll(
        "th.sortable"
    )
    .forEach(
        header => {

            header.addEventListener(
                "click",
                () => {

                    const column =
                        header.dataset.sort;

                    if (
                        sortColumn ===
                        column
                    ) {

                        sortDirection =
                            sortDirection ===
                            "desc"
                                ? "asc"
                                : "desc";

                    } else {

                        sortColumn =
                            column;

                        sortDirection =
                            "desc";
                    }

                    sortStocks();

                    renderStockTable();
                }
            );
        }
    );


searchInput.addEventListener(
    "input",
    applyFilters
);


sectorFilter.addEventListener(
    "change",
    applyFilters
);


periodFilter.addEventListener(
    "change",
    () => {

        const period =
            periodFilter.value;

        if (period === "RS") {

            sortColumn = "RS";

        } else {

            sortColumn = period;

        }

        sortDirection = "desc";

        applyFilters();
    }
);


document
    .getElementById(
        "clearFilters"
    )
    .addEventListener(
        "click",
        () => {

            searchInput.value = "";

            sectorFilter.value =
                "ALL";

            periodFilter.value =
                "RS";

            sortColumn = "RS";

            sortDirection = "desc";

            applyFilters();
        }
    );

// ============================================================
// RS MOMENTUM + VOLUME SCANNER
// ============================================================

let volumeRatioFilter = 0;

function scannerNumber(value, decimals = 2) {

    const n = Number(value);

    if (!Number.isFinite(n)) {
        return "—";
    }

    return n.toFixed(decimals);
}


function scannerPercent(value) {

    const n = Number(value);

    if (!Number.isFinite(n)) {
        return "—";
    }

    const sign = n > 0 ? "+" : "";

    return `${sign}${n.toFixed(2)}%`;
}


function scannerLtp(value) {

    const n = Number(value);

    if (!Number.isFinite(n)) {
        return "—";
    }

    return "₹" + n.toLocaleString(
        "en-IN",
        {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }
    );
}


function scannerVolume(value) {

    const n = Number(value);

    if (!Number.isFinite(n)) {
        return "—";
    }

    if (n >= 10000000) {
        return `${(n / 10000000).toFixed(2)} Cr`;
    }

    if (n >= 100000) {
        return `${(n / 100000).toFixed(2)} L`;
    }

    if (n >= 1000) {
        return `${(n / 1000).toFixed(1)} K`;
    }

    return Math.round(n).toLocaleString("en-IN");
}


function scannerChangeClass(value) {

    const n = Number(value);

    if (!Number.isFinite(n)) {
        return "";
    }

    if (n > 0) {
        return "positive";
    }

    if (n < 0) {
        return "negative";
    }

    return "";
}


// ============================================================
// CHARTINK HELPER FUNCTIONS
// ============================================================

function getChartInkUrl(stock) {
    const symbol = String(
        stock["Symbol"] || ""
    ).trim().toUpperCase();

    if (!symbol) {
        return "#";
    }

    return `https://chartink.com/stocks/${encodeURIComponent(symbol)}.html`;
}


function chartButton(stock) {
    const symbol = String(
        stock["Symbol"] || ""
    ).trim().toUpperCase();

    if (!symbol) {
        return "—";
    }

    return `
        <a
            href="${getChartInkUrl(stock)}"
            target="_blank"
            rel="noopener noreferrer"
            class="scanner-chart-link"
            title="Open ${symbol} ChartInk chart"
        >
            Chart
        </a>
    `;
}


function scannerStockLink(stock) {

    const symbolRaw =
        String(stock.Symbol || "")
            .trim()
            .toUpperCase();

    const symbol = escapeHtml(symbolRaw);
    const isFavorite = favorites.has(symbolRaw);

    return `
        <span class="stock-link-with-favorite">

            <button
                type="button"
                class="favorite-star-button ${isFavorite ? "is-favorite" : ""}"
                data-favorite-symbol="${symbol}"
                title="${isFavorite ? "Edit favorite" : "Add to favorites"}"
                aria-label="${isFavorite ? "Edit favorite" : "Add to favorites"} ${symbol}"
            >${isFavorite ? "★" : "☆"}</button>

            <button
                type="button"
                class="scanner-stock-history-link"
                onclick="openRSHistoryModal('${symbol}')"
                title="View last 10 trading days RS"
            >
                ${symbol}
            </button>

        </span>
    `;
}


document.addEventListener(
    "click",
    event => {

        const star =
            event.target.closest(
                ".favorite-star-button"
            );

        if (!star) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const symbol =
            star.dataset.favoriteSymbol;

        if (!symbol) {
            return;
        }

        openFavoriteReasonModal(symbol);
    },
    true
);


async function loadFavorites() {

    if (!FAVORITES_API_URL || FAVORITES_API_URL.includes("PASTE_GOOGLE")) {
        return;
    }

    try {
        const response = await fetch(
            FAVORITES_API_URL + "?action=list&v=" + Date.now(),
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error("Favorites API request failed");
        }

        const data = await response.json();
        favorites = new Map();

        (data.favorites || []).forEach(item => {
            const symbol = String(item.symbol || "").trim().toUpperCase();
            if (symbol) {
                favorites.set(symbol, item);
            }
        });

    } catch (error) {
        console.error("Unable to load favorites:", error);
    }
}


async function saveFavorite(favorite) {

    if (!FAVORITES_API_URL || FAVORITES_API_URL.includes("PASTE_GOOGLE")) {
        alert("Please configure the Google Apps Script URL first.");
        return false;
    }

    const response = await fetch(FAVORITES_API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "save", favorite })
    });

    if (!response.ok) {
        throw new Error("Unable to save favorite");
    }

    const data = await response.json();
    if (!data.ok) {
        throw new Error(data.error || "Unable to save favorite");
    }

    const saved = data.favorite || favorite;
    favorites.set(
        String(saved.symbol).trim().toUpperCase(),
        saved
    );

    return true;
}


async function removeFavorite(symbol) {

    if (!FAVORITES_API_URL || FAVORITES_API_URL.includes("PASTE_GOOGLE")) {
        alert("Please configure the Google Apps Script URL first.");
        return false;
    }

    const response = await fetch(FAVORITES_API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
            action: "remove",
            symbol: symbol
        })
    });

    if (!response.ok) {
        throw new Error("Unable to remove favorite");
    }

    const data = await response.json();
    if (!data.ok) {
        throw new Error(data.error || "Unable to remove favorite");
    }

    favorites.delete(symbol);
    return true;
}


function openFavoriteReasonModal(symbol) {

    const stock = stocks.find(
        item => String(item.Symbol || "").trim().toUpperCase() === String(symbol).trim().toUpperCase()
    );

    if (!stock) {
        return;
    }

    favoriteEditingSymbol = String(symbol).trim().toUpperCase();
    const existing = favorites.get(favoriteEditingSymbol) || {};
    const selected = new Set(existing.reasons || []);

    let modal = document.getElementById("favoriteReasonModal");

    if (!modal) {
        modal = document.createElement("div");
        modal.id = "favoriteReasonModal";
        modal.className = "favorite-modal";
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="favorite-modal-backdrop" onclick="closeFavoriteReasonModal()"></div>
        <div class="favorite-modal-card" role="dialog" aria-modal="true" aria-labelledby="favoriteModalTitle">
            <button type="button" class="favorite-modal-close" onclick="closeFavoriteReasonModal()">×</button>
            <div class="favorite-modal-eyebrow">FAVORITE STOCK</div>
            <h3 id="favoriteModalTitle">⭐ ${escapeHtml(favoriteEditingSymbol)}</h3>
            <p class="favorite-modal-company">${escapeHtml(stock["Company Name"] || "")}</p>

            <div class="favorite-reason-title">Why are you adding it?</div>
            <div class="favorite-reason-grid">
                ${FAVORITE_REASONS.map(reason => `
                    <label class="favorite-reason-option">
                        <input type="checkbox" value="${escapeHtml(reason)}" ${selected.has(reason) ? "checked" : ""}>
                        <span>${escapeHtml(reason)}</span>
                    </label>
                `).join("")}
            </div>

            <label class="favorite-notes-label">Notes (optional)
                <textarea id="favoriteNotes" rows="3" placeholder="Your entry plan / observation..."></textarea>
            </label>

            <div class="favorite-modal-actions">
                <button type="button" class="favorite-cancel-button" onclick="closeFavoriteReasonModal()">Cancel</button>
                <button type="button" class="favorite-save-button" onclick="submitFavoriteReasonModal()">Save Favorite</button>
            </div>
        </div>
    `;

    const notes = modal.querySelector("#favoriteNotes");
    if (notes) notes.value = existing.notes || "";
    modal.classList.add("active");
}


function closeFavoriteReasonModal() {
    const modal = document.getElementById("favoriteReasonModal");
    if (modal) modal.classList.remove("active");
    favoriteEditingSymbol = "";
}


async function submitFavoriteReasonModal() {

    const modal = document.getElementById("favoriteReasonModal");
    if (!modal || !favoriteEditingSymbol) return;

    const stock = stocks.find(
        item => String(item.Symbol || "").trim().toUpperCase() === favoriteEditingSymbol
    );

    if (!stock) return;

    const reasons = Array.from(
        modal.querySelectorAll('input[type="checkbox"]:checked')
    ).map(input => input.value);

    if (!reasons.length) {
        alert("Please select at least one reason.");
        return;
    }

    const notes =
        modal.querySelector("#favoriteNotes")?.value.trim() || "";

    const saveButton =
        modal.querySelector(".favorite-save-button");

    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = "Saving...";
    }

    try {
        await saveFavorite({
            symbol: favoriteEditingSymbol,
            company: stock["Company Name"] || "",
            isin: stock["ISIN Code"] || "",
            reasons,
            notes
        });

        closeFavoriteReasonModal();
        renderTopSectorStocks();
        applyFilters();
        renderMomentumVolumeScanners();
        renderFavoritesTable();

    } catch (error) {
        console.error(error);
        alert("Unable to save favorite: " + error.message);
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = "Save Favorite";
        }
    }
}


function renderFavoritesTable() {

    const body =
        document.getElementById("favoritesBody");

    const count =
        document.getElementById("favoritesCount");

    if (!body) {
        return;
    }

    const rows =
        Array.from(favorites.values());

    if (count) {
        count.textContent = rows.length;
    }

    if (!rows.length) {

        body.innerHTML = `
            <tr>
                <td
                    colspan="11"
                    class="loading"
                >
                    No favorite stocks yet.
                    Click ☆ beside any stock to add one.
                </td>
            </tr>
        `;

        return;
    }

    body.innerHTML =
        rows.map(
            (favorite, index) => {

                const symbol =
                    String(
                        favorite.symbol || ""
                    )
                    .trim()
                    .toUpperCase();

                const stock =
                    stocks.find(
                        item =>
                            String(
                                item.Symbol || ""
                            )
                            .trim()
                            .toUpperCase() ===
                            symbol
                    ) || {};

                const ltp =
                    getLtp(stock);

                const today =
                    Number(
                        stock["LTP Change %"]
                    );

                const rs =
                    Number(
                        stock[
                            "Stock Relative Strength vs Nifty"
                        ]
                    );

                const consistency =
                    Number(
                        stock["Consistency"]
                    );

                const rsDays =
                    Number(
                        stock["RS Data Days"]
                    );

                const reasons =
                    Array.isArray(
                        favorite.reasons
                    )
                        ? favorite.reasons
                        : [];

                return `
                    <tr>

                        <td>
                            ${index + 1}
                        </td>

                        <td>
                            ${scannerStockLink(stock)}
                        </td>

                        <td>
                            <span class="sector-tag">
                                ${escapeHtml(
                                    stock.Sector ||
                                    "—"
                                )}
                            </span>
                        </td>

                        <td class="numeric ltp-cell">
                            ${scannerLtp(ltp)}
                        </td>

                        <td
                            class="${scannerChangeClass(today)}"
                        >
                            ${scannerPercent(today)}
                        </td>

                        <td
                            class="${scannerChangeClass(rs)}"
                        >
                            ${scannerNumber(rs)}
                        </td>

                        <td>
                            ${
                                Number.isFinite(
                                    consistency
                                ) &&
                                Number.isFinite(
                                    rsDays
                                ) &&
                                rsDays > 1
                                    ? `${consistency}/${rsDays - 1}`
                                    : "—"
                            }
                        </td>

                        <td>
                            <div
                                class="favorite-reasons-list"
                            >
                                ${
                                    reasons.length
                                        ? reasons
                                            .map(
                                                reason =>
                                                    `<span class="favorite-reason-chip">${escapeHtml(reason)}</span>`
                                            )
                                            .join("")
                                        : "—"
                                }
                            </div>
                        </td>

                        <td
                            class="favorite-notes-cell"
                            title="${escapeHtml(
                                favorite.notes || ""
                            )}"
                        >
                            ${escapeHtml(
                                favorite.notes ||
                                "—"
                            )}
                        </td>

                        <td>
                            ${chartButton(stock)}
                        </td>

                        <td>
                            <button
                                type="button"
                                class="favorite-remove-button"
                                onclick="removeFavoriteFromTable('${escapeHtml(symbol)}')"
                            >
                                Remove
                            </button>
                        </td>

                    </tr>
                `;
            }
        )
        .join("");
}

async function removeFavoriteFromTable(symbol) {

    if (!confirm(`Remove ${symbol} from Favorites?`)) return;

    try {
        await removeFavorite(symbol);
        renderFavoritesTable();
        renderTopSectorStocks();
        applyFilters();
        renderMomentumVolumeScanners();
    } catch (error) {
        console.error(error);
        alert("Unable to remove favorite: " + error.message);
    }
}


/* NOTE: initFavoritesTab() used to attach a second, redundant
   click listener to every .scanner-tab that duplicated the
   "favorites" branch below — meaning clicking the Favorites tab
   rendered the table twice per click. Removed; the tab-switching
   listener directly below already handles it once. */



function openChartInk(symbol) {
    if (!symbol) return;

    const url =
        `https://chartink.com/stocks/${encodeURIComponent(symbol)}.html`;

    window.open(
        url,
        "_blank",
        "noopener,noreferrer"
    );
}

function getRsTrend(stock) {

    const history = Array.isArray(
        stock["RS History"]
    )
        ? stock["RS History"]
        : [];

    const values = history
        .map(x => Number(x.rs))
        .filter(Number.isFinite);

    if (values.length < 2) {
        return "—";
    }

    const last = values[values.length - 1];
    const first = values[0];

    if (last > first) {
        return "↗";
    }

    if (last < first) {
        return "↘";
    }

    return "→";
}


function getConsistencyText(stock) {

    const consistency =
        Number(stock["Consistency"]);

    const days =
        Number(stock["RS Data Days"]);

    if (
        !Number.isFinite(consistency)
        ||
        !Number.isFinite(days)
        ||
        days < 2
    ) {
        return "—";
    }

    return `${consistency}/${days - 1}`;
}


function getUniqueScannerStocks() {

    const seen = new Set();

    return stocks.filter(stock => {

        // Prefer ISIN because it is the most reliable
        // unique identifier for the actual stock.
        const isin =
            String(
                stock["ISIN Code"] || ""
            ).trim();

        const symbol =
            String(
                stock["Symbol"] || ""
            ).trim()
            .toUpperCase();

        const key =
            isin
                ? `ISIN:${isin}`
                : `SYMBOL:${symbol}`;

        if (!key || key === "SYMBOL:") {
            return false;
        }

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);

        return true;
    });
}

function renderRSMomentumScanner() {

    const body =
        document.getElementById(
            "rsMomentumBody"
        );

    if (!body) {
        return;
    }

    const uniqueStocks =
        getUniqueScannerStocks();

    const valid = uniqueStocks
        .filter(stock =>
            Number.isFinite(
                Number(
                    stock["Stock Relative Strength vs Nifty"]
                )
            )
        )
        .sort(
            (a, b) =>
                Number(
                    b["RS Momentum Score"] ?? -Infinity
                )
                -
                Number(
                    a["RS Momentum Score"] ?? -Infinity
                )
        );

    const top = valid.slice(0, 50);

    const momentumCount =
        valid.filter(
            stock =>
                Number(
                    stock["RS Momentum Score"]
                ) > 0
        ).length;

    const consistentCount =
        valid.filter(
            stock =>
                Number(
                    stock["Consistency"]
                ) >= 5
        ).length;

    const countEl =
        document.getElementById(
            "momentumStockCount"
        );

    const positiveEl =
        document.getElementById(
            "positiveMomentumCount"
        );

    const consistentEl =
        document.getElementById(
            "consistentStockCount"
        );

    if (countEl) {
        countEl.textContent =
            valid.length;
    }

    if (positiveEl) {
        positiveEl.textContent =
            momentumCount;
    }

    if (consistentEl) {
        consistentEl.textContent =
            consistentCount;
    }

    if (!top.length) {

        body.innerHTML = `
            <tr>
                <td
                    colspan="11"
                    class="loading"
                >
                    No RS momentum data available.
                </td>
            </tr>
        `;

        return;
    }

    body.innerHTML =
        top.map(
            (stock, index) => {

                const rs =
                    Number(
                        stock[
                            "Stock Relative Strength vs Nifty"
                        ]
                    );

                const change =
                    Number(
                        stock["10D RS Change"]
                    );

                const momentum =
                    Number(
                        stock["RS Momentum Score"]
                    );

                const ltpChange =
                    Number(
                        stock["LTP Change %"]
                    );

                return `
                    <tr>

                        <td>${index + 1}</td>

                        <td>
                            ${scannerStockLink(stock)}
                        </td>

                        <td>
                            ${stock["Company Name"] || "—"}
                        </td>

                        <td class="${scannerChangeClass(rs)}">
                            ${scannerNumber(rs)}
                        </td>

                        <td class="${scannerChangeClass(change)}">
                            ${scannerPercent(change)}
                        </td>

                        <td class="${scannerChangeClass(momentum)}">
                            ${scannerNumber(momentum)}
                        </td>

                        <td>
                            ${getConsistencyText(stock)}
                        </td>

                        <td class="rs-trend">
                            ${getRsTrend(stock)}
                        </td>

                        <td>
                            ${scannerLtp(stock.LTP)}
                        </td>

                        <td class="${scannerChangeClass(ltpChange)}">
                            ${scannerPercent(ltpChange)}
                        </td>

                        <td>
                            ${chartButton(stock)}
                        </td>

                    </tr>
                `;
            }
        ).join("");
}


function renderVolumeGainersScanner() {

    const body =
        document.getElementById(
            "volumeGainersBody"
        );

    if (!body) {
        return;
    }

    const uniqueStocks =
        getUniqueScannerStocks();

    const valid = uniqueStocks
        .filter(
            stock =>
                Number.isFinite(
                    Number(
                        stock["Volume Ratio"]
                    )
                )
        )
        .sort(
            (a, b) =>
                Number(
                    b["Volume Ratio"]
                )
                -
                Number(
                    a["Volume Ratio"]
                )
        );

    let top;

    if (volumeRatioFilter === 2) {

        top = valid.filter(
            stock =>
                Number(
                    stock["Volume Ratio"]
                ) >= 2
        );

    } else if (volumeRatioFilter === 3) {

        top = valid.filter(
            stock =>
                Number(
                    stock["Volume Ratio"]
                ) >= 3
        );

    } else {

        top = valid.slice(0, 50);

    }

    const highVolume =
        valid.filter(
            stock =>
                Number(
                    stock["Volume Ratio"]
                ) >= 2
        ).length;

    const veryHighVolume =
        valid.filter(
            stock =>
                Number(
                    stock["Volume Ratio"]
                ) >= 3
        ).length;

    document.getElementById(
        "volumeStockCount"
    ).textContent = valid.length;

    document.getElementById(
        "highVolumeCount"
    ).textContent = highVolume;

    document.getElementById(
        "veryHighVolumeCount"
    ).textContent = veryHighVolume;

    const highVolumeButton =
        document.getElementById(
            "highVolumeCount"
        );

    const veryHighVolumeButton =
        document.getElementById(
            "veryHighVolumeCount"
        );

    if (highVolumeButton) {

        highVolumeButton.classList.toggle(
            "active",
            volumeRatioFilter === 2
        );

        highVolumeButton.onclick = () => {

            volumeRatioFilter =
                volumeRatioFilter === 2
                    ? 0
                    : 2;

            renderVolumeGainersScanner();
        };
    }

    if (veryHighVolumeButton) {

        veryHighVolumeButton.classList.toggle(
            "active",
            volumeRatioFilter === 3
        );

        veryHighVolumeButton.onclick = () => {

            volumeRatioFilter =
                volumeRatioFilter === 3
                    ? 0
                    : 3;

            renderVolumeGainersScanner();
        };
    }

    if (!top.length) {

        body.innerHTML = `
            <tr>
                <td
                    colspan="11"
                    class="loading"
                >
                    No volume data available.
                </td>
            </tr>
        `;

        return;
    }

    body.innerHTML =
        top.map(
            (stock, index) => {

                const today =
                    Number(
                        stock["LTP Change %"]
                    );

                const ratio =
                    Number(
                        stock["Volume Ratio"]
                    );

                const volumeChange =
                    Number(
                        stock["Volume Change %"]
                    );

                const rs =
                    Number(
                        stock[
                            "Stock Relative Strength vs Nifty"
                        ]
                    );

                return `
                    <tr>

                        <td>${index + 1}</td>

                        <td>
                            ${scannerStockLink(stock)}
                        </td>

                        <td>
                            ${stock["Company Name"] || "—"}
                        </td>

                        <td>
                            ${scannerLtp(stock.LTP)}
                        </td>

                        <td class="${scannerChangeClass(today)}">
                            ${scannerPercent(today)}
                        </td>

                        <td>
                            ${scannerVolume(
                                stock["Today Volume"]
                            )}
                        </td>

                        <td>
                            ${scannerVolume(
                                stock["10D Average Volume"]
                            )}
                        </td>

                        <td>
                            <strong>
                                ${scannerNumber(ratio, 2)}x
                            </strong>
                        </td>

                        <td class="${scannerChangeClass(volumeChange)}">
                            ${scannerPercent(volumeChange)}
                        </td>

                        <td class="${scannerChangeClass(rs)}">
                            ${scannerNumber(rs)}
                        </td>

                        <td>
                            ${chartButton(stock)}
                        </td>

                    </tr>
                `;
            }
        ).join("");
}


function renderCombinedScanner() {

    const body =
        document.getElementById(
            "combinedScannerBody"
        );

    if (!body) {
        return;
    }

    const uniqueStocks =
        getUniqueScannerStocks();

    // ========================================================
    // ACTIONABLE RS + VOLUME CONDITIONS
    //
    // 1. Today's price change > 0
    // 2. 10D RS Change > 0
    // 3. RS Momentum Score > 0
    // 4. Volume Ratio >= 1.5x
    //
    // This identifies stocks where:
    // price is moving + RS is improving + volume is expanding
    // ========================================================

    const candidates =
        uniqueStocks.filter(stock => {

            const today =
                Number(
                    stock["LTP Change %"]
                );

            const rsChange =
                Number(
                    stock["10D RS Change"]
                );

            const momentum =
                Number(
                    stock["RS Momentum Score"]
                );

            const volumeRatio =
                Number(
                    stock["Volume Ratio"]
                );

            return (
                Number.isFinite(today)
                &&
                Number.isFinite(rsChange)
                &&
                Number.isFinite(momentum)
                &&
                Number.isFinite(volumeRatio)
                &&
                today > 0
                &&
                rsChange > 0
                &&
                momentum > 0
                &&
                volumeRatio >= 1.5
            );
        });


    // ========================================================
    // COMBINED SCORE
    //
    // Higher RS momentum + higher volume expansion
    // gets higher priority.
    //
    // Small price confirmation is also included.
    // ========================================================

    candidates.forEach(stock => {

        const momentum =
            Number(
                stock["RS Momentum Score"]
            );

        const volumeRatio =
            Number(
                stock["Volume Ratio"]
            );

        const today =
            Number(
                stock["LTP Change %"]
            );

        const rsChange =
            Number(
                stock["10D RS Change"]
            );

        stock._combinedScore =
            (
                momentum * 0.50
            )
            +
            (
                Math.log1p(volumeRatio) * 10 * 0.30
            )
            +
            (
                Math.max(rsChange, 0) * 0.15
            )
            +
            (
                Math.max(today, 0) * 0.05
            );
    });


    candidates.sort(
        (a, b) =>
            Number(
                b._combinedScore
            )
            -
            Number(
                a._combinedScore
            )
    );


    // ========================================================
    // SUMMARY
    // ========================================================

    const momentumCount =
        uniqueStocks.filter(
            stock =>
                Number(
                    stock["RS Momentum Score"]
                ) > 0
        ).length;


    const volumeCount =
        uniqueStocks.filter(
            stock =>
                Number(
                    stock["Volume Ratio"]
                ) >= 1.5
        ).length;


    const combinedCount =
        candidates.length;


    const combinedEl =
        document.getElementById(
            "combinedStockCount"
        );

    const momentumEl =
        document.getElementById(
            "combinedMomentumCount"
        );

    const volumeEl =
        document.getElementById(
            "combinedVolumeCount"
        );


    if (combinedEl) {
        combinedEl.textContent =
            combinedCount;
    }

    if (momentumEl) {
        momentumEl.textContent =
            momentumCount;
    }

    if (volumeEl) {
        volumeEl.textContent =
            volumeCount;
    }


    // ========================================================
    // NO RESULTS
    // ========================================================

    if (!candidates.length) {

        body.innerHTML = `
            <tr>
                <td
                    colspan="11"
                    class="loading"
                >
                    No RS + Volume candidates found.
                </td>
            </tr>
        `;

        return;
    }


    // Show top 50
    const top =
        candidates.slice(0, 50);


    body.innerHTML =
        top.map(
            (stock, index) => {

                const today =
                    Number(
                        stock["LTP Change %"]
                    );

                const rs =
                    Number(
                        stock[
                            "Stock Relative Strength vs Nifty"
                        ]
                    );

                const rsChange =
                    Number(
                        stock["10D RS Change"]
                    );

                const momentum =
                    Number(
                        stock["RS Momentum Score"]
                    );

                const volumeRatio =
                    Number(
                        stock["Volume Ratio"]
                    );

                const volumeChange =
                    Number(
                        stock["Volume Change %"]
                    );


                return `
                    <tr>

                        <td>
                            ${index + 1}
                        </td>


                        <td>
                            ${scannerStockLink(stock)}
                        </td>


                        <td>
                            ${stock["Company Name"] || "—"}
                        </td>


                        <td>
                            ${scannerLtp(
                                stock.LTP
                            )}
                        </td>


                        <td class="${scannerChangeClass(today)}">
                            ${scannerPercent(today)}
                        </td>


                        <td class="${scannerChangeClass(rs)}">
                            ${scannerNumber(rs)}
                        </td>


                        <td class="${scannerChangeClass(rsChange)}">
                            ${scannerPercent(rsChange)}
                        </td>


                        <td class="${scannerChangeClass(momentum)}">
                            ${scannerNumber(momentum)}
                        </td>


                        <td>
                            <strong>
                                ${scannerNumber(
                                    volumeRatio,
                                    2
                                )}x
                            </strong>
                        </td>


                        <td class="${scannerChangeClass(volumeChange)}">
                            ${scannerPercent(
                                volumeChange
                            )}
                        </td>


                        <td>
                            ${chartButton(stock)}
                        </td>

                    </tr>
                `;
            }
        ).join("");


    // Remove temporary ranking property
    candidates.forEach(
        stock => {
            delete stock._combinedScore;
        }
    );
}


function renderMomentumVolumeScanners() {

    renderRSMomentumScanner();

    renderVolumeGainersScanner();

    renderCombinedScanner();
}


// ------------------------------------------------------------
// Scanner tab switching
// ------------------------------------------------------------

document.querySelectorAll(
    ".scanner-tab"
).forEach(
    button => {

        button.addEventListener(
            "click",
            () => {

                document.querySelectorAll(
                    ".scanner-tab"
                ).forEach(
                    item =>
                        item.classList.remove(
                            "active"
                        )
                );

                document.querySelectorAll(
                    ".scanner-panel"
                ).forEach(
                    panel =>
                        panel.classList.remove(
                            "active"
                        )
                );

                button.classList.add(
                    "active"
                );

                const scanner =
                    button.dataset.scanner;

                if (scanner === "momentum") {

                    document.getElementById(
                        "rsMomentumPanel"
                    ).classList.add(
                        "active"
                    );

                }

                if (scanner === "volume") {

                    document.getElementById(
                        "volumeGainersPanel"
                    ).classList.add(
                        "active"
                    );

                }

                if (scanner === "combined") {

                    document.getElementById(
                        "combinedScannerPanel"
                    ).classList.add(
                        "active"
                    );

                }

                if (scanner === "favorites") {

                    document.getElementById(
                        "favoritesPanel"
                    ).classList.add(
                        "active"
                    );

                    renderFavoritesTable();

                }

            }
        );
    }
);

/* ============================================================
   10 DAY RS HISTORY
   ============================================================ */

function openRSHistoryModal(symbol) {

    const modal =
        document.getElementById(
            "rsHistoryModal"
        );

    if (!modal) {
        return;
    }

    const stock =
        getUniqueScannerStocks()
            .find(
                item =>
                    String(item.Symbol)
                        .toUpperCase() ===
                    String(symbol)
                        .toUpperCase()
            );

    if (!stock) {
        console.warn(
            "Stock not found:",
            symbol
        );

        return;
    }

    renderRSHistoryModal(stock);

    modal.classList.add("active");

    document.body.style.overflow = "hidden";
}


function closeRSHistoryModal() {

    const modal =
        document.getElementById(
            "rsHistoryModal"
        );

    if (!modal) {
        return;
    }

    modal.classList.remove("active");

    document.body.style.overflow = "";
}


function renderRSHistoryModal(stock) {

    const history =
        Array.isArray(
            stock["RS History"]
        )
            ? stock["RS History"]
            : [];

    if (!history.length) {
        return;
    }

    /*
     * IMPORTANT:
     * Sort by actual trading date.
     * We do NOT generate calendar dates.
     */

    const sortedHistory =
        [...history]
            .filter(
                item =>
                    item &&
                    item.date &&
                    Number.isFinite(
                        Number(item.rs)
                    )
            )
            .sort(
                (a, b) =>
                    new Date(a.date) -
                    new Date(b.date)
            )
            .slice(-10);


    const title =
        document.getElementById(
            "rsHistoryTitle"
        );

    if (title) {

        title.textContent =
            `${stock.Symbol} — 10 Day RS`;
    }


    const values =
        sortedHistory.map(
            item =>
                Number(item.rs)
        );


    const latest =
        values.length
            ? values[values.length - 1]
            : null;

    const oldest =
        values.length
            ? values[0]
            : null;

    const highest =
        values.length
            ? Math.max(...values)
            : null;

    const lowest =
        values.length
            ? Math.min(...values)
            : null;

    const average =
        values.length
            ? values.reduce(
                (sum, value) =>
                    sum + value,
                0
              ) / values.length
            : null;


    const tenDayChange =
        latest !== null &&
        oldest !== null
            ? latest - oldest
            : null;


    setRSHistoryValue(
        "rsHistoryChange",
        tenDayChange
    );

    setRSHistoryValue(
        "rsHistoryHigh",
        highest
    );

    setRSHistoryValue(
        "rsHistoryLow",
        lowest
    );

    setRSHistoryValue(
        "rsHistoryAverage",
        average
    );


    renderRSHistoryChart(
        sortedHistory
    );


    const body =
        document.getElementById(
            "rsHistoryBody"
        );

    if (!body) {
        return;
    }


    body.innerHTML =
        sortedHistory
            .slice()
            .reverse()
            .map(
                (item, index, arr) => {

                    const rs =
                        Number(item.rs);

                    const previous =
                        index <
                        arr.length - 1
                            ? Number(
                                arr[index + 1].rs
                              )
                            : null;

                    const change =
                        previous !== null
                            ? rs - previous
                            : null;

                    const changeClass =
                        change > 0
                            ? "rs-history-positive"
                            : change < 0
                                ? "rs-history-negative"
                                : "";


                    return `
                        <tr>

                            <td>
                                ${formatRSHistoryDate(
                                    item.date
                                )}
                            </td>

                            <td>
                                ${rs.toFixed(2)}
                            </td>

                            <td
                                class="${changeClass}"
                            >
                                ${
                                    change === null
                                        ? "—"
                                        : formatRSHistoryChange(
                                            change
                                          )
                                }
                            </td>

                        </tr>
                    `;
                }
            )
            .join("");
}


function setRSHistoryValue(
    elementId,
    value
) {

    const element =
        document.getElementById(
            elementId
        );

    if (!element) {
        return;
    }

    if (
        value === null ||
        value === undefined ||
        !Number.isFinite(
            Number(value)
        )
    ) {

        element.textContent = "—";

        element.className = "";

        return;
    }

    element.textContent =
        Number(value).toFixed(2);

    element.className =
        value > 0
            ? "rs-history-positive"
            : value < 0
                ? "rs-history-negative"
                : "";
}


function formatRSHistoryChange(
    value
) {

    const sign =
        value > 0
            ? "+"
            : "";

    return (
        sign +
        Number(value).toFixed(2)
    );
}


function formatRSHistoryDate(
    dateString
) {

    const date =
        new Date(
            dateString +
            "T00:00:00"
        );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return dateString;
    }

    return date.toLocaleDateString(
        "en-IN",
        {
            day: "2-digit",
            month: "short"
        }
    );
}


function renderRSHistoryChart(
    history
) {

    const chart =
        document.getElementById(
            "rsHistoryChart"
        );

    if (!chart) {
        return;
    }

    if (!history.length) {

        chart.innerHTML =
            "No RS history available.";

        return;
    }


    const values =
        history.map(
            item =>
                Number(item.rs)
        );


    const min =
        Math.min(...values);

    const max =
        Math.max(...values);

    const range =
        Math.max(
            max - min,
            1
        );


    chart.innerHTML =
        history
            .map(
                item => {

                    const value =
                        Number(item.rs);

                    const height =
                        15 +
                        (
                            (value - min) /
                            range
                        ) *
                        70;


                    return `
                        <div
                            class="rs-history-bar-wrap"
                        >

                            <span
                                class="rs-history-bar-value"
                                style="--bar-height:${height}%"
                            >
                                ${value.toFixed(1)}
                            </span>

                            <div
                                class="rs-history-bar"
                                style="height:${height}%"
                            ></div>

                            <span
                                class="rs-history-bar-date"
                            >
                                ${formatRSHistoryDate(
                                    item.date
                                )}
                            </span>

                        </div>
                    `;
                }
            )
            .join("");
}


/* ESC closes popup */

document.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Escape"
        ) {
            closeRSHistoryModal();
        }

    }
);

// Run scanner after data loading
const originalLoadData =
    loadData;

loadData = async function() {

    await originalLoadData();

    await loadFavorites();

    renderTopSectorStocks();
    applyFilters();
    renderMomentumVolumeScanners();
    renderFavoritesTable();

};

loadData();