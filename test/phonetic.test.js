import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptedWords, gradePhonetic, isPhoneticMatch, phoneticPhrase, phoneticUnits } from '../src/phonetic.js';

test('spells a simple ticker', () => {
  assert.equal(phoneticPhrase('QQQ'), 'quebec quebec quebec');
  assert.equal(phoneticPhrase('SPY'), 'sierra papa yankee');
});

test('spells digits and separators', () => {
  assert.equal(phoneticPhrase('BRK.B'), 'bravo romeo kilo point bravo');
  assert.equal(phoneticPhrase('2X'), 'two xray');
});

test('is case insensitive on the symbol', () => {
  assert.equal(phoneticPhrase('qqq'), phoneticPhrase('QQQ'));
});

test('accepts the canonical spelling', () => {
  assert.ok(isPhoneticMatch('QQQ', 'quebec quebec quebec'));
});

test('accepts common alternate spellings', () => {
  assert.ok(isPhoneticMatch('A', 'alpha'), 'alpha for alfa');
  assert.ok(isPhoneticMatch('A', 'alfa'));
  assert.ok(isPhoneticMatch('J', 'juliet'));
  assert.ok(isPhoneticMatch('X', 'x-ray'), 'punctuation is stripped');
  assert.ok(isPhoneticMatch('9', 'nine'));
  assert.ok(isPhoneticMatch('9', 'niner'));
});

test('is forgiving about spacing and case', () => {
  assert.ok(isPhoneticMatch('SPY', '  Sierra   PAPA yankee  '));
});

test('treats the separator word as optional', () => {
  assert.ok(isPhoneticMatch('BRK.B', 'bravo romeo kilo point bravo'));
  assert.ok(isPhoneticMatch('BRK.B', 'bravo romeo kilo bravo'), 'point may be skipped');
  assert.ok(isPhoneticMatch('BRK.B', 'bravo romeo kilo dot bravo'), 'dot is accepted');
});

test('rejects wrong, short and long answers', () => {
  assert.equal(isPhoneticMatch('QQQ', 'quebec quebec'), false);
  assert.equal(isPhoneticMatch('QQQ', 'quebec quebec quebec quebec'), false);
  assert.equal(isPhoneticMatch('QQQ', 'quebec kilo quebec'), false);
  assert.equal(isPhoneticMatch('QQQ', ''), false);
});

test('a required unit cannot be skipped', () => {
  assert.equal(isPhoneticMatch('SPY', 'sierra yankee'), false);
});

test('grades an in-progress answer without flagging the open word', () => {
  const grade = gradePhonetic('QQQ', 'quebec que');
  assert.deepEqual(grade.tokens.map((t) => t.status), ['ok', 'partial']);
  assert.equal(grade.complete, false);
  assert.equal(grade.errors, 0);
});

test('flags a wrong word as soon as it can be ruled out', () => {
  const grade = gradePhonetic('QQQ', 'quebec z');
  assert.deepEqual(grade.tokens.map((t) => t.status), ['ok', 'bad']);
  assert.equal(grade.errors, 1);
});

test('a completed word that is wrong is bad, not partial', () => {
  const grade = gradePhonetic('QQQ', 'quebec zulu ');
  assert.deepEqual(grade.tokens.map((t) => t.status), ['ok', 'bad']);
});

test('nextUnit tracks how far the answer has got', () => {
  assert.equal(gradePhonetic('SPY', '').nextUnit, 0);
  assert.equal(gradePhonetic('SPY', 'sierra ').nextUnit, 1);
  assert.equal(gradePhonetic('SPY', 'sierra papa ').nextUnit, 2);
});

test('a bad token does not consume an expected unit', () => {
  // "zulu" is wrong, but "papa" after it should still line up with P.
  const grade = gradePhonetic('SPY', 'sierra zulu papa yankee');
  assert.deepEqual(grade.tokens.map((t) => t.status), ['ok', 'bad', 'ok', 'ok']);
  assert.equal(grade.complete, false);
});

test('exposes the accepted spellings per character', () => {
  assert.deepEqual(acceptedWords('Q'), ['quebec']);
  assert.ok(acceptedWords('A').includes('alpha'));
  assert.deepEqual(acceptedWords('!'), []);
});

test('unknown characters are dropped from the units', () => {
  assert.deepEqual(phoneticUnits('A!B').map((u) => u.char), ['A', 'B']);
});
