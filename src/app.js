// UI wiring. All scoring lives in engine.js; all aggregation in stats.js.

import { MODES, Session } from './engine.js';
import { PRESETS, parseTickers } from './tickers.js';
import { store } from './storage.js';
import { overallStats, progressSeries, tickerStats, trend, weakTickers } from './stats.js';
import { renderLineChart } from './chart.js';
import * as gh from './github.js';

const $ = (id) => document.getElementById(id);
const on = (node, event, handler) => node.addEventListener(event, handler);

const state = {
  view: 'test',
  session: null,
  tickers: [],
  settings: store.settings(),
  tickerFilter: 'all',
  timer: null
};

/* ── Small helpers ──────────────────────────────────────────────────────── */

const fmtSeconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

function fmtDuration(ms) {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const fmtDate = (ts) =>
  new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

let toastTimer = null;
function toast(message, isError = false) {
  const node = $('toast');
  node.textContent = message;
  node.classList.toggle('err', isError);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
}

function setPanel(name) {
  for (const panel of document.querySelectorAll('.stage-panel')) {
    panel.classList.toggle('is-active', panel.id === `panel-${name}`);
  }
}

function setView(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const section of document.querySelectorAll('.view')) {
    section.classList.toggle('is-active', section.id === `view-${view}`);
  }
  if (view === 'progress') renderProgress();
  if (view === 'test' && state.session && !state.session.finished) $('answer').focus();
}

/* ── Setup view ─────────────────────────────────────────────────────────── */

function currentListName() {
  return state.settings.listName ?? 'Custom';
}

function loadTickerInput(text, listName) {
  $('ticker-input').value = text;
  if (listName) state.settings = store.saveSettings({ listName });
  refreshTickers();
}

function refreshTickers() {
  const { tickers, rejected } = parseTickers($('ticker-input').value);
  state.tickers = tickers;
  store.saveSettings({ tickerText: $('ticker-input').value });
  state.settings = store.settings();

  const parts = [`${tickers.length} symbol${tickers.length === 1 ? '' : 's'}`];
  if (rejected.length) parts.push(`${rejected.length} ignored: ${rejected.slice(0, 5).join(', ')}`);
  $('ticker-count').textContent = parts.join(' · ');
  renderIdleNote();
}

function renderPresets() {
  const row = $('preset-row');
  row.innerHTML = '';
  for (const preset of PRESETS) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.innerHTML = `<b>${preset.name}</b>`;
    on(chip, 'click', () => {
      loadTickerInput(preset.tickers, preset.name);
      toast(`Loaded ${preset.name}`);
    });
    row.append(chip);
  }
}

function renderSavedLists() {
  const row = $('saved-row');
  row.innerHTML = '';
  const lists = store.lists();
  for (const list of lists) {
    const chip = document.createElement('button');
    chip.className = 'chip saved';
    chip.innerHTML = `<b>${list.name}</b> · ${list.tickers.length} ✕`;
    chip.title = 'Click to load, shift-click to delete';
    on(chip, 'click', (event) => {
      if (event.shiftKey) {
        store.deleteList(list.name);
        renderSavedLists();
        toast(`Deleted "${list.name}"`);
        return;
      }
      loadTickerInput(list.tickers.join(' '), list.name);
      toast(`Loaded ${list.name}`);
    });
    row.append(chip);
  }
}

function renderIdleNote() {
  const count = state.settings.length || state.tickers.length;
  const mode = MODES[state.settings.mode]?.label ?? 'Ticker';
  $('idle-note').textContent = state.tickers.length === 0
    ? 'Add some symbols on the Setup tab first.'
    : `${count} prompt${count === 1 ? '' : 's'} from ${currentListName()}, ${mode.toLowerCase()} mode.`;
  $('run-list').textContent = currentListName();
  $('run-mode').textContent = mode;
  $('run-counter').textContent = `0 / ${count}`;
}

function syncSettingsUI() {
  const { mode, length, order, strict } = state.settings;
  for (const button of $('mode-picker').children) {
    button.classList.toggle('is-active', button.dataset.mode === mode);
  }
  for (const button of $('length-picker').children) {
    button.classList.toggle('is-active', Number(button.dataset.length) === Number(length));
  }
  $('order-toggle').checked = order !== 'sequential';
  $('strict-toggle').checked = Boolean(strict);
  $('mode-note').textContent = MODES[mode]?.hint ?? '';
  renderIdleNote();
}

/* ── Running a test ─────────────────────────────────────────────────────── */

function startRun(tickers = state.tickers) {
  if (tickers.length === 0) {
    toast('Add some symbols on the Setup tab first.', true);
    setView('setup');
    return;
  }
  const { mode, order, length, strict } = state.settings;
  state.session = new Session(tickers, {
    mode, order, length, strict, listName: currentListName()
  }).start();

  setView('test');
  setPanel('run');
  $('answer').value = '';
  $('answer').classList.remove('is-wrong');
  renderPrompt();
  $('answer').focus();

  clearInterval(state.timer);
  state.timer = setInterval(renderLiveStats, 100);
}

function renderPrompt() {
  const session = state.session;
  if (!session || session.finished) return;

  const phonetic = session.promptMode === 'phonetic';
  $('prompt-kicker').textContent = phonetic ? 'Type the phonetic alphabet' : 'Type the symbol';

  const prompt = $('prompt');
  const target = $('answer-target');

  if (phonetic) {
    prompt.textContent = session.symbol;
    const grade = session.grade();
    target.innerHTML = '';
    grade.units.forEach((unit, index) => {
      const chip = document.createElement('span');
      const token = grade.tokens.find((t) => t.unit === index);
      const status = token?.status === 'ok' ? 'ok'
        : token?.status === 'bad' ? 'bad'
        : index === grade.nextUnit ? 'next' : '';
      chip.className = `word ${status}`.trim();
      chip.textContent = unit.word;
      target.append(chip);
    });
  } else {
    const grade = session.grade();
    prompt.innerHTML = '';
    for (const { char, status } of grade.chars) {
      const span = document.createElement('span');
      span.className = `char ${status}`;
      span.textContent = char;
      prompt.append(span);
    }
    if (grade.overflow) {
      const span = document.createElement('span');
      span.className = 'char bad';
      span.textContent = grade.overflow;
      prompt.append(span);
    }
    target.innerHTML = '';
  }

  const done = session.results.length;
  $('run-counter').textContent = `${done} / ${session.total}`;
  $('run-progress-fill').style.width = `${(done / session.total) * 100}%`;
}

function renderLiveStats() {
  const session = state.session;
  if (!session || session.finished) return;
  const elapsed = Date.now() - session.startedAt;
  $('live-timer').textContent = fmtSeconds(elapsed);

  const accuracy = session.keystrokes > 0
    ? Math.round((session.correctKeystrokes / session.keystrokes) * 100)
    : 100;
  $('live-accuracy').textContent = `${accuracy}%`;

  const chars = session.results.reduce((sum, r) => sum + r.expected.length, 0);
  const typingMs = session.results.reduce((sum, r) => sum + r.typingMs, 0);
  const minutes = typingMs / 60000;
  $('live-wpm').textContent = minutes > 0 ? Math.round(chars / 5 / minutes) : 0;
}

function flashWrong() {
  const input = $('answer');
  const prompt = $('prompt');
  input.classList.add('is-wrong');
  prompt.classList.add('is-shake');
  setTimeout(() => {
    input.classList.remove('is-wrong');
    prompt.classList.remove('is-shake');
  }, 260);
}

function handleSubmit() {
  const session = state.session;
  if (!session || session.finished) return;

  const outcome = session.submit();
  if (!outcome.accepted) {
    if (outcome.correct === false) flashWrong();
    return;
  }
  if (!outcome.result.correct) flashWrong();

  $('answer').value = '';
  if (outcome.finished) finishRun();
  else renderPrompt();
}

function finishRun() {
  clearInterval(state.timer);
  const session = state.session;
  const summary = session.finished ? session.summary() : session.end();
  if (summary.prompts > 0) store.addSession(summary);

  // The last answer never re-renders the prompt, so settle the run bar here.
  $('run-counter').textContent = `${summary.prompts} / ${session.total}`;
  $('run-progress-fill').style.width = `${(summary.prompts / session.total) * 100}%`;
  renderFinalStats(summary);

  renderResults(summary);
  setPanel('done');
}

function renderFinalStats(summary) {
  $('live-timer').textContent = fmtSeconds(summary.elapsedMs);
  $('live-accuracy').textContent = `${Math.round(summary.keystrokeAccuracy)}%`;
  $('live-wpm').textContent = Math.round(summary.wpm);
}

function renderResults(summary) {
  $('result-hero').textContent = summary.wpm;

  const cells = [
    ['Accuracy', `${summary.promptAccuracy}%`],
    ['Keystrokes', `${summary.keystrokeAccuracy}%`],
    ['Correct', `${summary.correct}/${summary.prompts}`],
    ['Avg / prompt', fmtSeconds(summary.avgMs)],
    ['Total time', fmtDuration(summary.elapsedMs)]
  ];
  $('result-grid').innerHTML = cells
    .map(([label, value]) => `<div class="result-cell"><b>${value}</b><span>${label}</span></div>`)
    .join('');

  const rows = summary.results
    .map((r) => `<tr class="${r.correct ? '' : 'wrong'}">
      <td>${r.ticker}</td>
      <td><span class="tag">${r.mode}</span></td>
      <td class="typed">${r.correct ? '✓' : escapeHtml(r.typed || '—')}</td>
      <td class="num">${fmtSeconds(r.ms)}</td>
      <td class="num">${r.errors}</td>
    </tr>`)
    .join('');

  $('result-table').innerHTML = `
    <thead><tr><th>Symbol</th><th>Mode</th><th>You typed</th><th>Time</th><th>Errors</th></tr></thead>
    <tbody>${rows}</tbody>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ── Progress view ──────────────────────────────────────────────────────── */

function renderProgress() {
  const sessions = store.sessions();
  const overall = overallStats(sessions);

  const tiles = [
    ['Sessions', overall.sessions],
    ['Prompts', overall.prompts],
    ['Best wpm', overall.bestWpm],
    ['Avg wpm', overall.avgWpm],
    ['Accuracy', `${overall.accuracy}%`],
    ['Day streak', overall.streak],
    ['Time typed', fmtDuration(overall.timeMs)]
  ];
  $('overall-stats').innerHTML = tiles
    .map(([label, value]) => `<div class="stat-tile"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join('');

  const series = progressSeries(sessions);
  renderLineChart($('chart-wpm'), {
    series,
    valueKey: 'wpm',
    color: '--series-1',
    format: (n) => String(Math.round(n * 10) / 10),
    ariaLabel: 'Words per minute by session'
  });
  renderLineChart($('chart-accuracy'), {
    series,
    valueKey: 'accuracy',
    color: '--series-2',
    format: (n) => `${Math.round(n)}%`,
    min: 0,
    max: 100,
    ariaLabel: 'Percentage of prompts correct by session'
  });

  renderDelta('wpm-delta', trend(series, 'wpm'), (v) => `${v > 0 ? '+' : ''}${v} wpm`);
  renderDelta('accuracy-delta', trend(series, 'accuracy'), (v) => `${v > 0 ? '+' : ''}${v} pts`);

  renderTickerTable(sessions);
  renderSessionTable(sessions);
}

function renderDelta(id, value, format) {
  const node = $(id);
  if (value === null || value === 0) {
    node.textContent = '';
    node.className = 'delta';
    return;
  }
  node.textContent = `· ${format(value)} since first run`;
  node.className = `delta ${value > 0 ? 'up' : 'down'}`;
}

function renderTickerTable(sessions) {
  const rows = tickerStats(sessions, { mode: state.tickerFilter });
  const table = $('ticker-table');
  if (rows.length === 0) {
    table.innerHTML = '<tbody><tr><td class="empty">No attempts recorded yet.</td></tr></tbody>';
    return;
  }
  const body = rows
    .map((row) => {
      const severity = row.accuracy >= 95 ? '' : row.accuracy >= 80 ? ' is-warn' : ' is-bad';
      return `<tr>
        <td class="sym">${row.ticker}</td>
        <td><span class="tag">${row.mode}</span></td>
        <td class="num">${row.attempts}</td>
        <td class="num">
          <span class="meter${severity}"><i style="width:${row.accuracy}%"></i></span>
          ${row.accuracy}%
        </td>
        <td class="num">${fmtSeconds(row.avgMs)}</td>
        <td class="num">${row.bestMs === null ? '—' : fmtSeconds(row.bestMs)}</td>
      </tr>`;
    })
    .join('');
  table.innerHTML = `
    <thead><tr><th>Symbol</th><th>Mode</th><th>Tries</th><th>Accuracy</th><th>Avg</th><th>Best</th></tr></thead>
    <tbody>${body}</tbody>`;
}

function renderSessionTable(sessions) {
  const table = $('session-table');
  const recent = [...sessions].reverse().slice(0, 50);
  if (recent.length === 0) {
    table.innerHTML = '<tbody><tr><td class="empty">No sessions yet.</td></tr></tbody>';
    return;
  }
  const body = recent
    .map((s) => `<tr>
      <td>${fmtDate(s.endedAt)}</td>
      <td><span class="tag">${s.mode}</span></td>
      <td>${escapeHtml(s.listName ?? '—')}</td>
      <td class="num">${s.correct}/${s.prompts}</td>
      <td class="num">${s.wpm}</td>
      <td class="num">${s.promptAccuracy}%</td>
      <td class="num">${fmtDuration(s.elapsedMs)}</td>
    </tr>`)
    .join('');
  table.innerHTML = `
    <thead><tr><th>When</th><th>Mode</th><th>List</th><th>Correct</th><th>Wpm</th><th>Accuracy</th><th>Time</th></tr></thead>
    <tbody>${body}</tbody>`;
}

/* ── GitHub sync ────────────────────────────────────────────────────────── */

function renderSyncStatus(message, kind = '') {
  const node = $('sync-status');
  const settings = gh.loadSync();
  node.className = `sync-status ${kind}`.trim();
  if (message) {
    node.textContent = message;
    return;
  }
  if (!settings.token) {
    node.textContent = 'Not connected.';
    return;
  }
  const when = settings.lastSyncedAt ? `last synced ${fmtDate(settings.lastSyncedAt)}` : 'never synced';
  node.textContent = settings.gistId
    ? `Linked to gist ${settings.gistId.slice(0, 8)}… — ${when}.`
    : `Token saved — ${when}. Push once to create the gist.`;
}

async function withBusy(button, label, work) {
  const original = button.textContent;
  button.textContent = label;
  button.disabled = true;
  try {
    await work();
  } catch (error) {
    toast(error.message, true);
    renderSyncStatus(error.message, 'err');
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

function wireGithub() {
  const settings = gh.loadSync();
  $('gh-token').value = settings.token;
  $('gh-gist').value = settings.gistId;
  renderSyncStatus();

  on($('gh-save'), 'click', () => withBusy($('gh-save'), 'Checking…', async () => {
    gh.saveSync({ token: $('gh-token').value.trim(), gistId: $('gh-gist').value.trim() });
    const login = await gh.verify();
    renderSyncStatus(`Connected as ${login}.`, 'ok');
    toast(`Connected to GitHub as ${login}`);
  }));

  on($('gh-push'), 'click', () => withBusy($('gh-push'), 'Uploading…', async () => {
    const { gistId } = await gh.push(store.export());
    $('gh-gist').value = gistId;
    renderSyncStatus('Backed up just now.', 'ok');
    toast('History backed up to your gist');
  }));

  on($('gh-pull'), 'click', () => withBusy($('gh-pull'), 'Downloading…', async () => {
    const payload = await gh.pull();
    const restored = store.import(payload, { merge: true });
    state.settings = store.settings();
    renderSyncStatus(`Restored — ${restored.sessions.length} sessions on file.`, 'ok');
    renderSavedLists();
    syncSettingsUI();
    if (state.view === 'progress') renderProgress();
    toast(`Merged ${restored.sessions.length} sessions from your gist`);
  }));

  on($('gh-forget'), 'click', () => {
    gh.clearSync();
    $('gh-token').value = '';
    $('gh-gist').value = '';
    renderSyncStatus('Token removed from this browser.');
    toast('GitHub token forgotten');
  });
}

/* ── Wiring ─────────────────────────────────────────────────────────────── */

function wire() {
  for (const tab of document.querySelectorAll('.tab')) {
    on(tab, 'click', () => setView(tab.dataset.view));
  }

  on($('theme-toggle'), 'click', () => {
    const current = document.documentElement.dataset.theme
      ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('trillium.theme', next);
    if (state.view === 'progress') renderProgress();
  });

  // Test
  on($('start-button'), 'click', () => startRun());
  on($('again-button'), 'click', () => startRun());
  on($('review-button'), 'click', () => setView('progress'));
  on($('drill-button'), 'click', () => {
    const weak = weakTickers(store.sessions(), { limit: 12 });
    if (weak.length === 0) {
      toast('Nothing to drill yet — everything is fast and clean.');
      return;
    }
    startRun(weak);
    toast(`Drilling ${weak.length} weak symbols`);
  });

  const answer = $('answer');
  on(answer, 'input', () => {
    state.session?.type(answer.value);
    renderPrompt();
    renderLiveStats();
  });

  on(answer, 'keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSubmit();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      state.session?.skip();
      answer.value = '';
      if (state.session?.finished) finishRun();
      else renderPrompt();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishRun();
    }
  });

  // Enter starts a run from the idle and results panels.
  on(document, 'keydown', (event) => {
    if (event.key !== 'Enter' || state.view !== 'test') return;
    if (document.activeElement === answer) return;
    const idle = $('panel-idle').classList.contains('is-active');
    const done = $('panel-done').classList.contains('is-active');
    if (idle || done) {
      event.preventDefault();
      startRun();
    }
  });

  // Setup
  on($('ticker-input'), 'input', () => {
    state.settings = store.saveSettings({ listName: 'Custom' });
    refreshTickers();
  });

  on($('save-list-button'), 'click', () => {
    if (state.tickers.length === 0) {
      toast('Nothing to save yet.', true);
      return;
    }
    const name = prompt('Name this list', currentListName() === 'Custom' ? '' : currentListName());
    if (!name) return;
    store.saveList(name.trim(), state.tickers);
    state.settings = store.saveSettings({ listName: name.trim() });
    renderSavedLists();
    renderIdleNote();
    toast(`Saved "${name.trim()}"`);
  });

  on($('clear-list-button'), 'click', () => loadTickerInput('', 'Custom'));

  on($('mode-picker'), 'click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    state.settings = store.saveSettings({ mode: button.dataset.mode });
    syncSettingsUI();
  });

  on($('length-picker'), 'click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    state.settings = store.saveSettings({ length: Number(button.dataset.length) });
    syncSettingsUI();
  });

  on($('order-toggle'), 'change', (event) => {
    state.settings = store.saveSettings({ order: event.target.checked ? 'shuffle' : 'sequential' });
  });

  on($('strict-toggle'), 'change', (event) => {
    state.settings = store.saveSettings({ strict: event.target.checked });
  });

  // Progress filters
  on($('ticker-mode-filter'), 'click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    state.tickerFilter = button.dataset.mode;
    for (const sibling of $('ticker-mode-filter').children) {
      sibling.classList.toggle('is-active', sibling === button);
    }
    renderTickerTable(store.sessions());
  });

  // Backup
  on($('export-button'), 'click', () => {
    const blob = new Blob([store.export()], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `trillium-history-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  on($('import-button'), 'click', () => $('import-file').click());
  on($('import-file'), 'change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const restored = store.import(await file.text(), { merge: true });
      state.settings = store.settings();
      renderSavedLists();
      syncSettingsUI();
      toast(`Imported — ${restored.sessions.length} sessions on file`);
    } catch (error) {
      toast(error.message, true);
    }
    event.target.value = '';
  });

  on($('reset-button'), 'click', () => {
    if (!confirm('Erase all saved sessions, lists and settings from this browser?')) return;
    store.clear();
    state.settings = store.settings();
    renderSavedLists();
    syncSettingsUI();
    renderProgress();
    toast('History erased');
  });

  let resizeTimer = null;
  on(window, 'resize', () => {
    if (state.view !== 'progress') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderProgress, 150);
  });

  wireGithub();
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

function boot() {
  const savedTheme = localStorage.getItem('trillium.theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  const saved = state.settings.tickerText;
  const fallback = PRESETS.find((p) => p.name === state.settings.listName) ?? PRESETS[0];
  $('ticker-input').value = saved ?? fallback.tickers;
  if (!saved) store.saveSettings({ listName: fallback.name });
  state.settings = store.settings();

  wire();
  renderPresets();
  renderSavedLists();
  refreshTickers();
  syncSettingsUI();
  setPanel('idle');
}

boot();
