import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scoresPath = path.join(rootDir, "data", "fomc_hawkish_scores.csv");
const statementsPath = path.join(rootDir, "data", "statements.jsonl");
const yieldsPath = path.join(rootDir, "data", "us_2y_yield.csv");
const outputDir = path.join(rootDir, "site", "data");
const outputPath = path.join(outputDir, "dashboard.json");
const yieldSource = "https://fred.stlouisfed.org/series/DGS2";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function recordsFromCsv(text) {
  const [headers, ...rows] = parseCsv(text);
  if (!headers) throw new Error("CSV is empty");
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

const [scoreText, statementText, yieldText] = await Promise.all([
  fs.readFile(scoresPath, "utf8"),
  fs.readFile(statementsPath, "utf8"),
  fs.readFile(yieldsPath, "utf8"),
]);

const statementUrls = new Map(statementText.split(/\r?\n/).filter(Boolean).map((line) => {
  const statement = JSON.parse(line);
  return [statement.id, statement.sourceUrl];
}));

const scores = recordsFromCsv(scoreText).map((row) => ({
  id: row.id,
  date: row.dateKey,
  action: row.action,
  basisPoints: Number(row.bp),
  rateSignal: Number(row.rateSignal),
  weightedRate: Number(row.weightedRate),
  toneAdj: Number(row.toneAdj),
  toneSignal: Number(row.toneSignal),
  weightedTone: Number(row.weightedTone),
  assetLabel: row.assetLabel,
  assetSignal: Number(row.assetSignal),
  weightedAsset: Number(row.weightedAsset),
  dissentHawkishCount: Number(row.dissentHawkishCount),
  dissentDovishCount: Number(row.dissentDovishCount),
  dissentAdj: Number(row.dissentAdj),
  score: Number(row.score),
  unclampedScore: Number(row.unclampedScore),
  clamped: row.clamped === "是",
  reason: row.toneReason,
  dissentReason: row.dissentReason,
  formulaVersion: row.formulaVersion,
  statementUrl: statementUrls.get(row.id) ?? `https://www.federalreserve.gov/newsevents/pressreleases/monetary${row.id}a.htm`,
})).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.score))
  .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));

if (!scores.length) throw new Error("No valid FOMC score rows found");
for (const [index, row] of scores.entries()) {
  if (index < 7) {
    row.smoothed = null;
    continue;
  }
  const latestThreeMean = scores.slice(index - 2, index + 1).reduce((sum, item) => sum + item.score, 0) / 3;
  const latestEightMean = scores.slice(index - 7, index + 1).reduce((sum, item) => sum + item.score, 0) / 8;
  row.smoothed = Number((latestThreeMean * 0.6 + latestEightMean * 0.4).toFixed(2));
}

const yieldRecords = recordsFromCsv(yieldText);
const yields = yieldRecords.map((row) => ({ date: row.observation_date, rawValue: row.DGS2, value: Number(row.DGS2) }))
  .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.rawValue.trim() !== "" && Number.isFinite(row.value))
  .map(({ date, value }) => ({ date, value }))
  .sort((left, right) => left.date.localeCompare(right.date));
if (!yields.length) throw new Error("No valid DGS2 observations found");
const firstYieldAtOrAfterHistory = yields.findIndex((row) => row.date >= scores[0].date);
const yieldHistoryStart = firstYieldAtOrAfterHistory > 0 ? firstYieldAtOrAfterHistory - 1 : 0;

const latestScore = scores.at(-1);
const latestYield = yields.at(-1);
const dashboard = {
  metadata: {
    generatedAt: new Date().toISOString(),
    latestMeeting: latestScore.date,
    latestYieldDate: latestYield.date,
    latestYield: latestYield.value,
    yieldSource,
    yieldSeries: "DGS2",
    scoreCount: scores.length,
  },
  scores,
  yields: yields.slice(yieldHistoryStart),
};

if (!dashboard.yields.length) throw new Error("No yield observations overlap the FOMC score history");
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(dashboard)}\n`, "utf8");
console.log(`Built ${path.relative(rootDir, outputPath)} with ${scores.length} FOMC meetings and ${dashboard.yields.length} DGS2 observations`);
