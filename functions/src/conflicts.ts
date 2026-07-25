import { onCall, CallableRequest, HttpsError } from "firebase-functions/https";
import { onDocumentWritten } from "firebase-functions/firestore";
import * as admin from "firebase-admin";
import {
  StudentLite, ConflictType, classifyPair, conflictDocId, bucketBy,
  normaliseAdmissionForCompare, normalisePhoneForCompare,
} from "./dedupe";

const REGION = "africa-south1";

function db() {
  return admin.firestore();
}

interface ConflictDoc {
  id: string;
  schoolId: string;
  type: ConflictType;
  studentIds: string[];
  students: StudentLite[]; // denormalised snapshot, so the UI can render without extra reads
  reason: string;
  status: "open" | "dismissed" | "resolved";
  createdAt: string;
  updatedAt: string;
}

function toLite(id: string, data: FirebaseFirestore.DocumentData): StudentLite {
  return {
    id,
    name: data.name || "",
    admissionNo: data.admissionNo || "",
    classCode: data.classCode || "",
    parentName: data.parentName || "",
    parentPhone: data.parentPhone || "",
  };
}

/** Verifies the caller is an authenticated schoolAdmin of the given school — the only role
 * allowed to run a full conflict scan (mirrors the schoolAdmin check in firestore.rules). */
async function assertCallerIsSchoolAdmin(request: CallableRequest, schoolId: string): Promise<void> {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const profileSnap = await db().collection("users").doc(request.auth.uid).get();
  const profile = profileSnap.data();
  if (!profile || profile.role !== "schoolAdmin" || profile.schoolId !== schoolId) {
    throw new HttpsError("permission-denied", "Only this school's admin can run a conflict scan.");
  }
}

/** Upserts (or auto-resolves) one conflict doc for a classified pair, respecting any earlier
 * human decision — a conflict the admin already dismissed or resolved is never silently
 * recreated by a later scan or write, since the underlying rule (same pair + type) is stable. */
async function upsertConflict(
  schoolId: string, type: ConflictType, a: StudentLite, b: StudentLite, reason: string,
): Promise<void> {
  const id = conflictDocId(schoolId, type, a.id, b.id);
  const ref = db().collection("conflicts").doc(id);
  const existing = await ref.get();
  const now = new Date().toISOString();
  if (existing.exists && existing.data()?.status !== "open") return; // human already decided
  const record: ConflictDoc = {
    id, schoolId, type, studentIds: [a.id, b.id], students: [a, b], reason,
    status: "open", createdAt: existing.exists ? existing.data()!.createdAt : now, updatedAt: now,
  };
  await ref.set(record, { merge: false });
}

/** Marks any still-`open` conflict for this pair+type as auto-resolved when a rescan finds the
 * pair no longer classifies as a conflict (e.g. someone fixed the admission number). Leaves
 * `dismissed`/`resolved` history alone either way. */
async function autoResolveIfStale(schoolId: string, type: ConflictType, idA: string, idB: string): Promise<void> {
  const id = conflictDocId(schoolId, type, idA, idB);
  const ref = db().collection("conflicts").doc(id);
  const snap = await ref.get();
  if (snap.exists && snap.data()?.status === "open") {
    await ref.update({ status: "resolved", updatedAt: new Date().toISOString(), resolutionNote: "Auto-resolved: data no longer matches this conflict on rescan." });
  }
}

/**
 * Full-school conflict scan — callable, admin-only. Loads every active (non-archived) student
 * for the school, buckets by normalised admission no. and normalised parent phone (the only two
 * ways `classifyPair` can find a match), and classifies every pair within each bucket. Buckets
 * are normally tiny (a handful of siblings/duplicates at most), so this stays far cheaper than a
 * full O(n²) comparison across the whole roster.
 */
export const scanSchoolForConflicts = onCall(
  { region: REGION, timeoutSeconds: 120, memory: "256MiB", maxInstances: 5, cors: true },
  async (request: CallableRequest<{ schoolId: string }>) => {
    const { schoolId } = request.data || ({} as { schoolId: string });
    if (!schoolId) throw new HttpsError("invalid-argument", "schoolId is required.");
    await assertCallerIsSchoolAdmin(request, schoolId);

    const snap = await db().collection("students")
      .where("schoolId", "==", schoolId)
      .get();

    const students: StudentLite[] = snap.docs
      .filter(d => !d.data().archived)
      .map(d => toLite(d.id, d.data()));

    const admissionBuckets = bucketBy(students, s => normaliseAdmissionForCompare(s.admissionNo));
    const phoneBuckets = bucketBy(students, s => normalisePhoneForCompare(s.parentPhone));

    const seenPairs = new Set<string>(); // avoid classifying the same pair twice (e.g. same bucket via both keys)
    let flagged = 0;
    let checked = 0;

    for (const bucket of [...admissionBuckets, ...phoneBuckets]) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i], b = bucket[j];
          const pairKey = [a.id, b.id].sort().join("_");
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          checked++;
          const result = classifyPair(a, b);
          if (result) {
            await upsertConflict(schoolId, result.type, a, b, result.reason);
            flagged++;
          }
        }
      }
    }

    return { studentsScanned: students.length, pairsChecked: checked, conflictsFlagged: flagged };
  },
);

/**
 * Lightweight incremental check — fires on every create/update of a `students/{studentId}` doc.
 * Only queries for EXACT (already-normalised-at-write-time) matches on admission no. and parent
 * phone, rather than reading the whole school roster on every write — cheap enough to run on
 * every write, including mid-import. This catches the common case (copy-paste duplicate imports,
 * retyped admission numbers) immediately; case/spacing variants that don't exact-match in
 * Firestore are still caught by the periodic full `scanSchoolForConflicts` scan.
 */
export const onStudentWrittenCheckConflicts = onDocumentWritten(
  { document: "students/{studentId}", region: REGION, memory: "256MiB", maxInstances: 20 },
  async (event) => {
    const after = event.data?.after;
    if (!after || !after.exists) return; // deleted — nothing to check
    const data = after.data()!;
    if (data.archived) return;
    const studentId = event.params.studentId;
    const schoolId: string | undefined = data.schoolId;
    if (!schoolId) return;

    const self = toLite(studentId, data);
    const candidateDocs = new Map<string, FirebaseFirestore.DocumentData & { id: string }>();

    if (data.admissionNo) {
      const admSnap = await db().collection("students")
        .where("schoolId", "==", schoolId)
        .where("admissionNo", "==", data.admissionNo)
        .get();
      admSnap.docs.forEach(d => candidateDocs.set(d.id, { id: d.id, ...d.data() }));
    }
    if (data.parentPhone) {
      const phoneSnap = await db().collection("students")
        .where("schoolId", "==", schoolId)
        .where("parentPhone", "==", data.parentPhone)
        .get();
      phoneSnap.docs.forEach(d => candidateDocs.set(d.id, { id: d.id, ...d.data() }));
    }
    candidateDocs.delete(studentId);

    for (const [id, cData] of candidateDocs) {
      if (cData.archived) continue;
      const other = toLite(id, cData);
      const result = classifyPair(self, other);
      if (result) {
        await upsertConflict(schoolId, result.type, self, other, result.reason);
      } else {
        // These two shared an exact admission/phone value but classify as fine now (e.g. a
        // sibling pair, or data that's since been corrected) — clear any stale open flag.
        for (const type of ["duplicate_admission", "duplicate_student", "phone_conflict"] as ConflictType[]) {
          await autoResolveIfStale(schoolId, type, studentId, id);
        }
      }
    }
  },
);
