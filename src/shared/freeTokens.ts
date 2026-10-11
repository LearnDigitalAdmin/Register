/**
 * Free message tokens granted at signup. Pure, import-free, and copied byte-for-byte into Cloud Functions
 * (`functions/src/shared/freeTokens.ts`, re-exported from `functions/src/tokenAllocation.ts`; the copy is verified by
 * `functions/src/shared/sync.test.ts`), so the app and the server cannot disagree about the rule.
 *
 * The allowance is per SCHOOL, not per person: the account that registers a school (its school admin) receives it
 * once, together with the school record. A teacher who joins an existing school receives nothing at signup — the
 * school admin shares tokens with teachers through `allocateTokensToTeachers`. Balances that already exist are never
 * touched by this rule; it only decides what a brand-new account starts with.
 */

export const FREE_TOKENS_PER_SCHOOL = 50;

export type SignupRole = 'schoolAdmin' | 'teacherAdmin';

/** Tokens a brand-new account of this role starts with. */
export function signupFreeTokens(role: SignupRole): number {
  return role === 'schoolAdmin' ? FREE_TOKENS_PER_SCHOOL : 0;
}
