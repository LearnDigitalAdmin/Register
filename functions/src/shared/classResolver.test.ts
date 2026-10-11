import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveClassCode, ClassStructureLike } from './classResolver';

const levels = ['Grade 1', 'Grade 2', 'Grade 6', 'Grade 10'];
const withStreams: ClassStructureLike = {
  levels, streamsEnabled: true, streamMode: 'uniform', uniformStreams: ['Blue', 'Red'],
  classes: levels.flatMap(l => ['Blue', 'Red'].map(s => `${l}${s}`)),
};
const noStreams: ClassStructureLike = { levels, streamsEnabled: false, streamMode: 'none', classes: [...levels] };

test('exact and loosely formatted class strings resolve to the canonical code', () => {
  assert.equal(resolveClassCode('Grade 6Blue', undefined, withStreams).resolved, 'Grade 6Blue');
  assert.equal(resolveClassCode('grade 6 blue', undefined, withStreams).resolved, 'Grade 6Blue');
  assert.equal(resolveClassCode('6blue', undefined, withStreams).resolved, 'Grade 6Blue');
  assert.equal(resolveClassCode('Grade 6', 'Red', withStreams).resolved, 'Grade 6Red');
});

test('"Grade 6" never matches inside "Grade 60Blue", and Grade 10 wins over Grade 1', () => {
  assert.equal(resolveClassCode('Grade 60Blue', undefined, withStreams).resolved, null);
  assert.equal(resolveClassCode('Grade 10 Red', undefined, withStreams).resolved, 'Grade 10Red');
});

test('missing stream, unknown stream and unknown level are reported, never guessed', () => {
  assert.equal(resolveClassCode('Grade 6', undefined, withStreams).issue, 'stream_missing');
  assert.equal(resolveClassCode('Grade 6 Green', undefined, withStreams).issue, 'stream_unresolved');
  assert.equal(resolveClassCode('Form 3', undefined, withStreams).issue, 'no_level_match');
  assert.equal(resolveClassCode('', undefined, withStreams).issue, 'no_level_match');
});

test('schools without streams resolve the level alone and reject leftover text', () => {
  assert.equal(resolveClassCode('Grade 2', undefined, noStreams).resolved, 'Grade 2');
  assert.equal(resolveClassCode('Grade 2 Blue', undefined, noStreams).issue, 'unexpected_extra_text');
});

test('no class structure means nothing can be resolved', () => {
  assert.equal(resolveClassCode('Grade 2', undefined, null).issue, 'no_class_data');
});
