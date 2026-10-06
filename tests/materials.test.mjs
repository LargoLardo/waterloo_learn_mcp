import assert from 'node:assert/strict';
import test from 'node:test';
import { materialSearchTerms } from '../dist/materials.js';

test('materialSearchTerms keeps subject concepts and removes generic exam wording', () => {
  assert.deepEqual(
    materialSearchTerms('Final exam covers attention, memory, and signal detection'),
    ['attention', 'memory', 'signal', 'detection'],
  );
});

test('materialSearchTerms deduplicates concepts for bounded cross-file searches', () => {
  assert.deepEqual(materialSearchTerms('memory MEMORY perception memory'), ['memory', 'perception']);
});
