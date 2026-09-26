import { onSchedule } from "firebase-functions/scheduler";
import * as admin from "firebase-admin";
import { ScheduledMessage, calcScheduleOccurrenceTokenCost } from "./scheduleTypes";
import { isDateBlockedForSchool, BoardingType } from "./kenyanHolidays";
import { getHolidayRangesForDate } from "./holidayLookup";
import { findNextOccurrenceAfter } from "./scheduleCalendar";
import { resolveRecipients, ResolvedRecipient } from "./audienceResolver";
import { sendHostPinnacleSms, normalizeSmsPhone, sanitizeSmsText, HP_SMS_USERID, HP_SMS_PASSWORD, HP_SMS_APIKEY, HP_SMS_SENDERID } from "./smsSender";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const WRAPPER_PADDING_CHARS = 45;
const SEND_BATCH_SIZE = 5;

interface SchoolDoc {
  name: string;
  phone?: string;
  boardingType?: BoardingType;
}

interface UserDoc {
  phone?: string | null;
  displayName?: string;
}

function buildParentMessage(parentName: string, body: string, schoolName: string, schoolPhone: string): string {
  // Mirrors src/services/messagingService.ts buildMessage exactly, so segment counts here
  // match what was estimated at schedule-creation time.
  return `Dear ${parentName || "Parent"},\n${body}\n${schoolName}: ${schoolPhone || ""}`;
}

function isTeacherAudience(audienceType: ScheduledMessage["audienceType"]): boolean {
  return audienceType === "teachers_all" || audienceType === "teachers_selected";
}

/** Refunds any tokens reserved but never spent when a schedule reaches a terminal state. */
async function refundRemaining(fundingSourceUid: string, remaining: number): Promise<void> {
  if (remaining <= 0) return;
  const ref = db.collection("users").doc(fundingSourceUid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const balance = (snap.data() as UserDoc & { messageTokens?: number }).messageTokens || 0;
    tx.update(ref, { messageTokens: balance + remaining });
  });
}

async function notifyInsufficientTokens(fundingSourceUid: string, schedule: ScheduledMessage): Promise<void> {
  const userSnap = await db.collection("users").doc(fundingSourceUid).get();
  const phone = (userSnap.data() as UserDoc | undefined)?.phone;
  if (!phone) return;
  await sendHostPinnacleSms({
    mobile: normalizeSmsPhone(phone),
    message: `MyRegister: a scheduled message could not be sent — insufficient tokens. Top up to resume it.`,
  });
}

async function processSchedule(doc: FirebaseFirestore.QueryDocumentSnapshot): Promise<void> {
  const schedule = doc.data() as ScheduledMessage;
  const nowIso = new Date().toISOString();
  const dueDate = (schedule.nextRunAt as string).slice(0, 10);

  const schoolSnap = await db.collection("schools").doc(schedule.schoolId).get();
  if (!schoolSnap.exists) {
    await doc.ref.update({ status: "stopped", nextRunAt: null, updatedAt: nowIso });
    return;
  }
  const school = schoolSnap.data() as SchoolDoc;

  const customHolidays = await getHolidayRangesForDate(db, schedule.schoolId, dueDate);
  const isBlocked = (dateStr: string) =>
    isDateBlockedForSchool(dateStr, school.boardingType, customHolidays, schedule.includeWeekends).blocked;

  // A holiday added AFTER this schedule was planned can make an already-due date invalid —
  // in that case skip today and advance exactly as if today's occurrence had fired, using
  // the schedule's own cadence (so a weekly schedule still lands on the right weekday).
  if (isBlocked(dueDate)) {
    const next = findNextOccurrenceAfter(schedule.frequency, dueDate, isBlocked, schedule.endDate);
    if (!next) {
      await finaliseSchedule(doc.ref, schedule, "completed");
    } else {
      await doc.ref.update({ nextRunAt: nextRunIso(next, schedule.timeOfDay), updatedAt: nowIso });
    }
    return;
  }

  const recipients = await resolveRecipients(db, {
    schoolId: schedule.schoolId,
    audienceType: schedule.audienceType,
    classCode: schedule.classCode,
    recipientUids: schedule.recipientUids,
    recipientStudentIds: schedule.recipientStudentIds,
  });
  if (recipients.length === 0) {
    // Nothing to send this round (e.g. a class was emptied) — still advance the cadence
    // rather than spinning on it forever.
    await advanceOrComplete(doc.ref, schedule, dueDate, isBlocked, 0);
    return;
  }

  const cleanedBody = sanitizeSmsText(schedule.messageBody);
  const paddedBody = cleanedBody + " ".repeat(WRAPPER_PADDING_CHARS);
  const occurrenceCost = calcScheduleOccurrenceTokenCost(paddedBody, recipients.length);
  const availableNow = schedule.tokensAllocated - schedule.tokensUsed;

  if (availableNow < occurrenceCost) {
    await doc.ref.update({
      status: "insufficientTokens",
      insufficientTokens: true,
      nextRunAt: null,
      updatedAt: nowIso,
    });
    await notifyInsufficientTokens(schedule.fundingSourceUid, schedule);
    return;
  }

  await sendToRecipients(schedule, recipients, cleanedBody, school);

  await logScheduleSend(schedule, recipients.length, occurrenceCost, cleanedBody);

  await advanceOrComplete(doc.ref, schedule, dueDate, isBlocked, occurrenceCost);
}

async function sendToRecipients(
  schedule: ScheduledMessage,
  recipients: ResolvedRecipient[],
  cleanedBody: string,
  school: SchoolDoc,
): Promise<void> {
  const teacherAudience = isTeacherAudience(schedule.audienceType);

  for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
    const batch = recipients.slice(i, i + SEND_BATCH_SIZE);
    await Promise.allSettled(batch.map(r => {
      const message = teacherAudience
        ? `MyRegister: ${cleanedBody}`
        : buildParentMessage(r.name, cleanedBody, school.name, school.phone || "");
      return sendHostPinnacleSms({ mobile: normalizeSmsPhone(r.phone), message });
    }));
  }
}

async function logScheduleSend(
  schedule: ScheduledMessage,
  recipientCount: number,
  tokensUsedThisRun: number,
  cleanedBody: string,
): Promise<void> {
  await db.collection("messages").add({
    schoolId: schedule.schoolId,
    sentBy: schedule.createdBy,
    type: "custom",
    channel: "sms",
    recipients: schedule.classCode || schedule.audienceType,
    recipientCount,
    rawContent: cleanedBody,
    content: cleanedBody,
    smsSegments: Math.ceil((cleanedBody.length + 45) / 140),
    tokensUsed: tokensUsedThisRun,
    status: "sent",
    delivered: recipientCount,
    total: recipientCount,
    sentAt: new Date().toISOString(),
    scheduleId: schedule.id, // extra field beyond the base Message type — for traceability only
  });
}

function nextRunIso(dateStr: string, timeOfDay: string): string {
  const [h, m] = timeOfDay.split(":").map(Number);
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCHours(h - 3, m || 0, 0, 0); // Africa/Nairobi = UTC+3
  return d.toISOString();
}

async function advanceOrComplete(
  ref: FirebaseFirestore.DocumentReference,
  schedule: ScheduledMessage,
  firedDate: string,
  isBlocked: (dateStr: string) => boolean,
  tokensUsedThisRun: number,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const newTokensUsed = schedule.tokensUsed + tokensUsedThisRun;
  const newOccurrencesSent = schedule.occurrencesSent + 1;

  const next = findNextOccurrenceAfter(schedule.frequency, firedDate, isBlocked, schedule.endDate);
  const reachedPlannedCount = newOccurrencesSent >= schedule.occurrencesPlanned;

  if (!next || reachedPlannedCount) {
    await finaliseSchedule(ref, { ...schedule, tokensUsed: newTokensUsed, occurrencesSent: newOccurrencesSent }, "completed");
    return;
  }

  await ref.update({
    tokensUsed: newTokensUsed,
    occurrencesSent: newOccurrencesSent,
    lastRunAt: nowIso,
    nextRunAt: nextRunIso(next, schedule.timeOfDay),
    updatedAt: nowIso,
  });
}

async function finaliseSchedule(
  ref: FirebaseFirestore.DocumentReference,
  schedule: ScheduledMessage,
  status: "completed" | "stopped",
): Promise<void> {
  const remaining = schedule.tokensAllocated - schedule.tokensUsed;
  await refundRemaining(schedule.fundingSourceUid, remaining);
  await ref.update({
    status,
    nextRunAt: null,
    tokensAllocated: schedule.tokensUsed, // reservation now exactly matches what was spent
    updatedAt: new Date().toISOString(),
  });
}

export const scheduledMessagesPoller = onSchedule(
  { schedule: "every 10 minutes", timeZone: "Africa/Nairobi", region: "europe-west1", memory: "256MiB", timeoutSeconds: 300, secrets: [HP_SMS_USERID, HP_SMS_PASSWORD, HP_SMS_APIKEY, HP_SMS_SENDERID] },
  async () => {
    const nowIso = new Date().toISOString();
    const dueSnap = await db.collection("scheduledMessages")
      .where("status", "==", "active")
      .where("nextRunAt", "<=", nowIso)
      .limit(200) // safety cap per poll cycle — remaining due schedules pick up next cycle 10 min later
      .get();

    let processed = 0;
    for (const doc of dueSnap.docs) {
      try {
        await processSchedule(doc);
        processed++;
      } catch (err: any) {
        console.error(`scheduledMessagesPoller: failed processing ${doc.id}:`, err?.message || err);
      }
    }
    console.log(`scheduledMessagesPoller: processed ${processed}/${dueSnap.size} due schedule(s).`);
  },
);
