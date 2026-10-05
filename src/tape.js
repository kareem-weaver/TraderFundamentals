// The prints tape: a fixed-height column of the last N prints. New ones land at
// the top and shove everything down; whatever falls off the bottom is gone.
// Take a print by typing it before it is pushed out.
//
// Symbols repeat in runs the way a real tape does - usually a couple in a row,
// occasionally enough to fill the whole column.
//
// DOM-free, and every source of variation is injectable, so the whole thing is
// unit testable.

import { expectedAnswer, isAnswerCorrect, isOnTrack } from './engine.js';

/** Rows in the column. A print survives this many arrivals after its own. */
export const TAPE_ROWS = 20;

/** How full the column is when a run starts, so there is a tape to read. */
const PREFILL_ROWS = 12;

/** Gap between arrivals inside a burst. */
const BURST_GAP_MS = [80, 190];
const BURST_GAP_MEAN = (BURST_GAP_MS[0] + BURST_GAP_MS[1]) / 2;

/* ── Pace ───────────────────────────────────────────────────────────────── */

export const SPEED_MIN = 1;
export const SPEED_MAX = 10;
export const SPEED_DEFAULT = 5;

/** Gap between arrivals at the slowest and fastest settings, in ms. */
const GAP_AT_SLOWEST = 2600;
const GAP_AT_FASTEST = 200;

/**
 * How much longer each mode needs per print.
 *
 * A print survives TAPE_ROWS arrivals however you are answering, so the only
 * lever is the arrival gap. "SPY" is three keystrokes; "sierra papa yankee" is
 * eighteen plus the recall, roughly five times the work. Without this, phonetic
 * at a given speed is far harder than ticker at the same speed, which is not
 * what picking a speed should mean.
 */
export const MODE_PACE = { ticker: 1, phonetic: 3.5, mixed: 2.25 };

/** A word for each end of the dial, so the number is not the only cue. */
const SPEED_WORDS = ['Walk', 'Walk', 'Steady', 'Steady', 'Brisk', 'Brisk', 'Heavy', 'Heavy', 'Storm', 'Storm'];

export function clampSpeed(speed) {
  const n = Math.round(Number(speed));
  if (!Number.isFinite(n)) return SPEED_DEFAULT;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, n));
}

export function speedWord(speed) {
  return SPEED_WORDS[clampSpeed(speed) - 1];
}

/**
 * The gap we want between arrivals on average, before bursts are accounted
 * for. Geometric rather than linear, so each step up the dial feels like the
 * same jump in pressure.
 */
export function targetGapMs(speed, mode = 'ticker') {
  const level = clampSpeed(speed);
  const ratio = (level - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  const base = GAP_AT_SLOWEST * (GAP_AT_FASTEST / GAP_AT_SLOWEST) ** ratio;
  return base * (MODE_PACE[mode] ?? 1);
}

/** How clumpy the tape is at a given level. Busier settings burst harder. */
function burstShape(level) {
  const step = (level - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  return {
    burstChance: 0.12 + step * 0.3,
    burstSize: [2, 3 + Math.round(step * 4)],
    repeatChance: 0.1 + step * 0.08
  };
}

/**
 * The gap actually seen over a long run, which is not the base gap: arrivals
 * inside a burst come at BURST_GAP_MS instead, and busier settings spend more
 * of their time inside one.
 *
 * With p the chance of starting a burst and N its mean length, a share
 * f = 1 / (1 + p(N-1)) of arrivals are the ones that get to roll; the rest are
 * mid-burst and always take a burst gap.
 */
export function meanGapFor(baseGap, shape) {
  const meanSize = (shape.burstSize[0] + shape.burstSize[1] + 1) / 2;
  const rolls = 1 / (1 + shape.burstChance * (meanSize - 1));
  return (1 - rolls) * BURST_GAP_MEAN
    + rolls * (shape.burstChance * BURST_GAP_MEAN + (1 - shape.burstChance) * baseGap);
}

/** Invert the above, so the base gap lands the long-run mean on the target. */
function baseGapForTarget(target, shape) {
  const meanSize = (shape.burstSize[0] + shape.burstSize[1] + 1) / 2;
  const rolls = 1 / (1 + shape.burstChance * (meanSize - 1));
  const fromBursts = (1 - rolls) * BURST_GAP_MEAN + rolls * shape.burstChance * BURST_GAP_MEAN;
  const share = rolls * (1 - shape.burstChance);
  return Math.max(BURST_GAP_MEAN, (target - fromBursts) / share);
}

/** The base gap for a speed, with the mode adjustment applied. */
export function baseGapMs(speed, mode = 'ticker') {
  const level = clampSpeed(speed);
  return Math.round(baseGapForTarget(targetGapMs(level, mode), burstShape(level)));
}

/** Everything the tape needs to know about how fast to run. */
export function paceFor(speed, mode = 'ticker') {
  const level = clampSpeed(speed);
  const shape = burstShape(level);
  const base = baseGapForTarget(targetGapMs(level, mode), shape);
  return {
    // Spread around the mean so arrivals stay irregular at every setting.
    gapMs: [base * 0.6, base * 1.4],
    ...shape
  };
}

/**
 * How long a print stays on the column, in seconds. This is the number the
 * setup screen shows, so it has to be the real one - bursts included.
 */
export function columnSeconds(speed, mode = 'ticker') {
  return Math.round((TAPE_ROWS * targetGapMs(speed, mode)) / 1000);
}

/** Old saved settings used three named presets. */
const LEGACY_INTENSITY = { calm: 3, normal: 5, storm: 8 };

/** Accept either a 1-10 speed or one of the old preset names. */
export function toSpeed(value) {
  if (typeof value === 'string' && LEGACY_INTENSITY[value]) return LEGACY_INTENSITY[value];
  return clampSpeed(value ?? SPEED_DEFAULT);
}

const DEFAULTS = {
  mode: 'ticker',
  speed: SPEED_DEFAULT,
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
    this.speed = toSpeed(config.speed);
    this.tuning = paceFor(this.speed, config.mode);
    this.durationMs = config.durationMs;
    this.listName = config.listName;
    this.now = config.now;
    this.random = config.random;

    // rows[0] is the newest print, at the top. The last entry is about to fall
    // off the bottom.
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
    this.longestRun = 0;
    this.burstRemaining = 0;
    this.repeatTicker = null;
    this.repeatRemaining = 0;
    this.currentRun = 0;
  }

  /** A number in [min, max). */
  #between(min, max) {
    return min + this.random() * (max - min);
  }

  #randomTicker() {
    return this.tickers[Math.floor(this.random() * this.tickers.length)];
  }

  /**
   * How many prints a repeat run lasts. Weighted hard toward short runs, with
   * a thin tail that can fill the column.
   */
  #runLength() {
    const roll = this.random();
    if (roll < 0.6) return 2 + Math.floor(this.random() * 2);              // 2-3
    if (roll < 0.85) return 4 + Math.floor(this.random() * 3);             // 4-6
    if (roll < 0.97) return 7 + Math.floor(this.random() * 6);             // 7-12
    return 13 + Math.floor(this.random() * (TAPE_ROWS - 12));              // 13-20
  }

  /** The next symbol to print, continuing or starting a repeat run. */
  #nextTicker() {
    if (this.repeatRemaining > 0) {
      this.repeatRemaining -= 1;
      this.currentRun += 1;
      this.longestRun = Math.max(this.longestRun, this.currentRun);
      return this.repeatTicker;
    }

    const ticker = this.#randomTicker();
    this.currentRun = 1;
    this.longestRun = Math.max(this.longestRun, 1);

    if (this.tickers.length > 1 && this.random() < this.tuning.repeatChance) {
      this.repeatTicker = ticker;
      this.repeatRemaining = this.#runLength() - 1;
    }
    return ticker;
  }

  get elapsedMs() {
    if (this.startedAt === null) return 0;
    return (this.endedAt ?? this.now()) - this.startedAt;
  }

  get remainingMs() {
    return Math.max(0, this.durationMs - this.elapsedMs);
  }

  /** How far down the column a print sits: 0 at the top, 1 at the bottom row. */
  depthOf(row) {
    const index = this.rows.indexOf(row);
    return index < 0 ? 1 : index / (TAPE_ROWS - 1);
  }

  start() {
    const at = this.now();
    this.startedAt = at;

    // Seed the column so it reads like a tape already running, rather than
    // making you wait 20 arrivals before anything can be pushed out.
    for (let i = 0; i < PREFILL_ROWS; i += 1) {
      this.#push(at - (PREFILL_ROWS - i) * 400, { count: false });
    }
    this.nextSpawnAt = at + 300;
    this.peakLive = this.rows.length;
    return this;
  }

  /** Put one print at the top. Returns the row pushed off the bottom, if any. */
  #push(at, { count = true } = {}) {
    const ticker = this.#nextTicker();
    const mode = this.mode === 'mixed'
      ? (this.random() < 0.5 ? 'ticker' : 'phonetic')
      : this.mode;

    const row = {
      id: this.nextId++,
      ticker,
      mode,
      expected: expectedAnswer(ticker, mode),
      spawnAt: at,
      // Which way the print went. Cosmetic, but it is what a tape looks like.
      direction: this.random() < 0.5 ? 'up' : 'down',
      taken: false
    };
    this.rows.unshift(row);

    let evicted = null;
    if (this.rows.length > TAPE_ROWS) {
      evicted = this.rows.pop();
      // Something already taken just leaves; only a missed print is an escape.
      if (count && !evicted.taken) {
        this.escaped += 1;
        this.results.push({
          ticker: evicted.ticker,
          mode: evicted.mode,
          expected: evicted.expected,
          typed: '',
          correct: false,
          escaped: true,
          ms: at - evicted.spawnAt,
          errors: 0,
          clean: false
        });
      }
    }
    return { row, evicted };
  }

  /**
   * Advance the tape. Call once per animation frame.
   *
   * `dropped` is every print pushed off the bottom this tick, taken or not, so
   * the view can animate them out. Only the untaken ones counted as escapes.
   *
   * @returns {{spawned: object[], dropped: object[], finished: boolean}}
   */
  tick(at = this.now()) {
    if (this.finished) return { spawned: [], dropped: [], finished: true };

    const spawned = [];
    const dropped = [];
    const overtime = this.startedAt !== null && at - this.startedAt >= this.durationMs;

    if (!overtime) {
      while (at >= this.nextSpawnAt) {
        const { row, evicted } = this.#push(at);
        spawned.push(row);
        if (evicted) dropped.push(evicted);

        // A burst is a rapid run of arrivals rather than a simultaneous block.
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
          this.nextSpawnAt = at + this.#between(...this.tuning.gapMs);
        }
      }
    }

    this.peakLive = Math.max(this.peakLive, this.rows.length);

    // Once the clock is up the run ends; what is still on the column is not
    // held against you.
    if (overtime) {
      this.finished = true;
      this.endedAt = at;
      this.rows = [];
    }
    return { spawned, dropped, finished: this.finished };
  }

  /**
   * Prints whose answer could still become what is being typed. A print you
   * have already taken is not offered again, even though it stays on screen.
   */
  matching(typed = this.typed) {
    if (typed.trim() === '') return [];
    return this.rows.filter((row) => !row.taken && isOnTrack(row.ticker, typed, row.mode));
  }

  /**
   * Record an input change. A keystroke counts as correct when it keeps at
   * least one print on the column reachable.
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
   * Commit what is typed. Scores the lowest print not yet taken, since that is
   * the one about to be pushed off.
   *
   * The print stays on the column and keeps riding down to the bottom - the
   * tape does not shrink because you read it. It is just marked, so it cannot
   * be scored twice and will not count as an escape when it drops off.
   *
   * @returns {{hit: boolean, row?: object}}
   */
  submit(at = this.now()) {
    const typed = this.typed;
    if (typed.trim() === '') return { hit: false, empty: true };

    let target = -1;
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const row = this.rows[i];
      if (!row.taken && isAnswerCorrect(row.ticker, typed, row.mode)) {
        target = i;
        break;
      }
    }

    this.typed = '';

    if (target === -1) {
      this.wrongSubmits += 1;
      return { hit: false, typed };
    }

    const row = this.rows[target];
    row.taken = true;
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

  /** Stop early. Prints still on the column are not counted against you. */
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
      startedAt: this.startedAt,
      endedAt: this.endedAt ?? this.now(),
      mode: this.mode,
      speed: this.speed,
      columnSeconds: columnSeconds(this.speed, this.mode),
      listName: this.listName,
      // The length the run was set up for, not the elapsed time, so a run
      // ended early still records the contest it was started for.
      durationMs: this.durationMs,
      prompts: resolved,
      correct: this.hits,
      escaped: this.escaped,
      wrongSubmits: this.wrongSubmits,
      peakLive: this.peakLive,
      longestRun: this.longestRun,
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
