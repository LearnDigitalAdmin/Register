import {
  collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Enrolment, EnrolmentStatus } from '../types';

function enrolmentId(academicYearId: string, studentId: string): string {
  return `${academicYearId}_${studentId}`;
}

/**
 * Create (or overwrite, if re-run) a student's enrolment for a given academic year,
 * and point the student doc's `currentEnrolmentId` at it if that year is the school's active year.
 */
export async function createEnrolment(params: {
  studentId: string;
  schoolId: string;
  academicYearId: string;
  classCode: string;
  status?: EnrolmentStatus;
  setAsCurrent?: boolean;
}): Promise<Enrolment> {
  const { studentId, schoolId, academicYearId, classCode, status = 'active', setAsCurrent = true } = params;
  const id = enrolmentId(academicYearId, studentId);
  const enrolment: Enrolment = {
    id, studentId, schoolId, academicYearId, classCode, status,
    createdAt: new Date().toISOString(),
  };
  await setDoc(doc(db, 'enrolments', id), enrolment);
  if (setAsCurrent) {
    await updateDoc(doc(db, 'students', studentId), { currentEnrolmentId: id, classCode });
  }
  return enrolment;
}

export async function getEnrolment(enrolmentId: string): Promise<Enrolment | null> {
  const snap = await getDoc(doc(db, 'enrolments', enrolmentId));
  return snap.exists() ? (snap.data() as Enrolment) : null;
}

/** All enrolments for a school in a given academic year (used to build promotion rosters). */
export async function getEnrolmentsForYear(schoolId: string, academicYearId: string): Promise<Enrolment[]> {
  const q = query(
    collection(db, 'enrolments'),
    where('schoolId', '==', schoolId),
    where('academicYearId', '==', academicYearId),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as Enrolment);
}

/** Just the active students in one class, for a given year. */
export async function getClassRoster(schoolId: string, academicYearId: string, classCode: string): Promise<Enrolment[]> {
  const all = await getEnrolmentsForYear(schoolId, academicYearId);
  return all.filter(e => e.classCode === classCode && e.status === 'active');
}

export async function updateEnrolmentStatus(id: string, status: EnrolmentStatus): Promise<void> {
  await updateDoc(doc(db, 'enrolments', id), { status });
}
