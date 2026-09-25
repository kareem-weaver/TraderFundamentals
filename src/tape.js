// The prints tape: symbols surface at the bottom and rise to the top, each at
// its own speed. Type one and press Enter to take it off the tape before it
// escapes. Arrivals are deliberately clumpy, so the load is uneven.
//
// DOM-free, and every source of variation is injectable, so the whole thing is
// unit testable.

import { expectedAnswer, isAnswerCorrect, isOnTrack } from './engine.js';

/**
 * How hard the tape runs.
 * `spawnMs` is the gap between arrivals, `riseMs` how long a print takes to
 * cross the window, `burstChance` how often several land at once.
 */
export const INTENSITIES = {
  calm: {
    label: 'Calm',
    note: 'Room to think.',
    spawnMs: [1500, 2800], riseMs: [9000, 15000], burstChance: 0.1, burstSize: [2, 3]
  },
  normal: {
    label: 'Normal',
    note: 'Steady, with the odd flurry.',
    spawnMs: [850, 1900], riseMs: [6000, 11000], burstChance: 0.2, burstSize: [2, 4]
  },
  storm: {
    label: 'Storm',
    note: 'You will not get them all.',
    spawnMs: [380, 1100], riseMs: [3800, 7500], burstChance: 0.32, burstSize: [3, 6]
  }
};

export const LANES = 4;
const MAX_LIVE = 16;
/** A lane needs this much clear space at the bottom before it takes a print. */
const LANE_CLEARANCE = 0.16;
/** Gap between arrivals inside a burst. */
const BURST_GAP_MS = [130, 280];

const DEFAULTS = {
  mode: 'ticker',
  intensity: 'normal',
  durationMs: 120000,
  listName: 'Custom',
  now: () => Date.now(),
  random: Math.random
};

export class TapeSession {
  constructor(tickers, options = {}) {
    const config = { ...DEFAULTS, ...options };
    this.tickers = [...tickers];
    this.mode = config.mode;
    this.intensity = config.intensity;
    this.tuning = INTENSITIES[config.intensity] ?? INTENSITIES.normal;
    this.durationMs = config.durationMs;
    this.listName = config.listName;
    this.now = config.now;
    this.random = config.random;

    this.rows = [];
    this.results = [];
    this.startedAt = null;
    this.endedAt = null;
    this.nextSpawnAt = 0;
    this.nextId = 1;
    this.typed = '';
    this.finished = this.tickers.length === 0;

    this.hits = 0;
    this.escaped = 0;
    this.wrongSubmits = 0;
    this.keystrokes = 0;
    this.correctKeystrokes = 0;
    this.backspaces = 0;
    this.peakLive = 0;
    this.burstRemaining = 0;
    this.laneLastSpawn = new Array(LANES).fill(-Infinity);
  }

  /** A number in [min, max). */
  #between(min, max) {
    return min + this.random() * (max - min);
  }

  #pickTicker() {
    return this.tickers[Math.floor(this.random() * this.tickers.length)];
  }

  /**
   * Put a new print in whichever lane has the most clear space at the bottom.
   * Going by free space rather than by last-spawn time accounts for prints
   * rising at different speeds.
   */
  #pickLane(at) {
    let best = 0;
    let bestRoom = -Infinity;
    for (let i = 0; i < LANES; i += 1) {
      const room = this.#laneRoom(i, at);
      // Ties go to the lane used least recently, which spreads a burst out.
      if (room > bestRoom || (room === bestRoom && this.laneLastSpawn[i] < this.laneLastSpawn[best])) {
        bestRoom = room;
        best = i;
      }
    }
    return best;
  }

  /** How far along the lowest print in a lane is; Infinity when the lane is clear. */
  #laneRoom(lane, at) {
    let room = Infinity;
    for (const row of this.rows) {
      if (row.lane === lane) room = Math.min(room, this.progressOf(row, at));
    }
    return room;
  }

  get elapsedMs() {
    if (this.startedAt === null) return 0;
    return (this.endedAt ?? this.now()) - this.startedAt;
  }

  get remainingMs() {
    return Math.max(0, this.durationMs - this.elapsedMs);
  }

  start() {
    const at = this.now();
    this.startedAt = at;
    // First print lands almost immediately so the window is never empty at the off.
    this.nextSpawnAt = at + 250;
    return this;
  }

  #spawn(at) {
    const ticker = this.#pickTicker();
    const mode = this.mode === 'mixed'
      ? (this.random() < 0.5 ? 'ticker' : 'phonetic')
      : this.mode;
    const lane = this.#pickLane(at);
    this.laneLastSpawn[lane] = at;

    const row = {
      id: this.nextId++,
      ticker,
      mode,
      expected: expectedAnswer(ticker, mode),
      spawnAt: at,
      // Phonetic answers take far longer to type, so give them more runway.
      riseMs: this.#between(...this.tuning.riseMs) * (mode === 'phonetic' ? 1.7 : 1),
      lane,
      jitter: this.random()
    };
    this.rows.push(row);
    return row;
  }

  /** 0 at the bottom, 1 at the top, past 1 means it has escaped. */
  progressOf(row, at = this.now()) {
    return (at - row.spawnAt) / row.riseMs;
  }

  /**
   * Advance the tape. Call once per animation frame.
   * @returns {{spawned: object[], escaped: object[], finished: boolean}}
   */
  tick(at = this.now()) {
    if (this.finished) return { spawned: [], escaped: [], finished: true };

    const spawned = [];
    const escaped = [];
    const overtime = this.startedAt !== null && at - this.startedAt >= this.durationMs;

    // Retire anything that reached the top.
    for (const row of [...this.rows]) {
      if (this.progressOf(row, at) >= 1) {
        this.rows.splice(this.rows.indexOf(row), 1);
        this.escaped += 1;
        this.results.push({
          ticker: row.ticker,
          mode: row.mode,
          expected: row.expected,
          typed: '',
          correct: false,
          escaped: true,
          ms: row.riseMs,
          errors: 0,
          clean: false
        });
        escaped.push(row);
      }
    }

    // Stop feeding the tape once time is up, but let what is on screen play out.
    if (!overtime) {
      while (at >= this.nextSpawnAt && this.rows.length < MAX_LIVE) {
        // Every lane still crowded at the bottom? Hold the print back rather
        // than dropping it on top of one that has barely moved.
        if (this.#laneRoom(this.#pickLane(at), at) < LANE_CLEARANCE) {
          this.nextSpawnAt = at + 140;
          break;
        }
        spawned.push(this.#spawn(at));

        // A burst is a rapid run of arrivals, not a simultaneous block - they
        // land close together but far enough apart to read.
        if (this.burstRemaining > 0) {
          this.burstRemaining -= 1;
          this.nextSpawnAt = at + this.#between(...BURST_GAP_MS);
        } else if (this.random() < this.tuning.burstChance) {
          const size = Math.round(
            this.#between(this.tuning.burstSize[0], this.tuning.burstSize[1] + 0.999)
          );
          this.burstRemaining = Math.max(0, size - 1);
          this.nextSpawnAt = at + this.#between(...BURST_GAP_MS);
        } else {
          this.nextSpawnAt = at + this.#between(...this.tuning.spawnMs);
        }
      }
    }

    this.peakLive = Math.max(this.peakLive, this.rows.length);

    // The run ends when the clock is up and the window has drained.
    if (overtime && this.rows.length === 0) {
      this.finished = true;
      this.endedAt = at;
    }
    return { spawned, escaped, finished: this.finished };
  }

  /** Live rows whose answer could still become what is being typed. */
  matching(typed = this.typed) {
    if (typed.trim() === '') return [];
    return this.rows.filter((row) => isOnTrack(row.ticker, typed, row.mode));
  }

  /**
   * Record an input change. A keystroke counts as correct when it keeps at
   * least one print on the tape reachable.
   */
  type(value) {
    const previous = this.typed;
    const next = String(value);

    if (next.length < previous.length) {
      this.backspaces += previous.length - next.length;
    } else if (next.length > previous.length && this.rows.length > 0) {
      for (let i = previous.length; i < next.length; i += 1) {
        this.keystrokes += 1;
        if (this.matching(next.slice(0, i + 1)).length > 0) this.correctKeystrokes += 1;
      }
    }
    this.typed = next;
    return this;
  }

  /**
   * Commit what is typed. Takes the matching print closest to the top, since
   * that is the one about to be lost.
   * @returns {{hit: boolean, row?: object}}
   */
  submit(at = this.now()) {
    const typed = this.typed;
    if (typed.trim() === '') return { hit: false, empty: true };

    const candidates = this.rows
      .filter((row) => isAnswerCorrect(row.ticker, typed, row.mode))
      .sort((a, b) => this.progressOf(b, at) - this.progressOf(a, at));

    this.typed = '';

    if (candidates.length === 0) {
      this.wrongSubmits += 1;
      return { hit: false, typed };
    }

    const row = candidates[0];
    this.rows.splice(this.rows.indexOf(row), 1);
    this.hits += 1;
    this.results.push({
      ticker: row.ticker,
      mode: row.mode,
      expected: row.expected,
      typed,
      correct: true,
      escaped: false,
      ms: at - row.spawnAt,
      errors: 0,
      clean: true
    });
    return { hit: true, row };
  }

  /** Stop early. Prints still on screen are not counted against you. */
  end(at = this.now()) {
    if (!this.finished) {
      this.finished = true;
      this.endedAt = at;
      this.rows = [];
    }
    return this.summary();
  }

  /**
   * Same shape the one-at-a-time engine produces, so history, the progress
   * charts and the per-symbol table treat both the same.
   */
  summary() {
    const resolved = this.results.length;
    const elapsedMs = this.elapsedMs;
    const chars = this.results
      .filter((r) => r.correct)
      .reduce((sum, r) => sum + r.expected.length, 0);
    const minutes = elapsedMs / 60000;
    const hitTimes = this.results.filter((r) => r.correct).map((r) => r.ms);

    return {
      id: `${this.startedAt ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      style: 'tape',
      intensity: this.intensity,
      startedAt: this.startedAt,
      endedAt: this.endedAt ?? this.now(),
      mode: this.mode,
      listName: this.listName,
      prompts: resolved,
      correct: this.hits,
      escaped: this.escaped,
      wrongSubmits: this.wrongSubmits,
      peakLive: this.peakLive,
      elapsedMs,
      typingMs: elapsedMs,
      wpm: minutes > 0 ? Math.round((chars / 5 / minutes) * 10) / 10 : 0,
      // Prints taken per minute - the number that actually says "keeping up".
      tickersPerMinute: minutes > 0 ? Math.round((this.hits / minutes) * 10) / 10 : 0,
      keystrokeAccuracy: this.keystrokes > 0
        ? Math.round((this.correctKeystrokes / this.keystrokes) * 1000) / 10
        : 100,
      promptAccuracy: resolved > 0 ? Math.round((this.hits / resolved) * 1000) / 10 : 0,
      avgMs: hitTimes.length > 0
        ? Math.round(hitTimes.reduce((a, b) => a + b, 0) / hitTimes.length)
        : 0,
      keystrokes: this.keystrokes,
      results: this.results
    };
  }
}
