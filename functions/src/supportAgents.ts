/**
 * Support Agents: the Samuhia Desk agents a school lets help it. Stored on the school document as
 * `supportAgents.<COG-####>` = { addedAt, addedBy }. COG-0000 (company top desk) is locked: always authorised on every
 * school, shown first, never removable. Only the school admin can change the list, and every change is audited.
 * Register cannot (and must not) look the code up in desk: validation is by format, and desk re-checks the agent on its side.
 */
import { onCall, CallableRequest, HttpsError } from "firebase-functions/https";
import * as admin from "firebase-admin";
import { DESK_TOP_CODE, SupportAgentView } from "./deskContract";
import { agentViews, connectedAgentCodes, DeskInputError, parseAgentCodeInput } from "./deskAgents";
import { deskDb, requireSchoolAdmin, writeAudit, SchoolRecord } from "./deskStore";

const REGION = "africa-south1";
export const MAX_SUPPORT_AGENTS = 10;

function asHttpsError(err: unknown): never {
  if (err instanceof DeskInputError) throw new HttpsError("invalid-argument", err.message);
  throw err;
}

const agentField = (code: string) => new admin.firestore.FieldPath("supportAgents", code);

export interface ListSupportAgentsResult { agents: Array<SupportAgentView & { locked: boolean }>; max: number }

export const addSupportAgent = onCall(
  { region: REGION, memory: "256MiB", timeoutSeconds: 30, maxInstances: 10 },
  async (request: CallableRequest<{ agentCode?: string }>): Promise<{ ok: true; alreadyConnected: boolean }> => {
    const caller = await requireSchoolAdmin(request.auth);
    let code: string;
    try { code = parseAgentCodeInput(request.data?.agentCode); } catch (e) { return asHttpsError(e); }
    if (code === DESK_TOP_CODE) return { ok: true, alreadyConnected: true }; // always connected

    const ref = deskDb.collection("schools").doc(caller.schoolId);
    const alreadyConnected = await deskDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("failed-precondition", "Your school record was not found.");
      const school = snap.data() as SchoolRecord;
      if (school.adminUid !== caller.uid) throw new HttpsError("permission-denied", "Only the school admin can manage support agents.");
      const connected = connectedAgentCodes(school.supportAgents);
      if (connected.includes(code)) return true;
      if (connected.length >= MAX_SUPPORT_AGENTS) {
        throw new HttpsError("failed-precondition", `You can connect up to ${MAX_SUPPORT_AGENTS} support agents. Remove one first.`);
      }
      tx.update(ref, agentField(code), { addedAt: Date.now(), addedBy: caller.uid });
      return false;
    });
    if (!alreadyConnected) {
      await writeAudit({ source: "customer", action: "support_agent_added", entityCode: caller.schoolId, agentCode: code, actorUid: caller.uid, outcome: "ok" });
    }
    return { ok: true, alreadyConnected };
  },
);

export const removeSupportAgent = onCall(
  { region: REGION, memory: "256MiB", timeoutSeconds: 30, maxInstances: 10 },
  async (request: CallableRequest<{ agentCode?: string }>): Promise<{ ok: true; wasConnected: boolean }> => {
    const caller = await requireSchoolAdmin(request.auth);
    let code: string;
    try { code = parseAgentCodeInput(request.data?.agentCode); } catch (e) { return asHttpsError(e); }
    if (code === DESK_TOP_CODE) {
      throw new HttpsError("failed-precondition", "Samuhia Support (COG-0000) is always connected and cannot be removed.");
    }
    const ref = deskDb.collection("schools").doc(caller.schoolId);
    const wasConnected = await deskDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("failed-precondition", "Your school record was not found.");
      const school = snap.data() as SchoolRecord;
      if (school.adminUid !== caller.uid) throw new HttpsError("permission-denied", "Only the school admin can manage support agents.");
      if (!connectedAgentCodes(school.supportAgents).includes(code)) return false;
      tx.update(ref, agentField(code), admin.firestore.FieldValue.delete());
      return true;
    });
    if (wasConnected) {
      await writeAudit({ source: "customer", action: "support_agent_removed", entityCode: caller.schoolId, agentCode: code, actorUid: caller.uid, outcome: "ok" });
    }
    return { ok: true, wasConnected };
  },
);

export const listSupportAgents = onCall(
  { region: REGION, memory: "256MiB", timeoutSeconds: 30, maxInstances: 10 },
  async (request: CallableRequest<Record<string, never>>): Promise<ListSupportAgentsResult> => {
    const caller = await requireSchoolAdmin(request.auth);
    return { agents: agentViews(caller.school.supportAgents), max: MAX_SUPPORT_AGENTS };
  },
);
