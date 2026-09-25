import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketLabel, bucketOf, rankRows, rowFor, scoreOf } from '../src/leaderboard.js';

const tapeRun = (over = {}) => ({
  style: 'tape', mode: 'ticker', intensity: 'storm', durationMs: 120000,
  correct: 34, escaped: 12, promptAccuracy: 73.9, wpm: 41, longestRun: 5,
  listName: 'Watchlist', prompts: 46, ...over
});

const singleRun = (over = {}) => ({
  style: 'single', mode: 'phonetic', prompts: 20,
  correct: 19, promptAccuracy: 95, wpm: 38, listName: 'Watchlist', ...over
});

test('tape runs bucket by every setting that changes the contest', () => {
  assert.equal(bucketOf(tapeRun()), 'tape|ticker|storm|120000');
  assert.notEqual(bucketOf(tapeRun()), bucketOf(tapeRun({ intensity: 'calm' })));
  assert.notEqual(bucketOf(tapeRun()), bucketOf(tapeRun({ durationMs: 60000 })));
  assert.notEqual(bucketOf(tapeRun()), bucketOf(tapeRun({ mode: 'phonetic' })));
});

test('one-at-a-time runs bucket by run length', () => {
  assert.equal(bucketOf(singleRun()), 'single|phonetic|na|20');
  assert.notEqual(bucketOf(singleRun()), bucketOf(singleRun({ prompts: 50 })));
});

test('the two styles never share a board', () => {
  assert.notEqual(bucketOf(tapeRun()), bucketOf(singleRun()));
});

test('buckets read as something a person can pick from a list', () => {
  assert.equal(bucketLabel('tape|ticker|storm|120000'), 'Tape · ticker · storm · 2 min');
  assert.equal(bucketLabel('tape|phonetic|calm|60000'), 'Tape · phonetic · calm · 1 min');
  assert.equal(bucketLabel('single|ticker|na|20'), 'One at a time · ticker · 20 prompts');
});

test('the tape is ranked on prints banked, everything else on wpm', () => {
  assert.equal(scoreOf(tapeRun()), 34);
  assert.equal(scoreOf(singleRun()), 38);
});

test('a posted row carries the name, board and the run detail', () => {
  const row = rowFor(tapeRun(), { name: 'Kareem', board: 'abc123' });
  assert.equal(row.name, 'Kareem');
  assert.equal(row.board, 'abc123');
  assert.equal(row.bucket, 'tape|ticker|storm|120000');
  assert.equal(row.score, 34);
  assert.equal(row.escaped, 12);
  assert.equal(row.longest_run, 5);
});

test('names are trimmed and capped so one cannot wreck the table', () => {
  const row = rowFor(tapeRun(), { name: '   ' + 'x'.repeat(60) + '   ', board: 'b' });
  assert.equal(row.name.length, 24);
});

test('a missing field never posts undefined', () => {
  const row = rowFor({ style: 'single', mode: 'ticker', prompts: 10 }, { name: 'A', board: 'b' });
  for (const [key, value] of Object.entries(row)) {
    assert.notEqual(value, undefined, `${key} is undefined`);
  }
});

test('standings keep only each person’s best run', () => {
  const ranked = rankRows([
    { name: 'Kareem', score: 20, accuracy: 90 },
    { name: 'Kareem', score: 34, accuracy: 70 },
    { name: 'Sam', score: 28, accuracy: 99 }
  ]);
  assert.equal(ranked.length, 2);
  assert.deepEqual(ranked.map((r) => r.name), ['Kareem', 'Sam']);
  assert.equal(ranked[0].score, 34);
});

test('standings are ranked highest first and numbered', () => {
  const ranked = rankRows([
    { name: 'A', score: 10, accuracy: 50 },
    { name: 'B', score: 30, accuracy: 50 },
    { name: 'C', score: 20, accuracy: 50 }
  ]);
  assert.deepEqual(ranked.map((r) => [r.rank, r.name]), [[1, 'B'], [2, 'C'], [3, 'A']]);
});

test('a tie on score breaks on accuracy, then on who got there first', () => {
  const ranked = rankRows([
    { name: 'A', score: 30, accuracy: 80, created_at: '2026-01-02' },
    { name: 'B', score: 30, accuracy: 95, created_at: '2026-01-03' },
    { name: 'C', score: 30, accuracy: 80, created_at: '2026-01-01' }
  ]);
  assert.deepEqual(ranked.map((r) => r.name), ['B', 'C', 'A']);
});

test('the same person under different capitalisation is one player', () => {
  const ranked = rankRows([
    { name: 'Kareem', score: 10, accuracy: 50 },
    { name: 'kareem', score: 40, accuracy: 50 }
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].score, 40);
});

test('standings honour the limit', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ name: `P${i}`, score: i, accuracy: 0 }));
  assert.equal(rankRows(rows, { limit: 5 }).length, 5);
  assert.equal(rankRows(rows, { limit: 5 })[0].name, 'P49');
});

test('an empty board is empty, not an error', () => {
  assert.deepEqual(rankRows([]), []);
});

test('a real tape summary buckets on its configured settings', async () => {
  const { TapeSession } = await import('../src/tape.js');
  let t = 1000;
  const tape = new TapeSession(['SPY'], {
    now: () => t, random: () => 0.99,
    durationMs: 60000, intensity: 'storm', mode: 'ticker'
  }).start();
  t += 500;
  const summary = tape.end(t);
  // Regression: the summary used to omit durationMs, so every tape run posted
  // into a "|0" bucket that the board never showed.
  assert.equal(bucketOf(summary), 'tape|ticker|storm|60000');
  assert.equal(rowFor(summary, { name: 'A', board: 'b' }).duration_ms, 60000);
});
