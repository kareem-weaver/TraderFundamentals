// NATO/ICAO phonetic alphabet, plus the grading logic for phonetic answers.

/** Canonical spoken word for each character. */
export const PHONETIC = {
  A: 'alfa', B: 'bravo', C: 'charlie', D: 'delta', E: 'echo', F: 'foxtrot',
  G: 'golf', H: 'hotel', I: 'india', J: 'juliett', K: 'kilo', L: 'lima',
  M: 'mike', N: 'november', O: 'oscar', P: 'papa', Q: 'quebec', R: 'romeo',
  S: 'sierra', T: 'tango', U: 'uniform', V: 'victor', W: 'whiskey',
  X: 'xray', Y: 'yankee', Z: 'zulu',
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four',
  5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'niner',
  '.': 'point', '-': 'dash', '/': 'slash'
};

// Spellings that are just as correct in the wild. The canonical word is what we
// display; anything in this list is accepted when typed.
const EXTRA_SPELLINGS = {
  A: ['alpha'],
  J: ['juliet'],
  W: ['whisky'],
  X: ['x-ray', 'exray'],
  3: ['tree'],
  4: ['fower', 'fawer'],
  5: ['fife'],
  9: ['nine'],
  1000: ['tousand'],
  '.': ['dot', 'decimal'],
  '-': ['hyphen', 'minus'],
  '/': ['stroke']
};

// Characters that a reader may legitimately skip when speaking a symbol.
const OPTIONAL_CHARS = new Set(['.', '-', '/']);

/** Strip a typed word down to comparable form: "X-Ray" -> "xray". */
export function normalizeWord(word) {
  return String(word).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Every accepted spelling for one character, canonical spelling first. */
export function acceptedWords(char) {
  const key = String(char).toUpperCase();
  const canonical = PHONETIC[key];
  if (!canonical) return [];
  const words = [canonical, ...(EXTRA_SPELLINGS[key] ?? [])];
  return [...new Set(words.map(normalizeWord))];
}

/**
 * Break a symbol into the units a phonetic answer must cover.
 * @returns {{char: string, word: string, accepts: string[], optional: boolean}[]}
 */
export function phoneticUnits(symbol) {
  return [...String(symbol).toUpperCase()]
    .filter((char) => PHONETIC[char] !== undefined)
    .map((char) => ({
      char,
      word: PHONETIC[char],
      accepts: acceptedWords(char),
      optional: OPTIONAL_CHARS.has(char)
    }));
}

/** The answer we display as the model response, e.g. "quebec quebec quebec". */
export function phoneticPhrase(symbol) {
  return phoneticUnits(symbol).map((unit) => unit.word).join(' ');
}

/** Split typed text into tokens, remembering whether the last one is still open. */
function tokenize(typed) {
  const text = String(typed);
  const trimmed = text.trim();
  const tokens = trimmed === '' ? [] : trimmed.split(/\s+/);
  return { tokens, lastIsOpen: tokens.length > 0 && !/\s$/.test(text) };
}

/**
 * Grade a phonetic answer, in progress or finished.
 *
 * Tokens are aligned against the expected units left to right; an optional unit
 * (a separator such as ".") may be skipped, so both "bravo romeo kilo point bravo"
 * and "bravo romeo kilo bravo" are correct for BRK.B.
 *
 * @returns {{tokens: {text: string, status: 'ok'|'partial'|'bad', unit: number}[],
 *            units: object[], nextUnit: number, complete: boolean, errors: number}}
 */
export function gradePhonetic(symbol, typed) {
  const units = phoneticUnits(symbol);
  const { tokens, lastIsOpen } = tokenize(typed);
  const graded = [];
  let cursor = 0;

  tokens.forEach((raw, index) => {
    const word = normalizeWord(raw);
    const isOpen = lastIsOpen && index === tokens.length - 1;
    let matched = -1;
    let status = 'bad';

    for (let k = cursor; k < units.length; k += 1) {
      const unit = units[k];
      if (unit.accepts.includes(word)) {
        matched = k;
        status = 'ok';
        break;
      }
      if (isOpen && word !== '' && unit.accepts.some((accepted) => accepted.startsWith(word))) {
        matched = k;
        status = 'partial';
        break;
      }
      // A required unit cannot be jumped over; an optional one can.
      if (!unit.optional) break;
    }

    if (matched === -1) {
      graded.push({ text: raw, status: 'bad', unit: cursor });
    } else {
      graded.push({ text: raw, status, unit: matched });
      cursor = matched + 1;
    }
  });

  const remainingRequired = units.slice(cursor).some((unit) => !unit.optional);
  const complete =
    !remainingRequired && graded.length > 0 && graded.every((token) => token.status === 'ok');

  return {
    tokens: graded,
    units,
    nextUnit: cursor,
    complete,
    errors: graded.filter((token) => token.status === 'bad').length
  };
}

/** True when the typed phrase is an acceptable phonetic reading of the symbol. */
export function isPhoneticMatch(symbol, typed) {
  return gradePhonetic(symbol, typed).complete;
}
