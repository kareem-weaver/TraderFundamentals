import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, parseTickers, shuffle } from '../src/tickers.js';

test('parses across commas, spaces and newlines', () => {
  const { tickers } = parseTickers('spy, qqq\niwm;dia  vti');
  assert.deepEqual(tickers, ['SPY', 'QQQ', 'IWM', 'DIA', 'VTI']);
});

test('uppercases and keeps dots, dashes and slashes', () => {
  assert.deepEqual(parseTickers('brk.b rds-a es/z4').tickers, ['BRK.B', 'RDS-A', 'ES/Z4']);
});

test('dedupes by default and can be told not to', () => {
  assert.deepEqual(parseTickers('SPY spy SPY').tickers, ['SPY']);
  assert.deepEqual(parseTickers('SPY spy', { dedupe: false }).tickers, ['SPY', 'SPY']);
});

test('reports rejected junk instead of silently dropping it', () => {
  const { tickers, rejected } = parseTickers('SPY $$$ QQQ .BAD');
  assert.deepEqual(tickers, ['SPY', 'QQQ']);
  assert.deepEqual(rejected, ['$$$', '.BAD']);
});

test('empty input yields nothing', () => {
  assert.deepEqual(parseTickers('   ').tickers, []);
  assert.deepEqual(parseTickers(null).tickers, []);
});

test('shuffle keeps every item and leaves the input alone', () => {
  const input = ['A', 'B', 'C', 'D'];
  const out = shuffle(input, () => 0.5);
  assert.deepEqual([...out].sort(), [...input].sort());
  assert.deepEqual(input, ['A', 'B', 'C', 'D']);
});

test('queue defaults to one pass over the list', () => {
  assert.equal(buildQueue(['A', 'B', 'C'], { order: 'sequential' }).length, 3);
});

test('queue repeats the list to reach the requested length', () => {
  const queue = buildQueue(['A', 'B'], { length: 5, order: 'sequential' });
  assert.deepEqual(queue, ['A', 'B', 'A', 'B', 'A']);
});

test('queue truncates when the list is longer than the run', () => {
  assert.deepEqual(buildQueue(['A', 'B', 'C'], { length: 2, order: 'sequential' }), ['A', 'B']);
});

test('empty list yields an empty queue', () => {
  assert.deepEqual(buildQueue([], { length: 10 }), []);
});
