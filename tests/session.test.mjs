import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'node:http';

test('saved session reload and rejected-session errors', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-mcp-session-'));
  const authFile = path.join(dir, 'auth.json');
  await fs.writeFile(authFile, JSON.stringify({ cookies: [], origins: [] }));
  process.env.LEARN_AUTH_FILE = authFile;
  const server = createServer((req, res) => {
    const status = Number(req.url.slice(1));
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session rejected' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.LEARN_BASE_URL = `http://127.0.0.1:${server.address().port}`;

  const { AuthError, apiGet, apiGetBinary, closeBrowser, getContext } = await import('../dist/session.js');
  try {
    await t.test('getContext reloads auth.json after npm run login replaces it', async () => {
      const first = await getContext();
      const changed = new Date(Date.now() + 2_000);
      await fs.utimes(authFile, changed, changed);
      const second = await getContext();
      assert.notEqual(second, first);
    });
    await t.test('JSON and file requests explain how to recover from 401/403', async () => {
      for (const status of [401, 403]) {
        for (const get of [apiGet, apiGetBinary]) {
          await assert.rejects(get(`/${status}`), (error) => {
            assert.ok(error instanceof AuthError);
            assert.match(error.message, new RegExp(`saved session \\(${status}`));
            assert.match(error.message, /npm run login/);
            return true;
          });
        }
      }
    });
  } finally {
    await closeBrowser();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
