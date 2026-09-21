import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage so the browser module can run under node.
class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
  clear() { this.#map.clear(); }
}
globalThis.localStorage = new MemoryStorage();

const { store, mergeSessions, mergeLists } = await import('../src/storage.js');

beforeEach(() => store.clear());

const run = (id, endedAt = id) => ({ id: String(id), endedAt, prompts: 1, correct: 1, results: [] });

test('starts empty with usable defaults', () => {
  assert.deepEqual(store.sessions(), []);
  assert.equal(store.settings().mode, 'ticker');
});

test('sessions round-trip', () => {
  store.addSession(run(1));
  store.addSession(run(2));
  assert.deepEqual(store.sessions().map((s) => s.id), ['1', '2']);
});

test('settings merge rather than replace', () => {
  store.saveSettings({ mode: 'phonetic' });
  store.saveSettings({ length: 50 });
  const settings = store.settings();
  assert.equal(settings.mode, 'phonetic');
  assert.equal(settings.length, 50);
  assert.equal(settings.order, 'shuffle', 'untouched defaults survive');
});

test('lists save, overwrite by name, and delete', () => {
  store.saveList('Mine', ['SPY']);
  store.saveList('Mine', ['SPY', 'QQQ']);
  assert.equal(store.lists().length, 1);
  assert.deepEqual(store.lists()[0].tickers, ['SPY', 'QQQ']);
  store.deleteList('Mine');
  assert.deepEqual(store.lists(), []);
});

test('export produces valid JSON that import accepts', () => {
  store.addSession(run(1));
  const backup = store.export();
  store.clear();
  store.import(backup);
  assert.equal(store.sessions().length, 1);
});

test('import merges without duplicating sessions', () => {
  store.addSession(run(1));
  store.addSession(run(2));
  const backup = store.export();
  store.import(backup, { merge: true });
  assert.deepEqual(store.sessions().map((s) => s.id), ['1', '2']);
});

test('import brings in sessions this browser has not seen', () => {
  store.addSession(run(1));
  const incoming = { version: 1, sessions: [run(9, 9)], lists: [] };
  store.import(incoming, { merge: true });
  assert.deepEqual(store.sessions().map((s) => s.id), ['1', '9']);
});

test('import with merge off replaces history', () => {
  store.addSession(run(1));
  store.import({ version: 1, sessions: [run(9, 9)] }, { merge: false });
  assert.deepEqual(store.sessions().map((s) => s.id), ['9']);
});

test('import rejects a file that is not a backup', () => {
  assert.throws(() => store.import('{"hello":"world"}'), /does not look like/);
  assert.throws(() => store.import('not json at all'));
});

test('corrupt storage falls back to defaults instead of throwing', () => {
  localStorage.setItem('traderfundamentals.v1', '{{{not json');
  assert.deepEqual(store.sessions(), []);
  assert.equal(store.settings().mode, 'ticker');
});

test('merged sessions come back in chronological order', () => {
  const merged = mergeSessions([run(3, 300)], [run(1, 100), run(2, 200)]);
  assert.deepEqual(merged.map((s) => s.id), ['1', '2', '3']);
});

test('merging lists keeps the most recently saved copy', () => {
  const merged = mergeLists(
    [{ name: 'A', tickers: ['SPY'], savedAt: 1 }],
    [{ name: 'A', tickers: ['QQQ'], savedAt: 2 }]
  );
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].tickers, ['QQQ']);
});

test('clear wipes everything', () => {
  store.addSession(run(1));
  store.saveList('Mine', ['SPY']);
  store.clear();
  assert.deepEqual(store.sessions(), []);
  assert.deepEqual(store.lists(), []);
});
