import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FREE_TOKENS_PER_SCHOOL, signupFreeTokens } from './freeTokens';

test('the free allowance is 50 tokens per school', () => {
  assert.equal(FREE_TOKENS_PER_SCHOOL, 50);
});

test('the account that registers a school receives the allowance', () => {
  assert.equal(signupFreeTokens('schoolAdmin'), 50);
});

test('a teacher joining an existing school receives nothing at signup (not per teacher)', () => {
  assert.equal(signupFreeTokens('teacherAdmin'), 0);
});

test('a school with one admin and any number of teachers is granted exactly 50 in total', () => {
  const accounts: Array<'schoolAdmin' | 'teacherAdmin'> = ['schoolAdmin', 'teacherAdmin', 'teacherAdmin', 'teacherAdmin', 'teacherAdmin'];
  const total = accounts.reduce((sum, role) => sum + signupFreeTokens(role), 0);
  assert.equal(total, FREE_TOKENS_PER_SCHOOL);
});
