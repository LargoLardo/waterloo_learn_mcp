import assert from 'node:assert/strict';
import test from 'node:test';
import { initializePdfRenderer, pdfToPng } from '../dist/pdf.js';

const onePagePdf = Buffer.from(
  'JVBERi0xLjEKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NCA+PgpzdHJlYW0KQlQKL0YxIDI0IFRmCjUwIDEwMCBUZAooSGVsbG8pIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI1MSAwMDAwMCBuIAowMDAwMDAwMzQ1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDI1CiUlRU9G',
  'base64',
);

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
