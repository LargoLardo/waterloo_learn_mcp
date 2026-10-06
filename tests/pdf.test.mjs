import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { initializePdfRenderer, pdfToPng } from '../dist/pdf.js';

const onePagePdf = await readFile(new URL('./fixtures/one-page.pdf', import.meta.url));

test('pdfToPng renders PDFs in Node 20 without browser DOM globals', async () => {
  delete globalThis.DOMMatrix;
  delete globalThis.ImageData;
  delete globalThis.Path2D;

  const pages = await pdfToPng(onePagePdf, { viewportScale: 0.25, pagesToProcess: [1] });

  assert.equal(pages.length, 1);
  assert.equal(pages[0].pageNumber, 1);
  assert.ok(pages[0].content instanceof Buffer);
  assert.ok(pages[0].content.length > 0);
});

test('PDF renderer ESM dependency initializes before the server accepts requests', async () => {
  const renderer = await initializePdfRenderer();
  assert.equal(typeof renderer.getDocument, 'function');
});

test('pdfToPng reads document metadata without rendering page images', async () => {
  const pages = await pdfToPng(onePagePdf, { returnMetadataOnly: true });

  assert.equal(pages.length, 1);
  assert.equal(pages[0].width, 200);
  assert.equal(pages[0].height, 200);
  assert.equal(pages[0].content.length, 0);
});

test('pdfToPng can return each page text layer alongside its image', async () => {
  const pages = await pdfToPng(onePagePdf, {
    viewportScale: 0.25,
    pagesToProcess: [1],
    extractText: true,
  });

  assert.equal(pages[0].text, 'Hello');
  assert.ok(pages[0].content.length > 0);
});
