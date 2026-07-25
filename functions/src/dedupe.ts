/**
 * Duplicate/sibling/conflict classification for the student roster.
 *
 * NOTE: this file deliberately duplicates small pieces of normalisation logic that also live in
 * src/types.ts and src/utils/phoneValidation.ts on the frontend. Cloud Functions builds from its
 * own `functions/` package with `rootDir: src` (see functions/tsconfig.json), so it can't import
 * across that boundary. If the frontend's admission-number or phone normalisation rules change,
 * mirror the change here too.
 */

export interface StudentLite {
  id: string;
  name: string;
  admissionNo: string;
  classCode: string;
  parentName: string;
  parentPhone: string;
}

function cleanPhoneDigits(raw: string): string {
  return (raw || '').trim().replace(/[^\d+]/g, '');
}

/** Mirrors `normalisePhone` in src/utils/phoneValidation.ts (Kenyan local-format normalisation),
 * but never returns null here — an unrecognised/empty number just normalises to '', which never
 * equality-matches anything, so it can't cause a false match. */
export function normalisePhoneForCompare(raw: string): string {
  let digits = cleanPhoneDigits(raw);
  if (!digits) return '';
  if (digits.startsWith('+254')) digits = '0' + digits.slice(4);
  else if (digits.startsWith('254')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('+')) digits = digits.slice(1);
  if (/^0[17]\d{8}$/.test(digits)) return digits;
  if (/^0[2-9]\d{7,8}$/.test(digits) && digits.length === 10) return digits;
  return '';
}

/** Mirrors `normaliseAdmissionNo` in src/types.ts. */
export function normaliseAdmissionForCompare(raw: string): string {
  return (raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Order-independent name comparison so "Doe John", "John Doe", "john  doe", "JOHN DOE" all
 * compare equal — sorts the name's own words rather than trying to guess first/last name order. */
export function normaliseNameForCompare(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

export type ConflictType = 'duplicate_admission' | 'duplicate_student' | 'phone_conflict';

export interface ConflictCandidate {
  type: ConflictType;
  reason: string;
}

/**
 * Classifies a pair of same-school students. Returns null for anything that isn't worth a
 * human's attention — including ordinary siblings, who legitimately share a parent phone and/or
 * parent name while having different names and admission numbers.
 *
 * - Same admission number (after normalising) → `duplicate_admission`: always a data error,
 *   admission numbers must be unique per school.
 * - Same name AND same parent phone, different admission no → `duplicate_student`: very likely
 *   the same child entered twice.
 * - Same parent phone, different name, but parent names ALSO differ (and both are present) →
 *   `phone_conflict`: two different families are apparently sharing one phone number, which is
 *   either a coincidence worth confirming, a data-entry mistake, or a sign of a fabricated
 *   ("ghost") student record reusing a real contact number.
 * - Same parent phone, different name, but parent name matches (or either side left blank) →
 *   siblings; not flagged at all.
 */
export function classifyPair(a: StudentLite, b: StudentLite): ConflictCandidate | null {
  if (a.id === b.id) return null;

  const admA = normaliseAdmissionForCompare(a.admissionNo);
  const admB = normaliseAdmissionForCompare(b.admissionNo);
  const nameA = normaliseNameForCompare(a.name);
  const nameB = normaliseNameForCompare(b.name);
  const phoneA = normalisePhoneForCompare(a.parentPhone);
  const phoneB = normalisePhoneForCompare(b.parentPhone);
  const parentA = normaliseNameForCompare(a.parentName);
  const parentB = normaliseNameForCompare(b.parentName);

  const sameAdmission = !!admA && admA === admB;
  const sameName = !!nameA && nameA === nameB;
  const samePhone = !!phoneA && phoneA === phoneB;
  const sameParentName = !!parentA && parentA === parentB;

  if (sameAdmission) {
    return {
      type: 'duplicate_admission',
      reason: `Both students use admission no. "${a.admissionNo}" — admission numbers must be unique at a school.`,
    };
  }
  if (sameName && samePhone) {
    return {
      type: 'duplicate_student',
      reason: `Same student name and parent phone number, under two different admission numbers (${a.admissionNo}, ${b.admissionNo}) — likely the same child entered twice.`,
    };
  }
  if (samePhone && !sameName) {
    if (sameParentName || !parentA || !parentB) return null; // ordinary siblings — not a conflict
    return {
      type: 'phone_conflict',
      reason: `${a.name} and ${b.name} share a parent phone number but have different parent names ("${a.parentName || '—'}" vs "${b.parentName || '—'}") — verify this isn't a duplicate/ghost record or a coincidentally shared number.`,
    };
  }
  return null;
}

/** Deterministic, order-independent conflict doc ID — same pair + type always maps to the same
 * document, so re-scanning never creates duplicate conflict records. */
export function conflictDocId(schoolId: string, type: ConflictType, idA: string, idB: string): string {
  const [x, y] = [idA, idB].sort();
  return `${schoolId}_${type}_${x}_${y}`;
}

/** Groups students into buckets sharing the same non-empty key, keeping only buckets with 2+
 * students — that's the only case classifyPair has anything to compare. Used to avoid true
 * O(n²) comparison across a whole school roster; only same-admission and same-phone buckets are
 * ever compared pairwise, and those buckets are normally tiny. */
export function bucketBy<T>(items: T[], keyFn: (item: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map.values()).filter(b => b.length > 1);
}
