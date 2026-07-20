import {
  collection, doc, getDoc, getDocs, query, runTransaction, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { School, TeacherAssignment, TeacherTransferRecord, TeacherTransferType, UserProfile } from '../types';

export function assignmentId(schoolId: string, teacherUid: string, classCode: string): string {
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

  // Class-lock: reject up front if a DIFFERENT teacher already actively holds this class.
  // (Best-effort pre-check — Firestore transactions can't run arbitrary queries, only the
  // exact-duplicate check below runs inside the transaction itself.)
  const holders = await getTeachersForClass(schoolId, classCode);
  const otherHolder = holders.find(a => a.teacherUid !== teacherUid);
  if (otherHolder) {
    throw new Error(`${classCode} is already taught by ${otherHolder.teacherName}. Remove or transfer them first.`);
  }

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
}): Promise<TeacherTransferRecord & { swappedTeachers: { teacherUid: string; teacherName: string; intoClass: string }[] }> {
  const { teacherUid, teacherName, type, fromSchoolId, performedBy, reason } = params;
  const toClasses = [...new Set(params.toClasses.map(c => c.trim()).filter(Boolean))];
  if (toClasses.length === 0) throw new Error('At least one destination class is required.');

  const active = await getActiveAssignments(teacherUid);
  const fromClasses = active.map(a => a.classCode);

  // Classes this teacher is leaving that aren't ALSO one of their destinations — these become
  // available as swap slots for anyone displaced below.
  const vacated = fromClasses.filter(c => !toClasses.includes(c));

  // Find any destination class already actively held by a DIFFERENT teacher.
  const conflicts: TeacherAssignment[] = [];
  for (const c of toClasses) {
    const holders = await getTeachersForClass(fromSchoolId, c);
    const other = holders.find(a => a.teacherUid !== teacherUid);
    if (other) conflicts.push(other);
  }

  if (conflicts.length > vacated.length) {
    const names = conflicts.map(c => `${c.teacherName} (${c.classCode})`).join(', ');
    throw new Error(
      `Can't complete this transfer — ${names} would be left without a class. ` +
      `${teacherName} is only vacating ${vacated.length || 'no'} class(es) to swap them into. ` +
      `Free up a class first, or transfer them separately.`
    );
  }

  // Pair each conflicting occupant with a vacated class, 1:1, so nobody ends up orphaned —
  // e.g. moving Grade 8A's teacher into 8C automatically moves 8C's teacher into 8A.
  const swaps = conflicts.map((occupant, i) => ({ occupant, intoClass: vacated[i] }));

  const now = new Date().toISOString();
  const logRef = doc(db, 'teacherTransfers', logId());

  await runTransaction(db, async (tx) => {
    // Reads first (Firestore transaction rule): re-fetch every doc we're about to touch.
    const oldRefs = active.map(a => doc(db, 'teacherAssignments', a.id));
    const oldSnaps = await Promise.all(oldRefs.map(r => tx.get(r)));
    const userRef = doc(db, 'users', teacherUid);
    await tx.get(userRef);

    const swapOldRefs = swaps.map(s => doc(db, 'teacherAssignments', s.occupant.id));
    const swapOldSnaps = await Promise.all(swapOldRefs.map(r => tx.get(r)));
    const swapUserRefs = swaps.map(s => doc(db, 'users', s.occupant.teacherUid));
    const swapUserSnaps = await Promise.all(swapUserRefs.map(r => tx.get(r)));

    // 1. End the transferring teacher's old assignments.
    oldSnaps.forEach((snap, i) => {
      if (snap.exists()) tx.update(oldRefs[i], { active: false, endedAt: now, endedReason: type });
    });

    // 2. Create the transferring teacher's new assignments.
    for (const c of toClasses) {
      const newId = assignmentId(fromSchoolId, teacherUid, c);
      const assignment: TeacherAssignment = {
        id: newId, schoolId: fromSchoolId, teacherUid, teacherName, classCode: c,
        assignedAt: now, assignedBy: performedBy, active: true,
      };
      tx.set(doc(db, 'teacherAssignments', newId), assignment);
    }
    tx.update(userRef, { assignedClasses: toClasses, classCode: toClasses[0], lastActiveClass: toClasses[0] });

    // 3. Swap each displaced occupant into the class the transferring teacher just vacated,
    //    so no class and no teacher is left orphaned.
    swaps.forEach((s, i) => {
      if (swapOldSnaps[i].exists()) {
        tx.update(swapOldRefs[i], { active: false, endedAt: now, endedReason: type });
      }
      const newId = assignmentId(fromSchoolId, s.occupant.teacherUid, s.intoClass);
      const assignment: TeacherAssignment = {
        id: newId, schoolId: fromSchoolId, teacherUid: s.occupant.teacherUid, teacherName: s.occupant.teacherName,
        classCode: s.intoClass, assignedAt: now, assignedBy: performedBy, active: true,
      };
      tx.set(doc(db, 'teacherAssignments', newId), assignment);

      const occupantProfile = swapUserSnaps[i].data() as UserProfile | undefined;
      const remaining = (occupantProfile?.assignedClasses || []).filter(c => c !== s.occupant.classCode);
      remaining.push(s.intoClass);
      tx.update(swapUserRefs[i], {
        assignedClasses: remaining, classCode: remaining[0], lastActiveClass: s.intoClass,
      });
    });

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
    swappedTeachers: swaps.map(s => ({ teacherUid: s.occupant.teacherUid, teacherName: s.occupant.teacherName, intoClass: s.intoClass })),
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
