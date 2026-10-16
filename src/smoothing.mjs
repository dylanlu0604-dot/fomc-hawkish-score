function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

export function rebuildSmoothedColumns(headers, sourceRows) {
  const sourceHeaders = [...headers];
  const scoreIndex = sourceHeaders.indexOf("score");
  if (scoreIndex < 0) throw new Error("Score CSV is missing the score column");

  const nextHeaders = [...sourceHeaders];
  let smoothedIndex = nextHeaders.indexOf("smoothed");
  if (smoothedIndex < 0) {
    smoothedIndex = scoreIndex + 1;
    nextHeaders.splice(smoothedIndex, 0, "smoothed");
  }

  let smoothedMaxminIndex = nextHeaders.indexOf("smoothed_maxmin");
  if (smoothedMaxminIndex < 0) {
    smoothedMaxminIndex = smoothedIndex + 1;
    nextHeaders.splice(smoothedMaxminIndex, 0, "smoothed_maxmin");
  }

  const rows = sourceRows.map((sourceRow) => nextHeaders.map((header) => {
    const sourceIndex = sourceHeaders.indexOf(header);
    return sourceIndex < 0 ? "" : sourceRow[sourceIndex] ?? "";
  }));
  const dateIndex = nextHeaders.indexOf("dateKey");
  if (dateIndex >= 0) rows.sort((left, right) => left[dateIndex].localeCompare(right[dateIndex]));

  for (const [index, row] of rows.entries()) {
    if (index < 7) {
      row[smoothedIndex] = "";
      continue;
    }

    const mean = (windowSize) => {
      const windowRows = rows.slice(index - windowSize + 1, index + 1);
      const total = windowRows.reduce((sum, item) => {
        const score = Number(item[scoreIndex]);
        if (!Number.isFinite(score)) throw new Error("Score CSV contains an invalid score");
        return sum + score;
      }, 0);
      return total / windowSize;
    };

    row[smoothedIndex] = (mean(3) * 0.6 + mean(8) * 0.4).toFixed(2);
  }

  const smoothedValues = rows
    .map((row) => row[smoothedIndex])
    .filter((value) => value !== "")
    .map(Number);
  if (smoothedValues.some((value) => !Number.isFinite(value))) {
    throw new Error("Smoothed score column contains an invalid value");
  }

  if (smoothedValues.length === 0) {
    for (const row of rows) row[smoothedMaxminIndex] = "";
    return { headers: nextHeaders, rows };
  }

  const p10 = percentile(smoothedValues, 0.1);
  const p90 = percentile(smoothedValues, 0.9);
  for (const row of rows) {
    const smoothed = row[smoothedIndex];
    if (smoothed === "") {
      row[smoothedMaxminIndex] = "";
      continue;
    }

    const scaled = p90 === p10
      ? 50
      : 30 + (Number(smoothed) - p10) * 40 / (p90 - p10);
    row[smoothedMaxminIndex] = Math.max(0, Math.min(100, scaled)).toFixed(2);
  }

  return { headers: nextHeaders, rows };
}
