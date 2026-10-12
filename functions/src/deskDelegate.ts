/**
 * `deskdelegate` — the ONE private HTTPS function through which Samuhia Desk runs actions on a MyRegister school.
 *
 *  - Deployed with `invoker: "private"`: Cloud Run IAM only admits the desk runtime service account (one `roles/run.invoker`
 *    grant, see DEPLOYMENT.md). An unauthenticated call is refused by the platform with 403 before this code runs.
 *  - Direction of access is desk → Register only. Nothing here calls desk, holds a desk credential or knows a desk URL.
 *  - Every action re-checks that `agentCode` is connected to the school (COG-0000 always is) — defence in depth on top of desk's own checks.
 *  - Register's OWN rules are reused: student validation and documents (src/shared/importValidation), the scheduler's planning
 *    and token maths (planSchedule), SMS sanitising/sending (smsSender), per-part token cost, and the attendance report builders.
 *  - Mutating actions are idempotent per `requestId` (desk_delegate_requests) and every call writes an audit row (desk_audit).
 *  - Transport: domain outcomes are HTTP 200 with `{ ok:false, error }` because desk reads that body (it discards the body of a 401/403,
 *    which it treats as an IAM refusal). Only unexpected faults answer 500, and a non-POST answers 405.
 */
import { onRequest } from "firebase-functions/https";
import { HttpsError } from "firebase-functions/https";
import * as admin from "firebase-admin";
import {
  DelegateEntityInfo, DelegateFileResult, DelegateCommitResult, DelegateRequest, DelegateResponse, DelegateScheduleResult,
  DelegateSendResult, DelegateValidateResult, ImportErrorRecord,
} from "./deskContract";
import { isAgentAuthorised } from "./deskAgents";
import {
  audienceOptions, chunk, decideIdempotency, DelegateFault, DelegateLogDoc, FaultCode, importStudentId, LIMITS, parseAudience,
  parseDelegateRequest, parentBroadcastText, parseReportParams, parseSchedule, planImport, prepareBody, quoteSend, REPORT_TYPES,
  requestDocId, rowErrors, scheduleDocId, smsTier, STUDENT_EXPORT_HEADER, teacherText, validRecord,
} from "./deskDelegateCore";
import { deskDb, DESK_COLLECTIONS, isAlreadyExists, SchoolRecord, writeAudit } from "./deskStore";
import { publishCsv } from "./deskFiles";
import {
  containsLink, HP_SMS_APIKEY, HP_SMS_PASSWORD, HP_SMS_SENDERID, HP_SMS_USERID, normalizeSmsPhone, sanitizeSmsText, sendHostPinnacleSms,
} from "./smsSender";
import { planSchedule, stripUndefined } from "./scheduleManagement";
import type { ScheduledMessage } from "./scheduleTypes";
import { resolveRecipients } from "./audienceResolver";
import { todayEAT } from "./kenyanHolidays";
import { normalisePhone } from "./shared/phone";
import { buildStudentWrite, ExistingStudentLike, ImportFieldKey, validateRows } from "./shared/importValidation";
import type { ClassStructureLike } from "./shared/classResolver";
import {
  buildTermlyReport, buildWeeklySummary, isCurrentReportingWindow, RawAttendanceRecord, RawRegister, termlyCsvRows, weekBounds,
  weeklyCsvRows, ymdToDate,
} from "./shared/reportBuilders";

const REGION = "africa-south1";
const COMMIT_CHUNK = 200; // 2 documents per student -> 400 writes, under Firestore's 500 per batch

// ─── errors ────────────────────────────────────────────────────────────────

const HTTPS_TO_FAULT: Record<string, FaultCode> = {
  "invalid-argument": "invalid_argument", "failed-precondition": "failed_precondition", "permission-denied": "permission_denied",
  "not-found": "not_found", "resource-exhausted": "failed_precondition", "out-of-range": "invalid_argument",
};

function toFault(err: unknown): DelegateFault {
  if (err instanceof DelegateFault) return err;
  if (err instanceof HttpsError) {
    const code = HTTPS_TO_FAULT[err.code];
    if (code) return new DelegateFault(code, err.message);
  }
  console.error("deskdelegate unexpected error", err);
  return new DelegateFault("internal", "Something went wrong on the MyRegister side. Please try again.");
}

// ─── context ───────────────────────────────────────────────────────────────

interface Ctx {
  req: DelegateRequest;
  school: SchoolRecord;
  adminUid: string;
  adminName: string;
  adminPhone: string;
  balance: number;
  authorised: boolean;
}

const clean = (t: string): string => sanitizeSmsText(t);

async function loadContext(req: DelegateRequest): Promise<Ctx> {
  const schoolSnap = await deskDb.collection("schools").doc(req.entityCode).get();
  if (!schoolSnap.exists) throw new DelegateFault("not_found", `No MyRegister school has KNEC code ${req.entityCode}.`);
  const school = { id: schoolSnap.id, ...(schoolSnap.data() as Omit<SchoolRecord, "id">) };
  const userSnap = school.adminUid ? await deskDb.collection("users").doc(school.adminUid).get() : undefined;
  if (!userSnap || !userSnap.exists) throw new DelegateFault("failed_precondition", "This school has no active admin account.");
  const user = userSnap.data() as { displayName?: string; phone?: string | null; messageTokens?: number };
  return {
    req, school, adminUid: school.adminUid, adminName: user.displayName || "", adminPhone: school.adminPhone || user.phone || "",
    balance: user.messageTokens || 0, authorised: isAgentAuthorised(school.supportAgents, req.agentCode),
  };
}

function requireAuthorised(ctx: Ctx): void {
  if (!ctx.authorised) {
    throw new DelegateFault("permission_denied", `${ctx.req.agentCode} is not connected to ${ctx.school.name}. The school admin can add the agent under Settings → Support agents.`);
  }
}

async function loadClassStructure(schoolId: string): Promise<ClassStructureLike | null> {
  const snap = await deskDb.collection("classStructures").doc(schoolId).get();
  if (!snap.exists) return null;
  const d = snap.data() as Partial<ClassStructureLike>;
  if (!Array.isArray(d.classes)) return null;
  return {
    classes: d.classes, levels: Array.isArray(d.levels) ? d.levels : [], streamsEnabled: !!d.streamsEnabled,
    streamMode: d.streamMode || "none", uniformStreams: d.uniformStreams, perClassStreams: d.perClassStreams,
  };
}

// ─── idempotency journal ───────────────────────────────────────────────────

type Journal = { ref: FirebaseFirestore.DocumentReference; decision: ReturnType<typeof decideIdempotency>; doc?: Record<string, unknown> };

async function beginJournal(req: DelegateRequest): Promise<Journal> {
  const ref = deskDb.collection(DESK_COLLECTIONS.delegateRequests).doc(requestDocId(req.requestId));
  const decision = await deskDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as DelegateLogDoc) : undefined;
    const d = decideIdempotency(existing, { action: req.action, entityCode: req.entityCode, agentCode: req.agentCode }, Date.now());
    const now = Date.now();
    if (d.kind === "new") {
      tx.set(ref, { requestId: req.requestId, action: req.action, entityCode: req.entityCode, agentCode: req.agentCode, status: "processing", startedAt: now, updatedAt: now });
    } else if (d.kind === "resume") {
      tx.update(ref, { updatedAt: now });
    }
    return { d, data: snap.exists ? (snap.data() as Record<string, unknown>) : undefined };
  });
  if (decision.d.kind === "busy") throw new DelegateFault("failed_precondition", "This request is already being processed. Wait a minute and try again.");
  return { ref, decision: decision.d, doc: decision.data };
}

const patchJournal = (j: Journal, patch: Record<string, unknown>) => j.ref.update({ ...patch, updatedAt: Date.now() });
const finishJournal = (j: Journal, result: unknown) =>
  j.ref.update({ status: "done", result, updatedAt: Date.now(), phones: admin.firestore.FieldValue.delete(), text: admin.firestore.FieldValue.delete() });
/** A failure before any effect: remove the journal so the same requestId can be retried. */
const abandonJournal = (j: Journal) => j.ref.delete().catch(() => undefined);

// ─── actions ───────────────────────────────────────────────────────────────

async function entityInfo(ctx: Ctx): Promise<DelegateEntityInfo> {
  if (!ctx.authorised) {
    return { displayName: ctx.school.name, adminName: "", adminPhone: "", agentAuthorised: false, plan: "", creditsBalance: 0, audiences: [], reportTypes: [], exportKinds: [] };
  }
  const cs = await loadClassStructure(ctx.school.id);
  return {
    displayName: ctx.school.name, adminName: ctx.adminName, adminPhone: ctx.adminPhone, agentAuthorised: true,
    plan: "Pay-as-you-go message tokens", creditsBalance: ctx.balance,
    audiences: audienceOptions(cs?.classes || []), reportTypes: [...REPORT_TYPES], exportKinds: ["students"],
  };
}

interface ImportContext { cs: ClassStructureLike | null; existing: ExistingStudentLike[]; aliases: Partial<Record<ImportFieldKey, string[]>> }

async function loadImportContext(schoolId: string, ownIds: Set<string>): Promise<ImportContext> {
  const [cs, rosterSnap, mappingSnap] = await Promise.all([
    loadClassStructure(schoolId),
    deskDb.collection("students").where("schoolId", "==", schoolId).select("admissionNo", "name", "parentPhone").get(),
    deskDb.collection("importMappings").doc(schoolId).get(),
  ]);
  const existing = rosterSnap.docs.filter(d => !ownIds.has(d.id)).map(d => d.data() as ExistingStudentLike);
  const aliases = (mappingSnap.exists ? (mappingSnap.data() as { customFieldAliases?: Partial<Record<ImportFieldKey, string[]>> }).customFieldAliases : undefined) || {};
  return { cs, existing, aliases };
}

function runValidation(ctx: Ctx, payload: Record<string, unknown>, ic: ImportContext) {
  const plan = planImport(payload.rows, payload.targetClassCode, ic.aliases);
  if (plan.scope === "singleClass" && !(ic.cs?.classes || []).includes(plan.targetClassCode!)) {
    throw new DelegateFault("invalid_argument", `"${plan.targetClassCode}" is not a class at this school.`);
  }
  const rows = validateRows(plan.rows, {
    classStructure: ic.cs, existingStudents: ic.existing, activeAcademicYearId: ctx.school.activeAcademicYearId || null,
    scope: plan.scope, targetClassCode: plan.targetClassCode,
  });
  return rows;
}

async function validateRecords(ctx: Ctx): Promise<DelegateValidateResult> {
  requireAuthorised(ctx);
  const ic = await loadImportContext(ctx.school.id, new Set());
  const rows = runValidation(ctx, ctx.req.payload, ic);
  return { valid: rows.filter(r => r.isValid).map(validRecord), errors: rowErrors(rows) };
}

const MAX_REPORTED_ERRORS = 1000;
function capErrors(errors: ImportErrorRecord[]): ImportErrorRecord[] {
  if (errors.length <= MAX_REPORTED_ERRORS) return errors;
  return [...errors.slice(0, MAX_REPORTED_ERRORS), { row: 0, field: "row", reason: `${errors.length - MAX_REPORTED_ERRORS} more problems are not shown.` }];
}

async function commitRecords(ctx: Ctx): Promise<DelegateCommitResult> {
  requireAuthorised(ctx);
  const source = ctx.req.payload.source;
  if (source !== "excel" && source !== "manual") throw new DelegateFault("invalid_argument", 'source must be "excel" or "manual".');
  const yearId = ctx.school.activeAcademicYearId;
  if (!yearId) throw new DelegateFault("failed_precondition", "This school has no active academic year. The school admin must set one up in MyRegister first.");

  const journal = await beginJournal(ctx.req);
  if (journal.decision.kind === "replay") return journal.decision.result as DelegateCommitResult;
  try {
    const total = Array.isArray(ctx.req.payload.rows) ? ctx.req.payload.rows.length : 0;
    // Students already written by an earlier (interrupted) attempt of THIS request must not look like duplicates now.
    const own = new Set<string>();
    for (let i = 1; i <= total; i++) own.add(importStudentId(ctx.req.requestId, i));
    const ic = await loadImportContext(ctx.school.id, own);
    const rows = runValidation(ctx, ctx.req.payload, ic);
    const errors = rowErrors(rows);
    const writable = rows.filter(r => r.isValid);

    let created = 0;
    const writeFailures: ImportErrorRecord[] = [];
    const commitChunkRows = async (part: typeof writable): Promise<void> => {
      try {
        const batch = deskDb.batch();
        const now = new Date().toISOString();
        for (const row of part) {
          const id = importStudentId(ctx.req.requestId, row.rowIndex);
          const w = buildStudentWrite(row, { schoolId: ctx.school.id, academicYearId: yearId, studentId: id, now });
          batch.create(deskDb.collection("students").doc(id), w.student);
          batch.create(deskDb.collection("enrolments").doc(w.enrolmentId), w.enrolment);
        }
        await batch.commit();
        created += part.length;
      } catch (err) {
        if (part.length > 1) {
          const mid = Math.ceil(part.length / 2);
          await commitChunkRows(part.slice(0, mid));
          await commitChunkRows(part.slice(mid));
        } else if (isAlreadyExists(err)) {
          created += 1; // written by an earlier attempt of this same request
        } else {
          console.error("deskdelegate import row failed", part[0].rowIndex, err);
          writeFailures.push({ row: part[0].rowIndex, field: "row", reason: "This student could not be saved. Try again." });
        }
      }
    };
    for (const part of chunk(writable, COMMIT_CHUNK)) await commitChunkRows(part);

    const result: DelegateCommitResult = {
      created, skipped: rows.length - created, errors: capErrors([...errors, ...writeFailures]),
    };
    await finishJournal(journal, result);
    return result;
  } catch (err) {
    if (journal.decision.kind === "new") await abandonJournal(journal);
    throw err;
  }
}

/** Ids in `ids` that are NOT documents of `collection` belonging to `schoolId`. */
async function foreignIds(collection: "students" | "users", schoolId: string, ids: string[]): Promise<string[]> {
  const snaps = await deskDb.getAll(...ids.map(id => deskDb.collection(collection).doc(id)));
  return snaps.filter(s => !s.exists || (s.data() as { schoolId?: string }).schoolId !== schoolId).map(s => s.id);
}

async function resolveAudiencePhones(ctx: Ctx, aud: ReturnType<typeof parseAudience>): Promise<string[]> {
  if (aud.recipientStudentIds) {
    const bad = await foreignIds("students", ctx.school.id, aud.recipientStudentIds);
    if (bad.length) throw new DelegateFault("invalid_argument", `${bad.length} selected student(s) do not belong to this school.`);
  }
  if (aud.recipientUids) {
    const bad = await foreignIds("users", ctx.school.id, aud.recipientUids);
    if (bad.length) throw new DelegateFault("invalid_argument", `${bad.length} selected teacher(s) do not belong to this school.`);
  }
  const recipients = await resolveRecipients(deskDb, {
    schoolId: ctx.school.id, audienceType: aud.audienceType, classCode: aud.classCode,
    recipientUids: aud.recipientUids, recipientStudentIds: aud.recipientStudentIds,
  });
  const phones = new Set<string>();
  for (const r of recipients) {
    if (normalisePhone(r.phone)) phones.add(normalizeSmsPhone(r.phone));
  }
  return Array.from(phones);
}

async function sendSmsNow(ctx: Ctx): Promise<DelegateSendResult> {
  requireAuthorised(ctx);
  const p = ctx.req.payload;
  const cs = await loadClassStructure(ctx.school.id);
  const aud = parseAudience(p.audience, p.memberIds, cs?.classes || []);
  const body = prepareBody(p.message, clean, containsLink);
  const text = aud.teachers ? teacherText(body) : parentBroadcastText(body, ctx.school.name, ctx.school.phone || ctx.adminPhone, clean);
  if (text.length > LIMITS.messageChars) {
    throw new DelegateFault("invalid_argument", `The message is ${text.length} characters including the greeting and school footer; the limit is ${LIMITS.messageChars}.`);
  }
  if (p.dryRun !== undefined && typeof p.dryRun !== "boolean") throw new DelegateFault("invalid_argument", "dryRun must be true or false.");

  const phones = await resolveAudiencePhones(ctx, aud);
  if (phones.length === 0) throw new DelegateFault("failed_precondition", "No recipients with a valid phone number match this audience.");
  if (phones.length > LIMITS.sendRecipients) throw new DelegateFault("invalid_argument", `This audience has ${phones.length} recipients; the limit per send is ${LIMITS.sendRecipients}.`);
  const quote = quoteSend(text, phones.length);
  if (p.dryRun === true) return { queued: phones.length, creditsUsed: quote.tokens, creditsRemaining: ctx.balance };

  const journal = await beginJournal(ctx.req);
  if (journal.decision.kind === "replay") return journal.decision.result as DelegateSendResult;
  const userRef = deskDb.collection("users").doc(ctx.adminUid);

  let sendPhones = phones;
  let sendText = text;
  let reserved = quote.tokens;
  let segments = quote.segments;
  let sentChunks: number[] = [];
  if (journal.decision.kind === "resume") {
    const d = journal.doc || {};
    if (Array.isArray(d.phones) && typeof d.text === "string" && typeof d.reserved === "number") {
      sendPhones = d.phones as string[]; sendText = d.text; reserved = d.reserved; segments = Number(d.segments) || segments;
      sentChunks = Array.isArray(d.sentChunks) ? (d.sentChunks as number[]) : [];
    } else {
      await abandonJournal(journal); // died before reserving anything: start clean
      throw new DelegateFault("failed_precondition", "The previous attempt did not start. Please send again.");
    }
  } else {
    try {
      await deskDb.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const balance = ((snap.data() as { messageTokens?: number } | undefined)?.messageTokens) || 0;
        if (balance < reserved) {
          throw new DelegateFault("failed_precondition", `Not enough tokens: this send needs ${reserved} and ${ctx.school.name} has ${balance}. Ask the school admin to top up.`);
        }
        tx.update(userRef, { messageTokens: balance - reserved });
      });
    } catch (err) {
      await abandonJournal(journal);
      throw err;
    }
    await patchJournal(journal, { phones: sendPhones, text: sendText, reserved, segments, sentChunks: [], settled: false });
  }

  const groups = chunk(sendPhones, LIMITS.smsChunk);
  let lastError = "";
  for (let i = 0; i < groups.length; i++) {
    if (sentChunks.includes(i)) continue;
    const r = await sendHostPinnacleSms({ mobile: groups[i].join(","), message: sendText });
    if (r.success) {
      sentChunks.push(i);
      await patchJournal(journal, { sentChunks });
    } else {
      lastError = r.error || "provider error";
      console.error("deskdelegate sms chunk failed", i, lastError);
    }
  }
  const sentCount = sentChunks.reduce((n, i) => n + groups[i].length, 0);
  const charged = segments * sentCount;

  // Settle exactly once: refund what was reserved but not used.
  const balanceAfter = await deskDb.runTransaction(async (tx) => {
    const [uSnap, jSnap] = await Promise.all([tx.get(userRef), tx.get(journal.ref)]);
    const balance = ((uSnap.data() as { messageTokens?: number } | undefined)?.messageTokens) || 0;
    if ((jSnap.data() as { settled?: boolean } | undefined)?.settled) return balance;
    const refund = reserved - charged;
    tx.update(userRef, { messageTokens: balance + refund });
    tx.update(journal.ref, { settled: true, charged, updatedAt: Date.now() });
    return balance + refund;
  });

  if (sentCount === 0) {
    await abandonJournal(journal);
    throw new DelegateFault("failed_precondition", "The SMS provider did not accept the message. No tokens were charged. Please try again shortly.");
  }

  const tier = smsTier(sentCount);
  await deskDb.collection("messages").doc(`dsk_${journal.ref.id}`).set({
    schoolId: ctx.school.id, sentBy: `Samuhia Desk ${ctx.req.agentCode}`, type: "custom", channel: "sms",
    recipients: aud.classCode || aud.audienceType, recipientCount: sentCount, rawContent: body, content: sendText,
    smsSegments: segments, smsTier: tier.tier, costPerSegment: tier.kesPerToken, tokensUsed: charged,
    sentAt: new Date().toISOString(), delivered: sentCount, total: sendPhones.length,
    status: sentCount === sendPhones.length ? "sent" : "partial",
  });
  const result: DelegateSendResult = { queued: sentCount, creditsUsed: charged, creditsRemaining: balanceAfter };
  await finishJournal(journal, result);
  return result;
}

async function scheduleSms(ctx: Ctx): Promise<DelegateScheduleResult> {
  requireAuthorised(ctx);
  const p = ctx.req.payload;
  const cs = await loadClassStructure(ctx.school.id);
  const aud = parseAudience(p.audience, p.memberIds, cs?.classes || []);
  const sched = parseSchedule(p, clean, containsLink, Date.now());
  if (aud.recipientStudentIds) {
    const bad = await foreignIds("students", ctx.school.id, aud.recipientStudentIds);
    if (bad.length) throw new DelegateFault("invalid_argument", `${bad.length} selected student(s) do not belong to this school.`);
  }
  if (aud.recipientUids) {
    const bad = await foreignIds("users", ctx.school.id, aud.recipientUids);
    if (bad.length) throw new DelegateFault("invalid_argument", `${bad.length} selected teacher(s) do not belong to this school.`);
  }

  const journal = await beginJournal(ctx.req);
  if (journal.decision.kind === "replay") return journal.decision.result as DelegateScheduleResult;
  try {
    // Register's own planner: holiday/weekend rules, occurrence count, per-run cost (with its 1.2 multiplier) and first run time.
    const plan = await planSchedule({
      schoolId: ctx.school.id, audienceType: aud.audienceType, classCode: aud.classCode,
      recipientUids: aud.recipientUids, recipientStudentIds: aud.recipientStudentIds, messageBody: sched.body,
      frequency: sched.frequency, timeOfDay: sched.timeOfDay, startDate: sched.startDate, endDate: sched.endDate, includeWeekends: false,
    });
    const id = scheduleDocId(ctx.req.requestId);
    const ref = deskDb.collection("scheduledMessages").doc(id);
    const userRef = deskDb.collection("users").doc(ctx.adminUid);
    const now = new Date().toISOString();
    await deskDb.runTransaction(async (tx) => {
      const [existing, uSnap] = await Promise.all([tx.get(ref), tx.get(userRef)]);
      if (existing.exists) return; // an earlier attempt of this request already reserved tokens and created it
      const balance = ((uSnap.data() as { messageTokens?: number } | undefined)?.messageTokens) || 0;
      if (balance < plan.totalCost) {
        throw new DelegateFault("failed_precondition", `Not enough tokens to reserve this schedule: it needs ${plan.totalCost} (${plan.occurrencesPlanned} run(s) of ${plan.occurrenceCost}) and ${ctx.school.name} has ${balance}.`);
      }
      tx.update(userRef, { messageTokens: balance - plan.totalCost });
      const doc: ScheduledMessage = {
        id, schoolId: ctx.school.id, createdBy: ctx.adminUid, createdByRole: "schoolAdmin", audienceType: aud.audienceType,
        recipientUids: aud.recipientUids, recipientStudentIds: aud.recipientStudentIds, classCode: aud.classCode,
        messageBody: plan.cleanedBody, frequency: sched.frequency, timeOfDay: sched.timeOfDay, startDate: sched.startDate, endDate: sched.endDate,
        includeWeekends: false, fundingSource: "own", fundingSourceUid: ctx.adminUid,
        tokensRequired: plan.totalCost, tokensAllocated: plan.totalCost, tokensUsed: 0, insufficientTokens: false,
        status: "active", nextRunAt: plan.nextRunAt, occurrencesPlanned: plan.occurrencesPlanned, occurrencesSent: 0,
        createdVia: "desk", deskAgentCode: ctx.req.agentCode, deskRequestId: ctx.req.requestId, label: sched.label,
        createdAt: now, updatedAt: now,
      };
      tx.create(ref, stripUndefined(doc as unknown as Record<string, unknown>));
    });
    const result: DelegateScheduleResult = { scheduleId: id, recipients: plan.recipientCount, creditsPerRun: plan.occurrenceCost };
    await finishJournal(journal, result);
    return result;
  } catch (err) {
    if (journal.decision.kind === "new") await abandonJournal(journal);
    throw err;
  }
}

async function exportData(ctx: Ctx): Promise<DelegateFileResult> {
  requireAuthorised(ctx);
  if (ctx.req.payload.kind !== "students") throw new DelegateFault("invalid_argument", 'MyRegister can export "students".');
  const snap = await deskDb.collection("students").where("schoolId", "==", ctx.school.id).get();
  const students = snap.docs
    .map(d => d.data() as { admissionNo?: string; name?: string; classCode?: string; parentName?: string; parentPhone?: string; parentWhatsApp?: string; nationalId?: string; archived?: boolean })
    .filter(s => !s.archived)
    .sort((a, b) => (a.classCode || "").localeCompare(b.classCode || "") || (a.name || "").localeCompare(b.name || ""));
  const rows = [STUDENT_EXPORT_HEADER, ...students.map(s => [s.admissionNo || "", s.name || "", s.classCode || "", s.parentName || "", s.parentPhone || "", s.parentWhatsApp || "", s.nationalId || ""])];
  return publishCsv(ctx.school.id, `${ctx.school.name}_students`, rows);
}

async function runReport(ctx: Ctx): Promise<DelegateFileResult> {
  requireAuthorised(ctx);
  const cs = await loadClassStructure(ctx.school.id);
  const today = todayEAT();
  const params = parseReportParams(ctx.req.payload.reportType, ctx.req.payload.params, today, cs?.classes || []);
  const knownClassCodes = cs && cs.classes.length > 0 ? new Set(cs.classes) : null;
  const generatedAt = new Date().toISOString();
  const academicYearId = ctx.school.activeAcademicYearId;

  const range = (col: string, from: string, to: string, classCode?: string) => {
    let q: FirebaseFirestore.Query = deskDb.collection(col).where("schoolId", "==", ctx.school.id);
    if (classCode) q = q.where("classCode", "==", classCode);
    return q.where("date", ">=", from).where("date", "<=", to).get();
  };

  if (params.type === "weekly_summary") {
    const referenceDate = ymdToDate(params.date);
    const { start, end } = weekBounds(referenceDate);
    const regSnap = await range("registers", start, end, params.classCode);
    const report = buildWeeklySummary({
      schoolId: ctx.school.id, schoolName: ctx.school.name, referenceDate, academicYearId, classCodeFilter: params.classCode,
      registers: regSnap.docs.map(d => d.data() as RawRegister), knownClassCodes, generatedAt,
    });
    return publishCsv(ctx.school.id, `${ctx.school.name}_weekly_${report.weekStart}`, weeklyCsvRows(report));
  }

  const [attSnap, regSnap] = await Promise.all([
    range("attendance", params.startDate, params.endDate, params.classCode),
    range("registers", params.startDate, params.endDate, params.classCode),
  ]);
  let roster: Array<{ id: string; name: string; admissionNo: string; classCode: string }> = [];
  if (isCurrentReportingWindow(params.endDate, today)) {
    const rSnap = await deskDb.collection("students").where("schoolId", "==", ctx.school.id).get();
    roster = rSnap.docs
      .map(d => ({ id: d.id, ...(d.data() as { name: string; admissionNo: string; classCode: string; archived?: boolean }) }))
      .filter(s => !s.archived);
  }
  const report = buildTermlyReport({
    schoolId: ctx.school.id, schoolName: ctx.school.name, startDate: params.startDate, endDate: params.endDate, termLabel: params.termLabel,
    absenteeThreshold: params.absenteeThreshold, academicYearId, classCodeFilter: params.classCode,
    attendance: attSnap.docs.map(d => d.data() as RawAttendanceRecord), registers: regSnap.docs.map(d => d.data() as RawRegister),
    knownClassCodes, roster, generatedAt,
  });
  return publishCsv(ctx.school.id, `${ctx.school.name}_${params.termLabel}_attendance`, termlyCsvRows(report));
}

// ─── dispatcher ────────────────────────────────────────────────────────────

/** Counts only: audit rows never contain student or parent personal data. */
function auditDetails(action: string, payload: Record<string, unknown>, result: unknown): Record<string, unknown> {
  const r = (result || {}) as Record<string, unknown>;
  switch (action) {
    case "validate_records": return { rows: Array.isArray(payload.rows) ? payload.rows.length : 0, valid: (r.valid as unknown[] | undefined)?.length, errors: (r.errors as unknown[] | undefined)?.length };
    case "commit_records": return { rows: Array.isArray(payload.rows) ? payload.rows.length : 0, source: payload.source, created: r.created, skipped: r.skipped };
    case "send_sms_now": return { audience: payload.audience, dryRun: payload.dryRun === true, queued: r.queued, creditsUsed: r.creditsUsed };
    case "schedule_sms": return { audience: payload.audience, recipients: r.recipients, creditsPerRun: r.creditsPerRun, scheduleId: r.scheduleId };
    case "export_data": return { kind: payload.kind };
    case "run_report": return { reportType: payload.reportType };
    default: return {};
  }
}

export async function runDelegateAction(req: DelegateRequest): Promise<DelegateResponse<unknown>> {
  let ctx: Ctx | undefined;
  try {
    ctx = await loadContext(req);
    let result: unknown;
    switch (req.action) {
      case "entity_info": result = await entityInfo(ctx); break;
      case "validate_records": result = await validateRecords(ctx); break;
      case "commit_records": result = await commitRecords(ctx); break;
      case "schedule_sms": result = await scheduleSms(ctx); break;
      case "send_sms_now": result = await sendSmsNow(ctx); break;
      case "export_data": result = await exportData(ctx); break;
      case "run_report": result = await runReport(ctx); break;
    }
    await writeAudit({
      source: "delegate", action: req.action, entityCode: req.entityCode, agentCode: req.agentCode, requestId: req.requestId,
      outcome: "ok", details: { ...auditDetails(req.action, req.payload, result), agentAuthorised: ctx.authorised },
    });
    return { ok: true, result };
  } catch (err) {
    const fault = toFault(err);
    await writeAudit({
      source: "delegate", action: req.action, entityCode: req.entityCode, agentCode: req.agentCode, requestId: req.requestId,
      outcome: "error", errorCode: fault.code, details: { message: fault.message },
    });
    return { ok: false, error: { code: fault.code, message: fault.message } };
  }
}

export const deskdelegate = onRequest(
  {
    region: REGION, invoker: "private", cors: false, memory: "512MiB", timeoutSeconds: 540, maxInstances: 3,
    secrets: [HP_SMS_USERID, HP_SMS_PASSWORD, HP_SMS_APIKEY, HP_SMS_SENDERID],
  },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.status(405).set("Allow", "POST").json({ ok: false, error: { code: "invalid_argument", message: "Use POST." } });
      return;
    }
    let parsed: DelegateRequest;
    try {
      parsed = parseDelegateRequest(req.body);
    } catch (err) {
      const f = toFault(err);
      res.status(200).json({ ok: false, error: { code: f.code, message: f.message } });
      return;
    }
    const out = await runDelegateAction(parsed);
    res.status(!out.ok && out.error.code === "internal" ? 500 : 200).json(out);
  },
);
