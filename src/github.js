// Optional history sync through a private GitHub Gist.
//
// The token lives only in this browser's localStorage and is sent only to
// api.github.com. A fine-grained token with the single "Gists" permission is
// all this needs - never give it repo access.

const SETTINGS_KEY = 'traderfundamentals.github.v1';
const FILENAME = 'traderfundamentals-history.json';
const API = 'https://api.github.com';

export function loadSync() {
  try {
    return { token: '', gistId: '', lastSyncedAt: 0, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { token: '', gistId: '', lastSyncedAt: 0 };
  }
}

export function saveSync(patch) {
  const next = { ...loadSync(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function clearSync() {
  localStorage.removeItem(SETTINGS_KEY);
}

export function isConfigured() {
  return Boolean(loadSync().token);
}

async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const message = detail.message ?? response.statusText;
    if (response.status === 401) throw new Error('GitHub rejected the token (401). Check that it is valid and has the Gists permission.');
    if (response.status === 404) throw new Error('Gist not found (404). Check the gist ID, or clear it to create a new one.');
    throw new Error(`GitHub API error ${response.status}: ${message}`);
  }
  return response.json();
}

/** Confirm the token works and report which account it belongs to. */
export async function verify(token = loadSync().token) {
  if (!token) throw new Error('No token saved.');
  const user = await call('/user', { token });
  return user.login;
}

/** Upload the backup, creating the gist on first use. */
export async function push(backupJson) {
  const { token, gistId } = loadSync();
  if (!token) throw new Error('Add a GitHub token first.');
  const files = { [FILENAME]: { content: backupJson } };

  const gist = gistId
    ? await call(`/gists/${gistId}`, { token, method: 'PATCH', body: { files } })
    : await call('/gists', {
        token,
        method: 'POST',
        body: { description: 'TraderFundamentals typing history', public: false, files }
      });

  saveSync({ gistId: gist.id, lastSyncedAt: Date.now() });
  return { gistId: gist.id, url: gist.html_url };
}

/** Download the backup. Returns the raw JSON string for store.import(). */
export async function pull() {
  const { token, gistId } = loadSync();
  if (!token) throw new Error('Add a GitHub token first.');
  if (!gistId) throw new Error('No gist linked yet - push once to create one.');

  const gist = await call(`/gists/${gistId}`, { token });
  const file = gist.files?.[FILENAME];
  if (!file) throw new Error(`That gist has no ${FILENAME}.`);

  // GitHub truncates large files inline and serves the full copy separately.
  const content = file.truncated ? await fetch(file.raw_url).then((r) => r.text()) : file.content;
  saveSync({ lastSyncedAt: Date.now() });
  return content;
}
