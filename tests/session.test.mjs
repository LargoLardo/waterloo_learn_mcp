import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('getContext reloads auth.json after npm run login replaces it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-mcp-session-'));
  const authFile = path.join(dir, 'auth.json');
  await fs.writeFile(authFile, JSON.stringify({ cookies: [], origins: [] }));
  process.env.LEARN_AUTH_FILE = authFile;

  const { closeBrowser, getContext } = await import('../dist/session.js');
  try {
    const first = await getContext();
    const changed = new Date(Date.now() + 2_000);
    await fs.utimes(authFile, changed, changed);
    const second = await getContext();
    assert.notEqual(second, first);
  } finally {
    await closeBrowser();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
