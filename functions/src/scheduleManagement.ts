import { onCall, CallableRequest, HttpsError } from "firebase-functions/https";
import * as admin from "firebase-admin";
import {
  ScheduledMessage, ScheduleAudienceType, ScheduleFrequency, ScheduleFundingSource,
  calcScheduleOccurrenceTokenCost, calcScheduleTotalTokenCost,
} from "./scheduleTypes";
import { isDateBlockedForSchool, todayEAT, BoardingType } from "./kenyanHolidays";
import { getHolidayRangesOverlapping } from "./holidayLookup";
import { countOccurrences, findNextValidDate, toNairobiIsoDateTime } from "./scheduleCalendar";
import { resolveRecipientCount } from "./audienceResolver";
import { sanitizeSmsText, containsLink } from "./smsSender";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// A rough, deliberately conservative allowance for the "Dear {parentName}, ... {school}: {phone}"
// wrapper that gets added around the raw body at actual send time (see messagingService.ts
// buildMessage on the frontend). Reserving slightly high here is safer than under-reserving —
// worst case a schedule finishes with a small unused balance, refunded on completion/stop.
const WRAPPER_PADDING_CHARS = 45;

interface UserDoc {
  role: "schoolAdmin" | "teacherAdmin";
  schoolId: string;
  assignedClasses?: string[];
  messageTokens: number;
}

interface SchoolDoc {
  adminUid: string;
}

async function requireCaller(uid: string): Promise<{ uid: string; profile: UserDoc }> {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "User profile not found.");
  return { uid, profile: snap.data() as UserDoc };
}

/** Authorization + scope rules for who may schedule what. Mirrors the product rules:
 * a schoolAdmin can schedule anything at their school; a teacherAdmin may only schedule
 * for parents in their own assigned class(es), never teachers_all/teachers_selected/holiday_notice. */
function assertAudienceAllowed(profile: UserDoc, audienceType: ScheduleAudienceType, classCode?: string) {
  if (profile.role === "schoolAdmin") return;

  const teacherOnlyAudiences: ScheduleAudienceType[] = ["parents_class", "parents_selected"];
  if (!teacherOnlyAudiences.includes(audienceType)) {
    throw new HttpsError("permission-denied", "Teachers can only schedule messages to their own class's parents.");
  }
  const assigned = profile.assignedClasses ?? [];
  if (assigned.length > 0 && classCode && !assigned.includes(classCode)) {
    throw new HttpsError("permission-denied", "You can only schedule messages for a class you teach.");
  }
}

async function resolveFundingSourceUid(
  profile: UserDoc,
  callerUid: string,
  schoolId: string,
  fundingSource: ScheduleFundingSource,
): Promise<string> {
  if (profile.role === "schoolAdmin") return callerUid;
  if (fundingSource === "own") return callerUid;
  // fundingSource === 'school' — draw from the school admin's balance instead.
  const schoolSnap = await db.collection("schools").doc(schoolId).get();
  if (!schoolSnap.exists) throw new HttpsError("failed-precondition", "School not found.");
  return (schoolSnap.data() as SchoolDoc).adminUid;
}

interface ScheduleCore {
  schoolId: string;
  audienceType: ScheduleAudienceType;
  classCode?: string;
  recipientUids?: string[];
  recipientStudentIds?: string[];
  messageBody: string;
  frequency: ScheduleFrequency;
  timeOfDay: string;
  startDate: string;
  endDate?: string;
  includeWeekends: boolean;
  linkedHolidayPeriodId?: string;
  holidayNoticeVariant?: "goodbye" | "welcomeBack";
}

/** Shared plan step: validates dates, resolves recipient count, computes occurrences,
 * cost, and the first nextRunAt. Used by both create and edit (edit re-plans the remaining
 * portion of an existing schedule). Does NOT touch Firestore token balances. */
async function planSchedule(core: ScheduleCore) {
  if (core.frequency !== "once" && !core.endDate) {
    throw new HttpsError("invalid-argument", "endDate is required for daily/weekly schedules.");
  }
  if (core.endDate && core.endDate < core.startDate) {
    throw new HttpsError("invalid-argument", "endDate cannot be before startDate.");
  }

  const cleanedBody = sanitizeSmsText(core.messageBody);
  if (!cleanedBody.trim()) {
    throw new HttpsError("invalid-argument", "Message is empty after removing unsupported characters.");
  }
  if (containsLink(cleanedBody)) {
    throw new HttpsError("invalid-argument", "Links are not allowed in scheduled messages.");
  }

  const schoolSnap = await db.collection("schools").doc(core.schoolId).get();
  if (!schoolSnap.exists) throw new HttpsError("failed-precondition", "School not found.");
  const boardingType = (schoolSnap.data() as any).boardingType as BoardingType | undefined;

  const rangeEnd = core.endDate ?? core.startDate;
  const holidayRanges = await getHolidayRangesOverlapping(db, core.schoolId, core.startDate, rangeEnd);
  const isBlocked = (dateStr: string) =>
    isDateBlockedForSchool(dateStr, boardingType, holidayRanges, core.includeWeekends).blocked;

  const occurrencesPlanned = countOccurrences(core.frequency, core.startDate, core.endDate, isBlocked);
  if (occurrencesPlanned === 0) {
    throw new HttpsError(
      "invalid-argument",
      "No valid send dates in this range — every date is a weekend/holiday. Adjust the dates or enable weekends.",
    );
  }

  const firstDate = findNextValidDate(core.frequency, core.startDate, isBlocked, core.endDate);
  if (!firstDate) {
    throw new HttpsError("invalid-argument", "Could not find a valid first send date in range.");
  }

  const recipientCount = await resolveRecipientCount(db, {
    schoolId: core.schoolId,
    audienceType: core.audienceType,
    classCode: core.classCode,
    recipientUids: core.recipientUids,
    recipientStudentIds: core.recipientStudentIds,
  });
  if (recipientCount === 0) {
    throw new HttpsError("invalid-argument", "No recipients with a phone number match this audience.");
  }

  const paddedBody = cleanedBody + " ".repeat(WRAPPER_PADDING_CHARS);
  const occurrenceCost = calcScheduleOccurrenceTokenCost(paddedBody, recipientCount);
  const totalCost = calcScheduleTotalTokenCost(occurrenceCost, occurrencesPlanned);
  const nextRunAt = toNairobiIsoDateTime(firstDate, core.timeOfDay);

  return { cleanedBody, occurrencesPlanned, occurrenceCost, totalCost, nextRunAt, recipientCount };
}

/** Reserves up to `totalCost` tokens from fundingSourceUid's balance in one transaction.
 * Reserves whatever is available if the balance falls short — the schedule is still
 * created/updated, just flagged insufficientTokens, per the product's "create anyway,
 * notify, and top up later" design. */
async function reserveTokens(fundingSourceUid: string, totalCost: number): Promise<number> {
  return db.runTransaction(async (tx) => {
    const ref = db.collection("users").doc(fundingSourceUid);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("failed-precondition", "Funding account not found.");
    const balance = (snap.data() as UserDoc).messageTokens || 0;
    const reserved = Math.min(balance, totalCost);
    tx.update(ref, { messageTokens: balance - reserved });
    return reserved;
  });
}

/** Refunds `amount` tokens back to a user's balance. Used on stop/cancel/delete and when
 * an edit shrinks a schedule's remaining cost. */
async function refundTokens(uid: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const ref = db.collection("users").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const balance = (snap.data() as UserDoc).messageTokens || 0;
    tx.update(ref, { messageTokens: balance + amount });
  });
}

// ─── createScheduledMessage ─────────────────────────────────────────────────

interface CreateScheduleRequest extends ScheduleCore {
  fundingSource: ScheduleFundingSource;
}

export const createScheduledMessage = onCall(
  { region: "africa-south1", memory: "256MiB", timeoutSeconds: 60 },
  async (request: CallableRequest<CreateScheduleRequest>) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const { uid, profile } = await requireCaller(request.auth.uid);
    const data = request.data;

    if (data.schoolId !== profile.schoolId) {
      throw new HttpsError("permission-denied", "Cannot schedule messages for another school.");
    }
    assertAudienceAllowed(profile, data.audienceType, data.classCode);

    const plan = await planSchedule(data);
    const fundingSourceUid = await resolveFundingSourceUid(profile, uid, data.schoolId, data.fundingSource);
    const tokensAllocated = await reserveTokens(fundingSourceUid, plan.totalCost);
    const insufficientTokens = tokensAllocated < plan.totalCost;

    const now = new Date().toISOString();
    const docRef = db.collection("scheduledMessages").doc();
    const doc: ScheduledMessage = {
      id: docRef.id,
      schoolId: data.schoolId,
      createdBy: uid,
      createdByRole: profile.role,
      audienceType: data.audienceType,
      recipientUids: data.recipientUids,
      recipientStudentIds: data.recipientStudentIds,
      classCode: data.classCode,
      messageBody: plan.cleanedBody,
      frequency: data.frequency,
      timeOfDay: data.timeOfDay,
      startDate: data.startDate,
      endDate: data.endDate,
      includeWeekends: data.includeWeekends,
      fundingSource: data.fundingSource,
      fundingSourceUid,
      tokensRequired: plan.totalCost,
      tokensAllocated,
      tokensUsed: 0,
      insufficientTokens,
      status: insufficientTokens ? "insufficientTokens" : "active",
      nextRunAt: insufficientTokens ? null : plan.nextRunAt,
      occurrencesPlanned: plan.occurrencesPlanned,
      occurrencesSent: 0,
      linkedHolidayPeriodId: data.linkedHolidayPeriodId,
      holidayNoticeVariant: data.holidayNoticeVariant,
      createdAt: now,
      updatedAt: now,
    };
    await docRef.set(doc);

    if (insufficientTokens) {
      // Notification SMS to the funding account is sent by insufficientTokensRecheck's
      // sibling path — kept simple here by letting the poller's first pass raise it, since
      // the schedule won't be picked up (status !== 'active') until tokens are topped up.
      console.warn(`Schedule ${docRef.id} created with insufficient tokens (${tokensAllocated}/${plan.totalCost}).`);
    }

    return { id: docRef.id, tokensRequired: plan.totalCost, tokensAllocated, insufficientTokens, occurrencesPlanned: plan.occurrencesPlanned, nextRunAt: doc.nextRunAt };
  },
);

// ─── editScheduledMessage ───────────────────────────────────────────────────
// Edits replan the schedule from "today" forward (occurrences already sent are untouched)
// and true up the token reservation: refund if the new plan costs less, draw more if it
// costs more (flagging insufficientTokens again if the balance can't cover the increase).

interface EditScheduleRequest extends ScheduleCore {
  id: string;
}

export const editScheduledMessage = onCall(
  { region: "africa-south1", memory: "256MiB", timeoutSeconds: 60 },
  async (request: CallableRequest<EditScheduleRequest>) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const { uid, profile } = await requireCaller(request.auth.uid);
    const data = request.data;

    const ref = db.collection("scheduledMessages").doc(data.id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Schedule not found.");
    const existing = snap.data() as ScheduledMessage;

    if (existing.status === "stopped" || existing.status === "completed") {
      throw new HttpsError("failed-precondition", "This schedule has ended — reschedule or delete it instead of editing.");
    }
    if (existing.createdBy !== uid && profile.role !== "schoolAdmin") {
      throw new HttpsError("permission-denied", "Not authorised to edit this schedule.");
    }
    assertAudienceAllowed(profile, data.audienceType, data.classCode);

    // Re-plan starting from today (occurrences that already fired stay counted separately).
    const replanStart = data.startDate > todayEAT() ? data.startDate : todayEAT();
    const plan = await planSchedule({ ...data, startDate: replanStart });

    // True up the reservation: refund the unused portion of the OLD plan, then reserve
    // fresh against the NEW total. Simpler and more auditable than trying to diff the two.
    const unusedOld = existing.tokensAllocated - existing.tokensUsed;
    await refundTokens(existing.fundingSourceUid, unusedOld);

    const fundingSourceUid = existing.fundingSourceUid; // funding source itself isn't editable here
    const tokensAllocated = await reserveTokens(fundingSourceUid, plan.totalCost);
    const insufficientTokens = tokensAllocated < plan.totalCost;

    const update: Partial<ScheduledMessage> = {
      audienceType: data.audienceType,
      recipientUids: data.recipientUids,
      recipientStudentIds: data.recipientStudentIds,
      classCode: data.classCode,
      messageBody: plan.cleanedBody,
      frequency: data.frequency,
      timeOfDay: data.timeOfDay,
      startDate: data.startDate,
      endDate: data.endDate,
      includeWeekends: data.includeWeekends,
      tokensRequired: plan.totalCost,
      tokensAllocated,
      tokensUsed: 0,
      insufficientTokens,
      status: insufficientTokens ? "insufficientTokens" : "active",
      nextRunAt: insufficientTokens ? null : plan.nextRunAt,
      occurrencesPlanned: plan.occurrencesPlanned,
      occurrencesSent: 0,
      updatedAt: new Date().toISOString(),
    };
    await ref.update(update as any);

    return { tokensRequired: plan.totalCost, tokensAllocated, insufficientTokens, occurrencesPlanned: plan.occurrencesPlanned, nextRunAt: update.nextRunAt };
  },
);

// ─── stopScheduledMessage ───────────────────────────────────────────────────

export const stopScheduledMessage = onCall(
  { region: "africa-south1", memory: "128MiB", timeoutSeconds: 30 },
  async (request: CallableRequest<{ id: string }>) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const { uid, profile } = await requireCaller(request.auth.uid);

    const ref = db.collection("scheduledMessages").doc(request.data.id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Schedule not found.");
    const existing = snap.data() as ScheduledMessage;

    if (existing.createdBy !== uid && profile.role !== "schoolAdmin") {
      throw new HttpsError("permission-denied", "Not authorised to stop this schedule.");
    }
    if (existing.status === "stopped" || existing.status === "completed") {
      return { alreadyEnded: true };
    }

    const refund = existing.tokensAllocated - existing.tokensUsed;
    await refundTokens(existing.fundingSourceUid, refund);
    await ref.update({
      status: "stopped",
      nextRunAt: null,
      tokensAllocated: existing.tokensUsed, // reservation now exactly matches what was spent
      updatedAt: new Date().toISOString(),
    });

    return { stopped: true, refunded: refund };
  },
);

// ─── deleteScheduledMessage ─────────────────────────────────────────────────
// Only terminal (stopped/completed) schedules can be deleted — an active one must be
// stopped first, so a refund is never skipped by deleting out from under it.

export const deleteScheduledMessage = onCall(
  { region: "africa-south1", memory: "128MiB", timeoutSeconds: 30 },
  async (request: CallableRequest<{ id: string }>) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const { uid, profile } = await requireCaller(request.auth.uid);

    const ref = db.collection("scheduledMessages").doc(request.data.id);
    const snap = await ref.get();
    if (!snap.exists) return { deleted: false };
    const existing = snap.data() as ScheduledMessage;

    if (existing.createdBy !== uid && profile.role !== "schoolAdmin") {
      throw new HttpsError("permission-denied", "Not authorised to delete this schedule.");
    }
    if (existing.status !== "stopped" && existing.status !== "completed") {
      throw new HttpsError("failed-precondition", "Stop the schedule before deleting it.");
    }
    await ref.delete();
    return { deleted: true };
  },
);

// ─── rescheduleCompletedMessage ─────────────────────────────────────────────
// Clones a completed schedule's config into a brand-new active one with new dates —
// a fresh plan/reservation, funded the same way the original was.

interface RescheduleRequest {
  id: string;
  startDate: string;
  endDate?: string;
  timeOfDay?: string;
}

export const rescheduleCompletedMessage = onCall(
  { region: "africa-south1", memory: "256MiB", timeoutSeconds: 60 },
  async (request: CallableRequest<RescheduleRequest>) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const { uid, profile } = await requireCaller(request.auth.uid);

    const ref = db.collection("scheduledMessages").doc(request.data.id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Schedule not found.");
    const existing = snap.data() as ScheduledMessage;

    if (existing.status !== "completed") {
      throw new HttpsError("failed-precondition", "Only a completed schedule can be rescheduled.");
    }
    if (existing.createdBy !== uid && profile.role !== "schoolAdmin") {
      throw new HttpsError("permission-denied", "Not authorised to reschedule this.");
    }

    const core: ScheduleCore = {
      schoolId: existing.schoolId,
      audienceType: existing.audienceType,
      classCode: existing.classCode,
      recipientUids: existing.recipientUids,
      recipientStudentIds: existing.recipientStudentIds,
      messageBody: existing.messageBody,
      frequency: existing.frequency,
      timeOfDay: request.data.timeOfDay ?? existing.timeOfDay,
      startDate: request.data.startDate,
      endDate: request.data.endDate,
      includeWeekends: existing.includeWeekends,
      linkedHolidayPeriodId: existing.linkedHolidayPeriodId,
      holidayNoticeVariant: existing.holidayNoticeVariant,
    };
    const plan = await planSchedule(core);
    const tokensAllocated = await reserveTokens(existing.fundingSourceUid, plan.totalCost);
    const insufficientTokens = tokensAllocated < plan.totalCost;

    const now = new Date().toISOString();
    const newRef = db.collection("scheduledMessages").doc();
    const newDoc: ScheduledMessage = {
      ...existing,
      id: newRef.id,
      startDate: core.startDate,
      endDate: core.endDate,
      timeOfDay: core.timeOfDay,
      tokensRequired: plan.totalCost,
      tokensAllocated,
      tokensUsed: 0,
      insufficientTokens,
      status: insufficientTokens ? "insufficientTokens" : "active",
      nextRunAt: insufficientTokens ? null : plan.nextRunAt,
      occurrencesPlanned: plan.occurrencesPlanned,
      occurrencesSent: 0,
      createdAt: now,
      updatedAt: now,
    };
    await newRef.set(newDoc);

    return { id: newRef.id, tokensRequired: plan.totalCost, tokensAllocated, insufficientTokens, nextRunAt: newDoc.nextRunAt };
  },
);

// ─── resetSchedulesForNewAcademicYear ───────────────────────────────────────
// Called once by promotionService.applyPromotion() right after a promotion completes.
// Class codes shift on promotion, so any schedule still targeting last year's classCode
// would silently misfire — safer to stop everything school-wide and let admins/teachers
// re-create what they still need against the new roster. Refunds unused tokens, same as
// an individual stop.

export const resetSchedulesForNewAcademicYear = onCall(
  { region: "africa-south1", memory: "256MiB", timeoutSeconds: 120 },
  async (request: CallableRequest<{ schoolId: string }>) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    const { profile } = await requireCaller(request.auth.uid);
    const { schoolId } = request.data;

    if (profile.role !== "schoolAdmin" || profile.schoolId !== schoolId) {
      throw new HttpsError("permission-denied", "Only this school's admin can reset scheduling.");
    }

    const snap = await db.collection("scheduledMessages")
      .where("schoolId", "==", schoolId)
      .where("status", "in", ["active", "insufficientTokens"])
      .get();

    let stopped = 0;
    for (const doc of snap.docs) {
      const schedule = doc.data() as ScheduledMessage;
      const refund = schedule.tokensAllocated - schedule.tokensUsed;
      await refundTokens(schedule.fundingSourceUid, refund);
      await doc.ref.update({
        status: "stopped",
        nextRunAt: null,
        tokensAllocated: schedule.tokensUsed,
        updatedAt: new Date().toISOString(),
      });
      stopped++;
    }

    return { stopped };
  },
);
