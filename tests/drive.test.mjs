import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreDriveFile } from '../dist/drive.js';

const quiz = {
  fileId: 'quiz',
  name: 'Quiz 2 Solutions.pdf',
  path: 'CS 135/Fall 2025/Quiz 2 Solutions.pdf',
  mimeType: 'application/pdf',
  size: 100,
  modifiedTime: null,
  url: 'https://drive.google.com/open?id=quiz',
};

test('scoreDriveFile matches course and assessment terms across the path', () => {
  assert.ok(scoreDriveFile(quiz, 'CS 135 quiz') > 0);
  assert.equal(scoreDriveFile(quiz, 'MATH 136 quiz'), -1);
});

test('scoreDriveFile finds assessment-like files without a query', () => {
  assert.ok(scoreDriveFile(quiz) > 0);
  assert.equal(
    scoreDriveFile({ ...quiz, name: 'Lecture notes.pdf', path: 'CS 135/Lecture notes.pdf' }),
    -1,
  );
});
