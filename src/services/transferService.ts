import {
  collection, doc, getDoc, getDocs, query, runTransaction, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  AcademicYear, Enrolment, School, Student, TransferRecord,
} from '../types';

function transferId(): string {
  return doc(collection(db, '_ids')).id; // cheap client-side unique id generator
}

/** All transfer records for a student, most recent first — the preserved transfer history. */
export async function getTransferHistory(studentId: string): Promise<TransferRecord[]> {
  const snap = await getDocs(query(collection(db, 'transfers'), where('studentId', '==', studentId)));
  return snap.docs.map(d => d.data() as TransferRecord)
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
}

/** All transfers recorded for a school (admin-facing audit view), most recent first. */
export async function getSchoolTransfers(schoolId: string): Promise<TransferRecord[]> {
  const snap = await getDocs(query(collection(db, 'transfers'), where('schoolId', '==', schoolId)));
  return snap.docs.map(d => d.data() as TransferRecord)
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
}

async function assertNoDuplicateStudent(schoolId: string, admissionNo: string, nationalId?: string): Promise<void> {
  const byAdmission = await getDocs(query(
    collection(db, 'students'), where('schoolId', '==', schoolId), where('admissionNo', '==', admissionNo),
  ));
  if (!byAdmission.empty) {
    throw new Error(`Admission number ${admissionNo} is already in use at this school.`);
  }
  if (nationalId) {
    const byNational = await getDocs(query(
      collection(db, 'students'), where('schoolId', '==', schoolId), where('nationalId', '==', nationalId),
    ));
    if (!byNational.empty) {
      throw new Error('A student with this National ID already exists at this school.');
    }
  }
}

/**
 * TRANSFER IN — a new student joining from another school (or re-joining). Creates the student
 * doc + a fresh enrolment for the school's currently active year, and writes an audit record.
 * Guards against duplicate admission numbers / national IDs so the same student can never be
 * created twice.
 */
export async function transferInStudent(params: {
  schoolId: string;
  classCode: string;
  name: string;
  admissionNo: string;
  parentName: string;
  parentPhone: string;
  parentWhatsApp: string;
  nationalId?: string;
  fromSchoolId?: string;
  reason?: string;
  performedBy: string;
}): Promise<{ student: Student; enrolment: Enrolment; transfer: TransferRecord }> {
  const { schoolId, classCode, name, admissionNo, parentName, parentPhone, parentWhatsApp, nationalId, fromSchoolId, reason, performedBy } = params;

  const schoolSnap = await getDoc(doc(db, 'schools', schoolId));
  if (!schoolSnap.exists()) throw new Error('School not found.');
  const school = schoolSnap.data() as School;

  await assertNoDuplicateStudent(schoolId, admissionNo, nationalId);

  const now = new Date().toISOString();
  const studentRef = doc(collection(db, 'students'));
  const enrolId = `${school.activeAcademicYearId}_${studentRef.id}`;
  const transferRef = doc(db, 'transfers', transferId());

  const student: Student = {
    id: studentRef.id, name, admissionNo, classCode, schoolId,
    parentName, parentPhone, parentWhatsApp, createdAt: now,
    ...(nationalId ? { nationalId } : {}),
    currentEnrolmentId: enrolId,
  };
  const enrolment: Enrolment = {
    id: enrolId, studentId: studentRef.id, schoolId, academicYearId: school.activeAcademicYearId,
    classCode, status: 'active', createdAt: now,
  };
  const transfer: TransferRecord = {
    id: transferRef.id, schoolId, studentId: studentRef.id, studentName: name, admissionNo,
    type: 'transfer_in', academicYearId: school.activeAcademicYearId,
    toClassCode: classCode, ...(fromSchoolId ? { fromSchoolId } : {}),
    toEnrolmentId: enrolId, ...(reason ? { reason } : {}),
    status: 'completed', performedBy, performedAt: now,
  };

  await runTransaction(db, async (tx) => {
    tx.set(studentRef, student);
    tx.set(doc(db, 'enrolments', enrolId), enrolment);
    tx.set(transferRef, transfer);
  });

  return { student, enrolment, transfer };
}

/**
 * TRANSFER OUT — student leaves for another school. Closes their current enrolment
 * (status -> 'transferred') rather than deleting anything, so attendance history under that
 * enrolment is fully preserved. The student doc itself is kept (not deleted) so no orphaned
 * references remain; it's just no longer part of any active roster once its enrolment is closed.
 */
export async function transferOutStudent(params: {
  schoolId: string;
  studentId: string;
  toSchoolId?: string;
  reason?: string;
  performedBy: string;
}): Promise<TransferRecord> {
  const { schoolId, studentId, toSchoolId, reason, performedBy } = params;

  const studentSnap = await getDoc(doc(db, 'students', studentId));
  if (!studentSnap.exists()) throw new Error('Student not found.');
  const student = studentSnap.data() as Student;
  if (!student.currentEnrolmentId) throw new Error('Student has no active enrolment to transfer out of.');

  const enrolRef = doc(db, 'enrolments', student.currentEnrolmentId);
  const enrolSnap = await getDoc(enrolRef);
  if (!enrolSnap.exists()) throw new Error('Active enrolment record not found.');
  const enrolment = enrolSnap.data() as Enrolment;

  const now = new Date().toISOString();
  const transferRef = doc(db, 'transfers', transferId());
  const transfer: TransferRecord = {
    id: transferRef.id, schoolId, studentId, studentName: student.name, admissionNo: student.admissionNo,
    type: 'transfer_out', academicYearId: enrolment.academicYearId,
    fromClassCode: enrolment.classCode, ...(toSchoolId ? { toSchoolId } : {}),
    fromEnrolmentId: enrolment.id, ...(reason ? { reason } : {}),
    status: 'completed', performedBy, performedAt: now,
  };

  await runTransaction(db, async (tx) => {
    tx.update(enrolRef, { status: 'transferred', closedByTransferId: transferRef.id, closedAt: now });
    tx.update(doc(db, 'students', studentId), { currentEnrolmentId: null });
    tx.set(transferRef, transfer);
  });

  return transfer;
}

/**
 * INTERNAL TRANSFER — same academic year, moving to a different class and/or stream within
 * the same school. Closes the old enrolment and opens a new one (deterministic id, so this can
 * never create a duplicate active enrolment for the same student+year) rather than mutating the
 * old one in place, so the "was in Grade 5A, moved to Grade 5B on <date>" history is preserved.
 */
export async function internalTransferStudent(params: {
  schoolId: string;
  studentId: string;
  toClassCode: string;
  isStreamOnly?: boolean; // purely for labelling the transfer type in the audit trail
  reason?: string;
  performedBy: string;
}): Promise<{ enrolment: Enrolment; transfer: TransferRecord }> {
  const { schoolId, studentId, toClassCode, isStreamOnly, reason, performedBy } = params;

  const studentSnap = await getDoc(doc(db, 'students', studentId));
  if (!studentSnap.exists()) throw new Error('Student not found.');
  const student = studentSnap.data() as Student;
  if (!student.currentEnrolmentId) throw new Error('Student has no active enrolment to transfer.');

  const oldEnrolRef = doc(db, 'enrolments', student.currentEnrolmentId);
  const oldEnrolSnap = await getDoc(oldEnrolRef);
  if (!oldEnrolSnap.exists()) throw new Error('Active enrolment record not found.');
  const oldEnrolment = oldEnrolSnap.data() as Enrolment;

  if (oldEnrolment.classCode === toClassCode) {
    throw new Error('Student is already in that class.');
  }

  const now = new Date().toISOString();
  // Deterministic id per (year, student) means this REPLACES the roster row for that year rather
  // than creating a second one — guarding against duplicated active enrolments.
  const newEnrolId = `${oldEnrolment.academicYearId}_${studentId}`;
  const transferRef = doc(db, 'transfers', transferId());

  const newEnrolment: Enrolment = {
    id: newEnrolId, studentId, schoolId, academicYearId: oldEnrolment.academicYearId,
    classCode: toClassCode, status: 'active', createdAt: now,
  };
  const transfer: TransferRecord = {
    id: transferRef.id, schoolId, studentId, studentName: student.name, admissionNo: student.admissionNo,
    type: isStreamOnly ? 'internal_stream' : 'internal_class',
    academicYearId: oldEnrolment.academicYearId,
    fromClassCode: oldEnrolment.classCode, toClassCode,
    fromEnrolmentId: oldEnrolment.id, toEnrolmentId: newEnrolId,
    ...(reason ? { reason } : {}),
    status: 'completed', performedBy, performedAt: now,
  };

  await runTransaction(db, async (tx) => {
    if (newEnrolId !== oldEnrolment.id) {
      tx.update(oldEnrolRef, { status: 'transferred', closedByTransferId: transferRef.id, closedAt: now });
    }
    tx.set(doc(db, 'enrolments', newEnrolId), newEnrolment);
    tx.update(doc(db, 'students', studentId), { currentEnrolmentId: newEnrolId, classCode: toClassCode });
    tx.set(transferRef, transfer);
  });

  return { enrolment: newEnrolment, transfer };
}

/**
 * CROSS-YEAR TRANSFER — record (or correct) a transfer against a specific academic year other
 * than the school's current active one, e.g. backfilling a transfer that happened last year.
 * Purely an audit record against the given year's enrolment; it never touches the student's
 * `currentEnrolmentId`, since by definition it's not about the active year.
 */
export async function crossYearTransferRecord(params: {
  schoolId: string;
  studentId: string;
  academicYearId: string;
  fromClassCode?: string;
  toClassCode?: string;
  reason?: string;
  performedBy: string;
}): Promise<TransferRecord> {
  const { schoolId, studentId, academicYearId, fromClassCode, toClassCode, reason, performedBy } = params;

  const yearSnap = await getDoc(doc(db, 'academicYears', academicYearId));
  if (!yearSnap.exists()) throw new Error('Academic year not found.');
  const year = yearSnap.data() as AcademicYear;
  if (year.schoolId !== schoolId) throw new Error('Academic year does not belong to this school.');

  const studentSnap = await getDoc(doc(db, 'students', studentId));
  if (!studentSnap.exists()) throw new Error('Student not found.');
  const student = studentSnap.data() as Student;

  const now = new Date().toISOString();
  const transferRef = doc(db, 'transfers', transferId());
  const transfer: TransferRecord = {
    id: transferRef.id, schoolId, studentId, studentName: student.name, admissionNo: student.admissionNo,
    type: 'cross_year', academicYearId,
    ...(fromClassCode ? { fromClassCode } : {}),
    ...(toClassCode ? { toClassCode } : {}),
    ...(reason ? { reason } : {}),
    status: 'completed', performedBy, performedAt: now,
  };
  await runTransaction(db, async (tx) => {
    tx.set(transferRef, transfer);
  });
  return transfer;
}

/**
 * Reverse a transfer by writing a compensating record — the original TransferRecord is never
 * edited or deleted, preserving full history. Only supports reversing an internal transfer
 * (moving the student back to their prior class) since transfer-in/out reversals would touch
 * data outside this school's ownership.
 */
export async function reverseInternalTransfer(transfer: TransferRecord, performedBy: string): Promise<TransferRecord> {
  if (transfer.type !== 'internal_class' && transfer.type !== 'internal_stream') {
    throw new Error('Only internal (same-school) transfers can be reversed here.');
  }
  if (!transfer.fromClassCode) throw new Error('Original class is unknown; cannot reverse.');

  const { transfer: reversal } = await internalTransferStudent({
    schoolId: transfer.schoolId,
    studentId: transfer.studentId,
    toClassCode: transfer.fromClassCode,
    isStreamOnly: transfer.type === 'internal_stream',
    reason: `Reversal of transfer ${transfer.id}`,
    performedBy,
  });
  return reversal;
}
