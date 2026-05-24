export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type UserRole = 'schoolAdmin' | 'teacherAdmin';

export interface UserProfile {
  uid: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  role: UserRole;
  schoolId: string;
  schoolName: string;
  classCode?: string; // for teachers
  createdAt: string;
  messageTokens: number; // free platform, tokens for messages only
}

export interface School {
  id: string;
  name: string;
  county: string;
  type: string;
  adminUid: string;
  createdAt: string;
}

export interface Student {
  id: string;
  name: string;
  admissionNo: string;
  classCode: string;
  schoolId: string;
  parentName: string;
  parentPhone: string;
  parentWhatsApp: string;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  date: string; // YYYY-MM-DD
  classCode: string;
  schoolId: string;
  status: AttendanceStatus;
  note: string;
  savedBy: string;
  savedAt: string;
  locked: boolean;
}

/** SMS pricing tiers based on recipient count snapshot */
export type SmsTier = 'small' | 'medium' | 'large';

export function getSmsTier(recipientCount: number): SmsTier {
  if (recipientCount <= 100) return 'small';
  if (recipientCount <= 300) return 'medium';
  return 'large';
}

/** Cost per single SMS (1 segment = 140 chars) per recipient */
export const SMS_COST_PER_SEGMENT: Record<SmsTier, number> = {
  small: 0.7,   // ≤100 recipients
  medium: 0.5,  // 101–300 recipients
  large: 0.4,   // >300 recipients
};

export const SMS_SEGMENT_LENGTH = 140;
export const SMS_MAX_LENGTH = 400; // = 3 segments max

/** Count how many 140-char segments a message uses (1–3) */
export function countSmsSegments(text: string): number {
  const len = text.length;
  if (len === 0) return 0;
  return Math.ceil(len / SMS_SEGMENT_LENGTH);
}

/** Strip emojis and non-text characters from a message before sending */
export function sanitiseSmsText(raw: string): string {
  return raw
    // Remove emoji & pictographs
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '') // variation selectors
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // flags
    // Remove other non-printable / control characters (keep basic Latin + extended Latin)
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u024F\r\n]/g, '')
    // Collapse multiple spaces
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Calculate total token cost for a send */
export function calcTokenCost(cleanedText: string, recipientCount: number): number {
  const segments = countSmsSegments(cleanedText);
  const tier = getSmsTier(recipientCount);
  const costPerSegment = SMS_COST_PER_SEGMENT[tier];
  // tokens = segments × recipients × cost-per-segment
  // We store tokens as fractional but display rounded to 2dp
  return Math.ceil(segments * recipientCount * costPerSegment);
}

export interface Message {
  id: string;
  schoolId: string;
  sentBy: string;
  type: 'attendance' | 'assignment' | 'notice' | 'activity' | 'alert' | 'custom';
  /** SMS only */
  channel: 'sms';
  recipients: string; // "All School" | "Grade 7A" etc.
  recipientCount: number;
  /** Raw content before sanitisation */
  rawContent: string;
  /** Sanitised content actually sent */
  content: string;
  smsSegments: number;
  smsTier: SmsTier;
  costPerSegment: number;
  tokensUsed: number;
  sentAt: string;
  delivered: number;
  total: number;
  /** For log UI */
  status: 'sent' | 'failed' | 'partial';
}

export interface RegisterDay {
  date: string;
  classCode: string;
  schoolId: string;
  savedBy: string;
  savedAt: string;
  locked: boolean;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
}