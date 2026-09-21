# TraderFundamentals

A typing trainer for ticker symbols — and for saying them out loud. A symbol
appears, you type it, you press <kbd>Enter</kbd>, the next one appears. It times
every prompt, scores every keystroke, and keeps the history so you can see
whether you are actually getting faster.

## What it does

**Two things to type.** In *ticker* mode the prompt is `QQQ` and you type `QQQ`.
In *phonetic* mode the prompt is still `QQQ` but the answer is
`quebec quebec quebec` — the NATO alphabet, the way you would read the symbol
over a phone or a squawk box. *Mixed* mode alternates at random and tells you
which form each prompt wants.

**Your symbols.** Paste any list on the Setup tab — commas, spaces and newlines
all work. Dots, dashes and slashes are fine, so `BRK.B` and `RDS-A` behave.
Save named lists for later; four starter lists ship with it, including a
lookalikes set (`GOOG`/`GOOGL`, `TQQQ`/`SQQQ`, `VT`/`VTI`/`VTV`) and a
hard-to-spell set.

**Live feedback.** Ticker prompts colour character by character as you type.
Phonetic prompts show a chip per word that fills in as you get each one right.

**Scoring.**

| Measure | How it is worked out |
|---|---|
| WPM | Five characters counts as one word, over time spent actually typing |
| Accuracy | Prompts answered correctly |
| Keystroke accuracy | Characters that were right when typed — a typo you fix still costs you |
| Time per prompt | Prompt appearing → <kbd>Enter</kbd> |
| Clean | Correct with no wrong keys and no backspaces |

**History.** Every run is saved. The Progress tab charts speed and accuracy over
time, tracks a day streak, and ranks every symbol you have attempted — weakest
first, split by mode. **Drill my weak symbols** builds a run out of exactly
those, so practice goes where it is needed.

### Keys

| Key | |
|---|---|
| <kbd>Enter</kbd> | Submit, and start a run from the idle or results screen |
| <kbd>Tab</kbd> | Skip (counts as incorrect) |
| <kbd>Esc</kbd> | End the run early — answers so far still count |

### Phonetic answers it accepts

The canonical NATO word is what gets displayed, but the common alternates pass
too: `alpha` for `alfa`, `juliet` for `juliett`, `x-ray` for `xray`, `nine` for
`niner`, `whisky` for `whiskey`, plus the aviation `tree`/`fower`/`fife`.
Separators are optional — `BRK.B` accepts both `bravo romeo kilo point bravo`
and `bravo romeo kilo bravo`. Spacing and capitalisation never matter.

## Running it

It is a static site with no dependencies and no build step. ES modules will not
load over `file://`, so serve the folder:

```bash
npm start          # http://localhost:8080
```

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
src/engine.js       session state machine, timing and keystroke scoring
src/stats.js        history rollups, weak-symbol picking, streaks
src/storage.js      localStorage, export/import, merge
src/chart.js        inline-SVG progress charts
src/github.js       optional gist sync
src/app.js          UI wiring
test/               node:test suites for everything above
```

`engine.js`, `phonetic.js`, `stats.js`, `tickers.js` and `storage.js` hold no DOM
references, which is what lets the test suite cover the scoring rules directly.

## Licence

MIT
