// Parsing, validating and shuffling the symbols under test.

const VALID_SYMBOL = /^[A-Z0-9][A-Z0-9.\-/]*$/;

/** Starter lists so the app is useful before anyone pastes their own. */
export const PRESETS = [
  {
    name: 'Index ETFs',
    tickers: 'SPY QQQ IWM DIA VTI VOO IVV EFA EEM TLT HYG GLD SLV USO XLF XLE XLK XLV XLI XLU'
  },
  {
    name: 'Mega caps',
    tickers: 'AAPL MSFT NVDA AMZN GOOGL GOOG META TSLA BRK.B AVGO JPM LLY V XOM UNH MA COST HD WMT NFLX'
  },
  {
    name: 'Lookalikes',
    tickers: 'GOOG GOOGL BRK.A BRK.B VZ VT VTI VTV VUG VXX TQQQ SQQQ QQQ QQQM SPY SPXL SPXS UVXY SOXL SOXS'
  },
  {
    name: 'Watchlist',
    tickers:
      'DVA SIX C GM FITB PNFP CVS QMCO APUS WYY JAGX FORM VMO IQMX BTTC ILMN TBBB KITT ' +
      'MSGY CNC HUM RGTI AZO GRLM OPEN LH CHKP TRS MEGI PZT INSM MOD GWH MSCI CHTR O ' +
      'WARP BRN MGM QCOM OIG LITE GLND SNDK AXTX TEMP SRZN QBTS INVH JAN UDR PECO GII ' +
      'IONQ PICB SBR FOX RMI SGU NAD APP ONEN ' +
      // Liquid, frequently-traded names, so the tape reads like a real one.
      'NVDA TSLA AAPL MSFT AMZN META GOOGL AMD INTC MU ' +
      'AVGO SMCI PLTR COIN MSTR SOFI RIVN LCID NIO F ' +
      'BAC JPM WFC GS MS SCHW XOM CVX OXY SLB ' +
      'PFE MRNA LLY UNH ABBV BMY JNJ MRK GILD AMGN ' +
      'DIS NFLX WBD PARA ROKU SNAP PINS UBER LYFT DASH ' +
      'ABNB BKNG SHOP SQ PYPL HOOD AFRM UPST LMND CHWY ' +
      'BABA JD PDD TSM ASML ARM QRVO SWKS ON TER ' +
      'BA LMT RTX GE CAT DE HON MMM UPS FDX ' +
      'WMT TGT COST HD LOW NKE SBUX MCD KO PEP ' +
      'T VZ TMUS CMCSA CSCO ORCL CRM ADBE NOW SNOW'
  },
  {
    name: 'Hard to spell',
    tickers: 'NVDA NVAX NVDY XYLD JEPI JEPQ SCHD SCHG IBIT FBTC ARKK ARKG SMCI CRWD PLTR ASML TSM AMD MU QCOM'
  }
];

/**
 * Parse a free-form list (commas, spaces, newlines, semicolons all work).
 * @returns {{tickers: string[], rejected: string[]}}
 */
export function parseTickers(input, { dedupe = true } = {}) {
  const raw = String(input ?? '')
    .split(/[\s,;|]+/)
    // Trailing punctuation is almost always list formatting ("nad. app"), not
    // part of the symbol. Interior separators (BRK.B, RDS-A) are left alone.
    .map((token) => token.trim().toUpperCase().replace(/^[.\-/]+|[.\-/]+$/g, ''))
    .filter(Boolean);

  const tickers = [];
  const rejected = [];
  const seen = new Set();

  for (const token of raw) {
    if (!VALID_SYMBOL.test(token)) {
      rejected.push(token);
      continue;
    }
    if (dedupe && seen.has(token)) continue;
    seen.add(token);
    tickers.push(token);
  }
  return { tickers, rejected };
}

/** Fisher-Yates, with an injectable RNG so tests are deterministic. */
export function shuffle(items, random = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build the prompt queue for a run.
 * @param {string[]} tickers
 * @param {{length?: number, order?: 'shuffle'|'sequential', random?: () => number}} options
 */
export function buildQueue(tickers, { length, order = 'shuffle', random = Math.random } = {}) {
  if (tickers.length === 0) return [];
  const target = length && length > 0 ? length : tickers.length;
  const queue = [];
  while (queue.length < target) {
    const batch = order === 'shuffle' ? shuffle(tickers, random) : [...tickers];
    queue.push(...batch.slice(0, target - queue.length));
  }
  return queue;
}
