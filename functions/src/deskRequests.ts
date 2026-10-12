/**
 * Desk requests (customer side). A school admin raises a support request; it is written into THIS project's own
 * `desk_requests` collection as an OutboxSupportItem, and Samuhia Desk's 30-minute sweeper pulls it (desk reads here; this
 * code never calls desk). Desk writes `status: "pulled"`, `deskStatus` and `responses` back so the school sees progress.
 */
import { onCall, CallableRequest, HttpsError } from "firebase-functions/https";
import { OutboxSupportItem, RequestResponse, RequestStatus, OutboxStatus } from "./deskContract";
import { connectedAgentCodes, DeskInputError, parseRequestInput, REQUEST_LIMITS, resolveTargetDeskCodes } from "./deskAgents";
import { deskDb, DESK_COLLECTIONS, isAlreadyExists, requireSchoolAdmin, writeAudit } from "./deskStore";

const REGION = "africa-south1";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DeskRequestView {
  id: string; category: string; subject: string; message: string;
  status: OutboxStatus; deskStatus: RequestStatus | null; targetDeskCodes: string[];
  responses: RequestResponse[]; createdAt: number; pulledAt: number | null;
}

export function toRequestView(id: string, d: Partial<OutboxSupportItem>): DeskRequestView {
  return {
    id, category: d.category || "other", subject: d.subject || "", message: d.message || "",
    status: d.status || "new", deskStatus: d.deskStatus ?? null, targetDeskCodes: d.targetDeskCodes || [],
    responses: Array.isArray(d.responses) ? d.responses : [], createdAt: d.createdAt || 0, pulledAt: d.pulledAt ?? null,
  };
}

export const createDeskRequest = onCall(
  { region: REGION, memory: "256MiB", timeoutSeconds: 30, maxInstances: 10 },
  async (request: CallableRequest<Record<string, unknown>>): Promise<{ id: string; created: boolean; targetDeskCodes: string[] }> => {
    const caller = await requireSchoolAdmin(request.auth);
    let input;
    let targetDeskCodes: string[];
    try {
      input = parseRequestInput(request.data);
      targetDeskCodes = resolveTargetDeskCodes(connectedAgentCodes(caller.school.supportAgents), request.data?.targetDeskCodes);
    } catch (e) {
      if (e instanceof DeskInputError) throw new HttpsError("invalid-argument", e.message);
      throw e;
    }

    const id = `${caller.schoolId}_${input.clientToken}`;
    const ref = deskDb.collection(DESK_COLLECTIONS.requests).doc(id);

    // Daily cap per school. A count() aggregation bills 1 read per 1,000 index entries (the old code read every request the
    // school ever made). Needs the (entityCode, createdAt) composite index in firestore.indexes.json.
    const since = Date.now() - DAY_MS;
    const countSnap = await deskDb.collection(DESK_COLLECTIONS.requests)
      .where("entityCode", "==", caller.schoolId).where("createdAt", ">=", since).count().get();
    let recent = countSnap.data().count;
    if (recent >= REQUEST_LIMITS.perDay) {
      // A retry of a request that is already in the window must not count against itself (same rule as before).
      const self = await ref.get();
      if (self.exists && ((self.data() as { createdAt?: number }).createdAt || 0) >= since) recent -= 1;
    }
    if (recent >= REQUEST_LIMITS.perDay) {
      throw new HttpsError("resource-exhausted", `You've sent ${REQUEST_LIMITS.perDay} requests in the last 24 hours. Please wait for a reply before sending more.`);
    }

    const item: OutboxSupportItem = {
      kind: "support", status: "new", entityCode: caller.schoolId, entityName: caller.school.name,
      requesterName: caller.displayName, requesterPhone: caller.phone,
      category: input.category, subject: input.subject, message: input.message,
      targetDeskCodes, createdAt: Date.now(),
    };
    try {
      await ref.create(item as unknown as Record<string, unknown>);
    } catch (err) {
      if (isAlreadyExists(err)) return { id, created: false, targetDeskCodes }; // double-click / retry with the same token
      throw new HttpsError("internal", "We couldn't send your request. Please try again.");
    }
    await writeAudit({
      source: "customer", action: "desk_request_created", entityCode: caller.schoolId, actorUid: caller.uid,
      outcome: "ok", details: { requestId: id, category: input.category, targetDeskCodes },
    });
    return { id, created: true, targetDeskCodes };
  },
);

export const listDeskRequests = onCall(
  { region: REGION, memory: "256MiB", timeoutSeconds: 30, maxInstances: 10 },
  async (request: CallableRequest<Record<string, never>>): Promise<{ requests: DeskRequestView[] }> => {
    const caller = await requireSchoolAdmin(request.auth);
    // Newest 100 only (was: every request ever made, sorted in memory). Needs the (entityCode, createdAt desc) index.
    const snap = await deskDb.collection(DESK_COLLECTIONS.requests)
      .where("entityCode", "==", caller.schoolId).orderBy("createdAt", "desc").limit(100).get();
    const requests = snap.docs.map(d => toRequestView(d.id, d.data() as Partial<OutboxSupportItem>));
    return { requests };
  },
);
