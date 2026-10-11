import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * `src/shared/*` (app) and `functions/src/shared/*` (Cloud Functions) must be byte-identical: that is how the Desk
 * delegate reuses the app's own validation and report rules instead of re-implementing them. Fix a failure with
 * `cp src/shared/*.ts functions/src/shared/` from the repo root (test files stay only in functions).
 * Both trees are located from the repo root (the parent of `functions/`), whether run from src/ (tsx) or lib-test/ (compiled).
 */
function repoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (path.basename(dir) === 'functions' && fs.existsSync(path.join(path.dirname(dir), 'src', 'shared'))) return path.dirname(dir);
    dir = path.dirname(dir);
  }
  throw new Error(`Could not locate the repo root above ${from}`);
}

const root = repoRoot(__dirname);
const appShared = path.join(root, 'src', 'shared');                // <repo>/src/shared
const fnShared = path.join(root, 'functions', 'src', 'shared');    // <repo>/functions/src/shared
const list = (dir: string) => fs.readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort();

test('both trees contain the same shared modules', () => {
  assert.notEqual(path.resolve(appShared), path.resolve(fnShared));
  assert.deepEqual(list(fnShared), list(appShared));
  assert.ok(list(appShared).length >= 5);
});

for (const file of list(appShared)) {
  test(`shared/${file} is identical in the app and in functions`, () => {
    assert.equal(fs.readFileSync(path.join(fnShared, file), 'utf8'), fs.readFileSync(path.join(appShared, file), 'utf8'));
  });
}
