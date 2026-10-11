/**
 * Class/stream resolution for the bulk student importer.
 *
 * The implementation lives in `src/shared/classResolver.ts` (copied byte-for-byte into
 * `functions/src/shared/` and checked by `functions/src/shared/sync.test.ts`) so the Samuhia Desk delegate
 * resolves classes exactly the way the app does. Import from here in app code; this file only re-exports.
 */
export { resolveClassCode } from '../shared/classResolver';
export type { ClassResolutionIssue, ClassResolutionResult } from '../shared/classResolver';
