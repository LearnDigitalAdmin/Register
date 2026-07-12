import {
  collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  AcademicYear, ArchivedStudent, ArchivedYearRecord, AttendanceRecord, Enrolment, School, Student,
} from '../types';

/**
 * Graduate a student: writes a permanent record to the global `archivedStudents` collection
 * (with a per-year attendance summary built from historical `attendance` docs), then marks the
 * original `students/{id}` doc as archived. The student doc and all attendance records are kept
 * as-is — nothing is deleted or overwritten.
 */
export async function archiveGraduate(params: { schoolId: string; studentId: string }): Promise<ArchivedStudent> {
  const { schoolId, studentId } = params;

  const studentSnap = await getDoc(doc(db, 'students', studentId));
  if (!studentSnap.exists()) throw new Error('Student not found.');
  const student = studentSnap.data() as Student;

  const schoolSnap = await getDoc(doc(db, 'schools', schoolId));
  const school = schoolSnap.exists() ? (schoolSnap.data() as School) : null;

  const enrolSnap = await getDocs(query(
    collection(db, 'enrolments'), where('schoolId', '==', schoolId), where('studentId', '==', studentId),
  ));
  const enrolments = enrolSnap.docs.map(d => d.data() as Enrolment);

  const attSnap = await getDocs(query(
    collection(db, 'attendance'), where('schoolId', '==', schoolId), where('studentId', '==', studentId),
  ));
  const attendance = attSnap.docs.map(d => d.data() as AttendanceRecord);

  const years: ArchivedYearRecord[] = [];
  for (const en of enrolments) {
    const yearSnap = await getDoc(doc(db, 'academicYears', en.academicYearId));
    const yearLabel = yearSnap.exists() ? (yearSnap.data() as AcademicYear).label : en.academicYearId;
    // Prefer enrolmentId-tagged records; fall back to matching by class for pre-Phase-2 history.
    const yearAttendance = attendance.filter(a => (a.enrolmentId ? a.enrolmentId === en.id : a.classCode === en.classCode));
    years.push({
      academicYearId: en.academicYearId,
      yearLabel,
      classCode: en.classCode,
      presentDays: yearAttendance.filter(a => a.status === 'present').length,
      absentDays: yearAttendance.filter(a => a.status === 'absent').length,
      lateDays: yearAttendance.filter(a => a.status === 'late').length,
      excusedDays: yearAttendance.filter(a => a.status === 'excused').length,
      totalDays: yearAttendance.length,
    });
  }

  const archived: ArchivedStudent = {
    id: studentId,
    name: student.name,
    admissionNo: student.admissionNo,
    ...(student.nationalId ? { nationalId: student.nationalId } : {}),
    schoolId,
    schoolName: school?.name || '',
    graduatingClass: school?.graduatingClass || '',
    graduatedAt: new Date().toISOString(),
    years,
  };

  await setDoc(doc(db, 'archivedStudents', studentId), archived);
  await updateDoc(doc(db, 'students', studentId), { archived: true });

  return archived;
}

/** Search the global archive by exact admission number, exact national ID, or name prefix. */
export async function searchArchive(term: string): Promise<ArchivedStudent[]> {
  const clean = term.trim();
  if (!clean) return [];

  const results = new Map<string, ArchivedStudent>();

  const byAdmission = await getDocs(query(collection(db, 'archivedStudents'), where('admissionNo', '==', clean)));
  byAdmission.forEach(d => results.set(d.id, d.data() as ArchivedStudent));

  const byNationalId = await getDocs(query(collection(db, 'archivedStudents'), where('nationalId', '==', clean)));
  byNationalId.forEach(d => results.set(d.id, d.data() as ArchivedStudent));

  // No native "contains" search in Firestore — bounded prefix range query on name.
  const byName = await getDocs(query(
    collection(db, 'archivedStudents'), where('name', '>=', clean), where('name', '<=', clean + '\uf8ff'),
  ));
  byName.forEach(d => results.set(d.id, d.data() as ArchivedStudent));

  return [...results.values()];
}
