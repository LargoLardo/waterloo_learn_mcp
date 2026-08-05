import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  GOOGLE_DRIVE_ACCESS_TOKEN,
  GOOGLE_DRIVE_API_KEY,
  GOOGLE_DRIVE_FOLDER_IDS,
} from './config.js';
import { pdfToPng } from './pdf.js';

const execFileAsync = promisify(execFile);
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document';
const GOOGLE_SLIDES_MIME_TYPE = 'application/vnd.google-apps.presentation';
const TARGET_LONG_EDGE_PX = 800;
const MAX_PAGES = 30;
const MAX_INDEXED_ITEMS = 10_000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const INDEX_CACHE_MS = 5 * 60 * 1000;

let indexCache: { expiresAt: number; files: Promise<DriveFile[]> } | null = null;

interface DriveApiFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  shortcutDetails?: {
    targetId: string;
    targetMimeType: string;
  };
}

export interface DriveFile {
  fileId: string;
  name: string;
  path: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  url: string;
}

export interface DriveSearchResult {
  query: string | null;
  folderIds: string[];
  files: DriveFile[];
  indexedFiles: number;
}

export interface DriveFileResult {
  filename: string;
  totalPages: number;
  pages: { page: number; png: Buffer }[];
  note?: string;
}

function driveAuthHelp(): string {
  return (
    'Google Drive access is not configured. Set GOOGLE_DRIVE_API_KEY in .env.local for a public/shared folder, ' +
    'or GOOGLE_DRIVE_ACCESS_TOKEN for OAuth access.'
  );
}

function authHeaders(): Record<string, string> {
  return GOOGLE_DRIVE_ACCESS_TOKEN
    ? { Authorization: `Bearer ${GOOGLE_DRIVE_ACCESS_TOKEN}` }
    : {};
}

function driveUrl(apiPath: string, params: Record<string, string> = {}): URL {
  if (!GOOGLE_DRIVE_API_KEY && !GOOGLE_DRIVE_ACCESS_TOKEN) {
    throw new Error(driveAuthHelp());
  }
  const url = new URL(`${DRIVE_API_BASE}${apiPath}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (GOOGLE_DRIVE_API_KEY) url.searchParams.set('key', GOOGLE_DRIVE_API_KEY);
  return url;
}

async function driveFetch(url: URL): Promise<Response> {
  const response = await fetch(url, { headers: authHeaders() });
  if (response.ok) return response;

  const body = (await response.text()).slice(0, 500);
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Google Drive rejected access (${response.status}). Make sure the configured folder is shared with this credential. ${body}`,
    );
  }
  throw new Error(`Google Drive API error ${response.status}: ${body}`);
}

function normalizeFile(file: DriveApiFile, parentPath: string): DriveFile {
  const targetId = file.shortcutDetails?.targetId ?? file.id;
  const mimeType = file.shortcutDetails?.targetMimeType ?? file.mimeType;
  return {
    fileId: targetId,
    name: file.name,
    path: parentPath ? `${parentPath}/${file.name}` : file.name,
    mimeType,
    size: file.size ? Number(file.size) : null,
    modifiedTime: file.modifiedTime ?? null,
    url: file.webViewLink ?? `https://drive.google.com/open?id=${targetId}`,
  };
}

async function listChildren(folderId: string): Promise<DriveApiFile[]> {
  const files: DriveApiFile[] = [];
  let pageToken = '';
  do {
    const url = driveUrl('/files', {
      q: `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`,
      fields:
        'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,shortcutDetails(targetId,targetMimeType))',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await driveFetch(url);
    const page = (await response.json()) as { nextPageToken?: string; files?: DriveApiFile[] };
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

async function buildDriveIndex(): Promise<DriveFile[]> {
  if (GOOGLE_DRIVE_FOLDER_IDS.length === 0) {
    throw new Error('No Google Drive folders configured. Set GOOGLE_DRIVE_FOLDER_IDS in .env.local.');
  }

  const results: DriveFile[] = [];
  const seenFolders = new Set<string>();
  const queue = GOOGLE_DRIVE_FOLDER_IDS.map((id) => ({ id, path: '' }));

  while (queue.length > 0) {
    const folder = queue.shift()!;
    if (seenFolders.has(folder.id)) continue;
    seenFolders.add(folder.id);

    for (const item of await listChildren(folder.id)) {
      const targetId = item.shortcutDetails?.targetId ?? item.id;
      const targetMimeType = item.shortcutDetails?.targetMimeType ?? item.mimeType;
      if (targetMimeType === FOLDER_MIME_TYPE) {
        queue.push({ id: targetId, path: folder.path ? `${folder.path}/${item.name}` : item.name });
      } else {
        results.push(normalizeFile(item, folder.path));
      }
      if (results.length > MAX_INDEXED_ITEMS) {
        throw new Error(`Drive folder contains more than ${MAX_INDEXED_ITEMS} files; narrow GOOGLE_DRIVE_FOLDER_IDS.`);
      }
    }
  }
  return results;
}

async function indexDriveFiles(): Promise<DriveFile[]> {
  if (indexCache && indexCache.expiresAt > Date.now()) return indexCache.files;
  const files = buildDriveIndex();
  indexCache = { expiresAt: Date.now() + INDEX_CACHE_MS, files };
  files.catch(() => {
    if (indexCache?.files === files) indexCache = null;
  });
  return files;
}

export function scoreDriveFile(file: DriveFile, query?: string): number {
  const haystack = `${file.path} ${file.mimeType}`.toLowerCase();
  const terms = (query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1);
  if (terms.some((term) => !haystack.includes(term))) return -1;

  let score = terms.reduce((total, term) => total + (file.name.toLowerCase().includes(term) ? 10 : 4), 0);
  let assessmentLike = false;
  for (const keyword of ['quiz', 'midterm', 'exam', 'test', 'practice', 'solution']) {
    if (haystack.includes(keyword)) {
      assessmentLike = true;
      score += keyword === 'quiz' ? 5 : 2;
    }
  }
  if (!query && !assessmentLike) return -1;
  if (file.mimeType.includes('pdf')) score += 2;
  return score;
}

export async function searchDriveFiles(query?: string, limit = 20): Promise<DriveSearchResult> {
  const files = await indexDriveFiles();
  const normalizedQuery = query?.trim() || undefined;
  const ranked = files
    .map((file) => ({ file, score: scoreDriveFile(file, normalizedQuery) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, limit)
    .map(({ file }) => file);
  return {
    query: normalizedQuery ?? null,
    folderIds: GOOGLE_DRIVE_FOLDER_IDS,
    files: ranked,
    indexedFiles: files.length,
  };
}

function parsePages(spec: string): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error(`Invalid pages value "${spec}" - use forms like "4", "1-5", or "2,4,7-9".`);
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (start < 1 || end < start) throw new Error(`Invalid page range "${part.trim()}" in "${spec}".`);
    for (let page = start; page <= end && pages.size <= MAX_PAGES; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

async function findSoffice(): Promise<string | null> {
  const candidates = [
    'soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/opt/homebrew/bin/soffice',
  ];
  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 15_000 });
      return bin;
    } catch {
      // Try the next common installation path.
    }
  }
  return null;
}

async function pptxToPdf(pptx: Buffer, filename: string): Promise<Buffer> {
  const soffice = await findSoffice();
  if (!soffice) {
    throw new Error('Rendering PowerPoint files needs LibreOffice. Install it with `brew install --cask libreoffice`.');
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-drive-mcp-'));
  try {
    const inputPath = path.join(tmpDir, filename.replace(/[/\\]/g, '_') || 'slides.pptx');
    await fs.writeFile(inputPath, pptx);
    await execFileAsync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, inputPath], {
      timeout: 120_000,
    });
    return await fs.readFile(inputPath.replace(/\.[^.]+$/, '') + '.pdf');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadDriveFile(file: DriveFile): Promise<{ body: Buffer; contentType: string }> {
  const isGoogleFile = file.mimeType === GOOGLE_DOC_MIME_TYPE || file.mimeType === GOOGLE_SLIDES_MIME_TYPE;
  const url = driveUrl(
    isGoogleFile ? `/files/${encodeURIComponent(file.fileId)}/export` : `/files/${encodeURIComponent(file.fileId)}`,
    isGoogleFile ? { mimeType: 'application/pdf' } : { alt: 'media', supportsAllDrives: 'true' },
  );
  const response = await driveFetch(url);
  const declaredSize = Number(response.headers.get('content-length') ?? 0);
  if (declaredSize > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Drive file is larger than the ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB download limit.`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Drive file is larger than the ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB download limit.`);
  }
  return { body, contentType: response.headers.get('content-type') ?? file.mimeType };
}

export async function getDriveFile(fileId: string, pagesSpec?: string): Promise<DriveFileResult> {
  const files = await indexDriveFiles();
  const file = files.find((candidate) => candidate.fileId === fileId);
  if (!file) {
    throw new Error('That file is not inside a configured Google Drive folder. Use search_drive_files first.');
  }
  const downloaded = await downloadDriveFile(file);
  const ext = path.extname(file.name).toLowerCase();
  const isPdf =
    file.mimeType === GOOGLE_DOC_MIME_TYPE ||
    file.mimeType === GOOGLE_SLIDES_MIME_TYPE ||
    ext === '.pdf' ||
    downloaded.contentType.includes('application/pdf') ||
    downloaded.body.subarray(0, 4).toString() === '%PDF';
  const isPowerPoint = ext === '.ppt' || ext === '.pptx' || downloaded.contentType.includes('presentation');

  const pdf = isPdf
    ? downloaded.body
    : isPowerPoint
      ? await pptxToPdf(downloaded.body, file.name)
      : null;
  if (!pdf) {
    throw new Error(`Drive file "${file.name}" cannot be rendered. Supported types: PDF, PowerPoint, Google Docs, Google Slides.`);
  }

  const meta = await pdfToPng(pdf, { returnMetadataOnly: true, viewportScale: 1 });
  const totalPages = meta.length;
  const longEdgePts = Math.max(meta[0]?.width ?? 0, meta[0]?.height ?? 0);
  const viewportScale = longEdgePts > 0 ? Math.min(2, TARGET_LONG_EDGE_PX / longEdgePts) : 1;
  let pagesToProcess = pagesSpec ? parsePages(pagesSpec) : Array.from({ length: totalPages }, (_, index) => index + 1);
  pagesToProcess = pagesToProcess.filter((page) => page <= totalPages);
  if (pagesToProcess.length === 0) {
    throw new Error(`No pages to render: "${pagesSpec}" is outside this document's range (1-${totalPages}).`);
  }
  let note: string | undefined;
  if (pagesToProcess.length > MAX_PAGES) {
    pagesToProcess = pagesToProcess.slice(0, MAX_PAGES);
    note = `Rendered the first ${MAX_PAGES} of ${totalPages} pages. Call again with a pages range for the rest.`;
  }
  const rendered = await pdfToPng(pdf, { viewportScale, pagesToProcess });
  return {
    filename: file.name,
    totalPages,
    pages: rendered
      .filter((page) => page.content)
      .map((page) => ({ page: page.pageNumber, png: page.content as Buffer })),
    note,
  };
}
