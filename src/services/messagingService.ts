/**
 * src/services/messagingService.ts
 *
 * MESSAGE FORMAT (every outbound SMS):
 *   Dear {parentName},
 *   {body}
 *   {schoolName}: {schoolPhone}
 */

import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import {
  Student,
  AttendanceStatus,
  SmsTier,
  BoardingType,
  sanitiseSmsText,
  countSmsSegments,
  calcTokenCost,
  getSmsTier,
  KES_RATE_PER_TOKEN,
  containsLink,
  stripLinks,
} from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SchoolInfo {
  id: string;
  name: string;
  phone: string;
  county?: string;
  boardingType?: BoardingType;
}

export interface SenderInfo {
  uid: string;
  displayName: string;
  phone: string | null;
  schoolId: string;
  schoolName: string;
  messageTokens: number;
}

export interface SmsJob {
  to: string;
  parentName: string;
  studentName: string;
  message: string;
  segments: number;
  tokensNeeded: number;
  type: 'absent' | 'late' | 'present' | 'custom' | 'system';
  studentId: string;
}

export interface RegisterSendResult {
  sent: number;
  failed: number;
  tokensUsed: number;
  warningSmsSent: boolean;
  reason?: string;
}

// ─── Core message builder ─────────────────────────────────────────────────────

/**
 * Builds the FULL message text shown in the compose box and sent to parents.
 *
 *   Dear {parentName},
 *   {body}
 *   {schoolName}: {schoolPhone}
 */
export function buildMessage(
  parentName: string,
  body: string,
  schoolName: string,
  schoolPhone: string,
): string {
  const safeName   = sanitiseSmsText(parentName) || 'Parent';
  const safeBody   = sanitiseSmsText(body).trim();
  const safeSchool = sanitiseSmsText(schoolName);
  const safePhone  = schoolPhone.replace(/[^\d+\s\-()\[\]]/g, '').trim();
  return `Dear ${safeName},\n${safeBody}\n${safeSchool}: ${safePhone}`;
}

// ─── Attendance templates ─────────────────────────────────────────────────────

export function attendanceBody(
  status: 'absent' | 'late' | 'present',
  studentName: string,
  className: string,
  teacherName: string,
  teacherPhone: string,
  date: string,
): string {
  const s = sanitiseSmsText(studentName);
  const c = sanitiseSmsText(className);
  const t = sanitiseSmsText(teacherName);
  const p = teacherPhone.replace(/[^\d+\s\-]/g, '');

  switch (status) {
    case 'absent':
      return (
        `${s} has been marked ABSENT from ${c} today, ${date}.\n` +
        `For more information, contact ${t}: ${p}.`
      );
    case 'late':
      return (
        `${s} arrived LATE to ${c} today, ${date}.\n` +
        `For more information, contact ${t}: ${p}.`
      );
    case 'present':
      return `${s} was marked PRESENT in ${c} today, ${date}.`;
  }
}

export function buildAttendanceSms(
  status: 'absent' | 'late' | 'present',
  student: Student,
  school: SchoolInfo,
  className: string,
  teacherName: string,
  teacherPhone: string,
  date: string,
): string {
  return buildMessage(
    student.parentName || 'Parent',
    attendanceBody(status, student.name, className, teacherName, teacherPhone, date),
    school.name,
    school.phone,
  );
}

// ─── Compose panel helpers ────────────────────────────────────────────────────

export function buildComposedMessage(
  body: string,
  school: SchoolInfo,
  parentNamePlaceholder = 'Parent Name',
): string {
  if (!body.trim()) return '';
  return buildMessage(parentNamePlaceholder, body, school.name, school.phone);
}

export function analyseComposedMessage(
  body: string,
  school: SchoolInfo,
  recipientCount: number,
): { fullText: string; charCount: number; segments: number; tokenCost: number; isOver: boolean } {
  const fullText  = buildComposedMessage(body, school);
  const cleaned   = sanitiseSmsText(fullText);
  const charCount = cleaned.length;
  const segments  = countSmsSegments(cleaned);
  const tokenCost = calcTokenCost(cleaned, recipientCount);
  return { fullText, charCount, segments, tokenCost, isOver: charCount > 400 };
}

export function extractBody(fullMessage: string): string {
  const lines = fullMessage.split('\n');
  if (lines.length <= 2) return fullMessage;
  return lines.slice(1, -1).join('\n');
}

// ─── Cloud Function caller ────────────────────────────────────────────────────

/**
 * Calls the sendSms Firebase callable function.
 * Uses httpsCallable so auth tokens are injected automatically.
 */
export async function callSendSmsFunction(payload: {
  phone: string | string[];
  message: string;
  schoolId: string;
  schoolName: string;
  type?: string;
}): Promise<{ success: boolean; reference?: string; error?: string }> {
  try {
    const functions = getFunctions(undefined, 'africa-south1');
    const sendSms   = httpsCallable<
      { phone: string | string[]; message: string; schoolId: string; schoolName: string },
      { success: boolean; reference: string; message: string }
    >(functions, 'sendSms');

    const result = await sendSms({
      phone:      payload.phone,
      message:    payload.message,
      schoolId:   payload.schoolId,
      schoolName: payload.schoolName,
    });

    return { success: result.data.success, reference: result.data.reference };
  } catch (err: any) {
    const msg = err?.message ?? 'Unknown error';
    console.error('callSendSmsFunction error:', msg);
    return { success: false, error: msg };
  }
}

// ─── Firestore logger ─────────────────────────────────────────────────────────

export async function logMessageToFirestore(params: {
  schoolId: string; sentBy: string; type: string; recipients: string;
  recipientCount: number; rawContent: string; content: string;
  smsSegments: number; tier: SmsTier; tokensUsed: number;
  status: 'sent' | 'failed' | 'partial'; delivered: number; total: number;
}): Promise<string> {
  const ref = await addDoc(collection(db, 'messages'), {
    ...params,
    channel: 'sms',
    smsTier: params.tier,
    costPerSegment: KES_RATE_PER_TOKEN[params.tier],
    sentAt: new Date().toISOString(),
  });
  return ref.id;
}

// ─── Free token-warning SMS ───────────────────────────────────────────────────

export async function sendTokenWarning(params: {
  toPhone: string; senderName: string; schoolName: string;
  tokensNeeded: number; tokensAvailable: number;
  absentCount: number; lateCount: number; schoolId: string;
}): Promise<void> {
  const msg =
    `MyRegister: Hi ${sanitiseSmsText(params.senderName)}, your register for ` +
    `${sanitiseSmsText(params.schoolName)} was saved but parent SMS notifications ` +
    `could NOT be sent. Required: ${params.tokensNeeded} tokens ` +
    `(${params.absentCount} absent, ${params.lateCount} late). ` +
    `Available: ${params.tokensAvailable}. ` +
    `Top up via M-Pesa to notify parents. myregister.co.ke`;

  await callSendSmsFunction({
    phone:      params.toPhone,
    message:    msg,
    schoolId:   params.schoolId,
    schoolName: params.schoolName,
  });
}

// ─── Register auto-send ───────────────────────────────────────────────────────

export async function sendRegisterNotifications(params: {
  students: Student[];
  attendance: Record<string, AttendanceStatus>;
  sender: SenderInfo;
  school: SchoolInfo;
  className: string;
  teacherName: string;
  teacherPhone: string;
  sendPresent?: boolean;
}): Promise<RegisterSendResult> {
  const { students, attendance, sender, school, className, teacherName, teacherPhone, sendPresent = false } = params;

  const date = new Date().toLocaleDateString('en-KE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const jobs: SmsJob[] = [];

  for (const student of students) {
    const status = attendance[student.id] ?? 'unmarked';
    if (status === 'excused' || status === 'unmarked') continue;
    if (status === 'present' && !sendPresent) continue;
    if (!student.parentPhone?.trim())         continue;

    const tmpl = status === 'absent' ? 'absent' : status === 'late' ? 'late' : 'present';
    const fullMessage = buildAttendanceSms(tmpl, student, school, className, teacherName, teacherPhone, date);
    const segments = countSmsSegments(sanitiseSmsText(fullMessage));

    jobs.push({
      to: student.parentPhone,
      parentName: student.parentName || 'Parent',
      studentName: student.name,
      message: fullMessage,
      segments,
      tokensNeeded: segments,
      type: tmpl,
      studentId: student.id,
    });
  }

  if (jobs.length === 0) return { sent: 0, failed: 0, tokensUsed: 0, warningSmsSent: false };

  const totalNeeded = jobs.reduce((s, j) => s + j.tokensNeeded, 0);
  const tier = getSmsTier(students.length);

  if (sender.messageTokens < totalNeeded) {
    const absentCount = jobs.filter(j => j.type === 'absent').length;
    const lateCount   = jobs.filter(j => j.type === 'late').length;
    let warningSmsSent = false;

    if (sender.phone) {
      try {
        await sendTokenWarning({
          toPhone:         sender.phone,
          senderName:      sender.displayName,
          schoolName:      school.name,
          tokensNeeded:    totalNeeded,
          tokensAvailable: sender.messageTokens,
          absentCount,
          lateCount,
          schoolId:        sender.schoolId,
        });
        warningSmsSent = true;
      } catch (_) {}
    }

    await logMessageToFirestore({
      schoolId: sender.schoolId, sentBy: sender.displayName, type: 'attendance',
      recipients: className, recipientCount: jobs.length,
      rawContent: `[AUTO] Register ${date} — blocked`,
      content: `[BLOCKED] Need ${totalNeeded} tokens, had ${sender.messageTokens}.`,
      smsSegments: 0, tier, tokensUsed: 0, status: 'failed', delivered: 0, total: jobs.length,
    });

    return {
      sent: 0, failed: jobs.length, tokensUsed: 0, warningSmsSent,
      reason: `Insufficient tokens. Need ${totalNeeded}, available ${sender.messageTokens}.`,
    };
  }

  let sent = 0, failed = 0;
  const BATCH = 5;

  for (let i = 0; i < jobs.length; i += BATCH) {
    const results = await Promise.allSettled(
      jobs.slice(i, i + BATCH).map(job =>
        callSendSmsFunction({
          phone:      job.to,
          message:    job.message,
          schoolId:   sender.schoolId,
          schoolName: sender.schoolName,
        }),
      ),
    );
    results.forEach(r => { if (r.status === 'fulfilled' && r.value.success) sent++; else failed++; });
  }

  const tokensUsed = Math.min(totalNeeded, sender.messageTokens);
  try {
    await updateDoc(doc(db, 'users', sender.uid), { messageTokens: sender.messageTokens - tokensUsed });
  } catch (_) {}

  const sample = sanitiseSmsText(jobs[0]?.message ?? '');
  await logMessageToFirestore({
    schoolId: sender.schoolId, sentBy: sender.displayName, type: 'attendance',
    recipients: className, recipientCount: jobs.length,
    rawContent: `[AUTO] Register ${date}. ${jobs.filter(j=>j.type==='absent').length} absent, ${jobs.filter(j=>j.type==='late').length} late.`,
    content: sample, smsSegments: Math.ceil(sample.length / 140),
    tier, tokensUsed,
    status: failed === 0 ? 'sent' : sent > 0 ? 'partial' : 'failed',
    delivered: sent, total: jobs.length,
  });

  return { sent, failed, tokensUsed, warningSmsSent: false };
}

// ─── Broadcast send ───────────────────────────────────────────────────────────

export async function sendBroadcast(params: {
  bodyText: string;
  recipients: Student[];
  sender: SenderInfo;
  school: SchoolInfo;
  type: string;
  recipientsLabel: string;
}): Promise<{ sent: number; failed: number; tokensUsed: number; error?: string; linksRemoved?: boolean }> {
  const { recipients, sender, school, type, recipientsLabel } = params;

  // Links are never allowed in parent messages (phishing/spam risk) — this is the final
  // checkpoint before anything reaches the send function, even if the compose UI's live
  // cleaning was somehow bypassed.
  const linksRemoved = containsLink(params.bodyText);
  const bodyText = stripLinks(params.bodyText);
  if (!bodyText.trim()) {
    return { sent: 0, failed: 0, tokensUsed: 0, error: 'Message is empty after removing links — links are not allowed in parent messages.', linksRemoved };
  }

  const sample      = sanitiseSmsText(buildMessage('Parent', bodyText, school.name, school.phone));
  const segments    = countSmsSegments(sample);
  const tier        = getSmsTier(recipients.length);
  const totalTokens = segments * recipients.length;

  if (sender.messageTokens < totalTokens) {
    return { sent: 0, failed: recipients.length, tokensUsed: 0,
      error: `Insufficient tokens. Need ${totalTokens}, available ${sender.messageTokens}.`, linksRemoved };
  }

  const phones = recipients
    .filter(r => r.parentPhone?.trim())
    .map(r => r.parentPhone);

  if (phones.length === 0) {
    return { sent: 0, failed: 0, tokensUsed: 0, error: 'No recipients with a phone number.', linksRemoved };
  }

  // Single bulk call — cloud function accepts string[] and joins to a comma-separated
  // string for HostPinnacle, so all recipients receive the message in one request.
  // Broadcast uses a generic "Dear Parent," header since one body goes to everyone.
  const result = await callSendSmsFunction({
    phone:      phones,
    message:    sample,
    schoolId:   sender.schoolId,
    schoolName: sender.schoolName,
  });

  const sent       = result.success ? phones.length : 0;
  const failed     = result.success ? 0 : phones.length;
  const tokensUsed = result.success ? Math.min(totalTokens, sender.messageTokens) : 0;

  if (tokensUsed > 0) {
    try {
      await updateDoc(doc(db, 'users', sender.uid), { messageTokens: sender.messageTokens - tokensUsed });
    } catch (_) {}
  }

  await logMessageToFirestore({
    schoolId: sender.schoolId, sentBy: sender.displayName, type,
    recipients: recipientsLabel, recipientCount: phones.length,
    rawContent: bodyText, content: sample, smsSegments: segments,
    tier, tokensUsed,
    status: result.success ? 'sent' : 'failed',
    delivered: sent, total: phones.length,
  });

  return { sent, failed, tokensUsed, error: result.error, linksRemoved };
}