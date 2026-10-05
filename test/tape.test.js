import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODE_PACE, SPEED_DEFAULT, SPEED_MAX, SPEED_MIN, TAPE_ROWS, TapeSession,
  baseGapMs, clampSpeed, columnSeconds, meanGapFor, paceFor, speedWord,
  targetGapMs, toSpeed
} from '../src/tape.js';

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

  // Long enough to guarantee an arrival whatever the pace is tuned to.
  const aWhile = Math.ceil(tape.tuning.gapMs[1]) + 1;

  // Fill the remaining rows; nothing should escape yet.
  while (tape.rows.length < TAPE_ROWS) {
    c.advance(aWhile);
    assert.equal(tape.tick(c.now()).dropped.length, 0, 'nothing drops while there is room');
  }
  assert.equal(tape.rows.length, TAPE_ROWS);
  const bottom = tape.rows[TAPE_ROWS - 1];

  c.advance(aWhile);
  const { dropped } = tape.tick(c.now());
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].id, bottom.id, 'the bottom row is the one that goes');
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

test('taking a print scores it but leaves it on the column', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: plain }).start();
  const before = tape.rows.length;
  tape.type('SPY');
  const outcome = tape.submit(c.now());

  assert.equal(outcome.hit, true);
  assert.equal(tape.rows.length, before, 'the tape does not shrink because you read it');
  assert.ok(tape.rows.includes(outcome.row), 'it is still there');
  assert.equal(outcome.row.taken, true, 'just marked');
  assert.equal(tape.hits, 1);
  assert.equal(tape.results[0].correct, true);
});

test('a print already taken cannot be scored again', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: plain }).start();
  const copies = tape.rows.length;

  // Every row is SPY, so it can be taken exactly once per row and no more.
  for (let i = 0; i < copies; i += 1) {
    tape.type('SPY');
    assert.equal(tape.submit(c.now()).hit, true, `copy ${i + 1} should be takeable`);
  }
  tape.type('SPY');
  assert.equal(tape.submit(c.now()).hit, false, 'nothing left untaken');
  assert.equal(tape.hits, copies);
  assert.equal(tape.wrongSubmits, 1);
});

test('a taken print is not offered as a match again', () => {
  const tape = new TapeSession(['SPY'], { random: plain }).start();
  const before = tape.matching('SPY').length;
  tape.type('SPY');
  tape.submit();
  assert.equal(tape.matching('SPY').length, before - 1);
});

test('a taken print dropping off the bottom is not an escape', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], {
    now: c.now, random: plain, durationMs: 10 * 60_000
  }).start();

  // Take every print currently on the column.
  const taken = tape.rows.length;
  for (let i = 0; i < taken; i += 1) {
    tape.type('SPY');
    tape.submit(c.now());
  }
  assert.equal(tape.hits, taken);

  // Push all of them off the bottom.
  while (tape.rows.some((r) => r.taken)) {
    c.advance(2000);
    tape.tick(c.now());
  }
  assert.equal(tape.escaped, 0, 'banked prints leave without penalty');
  assert.equal(tape.results.filter((r) => r.escaped).length, 0);
});

test('an untaken print dropping off the bottom still escapes', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], {
    now: c.now, random: plain, durationMs: 10 * 60_000
  }).start();
  while (tape.escaped === 0) {
    c.advance(2000);
    tape.tick(c.now());
  }
  assert.ok(tape.escaped >= 1);
});

test('every print carries a direction', () => {
  const tape = new TapeSession(['SPY'], { random: mid }).start();
  assert.ok(tape.rows.length > 0);
  for (const row of tape.rows) {
    assert.ok(row.direction === 'up' || row.direction === 'down', `bad direction ${row.direction}`);
    assert.equal(row.taken, false, 'nothing starts taken');
  }
});

test('direction is split rather than fixed', () => {
  const c = clock();
  let seed = 99;
  const rng = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const tape = new TapeSession(['SPY', 'QQQ'], {
    now: c.now, random: rng, durationMs: 60 * 60_000
  }).start();
  for (let i = 0; i < 200; i += 1) {
    c.advance(2000);
    tape.tick(c.now());
  }
  const ups = tape.rows.filter((r) => r.direction === 'up').length;
  assert.ok(ups > 0 && ups < tape.rows.length, `all one way: ${ups}/${tape.rows.length}`);
});

test('with the symbol repeated, the lowest untaken copy goes first', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: plain }).start();
  const lowest = tape.rows[tape.rows.length - 1];
  const nextUp = tape.rows[tape.rows.length - 2];
  assert.ok(tape.rows.length > 2);

  tape.type('SPY');
  assert.equal(tape.submit(c.now()).row.id, lowest.id, 'closest to falling off first');
  tape.type('SPY');
  assert.equal(tape.submit(c.now()).row.id, nextUp.id, 'then the one above it');
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
    'correct', 'elapsedMs', 'wpm', 'promptAccuracy', 'avgMs', 'results',
    'durationMs', 'speed', 'style']) {
    assert.ok(summary[key] !== undefined, `missing ${key}`);
  }
  assert.ok(Array.isArray(summary.results));
});

test('the summary reports the settings the run was configured with', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], {
    now: c.now, random: plain, durationMs: 60_000, speed: 9, mode: 'phonetic'
  }).start();
  c.advance(1000);
  const summary = tape.end(c.now());
  // Ended after 1s, but the contest was a 60s storm run - that is what ranks.
  assert.equal(summary.durationMs, 60_000);
  assert.equal(summary.speed, 9);
  assert.equal(summary.mode, 'phonetic');
  assert.equal(summary.style, 'tape');
});

test('an empty symbol list finishes immediately', () => {
  const tape = new TapeSession([], { random: mid });
  assert.equal(tape.finished, true);
  assert.equal(tape.summary().prompts, 0);
});

test('a burst lands as a rapid run of arrivals, not all on one timestamp', () => {
  const c = clock();
  const tape = new TapeSession(['SPY'], { now: c.now, random: () => 0.01, speed: 9 }).start();
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

test('the speed dial runs 1 to 10 and clamps anything else', () => {
  assert.equal(clampSpeed(0), SPEED_MIN);
  assert.equal(clampSpeed(99), SPEED_MAX);
  assert.equal(clampSpeed(4.4), 4);
  assert.equal(clampSpeed('7'), 7);
  assert.equal(clampSpeed(undefined), SPEED_DEFAULT);
  assert.equal(clampSpeed(NaN), SPEED_DEFAULT);
});

test('every step up the dial makes the tape faster', () => {
  for (let level = SPEED_MIN; level < SPEED_MAX; level += 1) {
    assert.ok(baseGapMs(level) > baseGapMs(level + 1),
      `level ${level + 1} is not faster than ${level}`);
  }
});

test('the dial spans a wide but sane range', () => {
  assert.ok(columnSeconds(SPEED_MIN, 'ticker') > 40, 'level 1 is genuinely slow');
  assert.ok(columnSeconds(SPEED_MAX, 'ticker') < 6, 'level 10 is genuinely fast');
});

test('busier settings burst more often and in bigger clumps', () => {
  const slow = paceFor(SPEED_MIN, 'ticker');
  const fast = paceFor(SPEED_MAX, 'ticker');
  assert.ok(fast.burstChance > slow.burstChance);
  assert.ok(fast.burstSize[1] > slow.burstSize[1]);
  assert.ok(slow.gapMs[0] < slow.gapMs[1], 'arrivals stay irregular at every setting');
});

test('phonetic gets more time per print than ticker at the same speed', () => {
  // The whole point: "sierra papa yankee" is not three keystrokes.
  for (let level = SPEED_MIN; level <= SPEED_MAX; level += 1) {
    assert.ok(columnSeconds(level, 'phonetic') > columnSeconds(level, 'ticker'),
      `speed ${level} gives phonetic no more room than ticker`);
  }
  assert.ok(MODE_PACE.phonetic > MODE_PACE.mixed);
  assert.ok(MODE_PACE.mixed > MODE_PACE.ticker);
});

test('mixed sits between the two, since half its prints are spoken', () => {
  assert.ok(columnSeconds(5, 'mixed') > columnSeconds(5, 'ticker'));
  assert.ok(columnSeconds(5, 'mixed') < columnSeconds(5, 'phonetic'));
});

test('a phonetic tape really does arrive more slowly', () => {
  const c = clock();
  const ticker = new TapeSession(['SPY'], { now: c.now, random: mid, mode: 'ticker', speed: 5 });
  const spoken = new TapeSession(['SPY'], { now: c.now, random: mid, mode: 'phonetic', speed: 5 });
  assert.ok(spoken.tuning.gapMs[0] > ticker.tuning.gapMs[0]);
  assert.ok(spoken.tuning.gapMs[1] > ticker.tuning.gapMs[1]);
});

test('the old named presets still load as the speeds they were', () => {
  assert.equal(toSpeed('calm'), 3);
  assert.equal(toSpeed('normal'), 5);
  assert.equal(toSpeed('storm'), 8);
  assert.equal(toSpeed(7), 7);
  assert.equal(toSpeed(undefined), SPEED_DEFAULT);
});

test('a session accepts an old preset name as well as a number', () => {
  const legacy = new TapeSession(['SPY'], { random: mid, speed: 'storm' });
  assert.equal(legacy.speed, 8);
  assert.equal(legacy.summary().speed, 8);
});

test('every level has a word to go with the number', () => {
  for (let level = SPEED_MIN; level <= SPEED_MAX; level += 1) {
    assert.ok(speedWord(level), `level ${level} has no word`);
  }
  assert.notEqual(speedWord(SPEED_MIN), speedWord(SPEED_MAX));
});

/** Run a tape for a long simulated stretch and report the mean arrival gap. */
function simulateMeanGap(mode, speed, seconds = 6000) {
  let t = 0;
  const tape = new TapeSession(['SPY', 'QQQ', 'IWM'], {
    mode, speed, durationMs: Number.MAX_SAFE_INTEGER, now: () => t
  });
  tape.start();
  const before = tape.nextId;
  for (let step = 0; step < seconds * 50; step += 1) {
    t += 20;
    tape.tick(t);
  }
  return (seconds * 1000) / (tape.nextId - before);
}

test('the arrival gap the tape actually runs at matches the one it advertises', () => {
  // Regression: the setup screen derived its "about Ns per print" from the base
  // gap alone. Arrivals inside a burst come far quicker, and busier settings
  // spend more time inside one, so the real tape ran up to twice as fast as the
  // number on screen claimed.
  for (const mode of ['ticker', 'phonetic', 'mixed']) {
    for (const speed of [1, 4, 7, 10]) {
      const target = targetGapMs(speed, mode);
      const measured = simulateMeanGap(mode, speed);
      const error = Math.abs(measured - target) / target;
      assert.ok(error < 0.15,
        `${mode} at speed ${speed}: advertised ${Math.round(target)}ms, ran at ${Math.round(measured)}ms`);
    }
  }
});

test('the analytic mean gap accounts for bursts, not just the base gap', () => {
  const pace = paceFor(7, 'ticker');
  const baseMean = (pace.gapMs[0] + pace.gapMs[1]) / 2;
  const withBursts = meanGapFor(baseMean, pace);
  assert.ok(withBursts < baseMean, 'bursts can only shorten the average');
  assert.ok(Math.abs(withBursts - targetGapMs(7, 'ticker')) < 1,
    'and the base gap is chosen so the result lands on target');
});

test('the advertised seconds-on-column follows from the advertised gap', () => {
  for (const mode of ['ticker', 'phonetic']) {
    for (let speed = SPEED_MIN; speed <= SPEED_MAX; speed += 1) {
      assert.equal(columnSeconds(speed, mode),
        Math.round((TAPE_ROWS * targetGapMs(speed, mode)) / 1000));
    }
  }
});

test('the base gap is raised to compensate for bursting', () => {
  // Busier levels burst more, so their base gap has to sit above the target.
  assert.ok(baseGapMs(10, 'ticker') > targetGapMs(10, 'ticker'));
  assert.ok(baseGapMs(1, 'ticker') > targetGapMs(1, 'ticker'));
});
