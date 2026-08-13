import { addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { HolidayPeriod } from '../types';
import { createScheduledMessage, stopScheduledMessage } from './scheduleService';

export async function listSchoolHolidays(schoolId: string): Promise<HolidayPeriod[]> {
  const snap = await getDocs(query(collection(db, 'schoolHolidays'), where('schoolId', '==', schoolId)));
  return snap.docs
    .map(d => d.data() as HolidayPeriod)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export interface HolidayFormInput {
  schoolId: string;
  name: string;
  startDate: string;
  endDate: string; // pass same as startDate for a single-day holiday
  kind: 'public' | 'custom';
  sendGoodbye: boolean;
  goodbyeMessage?: string;
  sendWelcomeBack: boolean;
  welcomeBackMessage?: string;
  createdBy: string;
}

/**
 * Creates the holiday period, and — if requested — the linked goodbye (fires on startDate)
 * and/or welcome-back (fires the day after endDate) broadcasts as ordinary 'once'
 * scheduledMessages with audienceType 'holiday_notice'. Those go through
 * createScheduledMessage like any other schedule, so they're funded and token-costed the
 * same way.
 */
export async function createHolidayPeriod(input: HolidayFormInput): Promise<string> {
  const ref = await addDoc(collection(db, 'schoolHolidays'), {
    schoolId: input.schoolId,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    kind: input.kind,
    sendGoodbye: input.sendGoodbye,
    goodbyeMessage: input.goodbyeMessage || '',
    sendWelcomeBack: input.sendWelcomeBack,
    welcomeBackMessage: input.welcomeBackMessage || '',
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const patch: Record<string, string> = {};

  if (input.sendGoodbye && input.goodbyeMessage?.trim()) {
    const result = await createScheduledMessage({
      schoolId: input.schoolId,
      audienceType: 'holiday_notice',
      messageBody: input.goodbyeMessage,
      frequency: 'once',
      timeOfDay: '12:00',
      startDate: input.startDate,
      includeWeekends: true,
      fundingSource: 'own',
      linkedHolidayPeriodId: ref.id,
      holidayNoticeVariant: 'goodbye',
    });
    if (result.id) patch.goodbyeScheduleId = result.id;
  }

  if (input.sendWelcomeBack && input.welcomeBackMessage?.trim()) {
    const dayAfterEnd = addOneDay(input.endDate);
    const result = await createScheduledMessage({
      schoolId: input.schoolId,
      audienceType: 'holiday_notice',
      messageBody: input.welcomeBackMessage,
      frequency: 'once',
      timeOfDay: '07:00',
      startDate: dayAfterEnd,
      includeWeekends: true,
      fundingSource: 'own',
      linkedHolidayPeriodId: ref.id,
      holidayNoticeVariant: 'welcomeBack',
    });
    if (result.id) patch.welcomeBackScheduleId = result.id;
  }

  if (Object.keys(patch).length > 0) {
    await updateDoc(doc(db, 'schoolHolidays', ref.id), patch);
  }

  return ref.id;
}

/** Deletes a holiday period. Any linked goodbye/welcome-back schedule is stopped first
 * (which refunds its unused tokens) rather than left to fire against a holiday that no
 * longer exists. */
export async function deleteHolidayPeriod(holiday: HolidayPeriod): Promise<void> {
  if (holiday.goodbyeScheduleId) {
    try { await stopScheduledMessage(holiday.goodbyeScheduleId); } catch { /* best-effort — proceed with deletion either way */ }
  }
  if (holiday.welcomeBackScheduleId) {
    try { await stopScheduledMessage(holiday.welcomeBackScheduleId); } catch { /* best-effort — proceed with deletion either way */ }
  }
  await deleteDoc(doc(db, 'schoolHolidays', holiday.id));
}

function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
