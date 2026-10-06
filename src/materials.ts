import fs from 'node:fs/promises';
import path from 'node:path';
import { MATERIAL_CACHE_DIR } from './config.js';
import { flattenMaterials, resolveCourse, type StudyMaterial } from './context.js';
import { getContent, getTopicText, listCoursesWithTitles, type Course } from './d2l.js';

const CACHE_SCHEMA_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_FILES = 40;
const MAX_FILES = 60;
const DEFAULT_MAX_RESULTS = 24;
const MAX_RESULTS = 50;
const MAX_SNIPPET_CHARS = 1_800;
const CONCURRENCY = 4;
const PAGES_PER_FILE_IN_RESULTS = 4;

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'because', 'before', 'being', 'between', 'course', 'covers',
  'does', 'each', 'exam', 'final', 'from', 'have', 'into', 'more', 'most', 'other', 'over', 'same',
  'should', 'some', 'such', 'than', 'that', 'their', 'there', 'these', 'they', 'this', 'through',
  'under', 'using', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your',
]);

interface CachedMaterialText {
  schemaVersion: 1;
  courseId: number;
  topicId: string;
  filename: string;
  indexedAt: string;
  totalPages: number;
  pages: { page: number; text: string }[];
}

interface IndexedMaterial extends CachedMaterialText {
  title: string;
  modulePath: string[];
  cached: boolean;
}

export interface MaterialSearchResult {
  course: Course;
  query: string;
  indexedFiles: number;
  cachedFiles: number;
  failedFiles: number;
  totalPages: number;
  truncatedFiles: boolean;
  materials: {
    topicId: string;
    title: string;
    filename: string;
    modulePath: string[];
    totalPages: number;
    keywords: string[];
  }[];
  results: {
    topicId: string;
    title: string;
    filename: string;
    modulePath: string[];
    page: number;
    text: string;
    score: number;
    imageCall: { tool: 'get_topic_file'; courseId: number; topicId: string; pages: string };
  }[];
  warnings: string[];
}

function cachePath(courseId: number, topicId: string): string {
  const safeTopic = topicId.replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(MATERIAL_CACHE_DIR, String(courseId), `${safeTopic}.json`);
}

function isCachedMaterial(value: unknown, courseId: number, topicId: string): value is CachedMaterialText {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CachedMaterialText>;
  return item.schemaVersion === CACHE_SCHEMA_VERSION && item.courseId === courseId && item.topicId === topicId &&
    typeof item.filename === 'string' && typeof item.indexedAt === 'string' &&
    typeof item.totalPages === 'number' && Array.isArray(item.pages) &&
    item.pages.every((page) => Number.isInteger(page?.page) && page.page > 0 && typeof page.text === 'string');
}

async function readCache(courseId: number, topicId: string): Promise<CachedMaterialText | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath(courseId, topicId), 'utf8')) as unknown;
    if (!isCachedMaterial(parsed, courseId, topicId)) return null;
    const indexedAt = Date.parse(parsed.indexedAt);
    if (!Number.isFinite(indexedAt) || Date.now() - indexedAt >= CACHE_TTL_MS) return null;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Could not read cached course material ${courseId}/${topicId}: ${error}`);
    }
    return null;
  }
}

async function writeCache(item: CachedMaterialText): Promise<void> {
  const file = cachePath(item.courseId, item.topicId);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(item), { mode: 0o600 });
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600).catch(() => {});
}

async function indexMaterial(courseId: number, material: StudyMaterial, refresh: boolean): Promise<IndexedMaterial> {
  if (!refresh) {
    const cached = await readCache(courseId, material.topicId);
    if (cached) return { ...cached, title: material.title, modulePath: material.modulePath, cached: true };
  }

  const extracted = await getTopicText(courseId, material.topicId);
  const item: CachedMaterialText = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    courseId,
    topicId: material.topicId,
    filename: extracted.filename,
    indexedAt: new Date().toISOString(),
    totalPages: extracted.totalPages,
    pages: extracted.pages,
  };
  await writeCache(item).catch((error) => {
    console.warn(`Could not cache course material ${courseId}/${material.topicId}: ${error}`);
  });
  return { ...item, title: material.title, modulePath: material.modulePath, cached: false };
}

async function mapConcurrent<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .match(/[a-z][a-z0-9'-]{2,}/g)
    ?.filter((word) => !STOP_WORDS.has(word)) ?? [];
}

export function materialSearchTerms(query: string): string[] {
  return [...new Set(words(query))].slice(0, 50);
}

function pageScore(item: IndexedMaterial, pageText: string, query: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const page = pageText.toLowerCase();
  const metadata = `${item.title} ${item.filename} ${item.modulePath.join(' ')}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const pageMatches = page.split(term).length - 1;
    score += Math.min(pageMatches, 8) * 3;
    if (metadata.includes(term)) score += 5;
  }
  const phrase = query.trim().toLowerCase();
  if (phrase.length >= 5 && page.includes(phrase)) score += 20;
  return score;
}

function snippet(text: string, terms: string[]): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_SNIPPET_CHARS) return clean;
  const lower = clean.toLowerCase();
  const hit = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 300);
  const end = Math.min(clean.length, start + MAX_SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

function keywords(item: IndexedMaterial): string[] {
  const counts = new Map<string, number>();
  for (const word of words(`${item.title} ${item.modulePath.join(' ')} ${item.pages.map((page) => page.text).join(' ')}`)) {
    if (word.length < 4 || /^\d/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([word]) => word);
}

/** Index many course files once, then return only page-cited passages relevant to the query. */
export async function searchCourseMaterials(
  courseQuery: string | number,
  query: string,
  options: { maxFiles?: number; maxResults?: number; refresh?: boolean } = {},
): Promise<MaterialSearchResult> {
  const courses = await listCoursesWithTitles();
  const course = resolveCourse(courses, courseQuery);
  const modules = await getContent(course.ou);
  const allCandidates = flattenMaterials(modules, '').filter((material) => material.score >= 12);
  const maxFiles = Math.min(Math.max(options.maxFiles ?? DEFAULT_MAX_FILES, 1), MAX_FILES);
  const candidates = allCandidates.slice(0, maxFiles);
  const settled = await mapConcurrent(candidates, (material) => indexMaterial(course.ou, material, options.refresh ?? false));
  const indexed = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const warnings = settled.flatMap((result, index) =>
    result.status === 'rejected'
      ? [`${candidates[index].title} could not be indexed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : [],
  );

  const terms = materialSearchTerms(query);
  const ranked = indexed.flatMap((item) => item.pages
    .filter((page) => page.text.trim().length > 0)
    .map((page) => ({ item, page, score: pageScore(item, page.text, query, terms) })))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title) || a.page.page - b.page.page);

  const maxResults = Math.min(Math.max(options.maxResults ?? DEFAULT_MAX_RESULTS, 1), MAX_RESULTS);
  const perFile = new Map<string, number>();
  const selected = [] as typeof ranked;
  for (const result of ranked) {
    const count = perFile.get(result.item.topicId) ?? 0;
    if (count >= PAGES_PER_FILE_IN_RESULTS) continue;
    selected.push(result);
    perFile.set(result.item.topicId, count + 1);
    if (selected.length >= maxResults) break;
  }

  if (terms.length === 0) warnings.push('The search query did not contain useful subject terms. Use concepts from the exam scope or outline.');
  if (terms.length > 0 && selected.length === 0) warnings.push('No indexed page text matched. Try broader subject concepts or inspect the material keyword summaries.');
  if (allCandidates.length > candidates.length) {
    warnings.push(`Indexed ${candidates.length} of ${allCandidates.length} candidate files; raise maxFiles to scan more.`);
  }

  return {
    course,
    query,
    indexedFiles: indexed.length,
    cachedFiles: indexed.filter((item) => item.cached).length,
    failedFiles: settled.length - indexed.length,
    totalPages: indexed.reduce((sum, item) => sum + item.totalPages, 0),
    truncatedFiles: allCandidates.length > candidates.length,
    materials: indexed.map((item) => ({
      topicId: item.topicId,
      title: item.title,
      filename: item.filename,
      modulePath: item.modulePath,
      totalPages: item.totalPages,
      keywords: keywords(item),
    })),
    results: selected.map(({ item, page, score }) => ({
      topicId: item.topicId,
      title: item.title,
      filename: item.filename,
      modulePath: item.modulePath,
      page: page.page,
      text: snippet(page.text, terms),
      score,
      imageCall: { tool: 'get_topic_file', courseId: course.ou, topicId: item.topicId, pages: String(page.page) },
    })),
    warnings,
  };
}
