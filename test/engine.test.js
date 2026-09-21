import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, expectedAnswer, gradeTicker, isAnswerCorrect, isOnTrack } from '../src/engine.js';

/** A clock we control, so timings in tests are exact. */
function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const fixed = (value) => () => value;

test('expected answer follows the mode', () => {
  assert.equal(expectedAnswer('qqq', 'ticker'), 'QQQ');
  assert.equal(expectedAnswer('qqq', 'phonetic'), 'quebec quebec quebec');
});

test('grades a ticker character by character', () => {
  assert.deepEqual(gradeTicker('SPY', 'SP').chars.map((c) => c.status), ['ok', 'ok', 'pending']);
  assert.deepEqual(gradeTicker('SPY', 'SX').chars.map((c) => c.status), ['ok', 'bad', 'pending']);
});

test('grading a ticker is case insensitive and catches overflow', () => {
  assert.ok(gradeTicker('SPY', 'spy').complete);
  assert.equal(gradeTicker('SPY', 'SPYX').overflow, 'X');
  assert.equal(gradeTicker('SPY', 'SPYX').errors, 1);
});

test('on-track detection for both modes', () => {
  assert.ok(isOnTrack('SPY', 'SP', 'ticker'));
  assert.equal(isOnTrack('SPY', 'SX', 'ticker'), false);
  assert.equal(isOnTrack('SPY', 'SPYY', 'ticker'), false, 'too long is off track');
  assert.ok(isOnTrack('SPY', 'sierra pa', 'phonetic'));
  assert.equal(isOnTrack('SPY', 'sierra zz', 'phonetic'), false);
  assert.ok(isOnTrack('SPY', '', 'ticker'), 'empty is always on track');
});

test('answers are checked per mode, trimming whitespace', () => {
  assert.ok(isAnswerCorrect('SPY', ' spy ', 'ticker'));
  assert.ok(isAnswerCorrect('SPY', 'sierra papa yankee', 'phonetic'));
  assert.equal(isAnswerCorrect('SPY', 'SPY', 'phonetic'), false);
});

test('a clean run scores 100% and records every prompt', () => {
  const c = clock();
  const session = new Session(['SPY', 'QQQ'], {
    order: 'sequential', mode: 'ticker', now: c.now, random: fixed(0)
  }).start();

  c.advance(500);
  session.type('S').type('SP').type('SPY');
  c.advance(500);
  assert.equal(session.submit().accepted, true);

  session.type('Q').type('QQ').type('QQQ');
  c.advance(1000);
  const last = session.submit();
  assert.equal(last.finished, true);

  const summary = session.summary();
  assert.equal(summary.prompts, 2);
  assert.equal(summary.correct, 2);
  assert.equal(summary.promptAccuracy, 100);
  assert.equal(summary.keystrokeAccuracy, 100);
  assert.equal(summary.elapsedMs, 2000);
  assert.ok(summary.wpm > 0);
  assert.ok(summary.results.every((r) => r.clean));
});

test('wrong keystrokes lower accuracy but backspaces do not', () => {
  const c = clock();
  const session = new Session(['SPY'], { order: 'sequential', now: c.now, random: fixed(0) }).start();
  session.type('S').type('SX');       // 2 keystrokes, 1 wrong
  session.type('S');                  // backspace
  session.type('SP').type('SPY');     // 2 more, both right
  assert.equal(session.keystrokes, 4);
  assert.equal(session.correctKeystrokes, 3);
  assert.equal(session.backspaces, 1);

  c.advance(1000);
  session.submit();
  const summary = session.summary();
  assert.equal(summary.keystrokeAccuracy, 75);
  assert.equal(summary.correct, 1, 'corrected answer still counts as correct');
  assert.equal(summary.results[0].clean, false, 'but it was not clean');
});

test('a wrong answer advances and is recorded as incorrect', () => {
  const c = clock();
  const session = new Session(['SPY', 'QQQ'], { order: 'sequential', now: c.now, random: fixed(0) }).start();
  session.type('XYZ');
  c.advance(800);
  const outcome = session.submit();
  assert.equal(outcome.accepted, true);
  assert.equal(outcome.result.correct, false);
  assert.equal(session.symbol, 'QQQ', 'moved on to the next prompt');
});

test('strict mode holds the prompt until it is right', () => {
  const c = clock();
  const session = new Session(['SPY', 'QQQ'], {
    order: 'sequential', strict: true, now: c.now, random: fixed(0)
  }).start();
  session.type('XYZ');
  const rejected = session.submit();
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.correct, false);
  assert.equal(session.symbol, 'SPY', 'still on the same prompt');
  assert.equal(session.results.length, 0);

  session.type('SPY');
  assert.equal(session.submit().accepted, true);
  assert.equal(session.symbol, 'QQQ');
});

test('an empty submit is ignored', () => {
  const session = new Session(['SPY'], { order: 'sequential', random: fixed(0) }).start();
  assert.equal(session.submit().accepted, false);
  session.type('   ');
  assert.equal(session.submit().accepted, false);
  assert.equal(session.results.length, 0);
});

test('skip records an incorrect result and moves on', () => {
  const c = clock();
  const session = new Session(['SPY', 'QQQ'], { order: 'sequential', now: c.now, random: fixed(0) }).start();
  c.advance(300);
  session.skip();
  assert.equal(session.results[0].correct, false);
  assert.equal(session.results[0].skipped, true);
  assert.equal(session.symbol, 'QQQ');
});

test('phonetic mode expects and grades the spoken form', () => {
  const c = clock();
  const session = new Session(['QQQ'], {
    mode: 'phonetic', order: 'sequential', now: c.now, random: fixed(0)
  }).start();
  assert.equal(session.expected, 'quebec quebec quebec');

  for (const value of ['quebec', 'quebec quebec', 'quebec quebec quebec']) session.type(value);
  c.advance(4000);
  const outcome = session.submit();
  assert.equal(outcome.result.correct, true);
  assert.equal(outcome.result.mode, 'phonetic');
});

test('mixed mode assigns a form to every prompt', () => {
  const session = new Session(['SPY', 'QQQ', 'IWM'], {
    mode: 'mixed', order: 'sequential', random: fixed(0.1)
  }).start();
  assert.deepEqual(session.promptModes, ['ticker', 'ticker', 'ticker']);

  const other = new Session(['SPY'], { mode: 'mixed', order: 'sequential', random: fixed(0.9) }).start();
  assert.deepEqual(other.promptModes, ['phonetic']);
});

test('ending early keeps the answers already given', () => {
  const c = clock();
  const session = new Session(['SPY', 'QQQ', 'IWM'], { order: 'sequential', now: c.now, random: fixed(0) }).start();
  session.type('SPY');
  c.advance(1000);
  session.submit();

  const summary = session.end();
  assert.equal(summary.prompts, 1);
  assert.equal(summary.correct, 1);
  assert.ok(session.finished);
});

test('a session with no symbols is finished on arrival', () => {
  const session = new Session([], { random: fixed(0) });
  assert.ok(session.finished);
  assert.equal(session.summary().prompts, 0);
  assert.equal(session.summary().wpm, 0);
});

test('pasted text is scored one character at a time', () => {
  const session = new Session(['SPY'], { order: 'sequential', random: fixed(0) }).start();
  session.type('SXY');
  assert.equal(session.keystrokes, 3);
  assert.equal(session.correctKeystrokes, 1, 'S is right; X and everything after is off track');
});

test('per-prompt error counts reset between prompts', () => {
  const c = clock();
  const session = new Session(['SPY', 'QQQ'], { order: 'sequential', now: c.now, random: fixed(0) }).start();
  session.type('X');
  session.type('');
  session.type('S').type('SP').type('SPY');
  c.advance(500);
  session.submit();
  assert.equal(session.results[0].errors, 1);

  session.type('Q').type('QQ').type('QQQ');
  c.advance(500);
  session.submit();
  assert.equal(session.results[1].errors, 0);
  assert.equal(session.results[1].backspaces, 0);
});
