const numberFormat = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" });

function displayDate(isoDate) {
  if (!isoDate) return "—";
  const [year, month, day] = isoDate.split("-").map(Number);
  return dateFormat.format(new Date(Date.UTC(year, month - 1, day)));
}

function eventText(row) {
  if (row.action === "升息") return `升息 ${Math.abs(row.basisPoints)} bp`;
  if (row.action === "降息") return `降息 ${Math.abs(row.basisPoints)} bp`;
  return "維持利率";
}

function signed(value) {
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${numberFormat.format(number)}`;
}

function renderTable(scores) {
  const tbody = document.querySelector("#score-rows");
  const query = document.querySelector("#meeting-search").value.trim().toLocaleLowerCase("zh-TW");
  const rows = [...scores].reverse().filter((row) => {
    const haystack = [row.date, row.action, row.assetLabel, row.reason, row.dissentReason, eventText(row)].join(" ").toLocaleLowerCase("zh-TW");
    return haystack.includes(query);
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">沒有符合的會議</td></tr>';
  } else {
    tbody.innerHTML = rows.map((row) => {
      const reason = row.reason || "—";
      const dissent = row.dissentReason || "未偵測到可計分的利率異議";
      const link = row.statementUrl
        ? `<a class="statement-link" href="${escapeHtml(row.statementUrl)}" target="_blank" rel="noreferrer">聲明 ↗</a>`
        : "—";
      return `<tr>
        <td>${displayDate(row.date)}</td>
        <td><span class="action-text">${escapeHtml(eventText(row))}</span></td>
        <td class="numeric"><span class="component-value">${signed(row.weightedRate)}</span><span class="component-detail">${Math.abs(row.basisPoints)} bp · 訊號 ${signed(row.rateSignal)} × 3</span></td>
        <td class="numeric"><span class="component-value">${signed(row.weightedTone)}</span><span class="component-detail">toneAdj ${signed(row.toneAdj)} · 訊號 ${signed(row.toneSignal)}</span></td>
        <td><span class="component-value asset-label">${escapeHtml(row.assetLabel || "無新增動作")}</span><span class="component-detail">訊號 ${signed(row.assetSignal)} × 2 = ${signed(row.weightedAsset)}</span></td>
        <td title="${escapeHtml(dissent)}"><span class="dissent-summary">鷹派 ${numberFormat.format(row.dissentHawkishCount)} · 鴿派 ${numberFormat.format(row.dissentDovishCount)}</span><span class="component-detail dissent-adjustment">調整 ${signed(row.dissentAdj)}</span></td>
        <td class="numeric score-cell"><span class="score-value">${numberFormat.format(row.score)}</span><span class="component-detail">${row.clamped ? `截斷前 ${numberFormat.format(row.unclampedScore)}` : "0–10 分"}</span></td>
        <td class="reason-cell" title="${escapeHtml(reason)}">${escapeHtml(reason)}</td>
        <td>${link}</td>
      </tr>`;
    }).join("");
  }
  document.querySelector("#table-count").textContent = `顯示 ${rows.length} / ${scores.length} 場會議`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function createChart(dashboard) {
  if (!window.Chart) throw new Error("圖表元件載入失敗，請檢查網路連線後重新整理。");

  const scores = dashboard.scores;
  let scoreIndex = -1;
  const series = dashboard.yields.map((observation) => {
    while (scoreIndex + 1 < scores.length && scores[scoreIndex + 1].date <= observation.date) scoreIndex += 1;
    if (scoreIndex < 0) return null;
    const date = Date.parse(`${observation.date}T00:00:00Z`);
    const row = scores[scoreIndex];
    return { x: date, original: row.score, ma4: row.ma4, ma8: row.ma8, yield: observation.value };
  }).filter(Boolean);

  const chart = new Chart(document.querySelector("#score-chart"), {
    type: "line",
    data: {
      datasets: [
        { label: "原始分數", data: series.map((row) => ({ x: row.x, y: row.original })), yAxisID: "score", borderColor: "#2563eb", borderWidth: 1.35, borderDash: [5, 4], pointRadius: 0, stepped: "before", fill: false, order: 3 },
        { label: "4 次會議均線", data: series.map((row) => ({ x: row.x, y: row.ma4 })), yAxisID: "score", borderColor: "#0f9f9a", borderWidth: 2, pointRadius: 0, stepped: "before", fill: false, order: 2 },
        { label: "8 次會議均線", data: series.map((row) => ({ x: row.x, y: row.ma8 })), yAxisID: "score", borderColor: "#7c5ce7", borderWidth: 2, pointRadius: 0, stepped: "before", fill: false, order: 1 },
        { label: "2 年期殖利率", data: series.map((row) => ({ x: row.x, y: row.yield })), yAxisID: "yield", borderColor: "#e18a3b", borderWidth: 1.8, pointRadius: 0, tension: 0.12, fill: false, order: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      parsing: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        decimation: { enabled: true, algorithm: "lttb", samples: 1000 },
        tooltip: {
          backgroundColor: "#17253a",
          padding: 11,
          titleFont: { family: "DM Sans, Noto Sans TC, sans-serif", size: 11 },
          bodyFont: { family: "DM Sans, Noto Sans TC, sans-serif", size: 11 },
          callbacks: {
            title(items) { return items.length ? displayDate(new Date(items[0].parsed.x).toISOString().slice(0, 10)) : ""; },
            label(item) { return `${item.dataset.label}: ${numberFormat.format(item.parsed.y)}${item.dataset.yAxisID === "yield" ? "%" : ""}`; },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: "#8995a5",
            maxTicksLimit: 8,
            font: { family: "DM Sans, Noto Sans TC, sans-serif", size: 10 },
            callback(value) { return new Date(Number(value)).toISOString().slice(0, 7); },
          },
        },
        score: {
          type: "linear", position: "left", min: 0, max: 10,
          title: { display: true, text: "鷹鴿分數", color: "#7c8b9f", font: { size: 10 } },
          grid: { color: "#edf1f5", drawTicks: false },
          border: { display: false },
          ticks: { stepSize: 2, color: "#8995a5", padding: 9, font: { size: 10 } },
        },
        yield: {
          type: "linear", position: "right",
          title: { display: true, text: "殖利率（%）", color: "#7c8b9f", font: { size: 10 } },
          grid: { drawOnChartArea: false, drawTicks: false },
          border: { display: false },
          ticks: { color: "#8995a5", padding: 9, callback(value) { return `${numberFormat.format(value)}%`; }, font: { size: 10 } },
        },
      },
    },
  });

  const range = document.querySelector("#range-select");
  const updateRange = () => {
    const newest = series.at(-1).x;
    const years = range.value === "all" ? null : Number(range.value);
    chart.options.scales.x.min = years ? Date.UTC(new Date(newest).getUTCFullYear() - years, new Date(newest).getUTCMonth(), new Date(newest).getUTCDate()) : series[0].x;
    chart.options.scales.x.max = newest;
    chart.update("none");
  };
  range.addEventListener("change", updateRange);
  updateRange();
}

function populateSummary(dashboard) {
  const latestScore = dashboard.scores.at(-1);
  document.querySelector("#latest-score").textContent = numberFormat.format(latestScore.score);
  document.querySelector("#latest-meeting").textContent = `會議日期 ${displayDate(latestScore.date)} · 0–10 分`;
  const action = document.querySelector("#latest-action");
  action.textContent = latestScore.action;
  if (latestScore.action === "升息") action.classList.add("up");
  if (latestScore.action === "降息") action.classList.add("down");
  document.querySelector("#latest-yield").textContent = numberFormat.format(dashboard.metadata.latestYield);
  document.querySelector("#latest-yield-date").textContent = `資料日期 ${displayDate(dashboard.metadata.latestYieldDate)} · FRED DGS2`;
  document.querySelector("#meeting-count").textContent = numberFormat.format(dashboard.metadata.scoreCount);
  document.querySelector("#updated-at").textContent = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei",
  }).format(new Date(dashboard.metadata.generatedAt));
}

async function main() {
  const response = await fetch("data/dashboard.json", { cache: "no-store" });
  if (!response.ok) throw new Error("計分資料載入失敗。請稍後重試或通知維護者更新資料。");
  const dashboard = await response.json();
  populateSummary(dashboard);
  renderTable(dashboard.scores);
  document.querySelector("#meeting-search").addEventListener("input", () => renderTable(dashboard.scores));
  createChart(dashboard);
}

main().catch((error) => {
  const message = document.querySelector("#load-error");
  message.textContent = error.message;
  message.hidden = false;
  document.querySelector("#score-rows").innerHTML = `<tr><td colspan="9" class="empty-row">${escapeHtml(error.message)}</td></tr>`;
});
