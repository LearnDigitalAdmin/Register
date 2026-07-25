import { collection, doc, getDocs, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import { Conflict, ConflictStatus } from '../types';

/** Loads all conflicts for a school, most recently created first. Callers typically filter to
 * `status === 'open'` for the badge count / default panel view, but resolved/dismissed ones are
 * included so the panel can offer a "show resolved" history view. */
export async function getConflicts(schoolId: string): Promise<Conflict[]> {
  const snap = await getDocs(
    query(collection(db, 'conflicts'), where('schoolId', '==', schoolId), orderBy('createdAt', 'desc')),
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Conflict));
}

/** Marks a conflict dismissed (not actually a problem) or resolved (fixed outside this panel —
 * e.g. the admin corrected a class or admission number directly). Never deletes the record, so
 * there's always an audit trail of what was flagged and how it was handled. */
export async function setConflictStatus(conflictId: string, status: ConflictStatus, resolutionNote?: string): Promise<void> {
  await updateDoc(doc(db, 'conflicts', conflictId), {
    status,
    updatedAt: new Date().toISOString(),
    ...(resolutionNote ? { resolutionNote } : {}),
  });
}

export interface ScanResult {
  studentsScanned: number;
  pairsChecked: number;
  conflictsFlagged: number;
}

/** Runs a full-school conflict scan via the `scanSchoolForConflicts` Cloud Function
 * (admin-only — enforced server-side too). Useful right after a big import, or as a periodic
 * "ghost student" audit — the per-write trigger only catches exact-value matches, this catches
 * everything the extraction/normalisation logic can find. */
export async function scanSchoolForConflicts(schoolId: string): Promise<ScanResult> {
  const functions = getFunctions(undefined, 'africa-south1');
  const fn = httpsCallable<{ schoolId: string }, ScanResult>(functions, 'scanSchoolForConflicts');
  const result = await fn({ schoolId });
  return result.data;
}
