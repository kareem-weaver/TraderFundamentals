# TraderFundamentals

A typing trainer for ticker symbols — and for saying them out loud. A symbol
appears, you type it, you press <kbd>Enter</kbd>, the next one appears. It times
every prompt, scores every keystroke, and keeps the history so you can see
whether you are actually getting faster.

## What it does

**The prints tape (default).** A 20-row column down the right of the screen.
New prints land at the top and shove everything down a row; whatever falls off
the bottom is gone and counts against you. Type a symbol and press
<kbd>Enter</kbd> to bank it. **The print stays on the column** — the tape does
not shrink because you read it. It is marked with a tick, greys out, and rides
the rest of the way down without counting against you. You cannot bank the same
print twice, but a repeated symbol is a separate print each time, so a run of
six needs six answers.

Arrivals are deliberately clumpy — quiet stretches, then a burst — so the load
is uneven and you will not always keep up. That is the point. Symbols also
repeat in runs the way a real tape does: usually two or three together, and
once in a while enough of one symbol to fill the entire column.

Every print is green or red with an arrow, the way a tape shows which way it
went. That is decoration — it does not change what you type or how you score.

Three speeds: **Calm**, **Normal**, **Storm**. Runs are timed (1, 2 or 5
minutes) rather than a fixed number of symbols. The column starts part-filled
so there is a tape to read from the off. Whatever you have typed highlights
every print it could still bank, and <kbd>Enter</kbd> always takes the **lowest
unbanked** match — the one about to be pushed out.

Four things have to read at once on a single row, so each gets its own channel:

| Channel | Shows |
|---|---|
| Text colour + arrow | Which way the print went |
| Blue bar, left edge | Reachable by what you have typed |
| Background tint | Near the bottom — amber, then red |
| Dimmed, with a tick | Already banked |

**One at a time.** The original flow, still there under Drill style: a single
symbol, answer it, <kbd>Enter</kbd>, next. Fixed run length, optional strict
mode where a wrong answer will not advance.

**Two things to type.** In *ticker* mode the prompt is `QQQ` and you type `QQQ`.
In *phonetic* mode the prompt is still `QQQ` but the answer is
`quebec quebec quebec` — the NATO alphabet, the way you would read the symbol
over a phone or a squawk box. *Mixed* mode alternates at random and tells you
which form each prompt wants.

**Your symbols.** Paste any list on the Setup tab — commas, spaces and newlines
all work. Dots, dashes and slashes are fine, so `BRK.B` and `RDS-A` behave.
Save named lists for later. Five starter lists ship with it: the default
**Watchlist** of 162 liquid names, plus index ETFs, mega caps, a lookalikes set
(`GOOG`/`GOOGL`, `TQQQ`/`SQQQ`, `VT`/`VTI`/`VTV`) and a hard-to-spell set.

**Live feedback.** Ticker prompts colour character by character as you type.
Phonetic prompts show a chip per word that fills in as you get each one right.

**Scoring.**

| Measure | How it is worked out |
|---|---|
| WPM | Five characters counts as one word, over time spent actually typing |
| Accuracy | Prompts answered correctly; on the tape, taken vs. escaped |
| Keystroke accuracy | Characters that were right when typed — a typo you fix still costs you. On the tape, a keystroke is right while it still reaches something on screen |
| Time per prompt | Prompt appearing → <kbd>Enter</kbd>; on the tape, from when it surfaced |
| Per minute | Symbols taken off the tape per minute — the number that says "keeping up" |
| Longest run | The longest streak of one symbol repeating down the column |
| Clean | Correct with no wrong keys and no backspaces |

**History.** Every run is saved. The Progress tab charts speed and accuracy over
time, tracks a day streak, and ranks every symbol you have attempted — weakest
first, split by mode. **Drill my weak symbols** builds a run out of exactly
those, so practice goes where it is needed.

### Keys

| Key | |
|---|---|
| <kbd>Enter</kbd> | Submit, and start a run from the idle or results screen |
| <kbd>Tab</kbd> | Skip (one at a time only; counts as incorrect) |
| <kbd>Esc</kbd> | End the run early — answers so far still count, and prints still on the column are not held against you |

### Phonetic answers it accepts

The canonical NATO word is what gets displayed, but the common alternates pass
too: `alpha` for `alfa`, `juliet` for `juliett`, `x-ray` for `xray`, `nine` for
`niner`, `whisky` for `whiskey`, plus the aviation `tree`/`fower`/`fife`.
Separators are optional — `BRK.B` accepts both `bravo romeo kilo point bravo`
and `bravo romeo kilo bravo`. Spacing and capitalisation never matter.

## Sector drill

`sector-drill.html` is a separate, self-contained trainer that sits next to the
ticker drill.

Sector drill: learn which sector and subsector ~110 anchor stocks belong to.
Modes: ticker to sector (hotkeys <kbd>1</kbd>–<kbd>9</kbd>, <kbd>0</kbd>,
<kbd>-</kbd>), ticker to subsector, name them (type tickers in a sector against
a 25s timer), and pick the peers (select names that move with a ticker).
Includes a Study map tab with classification traps (`V`/`MA` in Financials,
`UBER` in Industrials, `GOOGL`/`META` in Comm Services, data-center REITs in
Real Estate) and cross-sector themes.

Misses are saved in this browser's `localStorage` under `sectorDrill.v1` and
weight later sessions toward the names you get wrong. The Study map shows your
miss counts and can reset them.

**Adding a name.** The deck is a pipe-delimited block near the top of the
script — one line per stock:

```
ticker|company|sector|subsector|note|themes
UBER|Uber|ind|Transportation|Moved from Tech to Industrials (ground transportation) in 2023.|
```

`sector` is one of the keys in the `SECTORS` array just above it (`tech`,
`comm`, `disc`, `stap`, `hc`, `fin`, `ind`, `en`, `mat`, `util`, `re`). `note`
and `themes` are optional; themes are comma-separated. A new subsector name
creates a new subsector automatically.

## Running it

It is a static site with no dependencies and no build step. ES modules will not
load over `file://`, so serve the folder:

```bash
npm start          # http://localhost:8080
```

The sector drill has no modules, so it also opens straight from disk — double-click
`sector-drill.html`. The only external request is its Google Fonts stylesheet,
and it falls back to system fonts offline. When the folder is served (locally or
on Pages) it is at `/sector-drill.html`, and the ticker drill's top bar links to
it.

Tests are plain `node:test`, no install required:

```bash
npm test
```

## Hosting it on GitHub Pages

`.github/workflows/pages.yml` publishes the default branch to Pages on every push
to it. Turn it on once, at **Settings → Pages → Build and deployment →
Source: GitHub Actions**.
The app then lives at `https://<user>.github.io/TraderFundamentals/`.

`.github/workflows/ci.yml` runs the test suite on pushes and pull requests.

## Syncing history to GitHub

History lives in this browser's `localStorage`, so by default it does not follow
you between machines. The Setup tab can back it up to a **private gist**:

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new)
   whose only permission is **Gists: read and write**. It needs no repository
   access at all.
2. Paste it into Setup → GitHub sync and press **Save & verify**.
3. **Back up ↑** writes your history to a private gist, creating it the first
   time. **Restore ↓** pulls it back and merges it with whatever is already in
   this browser, matching on session id so nothing is duplicated.

The token is stored in this browser's `localStorage` and is sent only to
`api.github.com`. Anyone with access to this browser profile can read it — on a
shared machine, use **Forget token** when you are done. **Export JSON** /
**Import JSON** do the same job as files if you would rather not use a token.

## Layout

```
index.html          markup
assets/styles.css   light + dark tokens, all styling
src/phonetic.js     NATO alphabet, alternate spellings, answer grading
src/tickers.js      list parsing, presets, run queue
src/engine.js       one-at-a-time state machine, timing and keystroke scoring
src/tape.js         the prints tape: the 20-row stack, arrivals, repeat runs
src/stats.js        history rollups, weak-symbol picking, streaks
src/storage.js      localStorage, export/import, merge
src/chart.js        inline-SVG progress charts
src/github.js       optional gist sync
src/app.js          UI wiring
sector-drill.html   the sector drill, self-contained (inline CSS, JS and deck data)
test/               node:test suites for everything above
```

`engine.js`, `tape.js`, `phonetic.js`, `stats.js`, `tickers.js` and `storage.js`
hold no DOM references, which is what lets the test suite cover the scoring
rules directly. The tape takes its clock and its randomness as arguments, so
arrival timing, push-outs, repeat runs and bursts are all tested
deterministically.

Both drill styles emit the same session shape, so history, the progress charts
and the per-symbol table treat them identically — a symbol you keep letting
escape shows up in exactly the same weakest-first table as one you keep
misspelling.

## Licence

MIT
