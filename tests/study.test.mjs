import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('exam context and material search with fixture LEARN/Drive data', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-mcp-study-'));
  const authFile = path.join(dir, 'auth.json');
  await fs.writeFile(authFile, JSON.stringify({ cookies: [], origins: [] }));
  const pdf = await fs.readFile(new URL('./fixtures/one-page.pdf', import.meta.url));
  let downloads = 0;
  let calendarUnavailable = false;
  const topics = Array.from({ length: 65 }, (_, index) => ({
    Identifier: String(index), Title: `Lesson ${index}`, TypeIdentifier: 'File', Url: `/lesson-${index}.pdf`,
  }));
  topics[0].Title = 'Lesson 0 unavailable';

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let data;
    let status = 200;
    if (url.pathname === '/d2l/api/versions/') {
      data = [{ ProductCode: 'lp', LatestVersion: '1.0' }, { ProductCode: 'le', LatestVersion: '1.0' }];
    } else if (url.pathname.includes('myenrollments')) {
      data = { Items: [{ OrgUnit: { Id: 123, Name: 'CS 135 - Fall 2026' } }], PagingInfo: { HasMoreItems: false } };
    } else if (url.pathname.endsWith('/news/')) {
      data = [
        { Id: 1, Title: 'Final exam scope', Body: { Text: 'Covers recursion' }, StartDate: null },
        { Id: 2, Title: 'Welcome', Body: { Text: 'Hello class' }, StartDate: null },
      ];
    } else if (url.pathname.endsWith('/content/toc')) {
      data = { Modules: [{ ModuleId: 1, Title: 'Lessons', Topics: topics, Modules: [] }] };
    } else if (url.pathname.includes('/calendar/')) {
      status = calendarUnavailable ? 500 : 200;
      data = [{ Title: 'Final exam', StartDateTime: '2026-12-10T12:00:00Z', EndDateTime: '2026-12-10T15:00:00Z', IsAllDayEvent: false }];
    } else if (url.pathname.endsWith('/file') || url.pathname.includes('DirectFileTopicDownload')) {
      if (url.pathname.includes('/topics/0/') || url.pathname.includes('/download/0/')) {
        status = 404;
        data = { error: 'File unavailable' };
      } else {
        downloads++;
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="lesson.pdf"' });
        res.end(pdf);
        return;
      }
    } else {
      status = 404;
      data = { error: 'Unknown fixture endpoint' };
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.LEARN_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.LEARN_AUTH_FILE = authFile;
  process.env.LEARN_OUTLINE_CACHE_DIR = path.join(dir, 'outlines');
  process.env.LEARN_MATERIAL_CACHE_DIR = path.join(dir, 'materials');
  process.env.GOOGLE_DRIVE_API_KEY = 'fixture-key';
  process.env.GOOGLE_DRIVE_ACCESS_TOKEN = '';
  process.env.GOOGLE_DRIVE_FOLDER_IDS = 'fixture-folder';
  await fs.mkdir(process.env.LEARN_OUTLINE_CACHE_DIR);
  await fs.writeFile(path.join(process.env.LEARN_OUTLINE_CACHE_DIR, '123.json'), JSON.stringify({
    schemaVersion: 2, courseId: 123, url: 'https://outline.uwaterloo.ca/fixture',
    title: 'CS 135 syllabus', text: 'Final covers recursion.', html: '', publishedAt: null,
    fetchedAt: new Date().toISOString(),
  }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).hostname, 'www.googleapis.com');
    if (new URL(url).searchParams.get('alt') === 'media') {
      return new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } });
    }
    return new Response(JSON.stringify({ files: [{
      id: 'past-exam', name: 'CS 135 Final Exam.pdf', mimeType: 'application/pdf',
    }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  const { closeBrowser, getContext } = await import('../dist/session.js');
  try {
    const context = await getContext();
    await context.route('**/*', (route) => route.abort());
    const { getExamContext } = await import('../dist/context.js');
    const { searchCourseMaterials } = await import('../dist/materials.js');
    const { getTopicFile } = await import('../dist/d2l.js');
    const { getDriveFile } = await import('../dist/drive.js');

    await t.test('exam bundle includes all sources and survives an unavailable calendar', async () => {
      const bundle = await getExamContext('CS 135');
      assert.equal(bundle.course.ou, 123);
      assert.equal(bundle.examSignals.announcements[0].title, 'Final exam scope');
      assert.equal(bundle.examSignals.announcements.length, 1);
      assert.equal(bundle.examSignals.upcomingEvents[0].title, 'Final exam');
      assert.match(bundle.outline.text, /recursion/);
      assert.equal(bundle.studyMaterials.length, 65);
      assert.equal(bundle.pastAssessments[0].fileId, 'past-exam');
      assert.equal(bundle.recommendedFileCalls[0].tool, 'get_topic_file');
      calendarUnavailable = true;
      const partial = await getExamContext('CS 135');
      assert.equal(partial.examSignals.upcomingEvents.length, 0);
      assert.match(partial.warnings.join(' '), /Calendar unavailable/);
      assert.equal(partial.examSignals.announcements.length, 1);
    });

    await t.test('search returns cited passages, caches files, and refreshes expired/corrupt entries', async () => {
      const first = await searchCourseMaterials('CS 135', 'hello');
      assert.equal(first.indexedFiles, 39);
      assert.equal(first.failedFiles, 1);
      assert.equal(first.cachedFiles, 0);
      assert.equal(downloads, 39);
      assert.match(first.results[0].text, /Hello/);
      assert.equal(first.results[0].page, 1);
      assert.equal(first.results[0].imageCall.tool, 'get_topic_file');
      assert.ok(first.truncatedFiles);
      const second = await searchCourseMaterials('CS 135', 'hello');
      assert.equal(second.cachedFiles, 39);
      assert.equal(downloads, 39);

      const cacheFile = path.join(process.env.LEARN_MATERIAL_CACHE_DIR, '123', '1.json');
      const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
      cached.indexedAt = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000).toISOString();
      await fs.writeFile(cacheFile, JSON.stringify(cached));
      const expired = await searchCourseMaterials('CS 135', 'hello');
      assert.equal(expired.cachedFiles, 38);
      assert.equal(downloads, 40);

      cached.indexedAt = 'invalid date';
      cached.pages = [{ page: 1, text: 123 }];
      await fs.writeFile(cacheFile, JSON.stringify(cached));
      const repaired = await searchCourseMaterials('CS 135', 'hello');
      assert.equal(repaired.cachedFiles, 38);
      assert.equal(downloads, 41);
      const refreshed = await searchCourseMaterials('CS 135', 'hello', { refresh: true });
      assert.equal(refreshed.cachedFiles, 0);
      assert.equal(downloads, 80);
      const maximum = await searchCourseMaterials('CS 135', 'hello', { maxFiles: 100 });
      assert.equal(maximum.indexedFiles, 59);
      assert.equal(maximum.failedFiles, 1);
    });

    await t.test('LEARN documents return both extracted text and PNG images', async () => {
      const result = await getTopicFile(123, '1', '1');
      assert.equal(result.pages[0].text, 'Hello');
      assert.equal(result.pages[0].png.subarray(1, 4).toString(), 'PNG');
    });
    await t.test('Drive documents return both extracted text and PNG images', async () => {
      const result = await getDriveFile('past-exam', '1');
      assert.equal(result.pages[0].text, 'Hello');
      assert.equal(result.pages[0].png.subarray(1, 4).toString(), 'PNG');
      await assert.rejects(getDriveFile('outside-configured-folder'), /not inside a configured/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await closeBrowser();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
