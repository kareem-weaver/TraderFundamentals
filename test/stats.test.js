import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStreak, overallStats, progressSeries, tickerStats, trend, weakTickers } from '../src/stats.js';

const DAY = 86_400_000;

/** Build a stored-session shape without running a whole Session. */
function session(endedAt, results, extra = {}) {
  const correct = results.filter((r) => r.correct).length;
  return {
    id: String(endedAt),
    endedAt,
    mode: extra.mode ?? 'ticker',
    listName: extra.listName ?? 'Test',
    prompts: results.length,
    correct,
    elapsedMs: results.reduce((sum, r) => sum + r.ms, 0),
    wpm: extra.wpm ?? 40,
    promptAccuracy: results.length ? (correct / results.length) * 100 : 0,
    avgMs: results.length ? results.reduce((s, r) => s + r.ms, 0) / results.length : 0,
    results
  };
}

const hit = (ticker, ms, mode = 'ticker') => ({ ticker, mode, correct: true, ms, errors: 0 });
const miss = (ticker, ms, mode = 'ticker') => ({ ticker, mode, correct: false, ms, errors: 2 });

test('rolls up attempts per symbol across sessions', () => {
  const rows = tickerStats([
    session(1, [hit('SPY', 1000), miss('QQQ', 3000)]),
    session(2, [hit('SPY', 2000)])
  ]);
  const spy = rows.find((r) => r.ticker === 'SPY');
  assert.equal(spy.attempts, 2);
  assert.equal(spy.accuracy, 100);
  assert.equal(spy.avgMs, 1500);
  assert.equal(spy.bestMs, 1000);
});

test('best time ignores wrong answers', () => {
  const rows = tickerStats([session(1, [miss('QQQ', 100), hit('QQQ', 5000)])]);
  assert.equal(rows[0].bestMs, 5000);
});

test('a symbol never answered correctly has no best time', () => {
  const rows = tickerStats([session(1, [miss('QQQ', 100)])]);
  assert.equal(rows[0].bestMs, null);
  assert.equal(rows[0].accuracy, 0);
});

test('ticker and phonetic attempts are tracked separately', () => {
  const rows = tickerStats([session(1, [hit('SPY', 1000), hit('SPY', 4000, 'phonetic')])]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.mode).sort(), ['phonetic', 'ticker']);
});

test('the mode filter narrows the rollup', () => {
  const rows = tickerStats([session(1, [hit('SPY', 1000), hit('SPY', 4000, 'phonetic')])], { mode: 'phonetic' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mode, 'phonetic');
});

test('weakest symbols come back worst first', () => {
  const weak = weakTickers([
    session(1, [miss('QQQ', 4000), hit('SPY', 500), hit('IWM', 600)])
  ]);
  assert.equal(weak[0], 'QQQ');
});

test('symbols that are fast and clean are not offered for drilling', () => {
  const weak = weakTickers([session(1, [hit('SPY', 1000), hit('QQQ', 1000)])]);
  assert.deepEqual(weak, []);
});

test('weak list honours the limit', () => {
  const results = ['A', 'B', 'C', 'D'].map((t) => miss(t, 3000));
  assert.equal(weakTickers([session(1, results)], { limit: 2 }).length, 2);
});

test('overall stats summarise every run', () => {
  const stats = overallStats([
    session(1, [hit('SPY', 1000), miss('QQQ', 1000)], { wpm: 30 }),
    session(2, [hit('SPY', 1000), hit('QQQ', 1000)], { wpm: 50 })
  ]);
  assert.equal(stats.sessions, 2);
  assert.equal(stats.prompts, 4);
  assert.equal(stats.correct, undefined);
  assert.equal(stats.bestWpm, 50);
  assert.equal(stats.avgWpm, 40);
  assert.equal(stats.accuracy, 75);
  assert.equal(stats.timeMs, 4000);
});

test('overall stats on an empty history are zeroed, not NaN', () => {
  const stats = overallStats([]);
  assert.equal(stats.sessions, 0);
  assert.equal(stats.accuracy, 0);
  assert.equal(stats.bestWpm, 0);
});

test('day streak counts back from today', () => {
  const today = new Date('2026-03-10T12:00:00Z');
  const at = (daysAgo) => today.getTime() - daysAgo * DAY;
  const runs = [session(at(0), [hit('SPY', 1)]), session(at(1), [hit('SPY', 1)]), session(at(2), [hit('SPY', 1)])];
  assert.equal(dayStreak(runs, today), 3);
});

test('a gap breaks the streak', () => {
  const today = new Date('2026-03-10T12:00:00Z');
  const at = (daysAgo) => today.getTime() - daysAgo * DAY;
  assert.equal(dayStreak([session(at(0), [hit('SPY', 1)]), session(at(3), [hit('SPY', 1)])], today), 1);
});

test('yesterday still counts; two days ago does not', () => {
  const today = new Date('2026-03-10T12:00:00Z');
  const at = (daysAgo) => today.getTime() - daysAgo * DAY;
  assert.equal(dayStreak([session(at(1), [hit('SPY', 1)])], today), 1);
  assert.equal(dayStreak([session(at(2), [hit('SPY', 1)])], today), 0);
  assert.equal(dayStreak([], today), 0);
});

test('progress series is oldest first and capped', () => {
  const runs = Array.from({ length: 40 }, (_, i) => session(i + 1, [hit('SPY', 1000)], { wpm: i }));
  const series = progressSeries(runs, { limit: 10 });
  assert.equal(series.length, 10);
  assert.equal(series[0].wpm, 30);
  assert.equal(series.at(-1).wpm, 39);
});

test('progress series can be filtered by mode', () => {
  const runs = [
    session(1, [hit('SPY', 1000)], { mode: 'ticker' }),
    session(2, [hit('SPY', 1000)], { mode: 'phonetic' })
  ];
  assert.equal(progressSeries(runs, { mode: 'phonetic' }).length, 1);
});

test('trend reports the change from first to last', () => {
  const series = [{ wpm: 30 }, { wpm: 35 }, { wpm: 42 }];
  assert.equal(trend(series, 'wpm'), 12);
  assert.equal(trend([{ wpm: 30 }], 'wpm'), null, 'one run is not a trend');
});
