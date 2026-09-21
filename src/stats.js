// Aggregating stored sessions into the numbers the progress view shows.

/** Per-ticker rollup across every stored session, worst first. */
export function tickerStats(sessions, { mode = 'all' } = {}) {
  const table = new Map();

  for (const session of sessions) {
    for (const result of session.results ?? []) {
      if (mode !== 'all' && result.mode !== mode) continue;
      const key = `${result.ticker}|${result.mode}`;
      const row = table.get(key) ?? {
        ticker: result.ticker,
        mode: result.mode,
        attempts: 0,
        correct: 0,
        totalMs: 0,
        bestMs: Infinity,
        errors: 0,
        lastSeen: 0
      };
      row.attempts += 1;
      if (result.correct) {
        row.correct += 1;
        row.bestMs = Math.min(row.bestMs, result.ms);
      }
      row.totalMs += result.ms;
      row.errors += result.errors ?? 0;
      row.lastSeen = Math.max(row.lastSeen, session.endedAt ?? 0);
      table.set(key, row);
    }
  }

  return [...table.values()]
    .map((row) => ({
      ...row,
      bestMs: row.bestMs === Infinity ? null : row.bestMs,
      avgMs: Math.round(row.totalMs / row.attempts),
      accuracy: Math.round((row.correct / row.attempts) * 1000) / 10
    }))
    .sort((a, b) => a.accuracy - b.accuracy || b.avgMs - a.avgMs);
}

/**
 * The symbols most worth drilling: lowest accuracy first, then slowest.
 * Symbols answered perfectly and quickly are left out entirely.
 */
export function weakTickers(sessions, { limit = 10, mode = 'all' } = {}) {
  const rows = tickerStats(sessions, { mode });
  if (rows.length === 0) return [];
  const medianMs = median(rows.map((row) => row.avgMs));
  return rows
    .filter((row) => row.accuracy < 100 || row.avgMs > medianMs)
    .slice(0, limit)
    .map((row) => row.ticker);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Headline numbers across all of history. */
export function overallStats(sessions) {
  const runs = sessions.filter((s) => (s.prompts ?? 0) > 0);
  if (runs.length === 0) {
    return { sessions: 0, prompts: 0, bestWpm: 0, avgWpm: 0, accuracy: 0, timeMs: 0, streak: 0 };
  }
  const prompts = runs.reduce((sum, s) => sum + s.prompts, 0);
  const correct = runs.reduce((sum, s) => sum + s.correct, 0);
  return {
    sessions: runs.length,
    prompts,
    bestWpm: Math.max(...runs.map((s) => s.wpm ?? 0)),
    avgWpm: Math.round((runs.reduce((sum, s) => sum + (s.wpm ?? 0), 0) / runs.length) * 10) / 10,
    accuracy: Math.round((correct / prompts) * 1000) / 10,
    timeMs: runs.reduce((sum, s) => sum + (s.elapsedMs ?? 0), 0),
    streak: dayStreak(runs)
  };
}

/** Consecutive days up to today (or yesterday) with at least one session. */
export function dayStreak(sessions, today = new Date()) {
  const days = new Set(
    sessions.filter((s) => s.endedAt).map((s) => new Date(s.endedAt).toDateString())
  );
  if (days.size === 0) return 0;
  const cursor = new Date(today);
  if (!days.has(cursor.toDateString())) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(cursor.toDateString())) return 0;
  }
  let streak = 0;
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Session-by-session series for the progress charts, oldest first. */
export function progressSeries(sessions, { mode = 'all', limit = 30 } = {}) {
  return sessions
    .filter((s) => (s.prompts ?? 0) > 0 && (mode === 'all' || s.mode === mode))
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
    .slice(-limit)
    .map((s) => ({
      at: s.endedAt,
      wpm: s.wpm ?? 0,
      accuracy: s.promptAccuracy ?? 0,
      avgMs: s.avgMs ?? 0,
      mode: s.mode,
      prompts: s.prompts
    }));
}

/** Change between the first and last run in a series, for the delta chips. */
export function trend(series, key) {
  if (series.length < 2) return null;
  const first = series[0][key];
  const last = series[series.length - 1][key];
  return Math.round((last - first) * 10) / 10;
}
