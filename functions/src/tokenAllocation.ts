import { onCall, CallableRequest, HttpsError } from "firebase-functions/https";
import * as admin from "firebase-admin";
import { TeacherTokenAllocation } from "./scheduleTypes";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface AllocateTokensRequest {
  schoolId: string;
  teacherUids: string[] | "all";
  /** Tokens given to EACH selected teacher — not a total split across them. */
  amountPerTeacher: number;
}

interface UserDoc {
  role: "schoolAdmin" | "teacherAdmin";
  schoolId: string;
  messageTokens: number;
  displayName: string;
}

/**
 * Moves `amountPerTeacher` tokens from the calling schoolAdmin's balance to each of the
 * selected teachers' balances, all in one transaction, plus one audit log doc per teacher.
 * Fails entirely (no partial allocation) if the admin's balance can't cover every teacher —
 * partial allocation would leave some teachers funded and others not for no visible reason.
 */
export const allocateTokensToTeachers = onCall(
  { region: "africa-south1", memory: "256MiB", timeoutSeconds: 60 },
  async (request: CallableRequest<AllocateTokensRequest>) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const adminUid = request.auth.uid;
    const { schoolId, teacherUids, amountPerTeacher } = request.data;

    if (!amountPerTeacher || amountPerTeacher <= 0) {
      throw new HttpsError("invalid-argument", "amountPerTeacher must be a positive number.");
    }

    const adminSnap = await db.collection("users").doc(adminUid).get();
    if (!adminSnap.exists) throw new HttpsError("failed-precondition", "Admin profile not found.");
    const adminProfile = adminSnap.data() as UserDoc;
    if (adminProfile.role !== "schoolAdmin" || adminProfile.schoolId !== schoolId) {
      throw new HttpsError("permission-denied", "Only this school's admin can allocate tokens.");
    }

    let resolvedTeacherUids: string[];
    if (teacherUids === "all") {
      const snap = await db.collection("users")
        .where("schoolId", "==", schoolId)
        .where("role", "==", "teacherAdmin")
        .get();
      resolvedTeacherUids = snap.docs.map(d => d.id);
    } else {
      resolvedTeacherUids = teacherUids;
    }
    if (resolvedTeacherUids.length === 0) {
      throw new HttpsError("invalid-argument", "No teachers to allocate to.");
    }

    const totalCost = amountPerTeacher * resolvedTeacherUids.length;

    const result = await db.runTransaction(async (tx) => {
      const adminRef = db.collection("users").doc(adminUid);
      const adminDoc = await tx.get(adminRef);
      const adminBalance = (adminDoc.data() as UserDoc).messageTokens || 0;
      if (adminBalance < totalCost) {
        throw new HttpsError(
          "failed-precondition",
          `Insufficient tokens. Need ${totalCost} (${amountPerTeacher} × ${resolvedTeacherUids.length} teachers), have ${adminBalance}.`,
        );
      }

      const teacherRefs = resolvedTeacherUids.map(uid => db.collection("users").doc(uid));
      const teacherDocs = await Promise.all(teacherRefs.map(r => tx.get(r)));

      const newAdminBalance = adminBalance - totalCost;
      tx.update(adminRef, { messageTokens: newAdminBalance });

      const now = new Date().toISOString();
      const allocations: { teacherUid: string; balanceAfter: number }[] = [];

      teacherDocs.forEach((tDoc, i) => {
        if (!tDoc.exists) return; // skip silently rather than fail the whole batch on a stale uid
        const teacherBalance = (tDoc.data() as UserDoc).messageTokens || 0;
        const teacherBalanceAfter = teacherBalance + amountPerTeacher;
        tx.update(teacherRefs[i], { messageTokens: teacherBalanceAfter });

        const logRef = db.collection("teacherTokenAllocations").doc();
        const log: TeacherTokenAllocation = {
          id: logRef.id,
          schoolId,
          teacherUid: resolvedTeacherUids[i],
          amount: amountPerTeacher,
          performedBy: adminUid,
          performedAt: now,
          teacherBalanceAfter,
          adminBalanceAfter: newAdminBalance,
        };
        tx.set(logRef, log);
        allocations.push({ teacherUid: resolvedTeacherUids[i], balanceAfter: teacherBalanceAfter });
      });

      return { newAdminBalance, allocations };
    });

    return {
      success: true,
      adminBalanceAfter: result.newAdminBalance,
      allocations: result.allocations,
    };
  },
);
