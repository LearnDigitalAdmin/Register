/**
 * Firestore helpers shared by the Samuhia Desk functions (support agents, desk requests, deskdelegate).
 * Collections written here live in THIS project's own database and are only ever read by desk through the Admin SDK:
 *   desk_requests          support requests customers raise (the outbox desk's sweeper pulls)
 *   desk_delegate_requests idempotency + outcome record for every mutating deskdelegate call
 *   desk_audit             one row per deskdelegate call and per customer change to their support agents
 * None of them has a Firestore rule, so clients cannot read or write them directly.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const deskDb = admin.firestore();
export const DESK_COLLECTIONS = {
  requests: "desk_requests",
  delegateRequests: "desk_delegate_requests",
  audit: "desk_audit",
} as const;

export interface SchoolRecord {
  id: string;
  name: string;
  phone?: string;
  adminUid: string;
  adminPhone?: string;
  boardingType?: "day" | "boarding";
  activeAcademicYearId?: string;
  supportAgents?: Record<string, { addedAt?: number; addedBy?: string; name?: string } | undefined>;
}

export interface AdminCaller { uid: string; displayName: string; phone: string; schoolId: string; school: SchoolRecord }

/** The signed-in caller must be the school admin of their own school; the school is derived from their profile, never from the request. */
export async function requireSchoolAdmin(auth: { uid: string } | undefined): Promise<AdminCaller> {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const userSnap = await deskDb.collection("users").doc(auth.uid).get();
  if (!userSnap.exists) throw new HttpsError("failed-precondition", "Your profile was not found.");
  const user = userSnap.data() as { role?: string; schoolId?: string; displayName?: string; phone?: string | null };
  if (user.role !== "schoolAdmin" || !user.schoolId) {
    throw new HttpsError("permission-denied", "Only the school admin can manage support agents and desk requests.");
  }
  const schoolSnap = await deskDb.collection("schools").doc(user.schoolId).get();
  if (!schoolSnap.exists) throw new HttpsError("failed-precondition", "Your school record was not found.");
  const school = { id: schoolSnap.id, ...(schoolSnap.data() as Omit<SchoolRecord, "id">) };
  if (school.adminUid !== auth.uid) throw new HttpsError("permission-denied", "Only the school admin can manage support agents and desk requests.");
  return { uid: auth.uid, displayName: user.displayName || "School admin", phone: user.phone || school.adminPhone || "", schoolId: user.schoolId, school };
}

export interface AuditRow {
  source: "customer" | "delegate";
  action: string;
  entityCode: string;
  agentCode?: string;
  actorUid?: string;
  requestId?: string;
  outcome: "ok" | "error";
  errorCode?: string;
  details?: Record<string, unknown>;
}

/** Appends an audit row. Awaited by callers so a missing row is never silent; failures are logged and returned. */
export async function writeAudit(row: AuditRow): Promise<boolean> {
  try {
    const clean: Record<string, unknown> = { ...row, at: Date.now() };
    for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k];
    await deskDb.collection(DESK_COLLECTIONS.audit).add(clean);
    return true;
  } catch (err) {
    console.error("desk audit write failed", row.action, row.entityCode, err);
    return false;
  }
}

/** Firestore gRPC ALREADY_EXISTS. */
export function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists";
}
