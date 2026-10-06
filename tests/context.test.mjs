import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCourse } from '../dist/context.js';

const courses = [
  {
    name: 'SYDE 162 - Spring 2026',
    title: 'Human Factors in Design',
    ou: 1276844,
    url: 'https://learn.uwaterloo.ca/d2l/home/1276844',
  },
  {
    name: 'SYDE 112 - Spring 2026',
    title: 'Calculus 2',
    ou: 1271149,
    url: 'https://learn.uwaterloo.ca/d2l/home/1271149',
  },
];

test('resolveCourse accepts a course code without requiring list_courses first', () => {
  assert.equal(resolveCourse(courses, 'syde 162').ou, 1276844);
});

test('resolveCourse accepts an official title or numeric courseId', () => {
  assert.equal(resolveCourse(courses, 'human factors').ou, 1276844);
  assert.equal(resolveCourse(courses, 1271149).name, 'SYDE 112 - Spring 2026');
});

test('resolveCourse gives an actionable error for an unknown course', () => {
  assert.throws(() => resolveCourse(courses, 'MATH 999'), /Available courses:.*SYDE 162/s);
});
