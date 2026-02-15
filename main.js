// main.js
(() => {
    const API_BASE = (window.API_BASE || "").replace(/\/+$/, "");
    const STORAGE = {
        HISTORY: "sa_history_v2",
        FAVS: "sa_favs_v2",
        RECENT: "sa_recent_v2",
        PREFS: "sa_prefs_v2",
    };
    const MAX_RECENT = 10;

    // DOM
    const yearEl = document.getElementById("year");
    const apiBaseText = document.getElementById("apiBaseText");

    const tabs = Array.from(document.querySelectorAll(".tab"));
    const panels = {
        analyzer: document.getElementById("panel-analyzer"),
        history: document.getElementById("panel-history"),
        about: document.getElementById("panel-about"),
    };

    const symbolInput = document.getElementById("symbolInput");
    const rangeSelect = document.getElementById("rangeSelect");
    const autoSaveSelect = document.getElementById("autoSaveSelect");

    const analyzeBtn = document.getElementById("analyzeBtn");
    const btnText = document.getElementById("btnText");
    const dot = document.getElementById("dot");

    const addFavBtn = document.getElementById("addFavBtn");
    const clearFavBtn = document.getElementById("clearFavBtn");
    const clearRecentBtn = document.getElementById("clearRecentBtn");

    const favList = document.getElementById("favList");
    const recentList = document.getElementById("recentList");

    const resultEmpty = document.getElementById("resultEmpty");
    const resultBox = document.getElementById("resultBox");
    const errorBox = document.getElementById("errorBox");

    const signalPill = document.getElementById("signalPill");
    const confidenceText = document.getElementById("confidenceText");
    const scoreText = document.getElementById("scoreText");
    const reasonsList = document.getElementById("reasonsList");

    const closeText = document.getElementById("closeText");
    const ma20Text = document.getElementById("ma20Text");
    const ma60Text = document.getElementById("ma60Text");
    const rsiText = document.getElementById("rsiText");
    const atrText = document.getElementById("atrText");
    const sourceText = document.getElementById("sourceText");

    const riskList = document.getElementById("riskList");

    const copyBtn = document.getElementById("copyBtn");
    const saveBtn = document.getElementById("saveBtn");

    const exportCsvBtn = document.getElementById("exportCsvBtn");
    const clearHistoryBtn = document.getElementById("clearHistoryBtn");
    const historyEmpty = document.getElementById("historyEmpty");
    const historyTableWrap = document.getElementById("historyTableWrap");
    const historyTbody = document.getElementById("historyTbody");

    // Charts
    const priceChartCanvas = document.getElementById("priceChart");
    const macdChartCanvas = document.getElementById("macdChart");
    const rsiChartCanvas = document.getElementById("rsiChart");
    let priceChart = null;
    let macdChart = null;
    let rsiChart = null;

    // Init
    yearEl.textContent = new Date().getFullYear();
    apiBaseText.textContent = API_BASE ? API_BASE : "（未設定，請到 config.js 設定 window.API_BASE）";

    // Load prefs
    const prefs = getJSON(STORAGE.PREFS, { range: "6mo", autosave: "on" });
    if (prefs.range) rangeSelect.value = prefs.range;
    if (prefs.autosave) autoSaveSelect.value = prefs.autosave;

    rangeSelect.addEventListener("change", () => {
        savePrefs();
    });
    autoSaveSelect.addEventListener("change", () => {
        savePrefs();
    });

    function savePrefs() {
        setJSON(STORAGE.PREFS, { range: rangeSelect.value, autosave: autoSaveSelect.value });
    }

    // Quick buttons
    document.querySelectorAll(".qbtn").forEach(btn => {
        btn.addEventListener("click", () => {
            const sym = btn.getAttribute("data-sym");
            symbolInput.value = sym;
            symbolInput.focus();
        });
    });

    // Tabs
    tabs.forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));
    function switchTab(name) {
        tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
        Object.entries(panels).forEach(([k, el]) => el.classList.toggle("active", k === name));
        if (name === "history") renderHistory();
    }

    // Storage initial render
    renderFavs();
    renderRecent();
    renderHistory();

    // Events
    analyzeBtn.addEventListener("click", onAnalyze);
    symbolInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") onAnalyze();
    });

    addFavBtn.addEventListener("click", () => {
        const sym = normalizeSymbol(symbolInput.value);
        if (!sym) return toast("請先輸入股票代號");
        addFavorite(sym);
        toast(`已加入收藏：${sym}`);
    });

    clearFavBtn.addEventListener("click", () => {
        setJSON(STORAGE.FAVS, []);
        renderFavs();
        toast("已清空收藏");
    });

    clearRecentBtn.addEventListener("click", () => {
        setJSON(STORAGE.RECENT, []);
        renderRecent();
        toast("已清空最近查詢");
    });

    copyBtn.addEventListener("click", () => {
        const txt = buildCopyText();
        if (!txt) return toast("沒有可複製的結果");
        navigator.clipboard.writeText(txt).then(() => toast("已複製到剪貼簿"));
    });

    saveBtn.addEventListener("click", () => {
        const last = window.__LAST_RESULT__;
        if (!last) return toast("目前沒有結果可以存");
        addHistory(last);
        toast("已存到歷史");
    });

    exportCsvBtn.addEventListener("click", exportHistoryCsv);
    clearHistoryBtn.addEventListener("click", () => {
        if (!confirm("確定要清除全部歷史？此操作無法復原。")) return;
        setJSON(STORAGE.HISTORY, []);
        renderHistory();
        toast("已清除歷史");
    });

    // Core analyze
    async function onAnalyze() {
        const sym = normalizeSymbol(symbolInput.value);
        if (!sym) return showError("請輸入股票代號（例：2330.TW 或 AAPL）");

        setLoading(true);
        hideError();
        hideResult();

        try {
            if (!API_BASE) {
                throw new Error("API_BASE 未設定。請在 config.js 設定 window.API_BASE 為 Render HTTPS 網址。");
            }

            const range = rangeSelect.value || "6mo";

            // 1) series for charts (required)
            const seriesUrl = `${API_BASE}/series?symbol=${encodeURIComponent(sym)}&range=${encodeURIComponent(range)}`;
            const seriesRes = await fetch(seriesUrl, { method: "GET" });
            if (!seriesRes.ok) {
                const t = await safeText(seriesRes);
                throw new Error(`Series 取得失敗：HTTP ${seriesRes.status}${t ? " - " + t : ""}`);
            }
            const series = await seriesRes.json();
            if (series.error) throw new Error(`Series 錯誤：${series.error}`);

            // 2) analyze (optional)
            let analysis = null;
            try {
                const analyzeUrl = `${API_BASE}/analyze?symbol=${encodeURIComponent(sym)}`;
                const analyzeRes = await fetch(analyzeUrl, { method: "GET" });
                if (analyzeRes.ok) analysis = await analyzeRes.json();
            } catch (_) {
                // ignore - we will use fallback logic
            }

            const mapped = mapResult(sym, range, series, analysis);

            renderResult(mapped);
            renderCharts(series);

            addRecent(sym);

            if ((autoSaveSelect.value || "on") === "on") {
                addHistory(mapped, { dedupeBySameMinute: true });
            }

            renderFavs();
            renderRecent();

        } catch (err) {
            showError(prettyError(err));
        } finally {
            setLoading(false);
        }
    }

    // Map / fallback scoring
    function mapResult(symbol, range, series, analysis) {
        const now = new Date();
        const lastIdx = (series.close && series.close.length) ? series.close.length - 1 : -1;

        const close = lastIdx >= 0 ? series.close[lastIdx] : null;
        const ma20 = lastIdx >= 0 && series.ma20 ? series.ma20[lastIdx] : null;
        const ma60 = lastIdx >= 0 && series.ma60 ? series.ma60[lastIdx] : null;
        const rsi14 = lastIdx >= 0 && (series.rsi14 || series.rsi) ? (series.rsi14 || series.rsi)[lastIdx] : null;
        const atr14 = lastIdx >= 0 && series.atr14 ? series.atr14[lastIdx] : null;
        const dataSource = series.data_source || "";

        // If backend provides /analyze, prefer it
        if (analysis && (analysis.signal || analysis.score != null || analysis.confidence != null)) {
            return {
                ts: now.toISOString(),
                timeLocal: formatLocal(now),
                symbol: analysis.symbol || symbol,
                range,
                signal: String(analysis.signal || "WATCH").toUpperCase(),
                score: analysis.score ?? null,
                confidence: analysis.confidence ?? null,
                why: Array.isArray(analysis.why) ? analysis.why : [],
                risk_flags: Array.isArray(analysis.risk_flags) ? analysis.risk_flags : [],
                close: analysis.close ?? close,
                ma20: analysis.ma20 ?? ma20,
                ma60: analysis.ma60 ?? ma60,
                rsi14: analysis.rsi ?? rsi14,
                atr14: analysis.atr14 ?? atr14,
                data_source: analysis.data_source || dataSource,
            };
        }

        // Otherwise do a simple client-side scoring using last point
        const why = [];
        const risk_flags = [];
        let score = 0;

        if (close != null && ma20 != null) {
            if (close >= ma20) { score += 1; why.push("收盤價高於 MA20（短線偏多）"); }
            else { score -= 1; why.push("收盤價低於 MA20（短線偏空）"); }
        }

        if (close != null && ma60 != null) {
            if (close >= ma60) { score += 1; why.push("收盤價高於 MA60（中期偏多）"); }
            else { score -= 1; why.push("收盤價低於 MA60（中期偏空）"); }
        }

        if (ma20 != null && ma60 != null) {
            if (ma20 >= ma60) { score += 1; why.push("MA20 ≥ MA60（多頭排列傾向）"); }
            else { score -= 1; why.push("MA20 < MA60（空頭排列傾向）"); }
        }

        // RSI
        if (rsi14 != null) {
            if (rsi14 < 30) { score += 1; why.push("RSI14 < 30（可能超賣，注意反彈）"); }
            else if (rsi14 > 70) { score -= 1; why.push("RSI14 > 70（可能超買，注意回檔）"); }
            else if (rsi14 >= 50) { score += 1; why.push("RSI14 ≥ 50（動能偏多）"); }
            else { score -= 1; why.push("RSI14 < 50（動能偏空）"); }
        }

        // MACD (if exists)
        if (series.macd && series.macd_signal && lastIdx >= 0) {
            const macd = series.macd[lastIdx];
            const sig = series.macd_signal[lastIdx];
            if (macd != null && sig != null) {
                if (macd >= sig) { score += 1; why.push("MACD ≥ Signal（動能偏多）"); }
                else { score -= 1; why.push("MACD < Signal（動能偏空）"); }
            }
        }

        // Bollinger (if exists)
        if (series.bb_upper && series.bb_lower && lastIdx >= 0 && close != null) {
            const up = series.bb_upper[lastIdx];
            const lo = series.bb_lower[lastIdx];
            if (up != null && lo != null) {
                if (close > up) { score -= 1; why.push("收盤價突破布林上軌（可能過熱）"); }
                else if (close < lo) { score += 1; why.push("收盤價跌破布林下軌（可能超跌）"); }
            }
        }

        // ATR risk flag
        if (atr14 != null && close != null && close !== 0) {
            const atrPct = atr14 / close;
            if (atrPct >= 0.05) risk_flags.push(`高波動（ATR/Close ${(atrPct * 100).toFixed(1)}%）`);
        }

        // signal mapping
        let signal = "WATCH";
        if (score >= 3) signal = "BUY";
        else if (score <= -3) signal = "SELL";

        // confidence: simple absolute-score scaling
        const confidence = Math.min(95, Math.max(40, 40 + Math.abs(score) * 12));

        return {
            ts: now.toISOString(),
            timeLocal: formatLocal(now),
            symbol,
            range,
            signal,
            score,
            confidence,
            why,
            risk_flags,
            close,
            ma20,
            ma60,
            rsi14,
            atr14,
            data_source: dataSource || "（未提供）",
        };
    }

    // Render result
    function renderResult(r) {
        window.__LAST_RESULT__ = r;

        resultEmpty.classList.add("hidden");
        resultBox.classList.remove("hidden");
        errorBox.classList.add("hidden");

        const s = (r.signal || "WATCH").toUpperCase();
        signalPill.textContent = s;
        signalPill.className = "pill " + (s === "BUY" ? "buy" : s === "SELL" ? "sell" : "watch");

        confidenceText.textContent = r.confidence ?? "--";
        scoreText.textContent = r.score ?? "--";

        reasonsList.innerHTML = "";
        const reasons = r.why && r.why.length ? r.why : ["（未提供理由）"];
        reasons.forEach(item => {
            const li = document.createElement("li");
            li.textContent = item;
            reasonsList.appendChild(li);
        });

        closeText.textContent = fmtNum(r.close, 2);
        ma20Text.textContent = fmtNum(r.ma20, 2);
        ma60Text.textContent = fmtNum(r.ma60, 2);
        rsiText.textContent = fmtNum(r.rsi14, 2);
        atrText.textContent = fmtNum(r.atr14, 2);
        sourceText.textContent = r.data_source || "--";

        // risk flags
        if (!r.risk_flags || !r.risk_flags.length) {
            riskList.className = "chips muted";
            riskList.textContent = "（無）";
        } else {
            riskList.className = "chips";
            riskList.innerHTML = "";
            r.risk_flags.forEach(x => {
                const span = document.createElement("span");
                span.className = "chip";
                span.textContent = x;
                riskList.appendChild(span);
            });
        }
    }

    function hideResult() {
        window.__LAST_RESULT__ = null;
        resultEmpty.classList.remove("hidden");
        resultBox.classList.add("hidden");
        destroyCharts();
    }

    function destroyCharts() {
        if (priceChart) { priceChart.destroy(); priceChart = null; }
        if (macdChart) { macdChart.destroy(); macdChart = null; }
        if (rsiChart) { rsiChart.destroy(); rsiChart = null; }
    }

    // Charts
    function renderCharts(series) {
        if (!window.Chart) return;
        const labels = series.t || [];
        const close = series.close || [];
        const ma20 = series.ma20 || [];
        const ma60 = series.ma60 || [];
        const bbU = series.bb_upper || series.bbUpper || [];
        const bbL = series.bb_lower || series.bbLower || [];

        const macd = series.macd || [];
        const macdSig = series.macd_signal || series.macdSignal || [];

        const rsi = series.rsi14 || series.rsi || [];

        destroyCharts();

        priceChart = new Chart(priceChartCanvas, {
            type: "line",
            data: {
                labels,
                datasets: [
                    { label: "Close", data: close, borderWidth: 2, pointRadius: 0, tension: 0.2 },
                    { label: "MA20", data: ma20, borderWidth: 1, pointRadius: 0, tension: 0.2 },
                    { label: "MA60", data: ma60, borderWidth: 1, pointRadius: 0, tension: 0.2 },
                    { label: "BB Upper", data: bbU, borderWidth: 1, pointRadius: 0, tension: 0.2 },
                    { label: "BB Lower", data: bbL, borderWidth: 1, pointRadius: 0, tension: 0.2 },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: { legend: { display: true } },
                scales: {
                    x: { ticks: { maxTicksLimit: 8 } },
                    y: { ticks: { maxTicksLimit: 6 } },
                },
            },
        });

        macdChart = new Chart(macdChartCanvas, {
            type: "line",
            data: {
                labels,
                datasets: [
                    { label: "MACD", data: macd, borderWidth: 2, pointRadius: 0, tension: 0.2 },
                    { label: "Signal", data: macdSig, borderWidth: 2, pointRadius: 0, tension: 0.2 },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: { legend: { display: true } },
                scales: {
                    x: { ticks: { maxTicksLimit: 8 } },
                    y: { ticks: { maxTicksLimit: 5 } },
                },
            },
        });

        rsiChart = new Chart(rsiChartCanvas, {
            type: "line",
            data: {
                labels,
                datasets: [
                    { label: "RSI14", data: rsi, borderWidth: 2, pointRadius: 0, tension: 0.2 },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: { legend: { display: true } },
                scales: {
                    x: { ticks: { maxTicksLimit: 8 } },
                    y: { min: 0, max: 100, ticks: { maxTicksLimit: 5 } },
                },
            },
        });
    }

    // Loading / Error
    function setLoading(isLoading) {
        analyzeBtn.disabled = isLoading;
        btnText.textContent = isLoading ? "分析中..." : "分析";
        dot.classList.toggle("on", isLoading);
    }

    function showError(msg) {
        errorBox.textContent = msg;
        errorBox.classList.remove("hidden");
    }
    function hideError() {
        errorBox.classList.add("hidden");
        errorBox.textContent = "";
    }

    // Toast
    function toast(msg) {
        let t = document.getElementById("toast");
        if (!t) {
            t = document.createElement("div");
            t.id = "toast";
            t.style.position = "fixed";
            t.style.left = "50%";
            t.style.bottom = "24px";
            t.style.transform = "translateX(-50%)";
            t.style.padding = "10px 12px";
            t.style.borderRadius = "999px";
            t.style.background = "rgba(15,23,42,.9)";
            t.style.color = "white";
            t.style.fontWeight = "900";
            t.style.boxShadow = "0 20px 50px rgba(0,0,0,.25)";
            t.style.opacity = "0";
            t.style.transition = "opacity .18s ease";
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.opacity = "1";
        clearTimeout(window.__TOAST_TIMER__);
        window.__TOAST_TIMER__ = setTimeout(() => (t.style.opacity = "0"), 2200);
    }

    // Favorites / Recent
    function addFavorite(sym) {
        const favs = getJSON(STORAGE.FAVS, []);
        if (!favs.includes(sym)) favs.unshift(sym);
        setJSON(STORAGE.FAVS, favs.slice(0, 30));
        renderFavs();
    }
    function removeFavorite(sym) {
        const favs = getJSON(STORAGE.FAVS, []).filter(x => x !== sym);
        setJSON(STORAGE.FAVS, favs);
        renderFavs();
    }
    function renderFavs() {
        const favs = getJSON(STORAGE.FAVS, []);
        if (!favs.length) {
            favList.className = "list muted";
            favList.textContent = "尚無收藏";
            return;
        }
        favList.className = "list";
        favList.innerHTML = "";
        favs.forEach(sym => {
            favList.appendChild(makeTag(sym, {
                rightLabel: "刪除",
                onClick: () => { symbolInput.value = sym; symbolInput.focus(); },
                onRight: () => { removeFavorite(sym); toast(`已移除收藏：${sym}`); }
            }));
        });
    }

    function addRecent(sym) {
        const list = getJSON(STORAGE.RECENT, []);
        const filtered = list.filter(x => x !== sym);
        filtered.unshift(sym);
        setJSON(STORAGE.RECENT, filtered.slice(0, MAX_RECENT));
        renderRecent();
    }

    function renderRecent() {
        const list = getJSON(STORAGE.RECENT, []);
        if (!list.length) {
            recentList.className = "list muted";
            recentList.textContent = "尚無紀錄";
            return;
        }
        recentList.className = "list";
        recentList.innerHTML = "";
        list.forEach(sym => {
            recentList.appendChild(makeTag(sym, {
                rightLabel: "帶入",
                onClick: () => { symbolInput.value = sym; symbolInput.focus(); },
                onRight: () => { symbolInput.value = sym; symbolInput.focus(); }
            }));
        });
    }

    function makeTag(text, { rightLabel, onClick, onRight }) {
        const wrap = document.createElement("div");
        wrap.className = "tag";
        wrap.title = "點擊帶入";

        const span = document.createElement("span");
        span.textContent = text;
        wrap.appendChild(span);

        const right = document.createElement("small");
        right.textContent = rightLabel || "";
        right.style.cursor = "pointer";
        right.addEventListener("click", (e) => {
            e.stopPropagation();
            onRight && onRight();
        });
        wrap.appendChild(right);

        wrap.addEventListener("click", () => onClick && onClick());
        return wrap;
    }

    // History
    function addHistory(item, opts = {}) {
        const hist = getJSON(STORAGE.HISTORY, []);
        const next = [...hist];

        if (opts.dedupeBySameMinute) {
            const key = dedupeKey(item);
            const exists = next.some(x => dedupeKey(x) === key);
            if (exists) {
                setJSON(STORAGE.HISTORY, next);
                renderHistory();
                return;
            }
        }

        next.unshift(item);
        setJSON(STORAGE.HISTORY, next.slice(0, 800));
        renderHistory();
    }

    function dedupeKey(x) {
        const d = new Date(x.ts);
        const minute = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
        return `${minute}|${x.symbol}|${x.range}|${x.signal}`;
    }

    function renderHistory() {
        const hist = getJSON(STORAGE.HISTORY, []);
        if (!hist.length) {
            historyEmpty.classList.remove("hidden");
            historyTableWrap.classList.add("hidden");
            historyTbody.innerHTML = "";
            return;
        }
        historyEmpty.classList.add("hidden");
        historyTableWrap.classList.remove("hidden");

        historyTbody.innerHTML = "";
        hist.forEach((h, idx) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td>${escapeHtml(h.timeLocal || formatLocal(new Date(h.ts)))}</td>
        <td><strong>${escapeHtml(h.symbol)}</strong></td>
        <td>${escapeHtml(h.range || "--")}</td>
        <td>${badge(h.signal)}</td>
        <td>${escapeHtml(String(h.confidence ?? "--"))}</td>
        <td>${escapeHtml(String(h.score ?? "--"))}</td>
        <td>${escapeHtml(fmtNum(h.close, 2))}</td>
        <td>${escapeHtml(fmtNum(h.ma20, 2))}</td>
        <td>${escapeHtml(fmtNum(h.ma60, 2))}</td>
        <td>${escapeHtml(fmtNum(h.rsi14, 2))}</td>
        <td>${escapeHtml(fmtNum(h.atr14, 2))}</td>
        <td>
          <button class="link" data-act="use" data-idx="${idx}">帶入</button>
          <button class="link danger" data-act="del" data-idx="${idx}">刪除</button>
        </td>
      `;
            historyTbody.appendChild(tr);
        });

        historyTbody.querySelectorAll("button[data-act]").forEach(btn => {
            btn.addEventListener("click", () => {
                const act = btn.getAttribute("data-act");
                const idx = Number(btn.getAttribute("data-idx"));
                const hist = getJSON(STORAGE.HISTORY, []);
                const item = hist[idx];
                if (!item) return;

                if (act === "use") {
                    switchTab("analyzer");
                    symbolInput.value = item.symbol;
                    rangeSelect.value = item.range || rangeSelect.value;
                    savePrefs();
                    symbolInput.focus();
                    toast(`已帶入：${item.symbol}（${item.range || ""}）`);
                }
                if (act === "del") {
                    hist.splice(idx, 1);
                    setJSON(STORAGE.HISTORY, hist);
                    renderHistory();
                    toast("已刪除一筆歷史");
                }
            });
        });
    }

    function exportHistoryCsv() {
        const hist = getJSON(STORAGE.HISTORY, []);
        if (!hist.length) return toast("目前沒有歷史可以匯出");

        const header = ["time", "symbol", "range", "signal", "confidence", "score", "close", "ma20", "ma60", "rsi14", "atr14", "data_source", "why", "risk_flags"];
        const rows = hist.map(h => [
            h.timeLocal || formatLocal(new Date(h.ts)),
            h.symbol,
            h.range || "",
            h.signal,
            h.confidence ?? "",
            h.score ?? "",
            h.close ?? "",
            h.ma20 ?? "",
            h.ma60 ?? "",
            h.rsi14 ?? "",
            h.atr14 ?? "",
            h.data_source ?? "",
            (Array.isArray(h.why) ? h.why.join(" | ") : ""),
            (Array.isArray(h.risk_flags) ? h.risk_flags.join(" | ") : ""),
        ]);

        const csv = [header, ...rows]
            .map(r => r.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(","))
            .join("\n");

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `stock_analyzer_history_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast("已開始下載 CSV");
    }

    // Helpers
    function normalizeSymbol(s) {
        if (!s) return "";
        return String(s).trim().toUpperCase();
    }

    function fmtNum(n, digits = 2) {
        if (n === null || n === undefined || n === "") return "--";
        const num = Number(n);
        if (!Number.isFinite(num)) return String(n);
        return num.toFixed(digits);
    }

    function prettyError(err) {
        const msg = (err && err.message) ? err.message : String(err);
        if (msg.includes("Failed to fetch")) {
            return "無法連線到後端 API。\n可能原因：\n- API_BASE 設錯（config.js）\n- Render 服務休眠中（首次喚醒要等一下）\n- 後端 CORS 未允許你的 GitHub Pages 網域\n- 網路阻擋/VPN\n\n請到 DevTools → Network 查看 Request URL / Status。";
        }
        return msg;
    }

    async function safeText(res) {
        try { return (await res.text()).slice(0, 200); } catch { return ""; }
    }

    function getJSON(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v ? JSON.parse(v) : fallback;
        } catch {
            return fallback;
        }
    }

    function setJSON(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function formatLocal(d) {
        const dt = (d instanceof Date) ? d : new Date(d);
        return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`;
    }

    function pad2(n) { return String(n).padStart(2, "0"); }

    function escapeHtml(s) {
        return String(s)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function badge(sig) {
        const s = String(sig || "WATCH").toUpperCase();
        const cls = s === "BUY" ? "buy" : s === "SELL" ? "sell" : "watch";
        return `<span class="pill ${cls}" style="padding:6px 10px; font-size:12px;">${escapeHtml(s)}</span>`;
    }

    function buildCopyText() {
        const r = window.__LAST_RESULT__;
        if (!r) return "";
        const lines = [
            `【Stock Analyzer】${r.symbol}（${r.range || ""}）`,
            `訊號：${r.signal}（信心度：${r.confidence ?? "--"}，分數：${r.score ?? "--"}）`,
            `收盤：${fmtNum(r.close, 2)}｜MA20：${fmtNum(r.ma20, 2)}｜MA60：${fmtNum(r.ma60, 2)}｜RSI：${fmtNum(r.rsi14, 2)}｜ATR：${fmtNum(r.atr14, 2)}`,
            `理由：${(r.why && r.why.length) ? r.why.join("；") : "（無）"}`,
            `風險：${(r.risk_flags && r.risk_flags.length) ? r.risk_flags.join("；") : "（無）"}`,
            `資料：${r.data_source || "--"}`,
            `時間：${r.timeLocal || formatLocal(new Date(r.ts))}`,
            `＊僅供教育與自用參考，非投資建議。`
        ];
        return lines.join("\n");
    }

})();