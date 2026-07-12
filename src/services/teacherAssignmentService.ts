import {
  collection, doc, getDoc, getDocs, query, runTransaction, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { School, TeacherAssignment, TeacherTransferRecord, TeacherTransferType, UserProfile } from '../types';

function assignmentId(schoolId: string, teacherUid: string, classCode: string): string {
  return `${schoolId}_${teacherUid}_${classCode}`.replace(/\s+/g, '_');
}

function logId(): string {
  return doc(collection(db, '_ids')).id;
}

/** All currently-active assignments for a teacher (their classes at their current school). */
export async function getActiveAssignments(teacherUid: string): Promise<TeacherAssignment[]> {
  const snap = await getDocs(query(
    collection(db, 'teacherAssignments'), where('teacherUid', '==', teacherUid), where('active', '==', true),
  ));
  return snap.docs.map(d => d.data() as TeacherAssignment);
}

/** Every teacher currently assigned to a given class (school-scoped) — used to guard against double-assignment. */
export async function getTeachersForClass(schoolId: string, classCode: string): Promise<TeacherAssignment[]> {
  const snap = await getDocs(query(
    collection(db, 'teacherAssignments'),
    where('schoolId', '==', schoolId), where('classCode', '==', classCode), where('active', '==', true),
  ));
  return snap.docs.map(d => d.data() as TeacherAssignment);
}

/** Full assignment history (active + ended) for a teacher, most recent first — permanent audit trail. */
export async function getAssignmentHistory(teacherUid: string): Promise<TeacherAssignment[]> {
  const snap = await getDocs(query(collection(db, 'teacherAssignments'), where('teacherUid', '==', teacherUid)));
  return snap.docs.map(d => d.data() as TeacherAssignment).sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
}

/**
 * Assign a teacher to an additional class at their current school. Rejects if that exact
 * (teacher, class) pairing is already active — the duplicate-assignment guard.
 */
export async function assignTeacherToClass(params: {
  schoolId: string; teacherUid: string; teacherName: string; classCode: string; assignedBy: string;
}): Promise<TeacherAssignment> {
  const { schoolId, teacherUid, teacherName, classCode, assignedBy } = params;
  const id = assignmentId(schoolId, teacherUid, classCode);
  const now = new Date().toISOString();

  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'teacherAssignments', id);
    const snap = await tx.get(ref);
    if (snap.exists() && (snap.data() as TeacherAssignment).active) {
      throw new Error(`${teacherName} is already assigned to ${classCode}.`);
    }
    const assignment: TeacherAssignment = {
      id, schoolId, teacherUid, teacherName, classCode, assignedAt: now, assignedBy, active: true,
    };
    tx.set(ref, assignment);

    const userRef = doc(db, 'users', teacherUid);
    const userSnap = await tx.get(userRef);
    const profile = userSnap.data() as UserProfile | undefined;
    const current = new Set(profile?.assignedClasses || (profile?.classCode ? [profile.classCode] : []));
    current.add(classCode);
    const assignedClasses = [...current];
    tx.update(userRef, { assignedClasses, classCode: assignedClasses[0] });
  });

  return { id, schoolId, teacherUid, teacherName, classCode, assignedAt: now, assignedBy, active: true };
}

/** Remove one class from a teacher's assignments (keeps their other classes, if any). */
export async function removeAssignment(params: {
  schoolId: string; teacherUid: string; classCode: string;
}): Promise<void> {
  const { schoolId, teacherUid, classCode } = params;
  const id = assignmentId(schoolId, teacherUid, classCode);
  const now = new Date().toISOString();

  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'teacherAssignments', id);
    const snap = await tx.get(ref);
    if (!snap.exists() || !(snap.data() as TeacherAssignment).active) {
      throw new Error('That assignment is not currently active.');
    }
    tx.update(ref, { active: false, endedAt: now, endedReason: 'removed' });

    const userRef = doc(db, 'users', teacherUid);
    const userSnap = await tx.get(userRef);
    const profile = userSnap.data() as UserProfile | undefined;
    const remaining = (profile?.assignedClasses || []).filter(c => c !== classCode);
    tx.update(userRef, {
      assignedClasses: remaining,
      classCode: remaining[0] || null,
      ...(profile?.lastActiveClass === classCode ? { lastActiveClass: remaining[0] || null } : {}),
    });
  });
}

/**
 * TEACHER TRANSFER (admin-initiated) — move a teacher between classes or streams AT THE SAME
 * SCHOOL. Ends the old assignment(s), creates new ones. Moving a teacher to a different SCHOOL
 * is intentionally not available here — per policy, admins cannot transfer a teacher's school
 * membership; only the teacher themself can do that (see `selfTransferSchool` below), and it
 * requires their own confirmation.
 */
export async function transferTeacher(params: {
  teacherUid: string;
  teacherName: string;
  type: Extract<TeacherTransferType, 'class_transfer' | 'stream_transfer'>;
  fromSchoolId: string;
  toClasses: string[];
  performedBy: string;
  reason?: string;
}): Promise<TeacherTransferRecord> {
  const { teacherUid, teacherName, type, fromSchoolId, performedBy, reason } = params;
  const toClasses = [...new Set(params.toClasses.map(c => c.trim()).filter(Boolean))];
  if (toClasses.length === 0) throw new Error('At least one destination class is required.');

  const active = await getActiveAssignments(teacherUid);
  const fromClasses = active.map(a => a.classCode);

  // Duplicate-assignment guard at the destination.
  for (const c of toClasses) {
    const existing = await getTeachersForClass(fromSchoolId, c);
    if (existing.some(a => a.teacherUid === teacherUid)) {
      throw new Error(`${teacherName} is already assigned to ${c}.`);
    }
  }

  const now = new Date().toISOString();
  const logRef = doc(db, 'teacherTransfers', logId());

  await runTransaction(db, async (tx) => {
    // Reads first (Firestore transaction rule): re-fetch the docs we're about to touch.
    const oldRefs = active.map(a => doc(db, 'teacherAssignments', a.id));
    const oldSnaps = await Promise.all(oldRefs.map(r => tx.get(r)));
    const userRef = doc(db, 'users', teacherUid);
    await tx.get(userRef);

    oldSnaps.forEach((snap, i) => {
      if (snap.exists()) tx.update(oldRefs[i], { active: false, endedAt: now, endedReason: type });
    });

    for (const c of toClasses) {
      const newId = assignmentId(fromSchoolId, teacherUid, c);
      const assignment: TeacherAssignment = {
        id: newId, schoolId: fromSchoolId, teacherUid, teacherName, classCode: c,
        assignedAt: now, assignedBy: performedBy, active: true,
      };
      tx.set(doc(db, 'teacherAssignments', newId), assignment);
    }

    tx.update(userRef, { assignedClasses: toClasses, classCode: toClasses[0], lastActiveClass: toClasses[0] });

    const record: TeacherTransferRecord = {
      id: logRef.id, teacherUid, teacherName, type,
      fromSchoolId, toSchoolId: fromSchoolId, fromClasses, toClasses,
      performedBy, performedAt: now, ...(reason ? { reason } : {}),
    };
    tx.set(logRef, record);
  });

  return {
    id: logRef.id, teacherUid, teacherName, type,
    fromSchoolId, toSchoolId: fromSchoolId, fromClasses, toClasses,
    performedBy, performedAt: now, ...(reason ? { reason } : {}),
  };
}

/**
 * SCHOOL TRANSFER (teacher self-service) — a teacher moves their own account to a different
 * school by entering that school's code and confirming. Immediately:
 *   - ends every active class assignment at the old school (deactivated, never deleted)
 *   - clears their class list and re-links the account to the new school
 *   - writes a permanent transfer-log entry
 * The old school loses all access for this teacher the moment this completes — there is no
 * approval step from the old school's admin, and admins can never trigger this on a teacher's
 * behalf (that's enforced in the security rules, not just this function).
 * The new school's admin then assigns classes there via the normal Assignment Manager.
 */
export async function selfTransferSchool(params: {
  teacherUid: string;
  teacherName: string;
  fromSchoolId: string;
  toSchoolCode: string;
  reason?: string;
}): Promise<TeacherTransferRecord> {
  const { teacherUid, teacherName, fromSchoolId, reason } = params;
  const toSchoolId = params.toSchoolCode.trim().toUpperCase();
  if (!toSchoolId) throw new Error('Enter the destination school code.');
  if (toSchoolId === fromSchoolId) throw new Error('You are already at this school.');

  const schoolSnap = await getDoc(doc(db, 'schools', toSchoolId));
  if (!schoolSnap.exists()) throw new Error("No school found with that code — double-check it with the destination school's admin.");
  const toSchool = schoolSnap.data() as School;

  const active = await getActiveAssignments(teacherUid);
  const now = new Date().toISOString();
  const logRef = doc(db, 'teacherTransfers', logId());

  await runTransaction(db, async (tx) => {
    const oldRefs = active.map(a => doc(db, 'teacherAssignments', a.id));
    const oldSnaps = await Promise.all(oldRefs.map(r => tx.get(r)));
    const userRef = doc(db, 'users', teacherUid);
    await tx.get(userRef);

    oldSnaps.forEach((snap, i) => {
      if (snap.exists()) tx.update(oldRefs[i], { active: false, endedAt: now, endedReason: 'school_transfer' });
    });

    tx.update(userRef, {
      schoolId: toSchoolId,
      schoolName: toSchool.name,
      assignedClasses: [],
      classCode: null,
      lastActiveClass: null,
    });

    const record: TeacherTransferRecord = {
      id: logRef.id, teacherUid, teacherName, type: 'school_transfer',
      fromSchoolId, toSchoolId, fromClasses: active.map(a => a.classCode), toClasses: [],
      performedBy: teacherUid, performedAt: now, ...(reason ? { reason } : {}),
    };
    tx.set(logRef, record);
  });

  return {
    id: logRef.id, teacherUid, teacherName, type: 'school_transfer',
    fromSchoolId, toSchoolId, fromClasses: active.map(a => a.classCode), toClasses: [],
    performedBy: teacherUid, performedAt: now, ...(reason ? { reason } : {}),
  };
}

/** Permanent activity log for a teacher — preserved even after a school transfer. */
export async function getTeacherTransferHistory(teacherUid: string): Promise<TeacherTransferRecord[]> {
  const snap = await getDocs(query(collection(db, 'teacherTransfers'), where('teacherUid', '==', teacherUid)));
  return snap.docs.map(d => d.data() as TeacherTransferRecord).sort((a, b) => b.performedAt.localeCompare(a.performedAt));
}

/** All teacherAdmin accounts at a school (for the admin's assignment manager screen). */
export async function getSchoolTeachers(schoolId: string): Promise<UserProfile[]> {
  const snap = await getDocs(query(
    collection(db, 'users'), where('schoolId', '==', schoolId), where('role', '==', 'teacherAdmin'),
  ));
  return snap.docs.map(d => d.data() as UserProfile);
}
