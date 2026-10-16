export function rebuildSmoothedColumn(headers, sourceRows) {
  const nextHeaders = [...headers];
  const scoreIndex = nextHeaders.indexOf("score");
  if (scoreIndex < 0) throw new Error("Score CSV is missing the score column");

  let smoothedIndex = nextHeaders.indexOf("smoothed");
  if (smoothedIndex < 0) {
    smoothedIndex = scoreIndex + 1;
    nextHeaders.splice(smoothedIndex, 0, "smoothed");
  }

  const dateIndex = nextHeaders.indexOf("dateKey");
  const rows = sourceRows.map((row) => {
    const nextRow = [...row];
    if (nextRow.length < nextHeaders.length) {
      nextRow.splice(smoothedIndex, 0, "");
    }
    return nextRow;
  });
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

  return { headers: nextHeaders, rows };
}
