import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENSITIES, TapeSession } from '../src/tape.js';

function clock(start = 10_000) {
  let t = start;
  return { now: () => t, set: (v) => { t = v; }, advance: (ms) => { t += ms; return t; } };
}

/** Deterministic RNG: cycles through the given values. */
function rng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

const mid = () => 0.5;

test('starts empty and schedules the first print', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid }).start();
  assert.equal(tape.rows.length, 0);
  assert.equal(tape.nextSpawnAt, 10_250);
});

test('a print appears once its spawn time arrives', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid }).start();
  c.advance(300);
  const { spawned } = tape.tick(c.now());
  assert.equal(spawned.length, 1);
  assert.equal(tape.rows[0].ticker, 'SPY');
  assert.equal(tape.rows[0].expected, 'SPY');
});

test('progress runs 0 at the bottom to 1 at the top', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid }).start();
  c.advance(300);
  tape.tick(c.now());
  const row = tape.rows[0];
  assert.equal(tape.progressOf(row, row.spawnAt), 0);
  assert.equal(tape.progressOf(row, row.spawnAt + row.riseMs / 2), 0.5);
  assert.equal(tape.progressOf(row, row.spawnAt + row.riseMs), 1);
});

test('a print that reaches the top escapes and counts against you', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid }).start();
  c.advance(300);
  tape.tick(c.now());
  const row = tape.rows[0];

  c.set(row.spawnAt + row.riseMs + 1);
  const { escaped } = tape.tick(c.now());
  assert.equal(escaped.length, 1);
  assert.equal(escaped[0].id, row.id);
  assert.ok(!tape.rows.some((r) => r.id === row.id), 'it is off the tape');
  assert.equal(tape.escaped, 1);

  const result = tape.results[0];
  assert.equal(result.correct, false);
  assert.equal(result.escaped, true);
  assert.equal(result.ticker, 'SPY');
});

test('typing a live print and submitting takes it off the tape', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid }).start();
  c.advance(300);
  tape.tick(c.now());

  c.advance(900);
  tape.type('S').type('SP').type('SPY');
  const outcome = tape.submit(c.now());
  assert.equal(outcome.hit, true);
  assert.equal(tape.rows.length, 0);
  assert.equal(tape.hits, 1);
  assert.equal(tape.results[0].correct, true);
  assert.equal(tape.results[0].ms, 900, 'time is measured from when it surfaced');
});

test('submitting something not on the tape is a wrong submit', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid }).start();
  c.advance(300);
  tape.tick(c.now());
  tape.type('QQQ');
  const outcome = tape.submit(c.now());
  assert.equal(outcome.hit, false);
  assert.equal(tape.wrongSubmits, 1);
  assert.equal(tape.rows.length, 1, 'the live print is untouched');
  assert.equal(tape.typed, '', 'the box is cleared either way');
});

test('an empty submit does nothing at all', () => {
  const tape = new TapeSession(['SPY'], { random: mid }).start();
  const outcome = tape.submit();
  assert.equal(outcome.hit, false);
  assert.equal(outcome.empty, true);
  assert.equal(tape.wrongSubmits, 0);
});

test('with the same symbol twice on the tape, the higher one is taken', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid }).start();
  c.advance(300);
  tape.tick(c.now());
  const older = tape.rows[0];

  // Force a second print of the same symbol, later and therefore lower.
  c.advance(2000);
  tape.nextSpawnAt = c.now();
  tape.tick(c.now());
  assert.equal(tape.rows.length, 2);

  tape.type('SPY');
  const outcome = tape.submit(c.now());
  assert.equal(outcome.hit, true);
  assert.equal(outcome.row.id, older.id, 'the one closest to escaping goes first');
  assert.equal(tape.rows.length, 1);
});

test('matching narrows as you type', () => {
  const c = clock();
  const tape = new TapeSession(['SPY', 'QQQ'], { now: c.now, random: rng([0.1, 0.9, 0.5]) }).start();
  c.advance(300);
  tape.tick(c.now());
  tape.nextSpawnAt = c.now();
  tape.tick(c.now());

  const symbols = new Set(tape.rows.map((r) => r.ticker));
  assert.ok(symbols.size >= 1);
  assert.equal(tape.matching('').length, 0, 'nothing typed matches nothing');
  const live = tape.rows[0].ticker;
  assert.ok(tape.matching(live[0]).length >= 1);
  assert.equal(tape.matching('ZZZZ').length, 0);
});

test('keystrokes score against whatever is on the tape', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid }).start();
  c.advance(300);
  tape.tick(c.now());

  tape.type('S').type('SP');        // both reachable
  tape.type('SPZ');                 // reaches nothing
  assert.equal(tape.keystrokes, 3);
  assert.equal(tape.correctKeystrokes, 2);

  tape.type('SP');                  // backspace, not an error
  assert.equal(tape.backspaces, 1);
  assert.equal(tape.keystrokes, 3);
});

test('keystrokes typed against an empty tape are not scored', () => {
  const tape = new TapeSession(['SPY'], { random: mid }).start();
  tape.type('X').type('XY');
  assert.equal(tape.keystrokes, 0);
});

test('a burst lands as a rapid run of arrivals, not all on one timestamp', () => {
  const c = clock();
  const always = () => 0.01;                    // always rolls a burst
  const tape = new TapeSession(['SPY'], { now: c.now, random: always, intensity: 'storm' }).start();
  c.advance(300);
  tape.tick(c.now());
  assert.equal(tape.rows.length, 1, 'the burst does not all arrive at once');
  assert.ok(tape.burstRemaining > 0, 'more of the burst is queued');

  // Inside a burst the gap is short, so several land within a second.
  let arrivals = 1;
  for (let i = 0; i < 10; i += 1) {
    c.advance(100);
    arrivals += tape.tick(c.now()).spawned.length;
  }
  assert.ok(arrivals >= 3, `expected a burst of arrivals, got ${arrivals}`);
  const times = new Set(tape.rows.map((r) => r.spawnAt));
  assert.ok(times.size > 1, 'burst arrivals are spread over time');
});

test('prints in a burst go to different lanes', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: () => 0.01, intensity: 'storm' }).start();
  c.advance(300);
  for (let i = 0; i < 6; i += 1) {
    tape.tick(c.now());
    c.advance(150);
  }
  const lanes = tape.rows.slice(0, 3).map((r) => r.lane);
  assert.equal(new Set(lanes).size, lanes.length, `lanes collided: ${lanes}`);
});

test('the tape never exceeds its concurrency cap', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: () => 0.01, intensity: 'storm' }).start();
  for (let i = 0; i < 40; i += 1) {
    c.advance(200);
    tape.tick(c.now());
  }
  assert.ok(tape.rows.length <= 16, `cap exceeded: ${tape.rows.length}`);
});

test('phonetic prints get more runway than plain ones', () => {
  const c = clock();
  const plain = new TapeSession(['SPY'], { now: c.now, random: mid, mode: 'ticker' }).start();
  const spoken = new TapeSession(['SPY'], { now: c.now, random: mid, mode: 'phonetic' }).start();
  c.advance(300);
  plain.tick(c.now());
  spoken.tick(c.now());
  assert.ok(spoken.rows[0].riseMs > plain.rows[0].riseMs);
  assert.equal(spoken.rows[0].expected, 'sierra papa yankee');
});

test('phonetic prints are answered with the spoken form', () => {
  const c = clock();
  const tape = new TapeSession(['QQQ'], { now: c.now, random: mid, mode: 'phonetic' }).start();
  c.advance(300);
  tape.tick(c.now());
  tape.type('quebec quebec quebec');
  assert.equal(tape.submit(c.now()).hit, true);
});

test('mixed mode puts both kinds of print on the tape', () => {
  const c = clock();
  const low = new TapeSession(['SPY'], { now: c.now, random: () => 0.9, mode: 'mixed' }).start();
  const high = new TapeSession(['SPY'], { now: c.now, random: () => 0.2, mode: 'mixed' }).start();
  c.advance(300);
  low.tick(c.now());
  high.tick(c.now());
  assert.equal(low.rows[0].mode, 'phonetic');
  assert.equal(high.rows[0].mode, 'ticker');
});

test('no new prints arrive after time is up', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid, durationMs: 5000 }).start();
  c.advance(300);
  tape.tick(c.now());
  const before = tape.nextId;

  c.advance(9000);
  const { spawned } = tape.tick(c.now());
  assert.equal(spawned.length, 0);
  assert.equal(tape.nextId, before);
});

test('the run ends once the clock is up and the window has drained', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid, durationMs: 5000 }).start();
  c.advance(300);
  tape.tick(c.now());
  assert.equal(tape.finished, false);

  c.advance(6000);
  tape.tick(c.now());          // past time, print still rising
  assert.equal(tape.finished, false, 'waits for the tape to clear');

  c.advance(30000);
  tape.tick(c.now());          // print escapes, window empty
  assert.equal(tape.finished, true);
});

test('ending early does not penalise what was still on screen', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid }).start();
  c.advance(300);
  tape.tick(c.now());
  c.advance(500);
  const summary = tape.end(c.now());
  assert.equal(summary.escaped, 0);
  assert.equal(summary.prompts, 0);
});

test('summary carries both hit and escape counts', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid, listName: 'Watchlist' }).start();
  c.advance(300);
  tape.tick(c.now());
  c.advance(600);
  tape.type('SPY');
  tape.submit(c.now());

  tape.nextSpawnAt = c.now();
  tape.tick(c.now());
  const row = tape.rows[0];
  c.set(row.spawnAt + row.riseMs + 1);
  tape.tick(c.now());

  const summary = tape.end(c.now());
  assert.equal(summary.style, 'tape');
  assert.equal(summary.listName, 'Watchlist');
  assert.equal(summary.correct, 1);
  assert.equal(summary.escaped, 1);
  assert.equal(summary.prompts, 2);
  assert.equal(summary.promptAccuracy, 50);
  assert.ok(summary.tickersPerMinute > 0);
  assert.equal(summary.results.length, 2);
});

test('summary shape matches what the history views expect', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: mid }).start();
  c.advance(300);
  tape.tick(c.now());
  c.advance(600);
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

test('every intensity is fully specified', () => {
  for (const [name, tuning] of Object.entries(INTENSITIES)) {
    assert.ok(tuning.label, `${name} has no label`);
    assert.equal(tuning.spawnMs.length, 2);
    assert.equal(tuning.riseMs.length, 2);
    assert.ok(tuning.spawnMs[0] < tuning.spawnMs[1]);
    assert.ok(tuning.riseMs[0] < tuning.riseMs[1]);
  }
  assert.ok(INTENSITIES.storm.spawnMs[0] < INTENSITIES.calm.spawnMs[0], 'storm is busier');
  assert.ok(INTENSITIES.storm.riseMs[1] < INTENSITIES.calm.riseMs[1], 'storm is faster');
});
