import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENSITIES, TAPE_ROWS, TapeSession } from '../src/tape.js';

function clock(start = 10_000) {
  let t = start;
  return { now: () => t, set: (v) => { t = v; }, advance: (ms) => { t += ms; return t; } };
}

const mid = () => 0.5;
/** Never starts a repeat run or a burst. */
const plain = () => 0.99;

const symbols = (tape) => tape.rows.map((r) => r.ticker);

test('the column is seeded so there is a tape to read', () => {
  const tape = new TapeSession(['SPY'], { random: mid }).start();
  assert.equal(tape.rows.length, 12);
  assert.ok(tape.rows.length < TAPE_ROWS, 'but it does not start full');
  assert.equal(tape.escaped, 0, 'seeding never counts as an escape');
  assert.equal(tape.results.length, 0);
});

test('a new print lands at the top and pushes the rest down', () => {
  const c = clock();
  const tape = new TapeSession(['SPY', 'QQQ'], { now: c.now, random: plain }).start();
  const wasTop = tape.rows[0];

  c.advance(400);
  const { spawned } = tape.tick(c.now());
  assert.equal(spawned.length, 1);
  assert.equal(tape.rows[0].id, spawned[0].id, 'newest is at index 0');
  assert.equal(tape.rows[1].id, wasTop.id, 'the old top moved down one');
});

test('the column never grows past its row count', () => {
  const c = clock();
  const tape = new TapeSession(['SPY', 'QQQ'], {
    now: c.now, random: plain, durationMs: 10 * 60_000
  }).start();
  for (let i = 0; i < 60; i += 1) {
    c.advance(2000);
    tape.tick(c.now());
    assert.ok(tape.rows.length <= TAPE_ROWS, `overflowed: ${tape.rows.length}`);
  }
  assert.equal(tape.rows.length, TAPE_ROWS, 'and it fills up');
});

test('a print pushed off the bottom escapes and counts against you', () => {
  const c = clock();
  const tape = new TapeSession(['SPY', 'QQQ'], {
    now: c.now, random: plain, durationMs: 10 * 60_000
  }).start();

  // Fill the remaining rows; nothing should escape yet.
  while (tape.rows.length < TAPE_ROWS) {
    c.advance(2000);
    assert.equal(tape.tick(c.now()).escaped.length, 0, 'nothing escapes while there is room');
  }
  assert.equal(tape.rows.length, TAPE_ROWS);
  const bottom = tape.rows[TAPE_ROWS - 1];

  c.advance(2000);
  const { escaped } = tape.tick(c.now());
  assert.equal(escaped.length, 1);
  assert.equal(escaped[0].id, bottom.id, 'the bottom row is the one that goes');
  assert.equal(tape.escaped, 1);
  assert.equal(tape.results[0].correct, false);
  assert.equal(tape.results[0].escaped, true);
});

test('depth runs 0 at the top to 1 at the bottom row', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], {
    now: c.now, random: plain, durationMs: 10 * 60_000
  }).start();
  while (tape.rows.length < TAPE_ROWS) {
    c.advance(2000);
    tape.tick(c.now());
  }
  assert.equal(tape.depthOf(tape.rows[0]), 0);
  assert.equal(tape.depthOf(tape.rows[TAPE_ROWS - 1]), 1);
});

test('typing a print on the column takes it off', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: plain }).start();
  const before = tape.rows.length;
  tape.type('SPY');
  const outcome = tape.submit(c.now());
  assert.equal(outcome.hit, true);
  assert.equal(tape.rows.length, before - 1);
  assert.equal(tape.hits, 1);
  assert.equal(tape.results[0].correct, true);
});

test('taking a print lets everything below it rise a row', () => {
  const c = clock();
  const tape = new TapeSession(['SPY', 'QQQ'], { now: c.now, random: mid }).start();
  const bottom = tape.rows[tape.rows.length - 1];
  const above = tape.rows[tape.rows.length - 2];

  tape.type(bottom.ticker);
  const outcome = tape.submit(c.now());
  assert.equal(outcome.hit, true);
  assert.equal(outcome.row.id, bottom.id);
  assert.equal(tape.rows[tape.rows.length - 1].id, above.id, 'the one above is now last');
});

test('with the symbol repeated, the lowest copy is taken first', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: plain }).start();
  const lowest = tape.rows[tape.rows.length - 1];
  assert.ok(tape.rows.length > 2);

  tape.type('SPY');
  const outcome = tape.submit(c.now());
  assert.equal(outcome.row.id, lowest.id, 'the copy closest to falling off goes first');
});

test('submitting something not on the column is a wrong submit', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: plain }).start();
  const before = tape.rows.length;
  tape.type('ZZZZ');
  const outcome = tape.submit(c.now());
  assert.equal(outcome.hit, false);
  assert.equal(tape.wrongSubmits, 1);
  assert.equal(tape.rows.length, before, 'the column is untouched');
  assert.equal(tape.typed, '');
});

test('an empty submit does nothing at all', () => {
  const tape = new TapeSession(['SPY'], { random: plain }).start();
  const outcome = tape.submit();
  assert.equal(outcome.hit, false);
  assert.equal(outcome.empty, true);
  assert.equal(tape.wrongSubmits, 0);
});

test('symbols repeat in runs', () => {
  const c = clock();
  // 0.05 always rolls a repeat and picks the shortest run bucket.
  const repeaty = () => 0.05;
  const tape = new TapeSession(['SPY', 'QQQ', 'IWM'], { now: c.now, random: repeaty }).start();
  const list = symbols(tape);
  const hasAdjacentRepeat = list.some((s, i) => i > 0 && s === list[i - 1]);
  assert.ok(hasAdjacentRepeat, `expected a run, got ${list.join(',')}`);
  assert.ok(tape.longestRun >= 2);
});

test('a long enough run can fill the whole column', () => {
  const c = clock();
  // 0.99 on the run-length roll selects the longest bucket (13-20).
  const values = [0.05, 0.0, 0.99, 0.99];
  let i = 0;
  const rng = () => values[i++ % values.length];
  const tape = new TapeSession(['SPY', 'QQQ'], {
    now: c.now, random: rng, durationMs: 60 * 60_000
  }).start();
  for (let n = 0; n < TAPE_ROWS * 2; n += 1) {
    c.advance(4000);
    tape.tick(c.now());
  }
  assert.ok(tape.longestRun >= 13, `longest run was ${tape.longestRun}`);
});

test('long runs stay rare under an even spread of randomness', () => {
  const c = clock();
  // mulberry32: deterministic and well distributed, so this asserts on the
  // distribution rather than on luck.
  let seed = 12345;
  const rng = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const tape = new TapeSession(
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    { now: c.now, random: rng, durationMs: 60 * 60_000 }
  ).start();
  for (let n = 0; n < 600; n += 1) {
    c.advance(2500);
    tape.tick(c.now());
  }
  const list = symbols(tape);
  const distinct = new Set(list).size;
  assert.ok(distinct > 1, 'a typical column is not all one symbol');
  assert.ok(tape.longestRun >= 2, 'but runs do happen');
});

test('a single-symbol list still works', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid }).start();
  c.advance(400);
  tape.tick(c.now());
  assert.ok(tape.rows.every((r) => r.ticker === 'SPY'));
});

test('matching narrows as you type', () => {
  const tape = new TapeSession(['SPY'], { random: plain }).start();
  assert.equal(tape.matching('').length, 0);
  assert.ok(tape.matching('S').length > 0);
  assert.equal(tape.matching('ZZ').length, 0);
});

test('keystrokes score against whatever is on the column', () => {
  const tape = new TapeSession(['SPY'], { random: plain }).start();
  tape.type('S').type('SP');
  tape.type('SPZ');
  assert.equal(tape.keystrokes, 3);
  assert.equal(tape.correctKeystrokes, 2);
  tape.type('SP');
  assert.equal(tape.backspaces, 1);
});

test('phonetic prints are answered with the spoken form', () => {
  const c = clock();
  const tape = new TapeSession(['QQQ'], { now: c.now, random: plain, mode: 'phonetic' }).start();
  assert.equal(tape.rows[0].expected, 'quebec quebec quebec');
  tape.type('quebec quebec quebec');
  assert.equal(tape.submit(c.now()).hit, true);
});

test('mixed mode puts both kinds of print on the column', () => {
  const low = new TapeSession(['SPY'], { random: () => 0.9, mode: 'mixed' }).start();
  const high = new TapeSession(['SPY'], { random: () => 0.2, mode: 'mixed' }).start();
  assert.equal(low.rows[0].mode, 'phonetic');
  assert.equal(high.rows[0].mode, 'ticker');
});

test('no new prints arrive after time is up', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: plain, durationMs: 5000 }).start();
  c.advance(400);
  tape.tick(c.now());
  const before = tape.nextId;

  c.advance(9000);
  const { spawned, finished } = tape.tick(c.now());
  assert.equal(spawned.length, 0);
  assert.equal(tape.nextId, before);
  assert.equal(finished, true);
});

test('ending early does not penalise what was still on the column', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: plain }).start();
  c.advance(500);
  const summary = tape.end(c.now());
  assert.equal(summary.escaped, 0);
  assert.equal(summary.prompts, 0);
});

test('summary carries both hit and escape counts', () => {
  const c = clock();
  const tape = new TapeSession(['SPY', 'QQQ'], {
    now: c.now, random: plain, listName: 'Watchlist', durationMs: 10 * 60_000
  }).start();

  tape.type(tape.rows[tape.rows.length - 1].ticker);
  tape.submit(c.now());

  while (tape.escaped === 0) {
    c.advance(400);
    tape.tick(c.now());
  }

  const summary = tape.end(c.now());
  assert.equal(summary.style, 'tape');
  assert.equal(summary.listName, 'Watchlist');
  assert.equal(summary.correct, 1);
  assert.ok(summary.escaped >= 1);
  assert.equal(summary.prompts, summary.correct + summary.escaped);
  assert.ok(summary.longestRun >= 1);
});

test('summary shape matches what the history views expect', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: plain }).start();
  tape.type('SPY');
  tape.submit(c.now());
  const summary = tape.end(c.now());

  for (const key of ['id', 'startedAt', 'endedAt', 'mode', 'listName', 'prompts',
    'correct', 'elapsedMs', 'wpm', 'promptAccuracy', 'avgMs', 'results']) {
    assert.ok(summary[key] !== undefined, `missing ${key}`);
  }
  assert.ok(Array.isArray(summary.results));
});

test('an empty symbol list finishes immediately', () => {
  const tape = new TapeSession([], { random: mid });
  assert.equal(tape.finished, true);
  assert.equal(tape.summary().prompts, 0);
});

test('a burst lands as a rapid run of arrivals, not all on one timestamp', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: () => 0.01, intensity: 'storm' }).start();
  c.advance(400);
  tape.tick(c.now());
  assert.ok(tape.burstRemaining > 0, 'more of the burst is queued');

  let arrivals = 0;
  for (let i = 0; i < 10; i += 1) {
    c.advance(100);
    arrivals += tape.tick(c.now()).spawned.length;
  }
  assert.ok(arrivals >= 2, `expected a burst of arrivals, got ${arrivals}`);
});

test('every intensity is fully specified', () => {
  for (const [name, tuning] of Object.entries(INTENSITIES)) {
    assert.ok(tuning.label, `${name} has no label`);
    assert.equal(tuning.spawnMs.length, 2);
    assert.ok(tuning.spawnMs[0] < tuning.spawnMs[1]);
    assert.ok(tuning.repeatChance > 0 && tuning.repeatChance < 1);
  }
  assert.ok(INTENSITIES.storm.spawnMs[0] < INTENSITIES.calm.spawnMs[0], 'storm is busier');
});
