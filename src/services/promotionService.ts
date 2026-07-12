import {
  collection, doc, getDoc, getDocs, query, runTransaction, where, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { AcademicYear, ClassStructure, Enrolment, School, Student } from '../types';
import { classToLevelAndStream } from './academicYearService';
import { archiveGraduate } from './archiveService';

export type PromotionAction = 'promote' | 'repeat' | 'transfer' | 'keep' | 'graduate';

export interface PromotionEntry {
  studentId: string;
  studentName: string;
  admissionNo: string;
  fromClass: string;
  /** Automatic-promotion target. Admins may override `action`/`toClass` before applying. */
  toClass: string | null;
  action: PromotionAction;
}

export interface ClassSummaryRow {
  fromClass: string;
  toClass: string | null;
  count: number;
}

export interface PromotionPreview {
  schoolId: string;
  fromYearId: string;
  toYearId: string;
  toYearLabel: string;
  entries: PromotionEntry[];
  classSummary: ClassSummaryRow[];
  graduateCount: number;
  repeaterCount: number;
  transferCount: number;
}

/** Build an automatic-promotion preview against the school's currently active year. Nothing is written yet. */
export async function buildPromotionPreview(schoolId: string, toYearLabel: string): Promise<PromotionPreview> {
  const schoolSnap = await getDoc(doc(db, 'schools', schoolId));
  if (!schoolSnap.exists()) throw new Error('School not found.');
  const school = schoolSnap.data() as School;

  const structureSnap = await getDoc(doc(db, 'classStructures', schoolId));
  if (!structureSnap.exists()) throw new Error('Class structure not set up for this school.');
  const structure = structureSnap.data() as ClassStructure;

  const fromYearId = school.activeAcademicYearId;
  const toYearId = `${schoolId}_${toYearLabel}`;

  const existingToYear = await getDoc(doc(db, 'academicYears', toYearId));
  if (existingToYear.exists() && (existingToYear.data() as AcademicYear).promotionAppliedAt) {
    throw new Error(`${toYearLabel} has already been promoted into for this school. Promotion cannot run twice.`);
  }

  const enrolSnap = await getDocs(query(
    collection(db, 'enrolments'),
    where('schoolId', '==', schoolId),
    where('academicYearId', '==', fromYearId),
    where('status', '==', 'active'),
  ));
  const enrolments = enrolSnap.docs.map(d => d.data() as Enrolment);

  const studentsSnap = await getDocs(query(collection(db, 'students'), where('schoolId', '==', schoolId)));
  const studentsById = new Map(studentsSnap.docs.map(d => [d.id, d.data() as Student]));

  const entries: PromotionEntry[] = [];
  for (const en of enrolments) {
    const student = studentsById.get(en.studentId);
    if (!student || student.archived) continue;

    const { level, stream } = classToLevelAndStream(structure, en.classCode);
    const isGraduating = level === structure.graduatingClass;

    let toClass: string | null;
    let action: PromotionAction;
    if (isGraduating) {
      toClass = null;
      action = 'graduate';
    } else {
      const nextLevel = structure.levels[structure.levels.indexOf(level) + 1];
      toClass = structure.streamsEnabled ? `${nextLevel}${stream}` : nextLevel;
      action = 'promote';
    }

    entries.push({
      studentId: en.studentId,
      studentName: student.name,
      admissionNo: student.admissionNo,
      fromClass: en.classCode,
      toClass,
      action,
    });
  }

  entries.sort((a, b) => a.fromClass.localeCompare(b.fromClass) || a.studentName.localeCompare(b.studentName));

  const summaryMap = new Map<string, ClassSummaryRow>();
  for (const e of entries) {
    const key = `${e.fromClass}\u2192${e.toClass ?? 'GRADUATE'}`;
    if (!summaryMap.has(key)) summaryMap.set(key, { fromClass: e.fromClass, toClass: e.toClass, count: 0 });
    summaryMap.get(key)!.count++;
  }

  return {
    schoolId,
    fromYearId,
    toYearId,
    toYearLabel,
    entries,
    classSummary: [...summaryMap.values()].sort((a, b) => a.fromClass.localeCompare(b.fromClass)),
    graduateCount: entries.filter(e => e.action === 'graduate').length,
    repeaterCount: entries.filter(e => e.action === 'repeat').length,
    transferCount: entries.filter(e => e.action === 'transfer').length,
  };
}

/**
 * Apply a (possibly manually-edited) promotion preview.
 *
 * Step 1 is a small transaction that flips the active year and stamps `promotionAppliedAt` on the
 * new year — this is the atomic, duplicate-promotion guard: if it's already stamped, this throws
 * and nothing else runs. Step 2 (roster writes) is chunked into batches of ≤400 using deterministic
 * enrolment ids (`${toYearId}_${studentId}`), so re-running it after a partial failure is safe —
 * it just re-writes the same docs rather than duplicating them.
 */
export async function applyPromotion(preview: PromotionPreview): Promise<{ toYearId: string }> {
  const { schoolId, fromYearId, toYearId, toYearLabel, entries } = preview;
  const now = new Date().toISOString();

  await runTransaction(db, async (tx) => {
    const toYearRef = doc(db, 'academicYears', toYearId);
    const toYearSnap = await tx.get(toYearRef);
    if (toYearSnap.exists() && (toYearSnap.data() as AcademicYear).promotionAppliedAt) {
      throw new Error(`${toYearLabel} has already been promoted into. Promotion cannot run twice.`);
    }

    const fromYearRef = doc(db, 'academicYears', fromYearId);
    const schoolRef = doc(db, 'schools', schoolId);

    const newYear: AcademicYear = {
      id: toYearId, schoolId, label: toYearLabel, status: 'active',
      startDate: now, promotedFromYearId: fromYearId, promotionAppliedAt: now, createdAt: now,
    };
    tx.set(toYearRef, newYear);
    tx.update(fromYearRef, { status: 'closed', closedAt: now });
    tx.update(schoolRef, { activeAcademicYearId: toYearId });
  });

  // Promoted / repeating / kept students get a new-year enrolment + updated currentEnrolmentId.
  const rosterEntries = entries.filter(e => e.action === 'promote' || e.action === 'repeat' || e.action === 'keep');
  for (let i = 0; i < rosterEntries.length; i += 400) {
    const batch = writeBatch(db);
    for (const e of rosterEntries.slice(i, i + 400)) {
      const finalClass = e.toClass || e.fromClass;
      const enrolId = `${toYearId}_${e.studentId}`;
      batch.set(doc(db, 'enrolments', enrolId), {
        id: enrolId, studentId: e.studentId, schoolId, academicYearId: toYearId,
        classCode: finalClass, status: e.action === 'repeat' ? 'repeating' : 'active',
        createdAt: now,
      });
      batch.update(doc(db, 'students', e.studentId), { currentEnrolmentId: enrolId, classCode: finalClass });
    }
    await batch.commit();
  }

  // Transferred students: close out their old enrolment, no new-year enrolment is created.
  const transfers = entries.filter(e => e.action === 'transfer');
  for (let i = 0; i < transfers.length; i += 400) {
    const batch = writeBatch(db);
    for (const e of transfers.slice(i, i + 400)) {
      batch.update(doc(db, 'enrolments', `${fromYearId}_${e.studentId}`), { status: 'transferred' });
    }
    await batch.commit();
  }

  // Graduates: archived one at a time (each does its own reads for attendance history).
  for (const e of entries.filter(x => x.action === 'graduate')) {
    await archiveGraduate({ schoolId, studentId: e.studentId });
  }

  return { toYearId };
}
