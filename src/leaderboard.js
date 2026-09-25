// Shared leaderboard, backed by Supabase over its REST API (no SDK, no deps).
//
// There is no login. A group is identified by a passphrase, which never leaves
// the browser: what gets stored is its SHA-256 digest, so two groups with
// different passphrases cannot see each other's boards. That separates groups;
// it does not secure them. Anyone holding the anon key can read the table, and
// because scoring runs in the browser a determined visitor can post a made-up
// score. It is built for a desk of people who trust each other.

const SETTINGS_KEY = 'traderfundamentals.board.v1';
const TABLE = 'scores';

/* ── Pure helpers (unit tested) ─────────────────────────────────────────── */

/**
 * Runs are only comparable against the same settings, so each combination gets
 * its own board. A 1-minute calm tape is not the same contest as 5-minute storm.
 */
export function bucketOf(summary) {
  if (summary.style === 'tape') {
    return ['tape', summary.mode, summary.intensity ?? 'normal', summary.durationMs ?? 0].join('|');
  }
  return ['single', summary.mode, 'na', summary.prompts ?? 0].join('|');
}

/** A human label for a bucket key. */
export function bucketLabel(bucket) {
  const [style, mode, intensity, size] = String(bucket).split('|');
  if (style === 'tape') {
    const minutes = Number(size) / 60000;
    const time = Number.isFinite(minutes) && minutes > 0
      ? `${minutes % 1 === 0 ? minutes : minutes.toFixed(1)} min`
      : 'untimed';
    return `Tape · ${mode} · ${intensity} · ${time}`;
  }
  return `One at a time · ${mode} · ${size} prompts`;
}

/** The number a run is ranked on: prints banked on the tape, WPM otherwise. */
export function scoreOf(summary) {
  return summary.style === 'tape' ? summary.correct ?? 0 : summary.wpm ?? 0;
}

/** The row posted for a finished run. */
export function rowFor(summary, { name, board }) {
  return {
    board,
    bucket: bucketOf(summary),
    name: String(name).trim().slice(0, 24),
    score: scoreOf(summary),
    accuracy: summary.promptAccuracy ?? 0,
    wpm: summary.wpm ?? 0,
    taken: summary.correct ?? 0,
    escaped: summary.escaped ?? 0,
    longest_run: summary.longestRun ?? 0,
    style: summary.style ?? 'single',
    mode: summary.mode ?? 'ticker',
    intensity: summary.intensity ?? null,
    duration_ms: summary.durationMs ?? null,
    list_name: summary.listName ?? null
  };
}

/**
 * Collapse many runs down to each player's best, highest first.
 * Ties on score break on accuracy, then on whoever got there first.
 */
export function rankRows(rows, { limit = 20 } = {}) {
  const best = new Map();
  for (const row of rows) {
    const key = String(row.name).toLowerCase();
    const held = best.get(key);
    if (!held
      || row.score > held.score
      || (row.score === held.score && (row.accuracy ?? 0) > (held.accuracy ?? 0))) {
      best.set(key, row);
    }
  }
  return [...best.values()]
    .sort((a, b) =>
      b.score - a.score
      || (b.accuracy ?? 0) - (a.accuracy ?? 0)
      || new Date(a.created_at ?? 0) - new Date(b.created_at ?? 0))
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

/* ── Settings ───────────────────────────────────────────────────────────── */

export function loadBoard() {
  try {
    return {
      url: '', key: '', board: '', name: '', autoPost: true,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    };
  } catch {
    return { url: '', key: '', board: '', name: '', autoPost: true };
  }
}

export function saveBoard(patch) {
  const next = { ...loadBoard(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function clearBoard() {
  localStorage.removeItem(SETTINGS_KEY);
}

export function isConfigured() {
  const { url, key, board, name } = loadBoard();
  return Boolean(url && key && board && name);
}

/**
 * Turn a group passphrase into an opaque board id. The passphrase itself is
 * never stored or sent.
 */
export async function boardIdFor(passphrase) {
  const text = String(passphrase).trim().toLowerCase();
  if (text.length < 4) throw new Error('Use a passphrase of at least 4 characters.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/* ── Supabase REST ──────────────────────────────────────────────────────── */

function endpoint(path) {
  const { url } = loadBoard();
  if (!url) throw new Error('Add your Supabase project URL first.');
  return `${url.replace(/\/+$/, '')}/rest/v1/${path}`;
}

function headers(extra = {}) {
  const { key } = loadBoard();
  if (!key) throw new Error('Add your Supabase anon key first.');
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function handle(response) {
  if (response.ok) return response;
  const detail = await response.json().catch(() => ({}));
  const message = detail.message ?? detail.hint ?? response.statusText;
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Supabase rejected the request (${response.status}). Check the anon key and that the table's policies are in place.`);
  }
  if (response.status === 404) {
    throw new Error('No "scores" table found. Run the SQL from the README in the Supabase SQL editor.');
  }
  throw new Error(`Supabase error ${response.status}: ${message}`);
}

/** Post a finished run. Silently does nothing when the board is not set up. */
export async function post(summary) {
  if (!isConfigured()) return null;
  const { name, board } = loadBoard();
  const response = await fetch(endpoint(TABLE), {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(rowFor(summary, { name, board }))
  });
  await handle(response);
  return true;
}

/** Fetch and rank one bucket's board. */
export async function top(bucket, { limit = 20 } = {}) {
  const { board } = loadBoard();
  if (!board) throw new Error('Join a group first.');
  const query = new URLSearchParams({
    board: `eq.${board}`,
    bucket: `eq.${bucket}`,
    select: 'name,score,accuracy,wpm,taken,escaped,longest_run,created_at',
    order: 'score.desc,accuracy.desc',
    limit: String(limit * 8)
  });
  const response = await fetch(`${endpoint(TABLE)}?${query}`, { headers: headers() });
  await handle(response);
  return rankRows(await response.json(), { limit });
}

/** Which buckets this group has any scores in. */
export async function buckets() {
  const { board } = loadBoard();
  if (!board) return [];
  const query = new URLSearchParams({
    board: `eq.${board}`,
    select: 'bucket',
    order: 'created_at.desc',
    limit: '500'
  });
  const response = await fetch(`${endpoint(TABLE)}?${query}`, { headers: headers() });
  await handle(response);
  const rows = await response.json();
  return [...new Set(rows.map((r) => r.bucket))];
}

/** Confirm the URL, key and table all work. */
export async function verify() {
  const response = await fetch(`${endpoint(TABLE)}?select=board&limit=1`, { headers: headers() });
  await handle(response);
  return true;
}
