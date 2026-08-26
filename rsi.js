const RSI_RESULTS_URL = "rsi/latest_results.json";

let rsiResults = [];
let rsiActiveTab = "SETUP";

function rsiEsc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function rsiNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(2) : "—";
}

function rsiSymbols(value) {
    return String(value || "")
        .split("|")
        .map(x => x.trim())
        .filter(Boolean);
}

function rsiSourceBadges(row) {
    const sources = rsiSymbols(row["Universe Sources"]);
    const periods = rsiSymbols(row["Universe Periods"]);

    return sources.map((source, i) => {
        const period = periods[i] || "";
        return `<span class="rsi-badge">${rsiEsc(source)}${period ? ` · ${rsiEsc(period)}` : ""}</span>`;
    }).join(" ");
}

function rsiFavorite(row) {
    const reasons = String(row["Favorite Reasons"] || "").trim();
    const notes = String(row["Favorite Notes"] || "").trim();

    if (!reasons && !notes) return "";

    return `
        <div class="rsi-favorite">
            ${reasons ? `<div><b>⭐</b> ${rsiEsc(reasons.replaceAll(" | ", " · "))}</div>` : ""}
            ${notes ? `<div class="rsi-note">📝 ${rsiEsc(notes)}</div>` : ""}
        </div>
    `;
}

function rsiChartLink(row) {
    const symbol = String(row.Symbol || "").trim().toUpperCase();
    const url = row["Chartink URL"] ||
        `https://chartink.com/stocks/${encodeURIComponent(symbol)}.html`;

    return `<a class="rsi-symbol" href="${rsiEsc(url)}" target="_blank" rel="noopener noreferrer">${rsiEsc(symbol)}</a>`;
}

function rsiCategory(row) {
    return String(row.Category || "").trim().toUpperCase();
}

function rsiRowsForTab(tab) {
    if (tab === "FAVORITES") {
        return rsiResults.filter(row =>
            String(row["Favorite Reasons"] || "").trim() ||
            String(row["Favorite Notes"] || "").trim()
        );
    }

    if (tab === "MONITORING") {
        return rsiResults.filter(row =>
            String(row["Monitoring Status"] || "").toUpperCase() === "MONITORING" ||
            String(row["Scan Mode"] || "").toUpperCase().includes("15M")
        );
    }

    return rsiResults.filter(row => rsiCategory(row) === tab);
}

function rsiRenderRows() {
    const body = document.getElementById("rsiTableBody");
    if (!body) return;

    const rows = rsiRowsForTab(rsiActiveTab);

    if (!rows.length) {
        body.innerHTML = `
            <tr>
                <td colspan="10" class="rsi-empty">
                    No ${rsiActiveTab.toLowerCase()} records found.
                </td>
            </tr>
        `;
        return;
    }

    body.innerHTML = rows.map((row, index) => {
        const category = rsiCategory(row);
        const reason = row.Reason || row.Signal || "—";
        const hourlyRsi = rsiNum(row["Current Hourly RSI"]);
        const weeklyRsi = rsiNum(row["Current Week RSI"]);
        const ltp = rsiNum(row["Current LTP"]);

        return `
            <tr>
                <td class="rsi-rank">${index + 1}</td>
                <td>${rsiChartLink(row)}</td>
                <td><span class="rsi-category rsi-${category.toLowerCase()}">${rsiEsc(category || "—")}</span></td>
                <td>${weeklyRsi}</td>
                <td>${hourlyRsi}</td>
                <td>${ltp}</td>
                <td>${rsiSourceBadges(row)}</td>
                <td>${rsiFavorite(row)}</td>
                <td class="rsi-reason">${rsiEsc(reason)}</td>
                <td>${rsiEsc(row["Scan Time"] || "")}</td>
            </tr>
        `;
    }).join("");
}

function rsiUpdateCounts() {
    const setup = rsiRowsForTab("SETUP").length;
    const watch = rsiRowsForTab("WATCH").length;
    const monitoring = rsiRowsForTab("MONITORING").length;
    const favorites = rsiRowsForTab("FAVORITES").length;

    const map = {
        rsiSetupCount: setup,
        rsiWatchCount: watch,
        rsiMonitoringCount: monitoring,
        rsiFavoritesCount: favorites,
        rsiTotalCount: rsiResults.length
    };

    Object.entries(map).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    });
}

function rsiActivateTab(tab) {
    rsiActiveTab = tab;

    document.querySelectorAll(".rsi-tab").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.rsiTab === tab
        );
    });

    rsiRenderRows();
}

async function loadRSITrading() {
    const body = document.getElementById("rsiTableBody");
    if (!body) return;

    try {
        const response = await fetch(
            `${RSI_RESULTS_URL}?v=${Date.now()}`
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        rsiResults = await response.json();

        rsiUpdateCounts();
        rsiRenderRows();

        const updated = document.getElementById("rsiLastUpdated");
        if (updated && rsiResults.length) {
            updated.textContent =
                rsiResults[0]["Scan Time"] || "Latest scan";
        }

    } catch (error) {
        console.error("RSI Trading load failed:", error);

        body.innerHTML = `
            <tr>
                <td colspan="10" class="rsi-empty">
                    Unable to load RSI data.
                </td>
            </tr>
        `;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".rsi-tab").forEach(button => {
        button.addEventListener("click", () => {
            rsiActivateTab(button.dataset.rsiTab);
        });
    });

    loadRSITrading();
});
