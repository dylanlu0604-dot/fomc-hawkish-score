import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import {
  fetchHtml,
  makeScoreRow,
  normalizeWhitespace,
  parseCsv,
  readJsonLines,
  scoreHeaders,
  scoreWithOpenAI,
  serializeCsv,
  writeJsonLinesIfChanged,
} from "./update-latest.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scorePath = path.join(rootDir, "data", "fomc_hawkish_scores.csv");
const statementPath = path.join(rootDir, "data", "statements.jsonl");
const auditPath = path.join(rootDir, "data", "ai_scoring_audit.jsonl");
const firstYear = 2000;
const lastYear = 2005;

function dateKeyFromId(id) {
  return `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
}

async function listYearStatements(year) {
  const archiveUrl = `https://www.federalreserve.gov/monetarypolicy/fomchistorical${year}.htm`;
  const archiveHtml = await fetchHtml(archiveUrl);
  const $ = load(archiveHtml);
  const links = $("a").toArray().filter((element) => $(element).text().trim() === "Statement");
  const records = [];

  for (const element of links) {
    const link = $(element);
    const panel = link.closest(".panel-default");
    const meetingTitle = normalizeWhitespace(panel.find(".panel-heading").first().text());
    const href = link.attr("href");
    const absoluteUrl = href ? new URL(href, archiveUrl).href : "";
    const id = absoluteUrl.match(/\/(\d{8})(?:\/|\.htm|$)/)?.[1];

    if (!meetingTitle || !id || id.slice(0, 4) !== String(year)) {
      throw new Error(`Could not identify a ${year} FOMC statement link: ${absoluteUrl || "missing URL"}`);
    }
    records.push({ id, dateKey: dateKeyFromId(id), meetingTitle, sourceUrl: absoluteUrl });
  }

  records.sort((left, right) => left.id.localeCompare(right.id));
  if (!records.length) throw new Error(`No statement links found in ${archiveUrl}`);
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error(`Duplicate statement dates found in ${archiveUrl}`);
  }
  return records;
}

async function fetchStatement(record) {
  const html = await fetchHtml(record.sourceUrl);
  const $ = load(html);
  let article = $("#article").first();
  if (article.length === 0) article = $("main").first();
  if (article.length === 0) article = $("body").first();
  article.find("script, style, nav, footer, header").remove();
  const text = normalizeWhitespace(article.text());

  if (text.length < 500) {
    throw new Error(`Statement extraction returned only ${text.length} characters from ${record.sourceUrl}`);
  }

  return {
    ...record,
    retrievedAt: new Date().toISOString(),
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    text,
  };
}

function objectFromRow(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

function previousMeetingFor(headers, rows, dateKey) {
  const dateIndex = headers.indexOf("dateKey");
  const previousRow = rows.filter((row) => (row[dateIndex] ?? "") < dateKey).at(-1);
  if (!previousRow) return null;
  const previous = objectFromRow(headers, previousRow);
  return {
    dateKey: previous.dateKey,
    action: previous.action,
    bp: Number(previous.bp),
    toneAdj: Number(previous.toneAdj),
    assetLabel: previous.assetLabel,
    assetSignal: Number(previous.assetSignal),
    score: Number(previous.score),
  };
}

async function backfillYear(year) {
  if (!Number.isInteger(year) || year < firstYear || year > lastYear) {
    throw new Error(`Year must be between ${firstYear} and ${lastYear}`);
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for historical scoring");

  const sourceRecords = await listYearStatements(year);
  const statements = [];
  for (const record of sourceRecords) statements.push(await fetchStatement(record));

  const csvText = await fs.readFile(scorePath, "utf8");
  const parsedRows = parseCsv(csvText);
  const headers = parsedRows.shift();
  if (!headers || headers.join("|") !== scoreHeaders.join("|")) {
    throw new Error("Unexpected score CSV headers; expected the existing v4 format");
  }

  const rows = parsedRows.filter((row) => row.length > 1);
  const idIndex = headers.indexOf("id");
  const statementRecords = await readJsonLines(statementPath);
  const auditRecords = await readJsonLines(auditPath);
  let scored = 0;
  let skipped = 0;
  let preserved = 0;

  for (const statement of statements) {
    const existingIndex = rows.findIndex((row) => row[idIndex] === statement.id);
    const priorAudit = auditRecords.filter((record) => record.id === statement.id).at(-1);
    const oldStatement = statementRecords.find((record) => record.id === statement.id);

    if (!oldStatement || oldStatement.sha256 !== statement.sha256) {
      const statementIndex = statementRecords.findIndex((record) => record.id === statement.id);
      if (statementIndex >= 0) statementRecords[statementIndex] = statement;
      else statementRecords.push(statement);
    }

    if (existingIndex >= 0 && priorAudit?.statementSha256 === statement.sha256) {
      skipped += 1;
      console.log(JSON.stringify({ year, id: statement.id, status: "already_scored" }));
      continue;
    }

    if (existingIndex >= 0 && !priorAudit) {
      auditRecords.push({
        id: statement.id,
        dateKey: statement.dateKey,
        sourceUrl: statement.sourceUrl,
        statementSha256: statement.sha256,
        status: "existing_score_preserved",
        model: null,
        promptVersion: null,
        scoredAt: new Date().toISOString(),
        backfillYear: year,
      });
      preserved += 1;
      console.log(JSON.stringify({ year, id: statement.id, status: "existing_score_preserved" }));
      continue;
    }

    const previous = previousMeetingFor(headers, rows, statement.dateKey);
    const { aiScore, model } = await scoreWithOpenAI(statement, previous);
    const scoreRow = makeScoreRow(statement, aiScore, headers);
    const dissentReasonIndex = headers.indexOf("dissentReason");
    if (statement.id < "20020507" && !/Voting against\b/i.test(statement.text)) {
      scoreRow[dissentReasonIndex] = "官方聲明未列投票異議資訊（2002-05前）；此項異議調整列為0";
    }

    if (existingIndex >= 0) rows[existingIndex] = scoreRow;
    else rows.push(scoreRow);
    rows.sort((left, right) => left[idIndex].localeCompare(right[idIndex]));

    auditRecords.push({
      id: statement.id,
      dateKey: statement.dateKey,
      sourceUrl: statement.sourceUrl,
      statementSha256: statement.sha256,
      status: existingIndex >= 0 ? "rescored_historical_statement" : "scored_historical_meeting",
      model,
      promptVersion: "fomc-score-v2-openai",
      scoredAt: new Date().toISOString(),
      score: Number(scoreRow[headers.indexOf("score")]),
      action: aiScore.action,
      toneAdj: aiScore.toneAdj,
      assetLabel: aiScore.assetLabel,
      backfillYear: year,
    });
    scored += 1;
    console.log(JSON.stringify({ year, id: statement.id, status: "scored", score: Number(scoreRow[headers.indexOf("score")]) }));
  }

  await fs.writeFile(scorePath, serializeCsv([headers, ...rows]), "utf8");
  statementRecords.sort((left, right) => left.id.localeCompare(right.id));
  auditRecords.sort((left, right) => left.id.localeCompare(right.id) || String(left.scoredAt).localeCompare(String(right.scoredAt)));
  await writeJsonLinesIfChanged(statementPath, statementRecords);
  await writeJsonLinesIfChanged(auditPath, auditRecords);
  console.log(JSON.stringify({ year, statements: statements.length, scored, skipped, preserved }));
}

const year = Number(process.argv[2]);
backfillYear(year).catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
