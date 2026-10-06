import {
  getAnnouncements,
  getContent,
  getCourseOutline,
  getUpcoming,
  listCoursesWithTitles,
  type Course,
} from './d2l.js';
import { searchDriveFiles, type DriveFile } from './drive.js';

const ASSESSMENT_TERMS = [
  'exam',
  'final',
  'midterm',
  'test',
  'quiz',
  'assessment',
  'scope',
  'format',
  'coverage',
  'review',
  'practice',
  'calculator',
  'open book',
  'closed book',
];
const MATERIAL_TERMS = [
  'lecture',
  'lesson',
  'week',
  'module',
  'chapter',
  'unit',
  'slides',
  'notes',
  'tutorial',
  'review',
];
const MAX_OUTLINE_CHARS = 60_000;
const MAX_MATERIALS = 100;

type Modules = Awaited<ReturnType<typeof getContent>>;
type Announcement = Awaited<ReturnType<typeof getAnnouncements>>[number];
type UpcomingEvent = Awaited<ReturnType<typeof getUpcoming>>[number];

export interface StudyMaterial {
  topicId: string;
  title: string;
  type: string;
  url: string | null;
  modulePath: string[];
  score: number;
}

export interface ExamContext {
  generatedAt: string;
  course: Course;
  assessment: string;
  examSignals: {
    announcements: Announcement[];
    upcomingEvents: UpcomingEvent[];
  };
  outline: Awaited<ReturnType<typeof getCourseOutline>> | null;
  studyMaterials: StudyMaterial[];
  pastAssessments: DriveFile[];
  recommendedFileCalls: {
    tool: 'get_topic_file';
    courseId: number;
    topicId: string;
    pages: string;
    title: string;
    reason: string;
  }[];
  warnings: string[];
  agentInstructions: string[];
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function courseCode(course: Course): string | null {
  return course.name.match(/\b[A-Z]{2,}\s*\d{2,4}[A-Z]?\b/i)?.[0]?.replace(/\s+/g, ' ') ?? null;
}

/** Resolve a human course query ("SYDE 162", title, or ou ID) without a separate tool call. */
export function resolveCourse(courses: Course[], query: string | number): Course {
  if (typeof query === 'number' || /^\d+$/.test(query.trim())) {
    const id = typeof query === 'number' ? query : Number(query);
    const match = courses.find((course) => course.ou === id);
    if (match) return match;
    throw new Error(`No enrolled course has courseId ${id}.`);
  }

  const needle = normalized(query);
  const ranked = courses
    .map((course) => {
      const name = normalized(course.name);
      const title = normalized(course.title ?? '');
      const code = normalized(courseCode(course) ?? '');
      let score = 0;
      if (needle === code) score += 100;
      if (needle === name || needle === title) score += 90;
      if (name.includes(needle) || title.includes(needle)) score += 40;
      const terms = needle.split(' ').filter(Boolean);
      if (terms.length > 0 && terms.every((term) => `${name} ${title}`.includes(term))) score += 20;
      return { course, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.course.ou - a.course.ou);

  if (ranked.length === 0) {
    throw new Error(
      `No enrolled course matched "${query}". Available courses: ` +
        courses.map((course) => `${course.name} (${course.ou})`).join(', '),
    );
  }
  return ranked[0].course;
}

function relevance(text: string, assessment: string): number {
  const haystack = normalized(text);
  const assessmentWords = normalized(assessment).split(' ').filter((term) => term.length > 2);
  let score = assessmentWords.reduce((sum, term) => sum + (haystack.includes(term) ? 8 : 0), 0);
  score += ASSESSMENT_TERMS.reduce((sum, term) => sum + (haystack.includes(term) ? 2 : 0), 0);
  return score;
}

function relevantAnnouncements(items: Announcement[], assessment: string): Announcement[] {
  const ranked = items
    .map((item) => ({ item, score: relevance(`${item.title} ${item.body}`, assessment) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.item.postedDate ?? '').localeCompare(a.item.postedDate ?? ''))
    .map(({ item }) => item);
  return (ranked.length > 0 ? ranked : items).slice(0, 10);
}

function relevantEvents(items: UpcomingEvent[], assessment: string): UpcomingEvent[] {
  return items.filter((item) => relevance(`${item.title} ${item.description ?? ''}`, assessment) > 0);
}

export function flattenMaterials(modules: Modules, assessment: string): StudyMaterial[] {
  const output: StudyMaterial[] = [];
  const visit = (items: Modules, parents: string[]) => {
    for (const module of items) {
      const modulePath = [...parents, module.title];
      for (const topic of module.topics) {
        const text = `${modulePath.join(' ')} ${topic.title} ${topic.type} ${topic.url ?? ''}`;
        const lower = text.toLowerCase();
        const fileLike = /\.(pdf|ppt|pptx)(?:$|[?#])/i.test(topic.url ?? '') ||
          /file|pdf|powerpoint|document/i.test(topic.type);
        let score = relevance(text, assessment);
        score += MATERIAL_TERMS.reduce((sum, term) => sum + (lower.includes(term) ? 3 : 0), 0);
        if (fileLike) score += 12;
        if (/outline|syllabus|assignment submission|dropbox/i.test(text)) score -= 8;
        output.push({
          topicId: topic.id,
          title: topic.title,
          type: topic.type,
          url: topic.url,
          modulePath,
          score,
        });
      }
      visit(module.modules, modulePath);
    }
  };
  visit(modules, []);
  return output
    .sort((a, b) => b.score - a.score || a.modulePath.join('/').localeCompare(b.modulePath.join('/')))
    .slice(0, MAX_MATERIALS);
}

async function optionalSource<T>(
  label: string,
  operation: () => Promise<T>,
  fallback: T,
  warnings: string[],
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    warnings.push(`${label} unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
}

async function findPastAssessments(course: Course, assessment: string): Promise<DriveFile[]> {
  const code = courseCode(course) ?? course.name;
  const queries = [`${code} ${assessment}`, `${code} exam`, code];
  for (const query of queries) {
    const result = await searchDriveFiles(query, 12);
    if (result.files.length > 0) return result.files;
  }
  return [];
}

/**
 * Gather the planning context an agent needs before reading lesson files and
 * drafting a grounded practice assessment. Independent sources degrade
 * gracefully so, for example, a missing Outline session does not hide LEARN
 * announcements and content.
 */
export async function getExamContext(query: string | number, assessment = 'final exam'): Promise<ExamContext> {
  const warnings: string[] = [];
  const courses = await listCoursesWithTitles();
  const course = resolveCourse(courses, query);

  const [announcements, modules, outline, upcoming, pastAssessments] = await Promise.all([
    optionalSource('Announcements', () => getAnnouncements(course.ou), [], warnings),
    optionalSource('Course content', () => getContent(course.ou), [], warnings),
    optionalSource('Course outline', () => getCourseOutline(course.ou), null, warnings),
    optionalSource('Calendar', () => getUpcoming(course.ou, 365), [], warnings),
    optionalSource('Past-assessment Drive search', () => findPastAssessments(course, assessment), [], warnings),
  ]);

  if (outline && outline.text.length > MAX_OUTLINE_CHARS) {
    outline.text = `${outline.text.slice(0, MAX_OUTLINE_CHARS)}\n\n[Outline truncated at ${MAX_OUTLINE_CHARS} characters.]`;
    warnings.push('The course outline was truncated to keep the MCP response within model context limits.');
  }

  const studyMaterials = flattenMaterials(modules, assessment);
  const recommended = studyMaterials.filter((item) => item.score >= 12).slice(0, 12);

  return {
    generatedAt: new Date().toISOString(),
    course,
    assessment,
    examSignals: {
      announcements: relevantAnnouncements(announcements, assessment),
      upcomingEvents: relevantEvents(upcoming, assessment),
    },
    outline,
    studyMaterials,
    pastAssessments,
    recommendedFileCalls: recommended.map((item) => ({
      tool: 'get_topic_file',
      courseId: course.ou,
      topicId: item.topicId,
      pages: '1-10',
      title: item.title,
      reason: `High-priority lesson material in ${item.modulePath.join(' > ')}`,
    })),
    warnings,
    agentInstructions: [
      'Treat instructor announcements and the official outline as the authority for exam date, format, rules, and scope.',
      'Call search_course_materials with the subject concepts or learning objectives named in the exam scope. It can index 20+ large files and return only relevant page-cited passages.',
      'Use the search result keyword summaries to check coverage, then call get_topic_file only for relevant cited pages that need diagrams or visual context.',
      'Use past assessments only as style and difficulty references. Do not assume their scope matches the current course offering.',
      'Generate original questions grounded in the retrieved lessons, and label any inferred scope or format explicitly.',
      'Include an answer key or worked solutions unless the student asks for questions only.',
    ],
  };
}
