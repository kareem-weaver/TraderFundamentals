// The typing-test state machine: prompts in, keystroke-level scoring out.
// Deliberately free of DOM references so it can be unit tested directly.

import { gradePhonetic, phoneticPhrase } from './phonetic.js';
import { buildQueue } from './tickers.js';

export const MODES = {
  ticker: { id: 'ticker', label: 'Ticker', hint: 'Type the symbol' },
  phonetic: { id: 'phonetic', label: 'Phonetic', hint: 'Type the phonetic alphabet' },
  mixed: { id: 'mixed', label: 'Mixed', hint: 'Whichever the prompt asks for' }
};

/** The answer expected for a symbol in a given mode. */
export function expectedAnswer(symbol, mode) {
  return mode === 'phonetic' ? phoneticPhrase(symbol) : String(symbol).toUpperCase();
}

/** Grade typed text against a ticker, character by character. */
export function gradeTicker(symbol, typed) {
  const target = String(symbol).toUpperCase();
  const value = String(typed).toUpperCase();
  const chars = [...target].map((char, index) => {
    if (index >= value.length) return { char, status: 'pending' };
    return { char, status: value[index] === char ? 'ok' : 'bad' };
  });
  const overflow = value.length > target.length ? value.slice(target.length) : '';
  return {
    chars,
    overflow,
    complete: value === target,
    errors: chars.filter((c) => c.status === 'bad').length + overflow.length
  };
}

/**
 * Is the text typed so far still on a correct path?
 * Used to score each keystroke as it lands.
 */
export function isOnTrack(symbol, typed, mode) {
  if (typed === '') return true;
  if (mode === 'phonetic') {
    const grade = gradePhonetic(symbol, typed);
    return grade.tokens.every((token) => token.status !== 'bad');
  }
  const target = String(symbol).toUpperCase();
  const value = String(typed).toUpperCase();
  return value.length <= target.length && target.startsWith(value);
}

/** Does this answer count as correct on submit? */
export function isAnswerCorrect(symbol, typed, mode) {
  if (mode === 'phonetic') return gradePhonetic(symbol, typed).complete;
  return String(typed).trim().toUpperCase() === String(symbol).toUpperCase();
}

const DEFAULTS = {
  mode: 'ticker',
  order: 'shuffle',
  length: 0,
  strict: false,
  now: () => Date.now(),
  random: Math.random
};

/**
 * A single run of the test.
 *
 * Lifecycle: `new Session(...)` -> `start()` -> `type(value)` per input event ->
 * `submit()` on Enter -> repeat until `finished`, then `summary()`.
 */
export class Session {
  constructor(tickers, options = {}) {
    const config = { ...DEFAULTS, ...options };
    this.now = config.now;
    this.mode = config.mode;
    this.order = config.order;
    this.strict = config.strict;
    this.listName = config.listName ?? 'Custom';
    this.queue = buildQueue(tickers, {
      length: config.length,
      order: config.order,
      random: config.random
    });
    // In mixed mode each prompt independently asks for one form or the other.
    this.promptModes = this.queue.map(() =>
      this.mode === 'mixed' ? (config.random() < 0.5 ? 'ticker' : 'phonetic') : this.mode
    );
    this.index = 0;
    this.typed = '';
    this.results = [];
    this.startedAt = null;
    this.endedAt = null;
    this.shownAt = null;
    this.firstKeyAt = null;
    this.keystrokes = 0;
    this.correctKeystrokes = 0;
    this.backspaces = 0;
    this.promptErrors = 0;
    this.finished = this.queue.length === 0;
  }

  get total() {
    return this.queue.length;
  }

  get symbol() {
    return this.queue[this.index];
  }

  get promptMode() {
    return this.promptModes[this.index];
  }

  get expected() {
    return expectedAnswer(this.symbol, this.promptMode);
  }

  start() {
    if (this.startedAt === null) this.startedAt = this.now();
    this.shownAt = this.now();
    return this;
  }

  /**
   * Record an input change. Scores each newly inserted character as correct or
   * not; backspaces are tracked separately and never counted as errors.
   */
  type(value) {
    if (this.finished) return this;
    const previous = this.typed;
    const next = String(value);
    if (this.firstKeyAt === null && next !== '') this.firstKeyAt = this.now();

    if (next.length < previous.length) {
      this.backspaces += previous.length - next.length;
    } else if (next.length > previous.length) {
      // Score the inserted run one character at a time so paste is graded too.
      for (let i = previous.length; i < next.length; i += 1) {
        const slice = next.slice(0, i + 1);
        this.keystrokes += 1;
        if (isOnTrack(this.symbol, slice, this.promptMode)) {
          this.correctKeystrokes += 1;
        } else {
          this.promptErrors += 1;
        }
      }
    }
    this.typed = next;
    return this;
  }

  /** Live grading for the current prompt, for the UI to render. */
  grade() {
    if (this.finished) return null;
    return this.promptMode === 'phonetic'
      ? gradePhonetic(this.symbol, this.typed)
      : gradeTicker(this.symbol, this.typed);
  }

  /**
   * Commit the current answer (Enter).
   * @returns {{accepted: boolean, result?: object}} `accepted: false` means strict
   * mode rejected a wrong answer and the prompt stays up.
   */
  submit() {
    if (this.finished) return { accepted: false };
    const typed = this.typed;
    if (typed.trim() === '') return { accepted: false };

    const correct = isAnswerCorrect(this.symbol, typed, this.promptMode);
    if (!correct && this.strict) {
      this.promptErrors += 1;
      return { accepted: false, correct: false };
    }

    const at = this.now();
    const result = {
      ticker: this.symbol,
      mode: this.promptMode,
      expected: this.expected,
      typed,
      correct,
      ms: at - (this.shownAt ?? at),
      typingMs: at - (this.firstKeyAt ?? this.shownAt ?? at),
      errors: this.promptErrors,
      backspaces: this.backspaces,
      clean: correct && this.promptErrors === 0 && this.backspaces === 0
    };
    this.results.push(result);

    this.typed = '';
    this.promptErrors = 0;
    this.backspaces = 0;
    this.firstKeyAt = null;
    this.index += 1;

    if (this.index >= this.queue.length) {
      this.finished = true;
      this.endedAt = at;
    } else {
      this.shownAt = at;
    }
    return { accepted: true, result, finished: this.finished };
  }

  /** Skip the current prompt without an answer; counts as incorrect. */
  skip() {
    if (this.finished) return { accepted: false };
    const at = this.now();
    this.results.push({
      ticker: this.symbol,
      mode: this.promptMode,
      expected: this.expected,
      typed: this.typed,
      correct: false,
      skipped: true,
      ms: at - (this.shownAt ?? at),
      typingMs: at - (this.firstKeyAt ?? this.shownAt ?? at),
      errors: this.promptErrors,
      backspaces: this.backspaces,
      clean: false
    });
    this.typed = '';
    this.promptErrors = 0;
    this.backspaces = 0;
    this.firstKeyAt = null;
    this.index += 1;
    if (this.index >= this.queue.length) {
      this.finished = true;
      this.endedAt = at;
    } else {
      this.shownAt = at;
    }
    return { accepted: true, finished: this.finished };
  }

  /** Stop early; whatever was answered still counts. */
  end() {
    if (!this.finished) {
      this.finished = true;
      this.endedAt = this.now();
    }
    return this.summary();
  }

  /** Roll the run up into the record that gets stored in history. */
  summary() {
    const results = this.results;
    const elapsedMs = results.reduce((sum, r) => sum + r.ms, 0);
    const typingMs = results.reduce((sum, r) => sum + r.typingMs, 0);
    const correct = results.filter((r) => r.correct).length;
    const chars = results.reduce((sum, r) => sum + r.expected.length, 0);
    const minutes = typingMs / 60000;

    return {
      id: `${this.startedAt ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: this.startedAt,
      endedAt: this.endedAt ?? this.now(),
      mode: this.mode,
      listName: this.listName,
      prompts: results.length,
      correct,
      elapsedMs,
      typingMs,
      // Standard typing-test WPM: five characters count as one word.
      wpm: minutes > 0 ? Math.round((chars / 5 / minutes) * 10) / 10 : 0,
      keystrokeAccuracy:
        this.keystrokes > 0
          ? Math.round((this.correctKeystrokes / this.keystrokes) * 1000) / 10
          : 100,
      promptAccuracy: results.length > 0 ? Math.round((correct / results.length) * 1000) / 10 : 0,
      avgMs: results.length > 0 ? Math.round(elapsedMs / results.length) : 0,
      keystrokes: this.keystrokes,
      results
    };
  }
}
