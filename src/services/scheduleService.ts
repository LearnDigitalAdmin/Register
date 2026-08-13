import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where } from 'firebase/firestore';
import app, { db } from '../firebase';
import {
  ScheduledMessage, ScheduleAudienceType, ScheduleFrequency, ScheduleFundingSource,
  HolidayNoticeVariant, Student,
} from '../types';

const functions = getFunctions(app, 'africa-south1');

// ─── Callable wrappers ──────────────────────────────────────────────────────

export interface ScheduleFormInput {
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
  holidayNoticeVariant?: HolidayNoticeVariant;
}

export interface ScheduleMutationResult {
  id?: string;
  tokensRequired: number;
  tokensAllocated: number;
  insufficientTokens: boolean;
  occurrencesPlanned?: number;
  nextRunAt: string | null;
}

export async function createScheduledMessage(
  input: ScheduleFormInput & { fundingSource: ScheduleFundingSource },
): Promise<ScheduleMutationResult> {
  const fn = httpsCallable<typeof input, ScheduleMutationResult>(functions, 'createScheduledMessage');
  const result = await fn(input);
  return result.data;
}

export async function editScheduledMessage(
  input: ScheduleFormInput & { id: string },
): Promise<ScheduleMutationResult> {
  const fn = httpsCallable<typeof input, ScheduleMutationResult>(functions, 'editScheduledMessage');
  const result = await fn(input);
  return result.data;
}

export async function stopScheduledMessage(id: string): Promise<{ stopped?: boolean; alreadyEnded?: boolean; refunded?: number }> {
  const fn = httpsCallable<{ id: string }, { stopped?: boolean; alreadyEnded?: boolean; refunded?: number }>(functions, 'stopScheduledMessage');
  const result = await fn({ id });
  return result.data;
}

export async function deleteScheduledMessage(id: string): Promise<{ deleted: boolean }> {
  const fn = httpsCallable<{ id: string }, { deleted: boolean }>(functions, 'deleteScheduledMessage');
  const result = await fn({ id });
  return result.data;
}

export async function rescheduleCompletedMessage(
  input: { id: string; startDate: string; endDate?: string; timeOfDay?: string },
): Promise<ScheduleMutationResult> {
  const fn = httpsCallable<typeof input, ScheduleMutationResult>(functions, 'rescheduleCompletedMessage');
  const result = await fn(input);
  return result.data;
}

/** Called once by promotionService.applyPromotion() right after a promotion completes —
 * stops every active/insufficientTokens schedule at the school, refunding unused tokens,
 * since class codes shift on promotion and a stale schedule would silently misfire. */
export async function resetSchedulesForNewAcademicYear(schoolId: string): Promise<{ stopped: number }> {
  const fn = httpsCallable<{ schoolId: string }, { stopped: number }>(functions, 'resetSchedulesForNewAcademicYear');
  const result = await fn({ schoolId });
  return result.data;
}

// ─── Listing ────────────────────────────────────────────────────────────────

export async function listSchoolSchedules(schoolId: string): Promise<ScheduledMessage[]> {
  const snap = await getDocs(query(collection(db, 'scheduledMessages'), where('schoolId', '==', schoolId)));
  return snap.docs
    .map(d => d.data() as ScheduledMessage)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Live recipient-count estimate (preview only — server recomputes authoritatively) ──

export interface AudienceEstimateInput {
  schoolId: string;
  audienceType: ScheduleAudienceType;
  classCode?: string;
  recipientUids?: string[];
  recipientStudentIds?: string[];
}

export async function estimateRecipientCount(input: AudienceEstimateInput): Promise<number> {
  const { schoolId, audienceType, classCode, recipientUids, recipientStudentIds } = input;

  switch (audienceType) {
    case 'teachers_selected':
      return recipientUids?.length ?? 0;

    case 'teachers_all': {
      const snap = await getDocs(query(
        collection(db, 'users'), where('schoolId', '==', schoolId), where('role', '==', 'teacherAdmin'),
      ));
      return snap.size;
    }

    case 'parents_selected':
      return recipientStudentIds?.length ?? 0;

    case 'parents_class': {
      if (!classCode) return 0;
      const snap = await getDocs(query(
        collection(db, 'students'), where('schoolId', '==', schoolId), where('classCode', '==', classCode),
      ));
      return snap.docs.filter(d => !!(d.data() as Student).parentPhone?.trim()).length;
    }

    case 'parents_school':
    case 'holiday_notice': {
      let q = query(collection(db, 'students'), where('schoolId', '==', schoolId));
      if (classCode) q = query(collection(db, 'students'), where('schoolId', '==', schoolId), where('classCode', '==', classCode));
      const snap = await getDocs(q);
      return snap.docs.filter(d => !!(d.data() as Student).parentPhone?.trim()).length;
    }
  }
}
