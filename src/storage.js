// localStorage persistence. Everything is namespaced and version-stamped so the
// shape can change later without stranding someone's history.

const KEY = 'traderfundamentals.v1';
const MAX_SESSIONS = 300;

const EMPTY = {
  version: 1,
  sessions: [],
  lists: [],
  settings: {
    style: 'tape',
    mode: 'ticker',
    order: 'shuffle',
    length: 20,
    strict: false,
    intensity: 'normal',
    durationMs: 120000,
    listName: 'Watchlist'
  }
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(EMPTY), ...parsed };
  } catch {
    return structuredClone(EMPTY);
  }
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    // Quota exceeded: drop the oldest half of history and try once more.
    try {
      const trimmed = { ...state, sessions: state.sessions.slice(-Math.floor(MAX_SESSIONS / 2)) };
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      return true;
    } catch {
      return false;
    }
  }
}

export const store = {
  all: read,

  sessions() {
    return read().sessions;
  },

  addSession(summary) {
    const state = read();
    state.sessions = [...state.sessions, summary].slice(-MAX_SESSIONS);
    write(state);
    return state.sessions;
  },

  settings() {
    return read().settings;
  },

  saveSettings(patch) {
    const state = read();
    state.settings = { ...state.settings, ...patch };
    write(state);
    return state.settings;
  },

  lists() {
    return read().lists;
  },

  saveList(name, tickers) {
    const state = read();
    const existing = state.lists.findIndex((list) => list.name === name);
    const entry = { name, tickers, savedAt: Date.now() };
    if (existing >= 0) state.lists[existing] = entry;
    else state.lists.push(entry);
    write(state);
    return state.lists;
  },

  deleteList(name) {
    const state = read();
    state.lists = state.lists.filter((list) => list.name !== name);
    write(state);
    return state.lists;
  },

  /** Full backup, for the export button and for Gist sync. */
  export() {
    return JSON.stringify(read(), null, 2);
  },

  /**
   * Restore a backup.
   * @param {string|object} payload
   * @param {{merge?: boolean}} options merge keeps existing sessions and adds
   *   any incoming ones that aren't already present (matched on id).
   */
  import(payload, { merge = true } = {}) {
    const incoming = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!incoming || !Array.isArray(incoming.sessions)) {
      throw new Error('That file does not look like a TraderFundamentals backup.');
    }
    const current = read();
    const sessions = merge ? mergeSessions(current.sessions, incoming.sessions) : incoming.sessions;
    const state = {
      ...current,
      ...incoming,
      version: 1,
      sessions: sessions.slice(-MAX_SESSIONS),
      lists: merge ? mergeLists(current.lists, incoming.lists ?? []) : incoming.lists ?? []
    };
    write(state);
    return state;
  },

  clear() {
    localStorage.removeItem(KEY);
  }
};

export function mergeSessions(a, b) {
  const byId = new Map();
  for (const session of [...a, ...b]) {
    if (session && session.id) byId.set(session.id, session);
  }
  return [...byId.values()].sort((x, y) => (x.endedAt ?? 0) - (y.endedAt ?? 0));
}

export function mergeLists(a, b) {
  const byName = new Map();
  for (const list of [...a, ...b]) {
    if (!list || !list.name) continue;
    const existing = byName.get(list.name);
    if (!existing || (list.savedAt ?? 0) >= (existing.savedAt ?? 0)) byName.set(list.name, list);
  }
  return [...byName.values()];
}
