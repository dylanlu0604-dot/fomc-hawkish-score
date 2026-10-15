import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(rootDir, "data", "us_2y_yield.csv");
const sourceUrl = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS2";

const response = await fetch(sourceUrl, {
  headers: {
    "User-Agent": "fomc-hawkish-score/1.0 (FRED DGS2 data refresh)",
    Accept: "text/csv",
  },
});
if (!response.ok) throw new Error(`FRED returned HTTP ${response.status}`);

const csv = await response.text();
const lines = csv.trim().split(/\r?\n/);
if (lines[0]?.replace(/^\uFEFF/, "") !== "observation_date,DGS2") {
  throw new Error("Unexpected FRED DGS2 CSV header");
}

const validRows = lines.slice(1).filter((line) => {
  const [date, value] = line.split(",");
  return /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") && value?.trim() !== "" && Number.isFinite(Number(value));
});
if (validRows.length < 1_000) throw new Error(`FRED DGS2 returned only ${validRows.length} valid observations`);

const latestDate = validRows.at(-1).split(",")[0];
const ageDays = (Date.now() - Date.parse(`${latestDate}T00:00:00Z`)) / 86_400_000;
if (ageDays > 14) throw new Error(`Latest DGS2 observation is stale: ${latestDate}`);

await fs.writeFile(outputPath, `${lines[0]}\n${lines.slice(1).join("\n")}\n`, "utf8");
console.log(`Saved ${validRows.length} DGS2 observations through ${latestDate} to ${path.relative(rootDir, outputPath)}`);
